import { useCallback, useEffect, useRef, useState } from 'react';
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
import type {
  RenderJob,
  RenderMainToWorker,
  RenderWorkerToMain,
} from '../audio/render/types';
import {
  encodeWavPcm16,
  estimateWavPcm16Size,
  stretchedFilename,
  WAV_MAX_BYTES,
} from '../audio/render/wav';

type RenderStatus =
  | { kind: 'idle' }
  | { kind: 'rendering' }
  | { kind: 'encoding' }
  | { kind: 'done'; filename: string }
  | { kind: 'error'; message: string };

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KiB', 'MiB', 'GiB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}

export function WriteToFilePanel() {
  const source = useStore((s) => s.source);
  const params = useStore((s) => s.params);
  const processParams = useStore((s) => s.processParams);
  const binauralParams = useStore((s) => s.binauralParams);
  const envelope = useStore((s) => s.envelope);

  const [status, setStatus] = useState<RenderStatus>({ kind: 'idle' });
  const workerRef = useRef<Worker | null>(null);
  const jobIdRef = useRef(0);

  // The render worker is heavier than the streaming one (it allocates the
  // entire output buffer). Tear it down when the panel unmounts.
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
    };
  }, []);

  const sr = source?.sampleRate ?? 44100;
  const dur = source?.durationSec ?? 0;
  const stretch = sliderToStretch(params.mode, params.stretchSlider);
  // Offline rendering reuses the same FFT-size mapping as preview so the
  // result matches what the user just heard. The streaming-clamped size
  // (<=64K) is enough headroom for everything other than max-slider
  // hyperstretch, and matches what was previewed.
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
  }, [source, params, processParams, binauralParams, envelope, stretch, fftSize]);

  const onRender = useCallback(async () => {
    if (!source) return;
    if (tooLarge) {
      setStatus({
        kind: 'error',
        message: `Output would be ${formatBytes(outBytes)} — exceeds the 4 GiB WAV limit. Lower the stretch factor.`,
      });
      return;
    }
    const job = buildJob();
    if (!job) return;

    // Reuse the worker across renders so the wasm module stays warm.
    if (!workerRef.current) {
      workerRef.current = new Worker(
        new URL('../audio/render/render-worker.ts', import.meta.url),
        { type: 'module' },
      );
    }
    const worker = workerRef.current;

    setStatus({ kind: 'rendering' });

    const transfer = job.channels.map((c) => c.buffer);
    const result = await new Promise<RenderWorkerToMain>((resolve) => {
      const onMessage = (e: MessageEvent<RenderWorkerToMain>) => {
        const m = e.data;
        if (m.type === 'rendered' && m.jobId === job.jobId) {
          worker.removeEventListener('message', onMessage);
          resolve(m);
        } else if (m.type === 'error') {
          worker.removeEventListener('message', onMessage);
          resolve(m);
        }
      };
      worker.addEventListener('message', onMessage);
      const msg: RenderMainToWorker = { type: 'render', ...job };
      worker.postMessage(msg, transfer);
    });

    if (result.type === 'error') {
      setStatus({ kind: 'error', message: result.message });
      return;
    }
    if (result.type !== 'rendered') return;

    setStatus({ kind: 'encoding' });
    try {
      const blob = encodeWavPcm16(result.channels, result.sampleRate);
      const filename = stretchedFilename(source.name);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      // Revoke after the browser has consumed the URL. A microtask is too
      // early in some browsers; a frame is plenty.
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setStatus({ kind: 'done', filename });
    } catch (err) {
      setStatus({
        kind: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, [source, buildJob, outBytes, tooLarge]);

  const busy = status.kind === 'rendering' || status.kind === 'encoding';

  return (
    <div className="parameters-panel write-panel">
      <div className="param-row">
        <span className="label">
          Stretch: {formatStretchFactor(stretch)} ({formatDuration(dur * stretch)})
        </span>
      </div>
      <div className="param-row sub">
        <span className="label small">
          Window: {formatFftSize(fftSize)} ({res.seconds.toFixed(4)} s, {res.hz.toFixed(4)} Hz)
        </span>
      </div>
      <hr />
      <div className="param-row">
        <span className="label">Format:</span>
        <span className="value-readout" style={{ minWidth: 0 }}>WAV, 16-bit PCM</span>
        <span className="label small" style={{ marginLeft: 'auto' }}>
          {numChannels === 2 ? 'Stereo' : numChannels === 1 ? 'Mono' : '—'}, {sr} Hz
        </span>
      </div>
      <div className="param-row">
        <span className="label">Output:</span>
        <span className="value-readout">
          {source ? `${formatDuration(outDurationSec)} (${formatBytes(outBytes)})` : '—'}
        </span>
      </div>
      {tooLarge && (
        <div className="param-row">
          <span className="label small" style={{ color: 'var(--accent-red)' }}>
            Exceeds the 4 GiB WAV limit. Lower the stretch factor or shorten the source.
          </span>
        </div>
      )}
      <hr />
      <div className="param-row">
        <button
          className="menu-button"
          disabled={!source || busy || tooLarge}
          onClick={onRender}
          title={!source ? 'Load a source file first' : 'Render and download a WAV file'}
        >
          {busy ? 'Rendering…' : 'Render & download'}
        </button>
        <span className="status" style={{ minWidth: 200 }}>
          <span
            className={
              'status-dot ' +
              (status.kind === 'rendering' || status.kind === 'encoding'
                ? 'rendering'
                : status.kind === 'done'
                  ? 'done'
                  : status.kind === 'error'
                    ? 'error'
                    : 'idle')
            }
          />
          {status.kind === 'idle' && 'Idle'}
          {status.kind === 'rendering' && 'Rendering…'}
          {status.kind === 'encoding' && 'Encoding WAV…'}
          {status.kind === 'done' && `Saved ${status.filename}`}
          {status.kind === 'error' && `Error: ${status.message}`}
        </span>
      </div>
      <div className="param-row sub">
        <span className="label small">
          Renders use the current Parameters / Process / Binaural beats settings. The page may
          appear unresponsive on very long stretches — the work happens in a background worker.
        </span>
      </div>
    </div>
  );
}
