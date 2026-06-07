import { useCallback, useRef, useState } from 'react';
import { useStore } from '../state/store';
import {
  fftResolution,
  formatBytes,
  formatDuration,
  formatFftSize,
  formatStretchFactor,
  shouldWarn,
  sliderToStreamingFftSize,
  sliderToStretch,
} from '../state/mappings';
import { densifyLogValuesWithBreakpoints } from './EnvelopeEditor/interpolation';
import type { RenderJob } from '../audio/render/types';
import { runRender } from '../audio/render/runRender';
import { encodeWavPcm16Async, estimateWavPcm16Size, WAV_MAX_BYTES } from '../audio/render/wav';
import { getUploadUrl } from '../audio/loadInjected';
import { cancel, closeWithResult } from '../ipc';
import { ConfirmDialog } from './ConfirmDialog';
import { ProgressDialog } from './ProgressDialog';

type Status =
  | { kind: 'idle' }
  | { kind: 'confirm' }
  | { kind: 'rendering'; fraction: number }
  | { kind: 'encoding'; fraction: number }
  | { kind: 'uploading' }
  | { kind: 'cancelling' }
  | { kind: 'error'; message: string };

export function ApplyBar() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const processParams = useStore((s) => s.processParams);
  const binauralParams = useStore((s) => s.binauralParams);
  const envelope = useStore((s) => s.envelope);

  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const jobIdRef = useRef(0);
  const abortRef = useRef<AbortController | null>(null);

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

  // The render → encode → upload pipeline. Called directly for short outputs, or
  // from the warning dialog's confirm for long ones. Cancellable at every phase
  // via the shared AbortController.
  const startRender = useCallback(async () => {
    const uploadUrl = getUploadUrl();
    const job = buildJob();
    if (!job || !uploadUrl) return;

    const ac = new AbortController();
    abortRef.current = ac;
    setStatus({ kind: 'rendering', fraction: 0 });
    try {
      const rendered = await runRender(job, {
        signal: ac.signal,
        onProgress: (f) => setStatus({ kind: 'rendering', fraction: f }),
      });
      setStatus({ kind: 'encoding', fraction: 0 });
      const blob = await encodeWavPcm16Async(rendered.channels, rendered.sampleRate, {
        signal: ac.signal,
        onProgress: (f) => setStatus({ kind: 'encoding', fraction: f }),
      });
      setStatus({ kind: 'uploading' });
      const response = await fetch(uploadUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'audio/wav' },
        body: blob,
        signal: ac.signal,
      });
      if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`Upload failed: HTTP ${response.status} ${text}`);
      }
      closeWithResult({ sampleRate: rendered.sampleRate });
      // After closeWithResult the host tears down the webview; UI state below
      // this line is moot.
    } catch (err) {
      if (ac.signal.aborted || (err instanceof Error && err.name === 'AbortError')) {
        setStatus({ kind: 'idle' });
      } else {
        setStatus({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      abortRef.current = null;
    }
  }, [buildJob]);

  const onApply = useCallback(() => {
    if (!source) return;
    if (tooLarge) {
      setStatus({
        kind: 'error',
        message: `Output exceeds the 4 GiB WAV limit. Lower the stretch factor.`,
      });
      return;
    }
    if (!getUploadUrl()) {
      setStatus({
        kind: 'error',
        message: 'No upload endpoint available — run inside Ableton Live.',
      });
      return;
    }
    if (shouldWarn(outDurationSec)) {
      setStatus({ kind: 'confirm' });
      return;
    }
    void startRender();
  }, [source, tooLarge, outDurationSec, startRender]);

  const onCancel = useCallback(() => {
    cancel();
  }, []);

  const onCancelRender = useCallback(() => {
    setStatus({ kind: 'cancelling' });
    abortRef.current?.abort();
  }, []);

  const busy =
    status.kind === 'rendering' ||
    status.kind === 'encoding' ||
    status.kind === 'uploading' ||
    status.kind === 'cancelling';

  const progress = progressView(status, outDurationSec);

  return (
    <div className="apply-bar">
      <div className="apply-info">
        <span>Stretch: {formatStretchFactor(stretch)} → {formatDuration(outDurationSec)}</span>
        <span className="apply-sep">·</span>
        <span>Window: {formatFftSize(fftSize)} ({res.seconds.toFixed(3)}s)</span>
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

      {status.kind === 'confirm' && (
        <ConfirmDialog
          title="Long render"
          body={
            <p>
              This will produce {envelope.enabled ? 'about ' : ''}
              <strong>{formatDuration(outDurationSec)}</strong> of audio
              {' '}(~{formatBytes(outBytes)}) and may take a while. Render anyway?
            </p>
          }
          confirmLabel="Render anyway"
          cancelLabel="Cancel"
          onConfirm={() => void startRender()}
          onCancel={() => setStatus({ kind: 'idle' })}
        />
      )}

      {progress && (
        <ProgressDialog
          title={progress.title}
          phaseLabel={progress.label}
          fraction={progress.fraction}
          canCancel={status.kind !== 'cancelling'}
          onCancel={onCancelRender}
        />
      )}
    </div>
  );
}

// Maps the busy states to the progress overlay's title/label/fraction; returns
// null when no overlay should show.
function progressView(
  status: Status,
  outDurationSec: number,
): { title: string; label: string; fraction: number | null } | null {
  switch (status.kind) {
    case 'rendering':
      return {
        title: 'Rendering audio',
        label: `Rendering · ${formatDuration(outDurationSec)}`,
        fraction: status.fraction,
      };
    case 'encoding':
      return { title: 'Encoding WAV', label: 'Encoding', fraction: status.fraction };
    case 'uploading':
      return { title: 'Saving', label: 'Saving to Live', fraction: null };
    case 'cancelling':
      return { title: 'Cancelling', label: 'Cancelling…', fraction: null };
    default:
      return null;
  }
}
