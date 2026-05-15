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

function processBinaural(
  M: PSModule,
  sampleRate: number,
  left: Float32Array,
  right: Float32Array,
  cfg: RenderJob['binaural'],
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
  }
  bp.delete();
  return { left: outL, right: outR };
}

async function handleRender(job: RenderJob): Promise<void> {
  const M = await getModule();
  const win = mapWindow(M, job.windowType) as never;

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
      const out = renderer.renderStereo(job.channels[0], job.channels[1]);
      left = out.left;
      right = out.right;
    } else {
      left = renderer.renderMono(job.channels[0]);
      right = null;
    }
    renderer.delete();
    renderer = null;

    let finalChannels: Float32Array[];
    if (job.binaural.enabled) {
      const r = right ?? new Float32Array(left);
      const stereo = processBinaural(M, job.sampleRate, left, r, job.binaural);
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
