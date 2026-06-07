/// <reference lib="webworker" />
import PaulstretchModule, {
  type BinauralBeatsProcessor,
  type OfflineRenderer,
  type PaulstretchModule as PSModule,
} from '@olilarkin/paulstretch-wasm';
import wasmUrl from '@olilarkin/paulstretch-wasm/paulstretch.wasm?url';
import type { BinauralStereoMode, WindowType } from '../../types';
import type { RenderJob, RenderMainToWorker, RenderWorkerToMain } from './types';

let modulePromise: Promise<PSModule> | null = null;
function getModule(): Promise<PSModule> {
  if (!modulePromise) {
    modulePromise = PaulstretchModule({
      locateFile: (path: string) => (path.endsWith('.wasm') ? wasmUrl : path),
    });
  }
  return modulePromise;
}

function mapWindow(M: PSModule, w: WindowType): number {
  switch (w) {
    case 'Rectangular': return M.Window.Rectangular;
    case 'Hamming': return M.Window.Hamming;
    case 'Hann': return M.Window.Hann;
    case 'Blackman': return M.Window.Blackman;
    case 'BlackmanHarris': return M.Window.BlackmanHarris;
    default: return M.Window.Hann;
  }
}

function mapBinauralMode(M: PSModule, mode: BinauralStereoMode): number {
  switch (mode) {
    case 'LeftRight': return M.BinauralStereoMode.LeftRight;
    case 'RightLeft': return M.BinauralStereoMode.RightLeft;
    case 'Symmetric': return M.BinauralStereoMode.Symmetric;
    default: return M.BinauralStereoMode.LeftRight;
  }
}

function post(msg: RenderWorkerToMain, transfer?: Transferable[]): void {
  (self as DedicatedWorkerGlobalScope).postMessage(msg, transfer ?? []);
}

// Posts a `progress` message, throttled to integer-percent changes. A long
// render fires `onChunk` thousands of times; this caps it at ~101 messages.
function makeProgressEmitter(jobId: number): (fraction: number) => void {
  let lastPct = -1;
  return (fraction) => {
    const f = fraction < 0 ? 0 : fraction > 1 ? 1 : fraction;
    const pct = Math.floor(f * 100);
    if (pct !== lastPct) {
      lastPct = pct;
      post({ type: 'progress', jobId, fraction: f });
    }
  };
}

// Render into a single JS-heap buffer one chunk at a time. The whole-buffer
// renderMono/renderStereo hold the entire output in WASM linear memory twice
// over (the C++ buffer plus the returned copy), so a large stretch factor can
// blow past the 4 GiB wasm32 cap and abort — see paulstretch-for-live#2. The
// chunked API keeps peak WASM memory at ~input + one chunk regardless of output
// length; we accumulate the chunks here on the (much larger) JS heap.
// estimateOutputFrames is an upper bound, so we pre-size to it and trim to the
// frames actually written.
function renderMonoToHeap(
  renderer: OfflineRenderer,
  input: Float32Array,
  onProgress: (fraction: number) => void,
): Float32Array {
  const cap = renderer.estimateOutputFrames(input.length);
  const out = new Float32Array(cap);
  let off = 0;
  renderer.renderMonoChunked(input, (chunk) => {
    out.set(chunk, off);
    off += chunk.length;
    if (cap > 0) onProgress(off / cap);
  });
  return out.subarray(0, off);
}

function renderStereoToHeap(
  renderer: OfflineRenderer,
  left: Float32Array,
  right: Float32Array,
  onProgress: (fraction: number) => void,
): { left: Float32Array; right: Float32Array } {
  const cap = renderer.estimateOutputFrames(left.length);
  const outL = new Float32Array(cap);
  const outR = new Float32Array(cap);
  let off = 0;
  renderer.renderStereoChunked(left, right, (l, r) => {
    outL.set(l, off);
    outR.set(r, off);
    off += l.length;
    if (cap > 0) onProgress(off / cap);
  });
  return { left: outL.subarray(0, off), right: outR.subarray(0, off) };
}

