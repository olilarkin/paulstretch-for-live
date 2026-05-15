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

export async function runRender(job: RenderJob): Promise<RenderResult> {
  const worker = getWorker();
  const transfer = job.channels.map((c) => c.buffer);

  return new Promise<RenderResult>((resolve, reject) => {
    const onMessage = (e: MessageEvent<RenderWorkerToMain>) => {
      const m = e.data;
      if (m.type === 'rendered' && m.jobId === job.jobId) {
        worker.removeEventListener('message', onMessage);
        resolve({ channels: m.channels, sampleRate: m.sampleRate });
      } else if (m.type === 'error') {
        worker.removeEventListener('message', onMessage);
        reject(new Error(m.message));
      }
    };
    worker.addEventListener('message', onMessage);
    const msg: RenderMainToWorker = { type: 'render', ...job };
    worker.postMessage(msg, transfer);
  });
}

export function disposeRenderWorker(): void {
  workerSingleton?.terminate();
  workerSingleton = null;
}
