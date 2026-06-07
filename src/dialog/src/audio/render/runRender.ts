import type {
  RenderJob,
  RenderMainToWorker,
  RenderWorkerToMain,
} from './types';

// Persistent worker for the whole dialog lifetime. The wasm module compile is
// the slow bit; warming it once across renders matters when the user iterates.
let workerSingleton: Worker | null = null;
function getWorker(): Worker {
  if (!workerSingleton) {
    workerSingleton = new Worker(
      new URL('./render-worker.ts', import.meta.url),
      { type: 'module' },
    );
  }
  return workerSingleton;
}

export interface RenderResult {
  channels: Float32Array[];
  sampleRate: number;
}

export interface RunRenderOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

export async function runRender(
  job: RenderJob,
  opts: RunRenderOptions = {},
): Promise<RenderResult> {
  const { onProgress, signal } = opts;
  const worker = getWorker();
  const transfer = job.channels.map((c) => c.buffer);

  return new Promise<RenderResult>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException('Render cancelled', 'AbortError'));
      return;
    }

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      signal?.removeEventListener('abort', onAbort);
    };
    // The render is a blocking synchronous WASM call, so the worker can't read a
    // cancel message mid-render — terminating it is the only reliable stop. The
    // singleton is reset so the next render spawns (and re-warms) a fresh worker.
    const onAbort = () => {
      cleanup();
      disposeRenderWorker();
      reject(new DOMException('Render cancelled', 'AbortError'));
    };
    const onMessage = (e: MessageEvent<RenderWorkerToMain>) => {
      const m = e.data;
      if (m.type === 'progress' && m.jobId === job.jobId) {
        onProgress?.(m.fraction);
      } else if (m.type === 'rendered' && m.jobId === job.jobId) {
        cleanup();
        resolve({ channels: m.channels, sampleRate: m.sampleRate });
      } else if (m.type === 'error') {
        cleanup();
        reject(new Error(m.message));
      }
    };
    worker.addEventListener('message', onMessage);
    signal?.addEventListener('abort', onAbort);
    const msg: RenderMainToWorker = { type: 'render', ...job };
    worker.postMessage(msg, transfer);
  });
}

export function disposeRenderWorker(): void {
  workerSingleton?.terminate();
  workerSingleton = null;
}