function processBinaural(
  M: PSModule,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  cfg: RenderJob['binaural'],
  onProgress: (fraction: number) => void,
): { left: Float32Array; right: Float32Array } {
  const bp: BinauralBeatsProcessor = new M.BinauralBeatsProcessor(sampleRate);
  bp.setOptions({
    enabled: true,
    stereoMode: mapBinauralMode(M, cfg.stereoMode) as never,
    mono: cfg.mono,
    beatFrequencyHz: cfg.beatFrequencyHz,
  });
  if (cfg.frequencyEnvelope.positions.length > 0) {
    bp.setFrequencyEnvelope(cfg.frequencyEnvelope.positions, cfg.frequencyEnvelope.values);
  }

  const total = left.length;
  const outL = new Float32Array(total);
  const outR = new Float32Array(total);
  // Chunk so positionPct sweeps 0..100 across the rendered output, matching
  // how the streaming engine drives the same envelope during preview.
  const CHUNK = 8192;
  for (let off = 0; off < total; off += CHUNK) {
    const end = Math.min(off + CHUNK, total);
    const positionPct = total === 0 ? 0 : (100.0 * off) / total;
    const r = bp.process(left.subarray(off, end), right.subarray(off, end), positionPct);
    outL.set(r.left, off);
    outR.set(r.right, off);
    if (total > 0) onProgress(end / total);
  }
  bp.delete();
  return { left: outL, right: outR };
}

async function handleRender(job: RenderJob): Promise<void> {
  const M = await getModule();
  const win = mapWindow(M, job.windowType) as never;

  // When binaural is enabled the render is followed by a second O(n) pass, so
  // split the progress bar: render fills 0–0.5, the binaural pass 0.5–1.0. With
  // no binaural, render owns the full 0–1.
  const emit = makeProgressEmitter(job.jobId);
  const renderScale = job.binaural.enabled ? 0.5 : 1.0;
  const renderProgress = (f: number) => emit(f * renderScale);
  const binauralProgress = (f: number) => emit(0.5 + f * 0.5);

  let renderer: OfflineRenderer | null = null;
  try {
    renderer = new M.OfflineRenderer(
      job.stretch,
      job.fftSize,
      job.sampleRate,
      win,
      job.onsetSensitivity,
    );

    if (job.stretchEnvelope && job.stretchEnvelope.positions.length > 0) {
      renderer.setStretchEnvelope(job.stretchEnvelope.positions, job.stretchEnvelope.values);
    }

    renderer.setProcessOptions({
      ...job.processOptions,
      arbitraryFilterEnabled: job.arbitraryFilter.enabled,
    });
    if (job.arbitraryFilter.enabled && job.arbitraryFilter.positions.length > 0) {
      renderer.setArbitraryFilter(job.arbitraryFilter.positions, job.arbitraryFilter.values);
    }

    let left: Float32Array;
    let right: Float32Array | null;
    if (job.channels.length >= 2) {
      const out = renderStereoToHeap(renderer, job.channels[0], job.channels[1], renderProgress);
      left = out.left;
      right = out.right;
    } else {
      left = renderMonoToHeap(renderer, job.channels[0], renderProgress);
      right = null;
    }
    renderer.delete();
    renderer = null;

    let finalChannels: Float32Array[];
    if (job.binaural.enabled) {
      const r = right ?? new Float32Array(left);
      const stereo = processBinaural(M, job.sampleRate, left, r, job.binaural, binauralProgress);
      finalChannels = [stereo.left, stereo.right];
    } else {
      finalChannels = right ? [left, right] : [left];
    }

    post(
      {
        type: 'rendered',
        jobId: job.jobId,
        channels: finalChannels,
        sampleRate: job.sampleRate,
      },
      finalChannels.map((c) => c.buffer),
    );
  } catch (err) {
    if (renderer) {
      try { renderer.delete(); } catch { /* ignore */ }
    }
    post({
      type: 'error',
      jobId: job.jobId,
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

async function handleMain(msg: RenderMainToWorker): Promise<void> {
  try {
    if (msg.type === 'init') {
      await getModule();
      post({ type: 'ready' });
      return;
    }
    if (msg.type === 'render') {
      await handleRender(msg);
      return;
    }
  } catch (err) {
    post({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
}

self.onmessage = (e: MessageEvent<RenderMainToWorker>) => {
  void handleMain(e.data);
};
