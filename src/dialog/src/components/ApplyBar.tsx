import { useCallback, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  fftResolution,
  formatDuration,
  formatFftSize,
  formatStretchFactor,
  sliderToStreamingFftSize,
  sliderToStretch,
} from '../state/mappings';
import { densifyLogValuesWithBreakpoints } from './EnvelopeEditor/interpolation';
import type { RenderJob } from '../audio/render/types';
import { runRender } from '../audio/render/runRender';
import { encodeWavPcm16, estimateWavPcm16Size, WAV_MAX_BYTES } from '../audio/render/wav';
import { getUploadUrl } from '../audio/loadInjected';
import { cancel, closeWithResult } from '../ipc';

type Status =
  | { kind: 'idle' }
  | { kind: 'rendering' }
  | { kind: 'encoding' }
  | { kind: 'uploading' }
  | { kind: 'error'; message: string };

export function ApplyBar() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const processParams = useStore((s) => s.processParams);
  const binauralParams = useStore((s) => s.binauralParams);
  const envelope = useStore((s) => s.envelope);

  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const jobIdRef = useRef(0);

  const sr = source?.sampleRate ?? 44100;
  const dur = source?.durationSec ?? 0;
  const stretch = sliderToStretch(params.mode, params.stretchSlider);
  const fftSize = sliderToStreamingFftSize(params.windowSlider);
  const res = fftResolution(fftSize, sr);
  const numChannels = source?.channels.length ?? 0;
  const outFrames = Math.round(dur * stretch * sr);
  const outBytes = numChannels > 0 ? estimateWavPcm16Size(outFrames, numChannels) : 0;
  const outDurationSec = dur * stretch;
  const tooLarge = outBytes > WAV_MAX_BYTES;

  const buildJob = useCallback((): RenderJob | null => {
    if (!source) return null;
    const { arbitraryFilter, ...processOptions } = processParams;
    const filterCurve = arbitraryFilter.enabled
      ? densifyLogValuesWithBreakpoints(arbitraryFilter, 512)
      : { positions: new Float32Array(0), values: new Float32Array(0) };
    const envCurve = envelope.enabled
      ? densifyLogValuesWithBreakpoints(envelope, 256)
      : null;
    const binauralCurve = densifyLogValuesWithBreakpoints(binauralParams.frequencyEnvelope, 256);

    return {
      jobId: ++jobIdRef.current,
      sampleRate: source.sampleRate,
      channels: source.channels.map((c) => new Float32Array(c)),
      stretch,
      fftSize,
      windowType: params.windowType,
      onsetSensitivity: params.onsetSensitivity,
      processOptions,
      arbitraryFilter: {
        enabled: arbitraryFilter.enabled,
        positions: filterCurve.positions,
        values: filterCurve.values,
      },
      stretchEnvelope: envCurve
        ? { positions: envCurve.positions, values: envCurve.values }
        : null,
      binaural: {
        enabled: binauralParams.enabled,
        stereoMode: binauralParams.stereoMode,
        mono: binauralParams.mono,
        beatFrequencyHz: binauralParams.beatFrequencyHz,
        frequencyEnvelope: {
          positions: binauralCurve.positions,
          values: binauralCurve.values,
        },
      },
    };
  }, [source, params, processParams, binauralParams, envelope, stretch, fftSize, jobIdRef]);

  const onApply = useCallback(async () => {
    if (!source) return;
    if (tooLarge) {
      setStatus({
        kind: 'error',
        message: `Output exceeds the 4 GiB WAV limit. Lower the stretch factor.`,
      });
      return;
    }
    const uploadUrl = getUploadUrl();
    if (!uploadUrl) {
      setStatus({
        kind: 'error',
        message: 'No upload endpoint available — run inside Ableton Live.',
      });
      return;
    }
    const job = buildJob();
    if (!job) return;
    setStatus({ kind: 'rendering' });
    try {
      const rendered = await runRender(job);
      setStatus({ kind: 'encoding' });
      const blob = encodeWavPcm16(rendered.channels, rendered.sampleRate);
      setStatus({ kind: 'uploading' });
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: blob,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Upload failed: HTTP ${response.status} ${text}`);
      }
      closeWithResult({ sampleRate: rendered.sampleRate });
      // After closeWithResult the host tears down the webview; UI state below
      // this line is moot.
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [source, buildJob, tooLarge]);

  const onCancel = useCallback(() => {
    cancel();
  }, []);

  const busy =
    status.kind === 'rendering' ||
    status.kind === 'encoding' ||
    status.kind === 'uploading';

  return (
    <div className="apply-bar">
      <div className="apply-info">
        <span>Stretch: {formatStretchFactor(stretch)} → {formatDuration(outDurationSec)}</span>
        <span className="apply-sep">·</span>
        <span>Window: {formatFftSize(fftSize)} ({res.seconds.toFixed(3)}s)</span>
        {status.kind === 'rendering' && <span className="apply-status">Rendering…</span>}
        {status.kind === 'encoding' && <span className="apply-status">Encoding WAV…</span>}
        {status.kind === 'uploading' && <span className="apply-status">Saving…</span>}
        {status.kind === 'error' && <span className="apply-status error">Error: {status.message}</span>}
      </div>
      <div className="apply-buttons">
        <button className="menu-button" onClick={onCancel} disabled={busy}>
          Cancel
        </button>
        <button
          className="menu-button primary"
          onClick={onApply}
          disabled={!source || busy || tooLarge}
        >
          {busy ? 'Working…' : 'Apply'}
        </button>
      </div>
    </div>
  );
}
