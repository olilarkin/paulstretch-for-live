// AudioWorklet-side consumer for the SAB audio ring. The worklet receives
// the ring's SAB handles on its `port` from main at boot, then reads
// samples directly from shared memory in process() with no per-block
// message traffic on the audio thread.

declare const sampleRate: number;
declare const currentTime: number;
declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor(options?: { processorOptions?: unknown });
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>,
  ): boolean;
}
declare function registerProcessor(
  name: string,
  processor: typeof AudioWorkletProcessor,
): void;

// Duplicated minimal ring impl — the worklet is bundled separately and
// shares no module graph with the main app. Kept tiny and exactly in sync
// with src/audio/streaming/ring-buffer.ts (READ_POS=0, WRITE_POS=1, frame
// positions monotonic Int32).

interface RingHandles {
  control: SharedArrayBuffer;
  data: SharedArrayBuffer;
  channels: number;
  capacityFrames: number;
}

interface RingView {
  channels: number;
  capacity: number;
  control: Int32Array;
  data: Float32Array;
}

const READ_POS = 0;
const WRITE_POS = 1;
const RESET_EPOCH = 2;
const RESET_TARGET = 3;

function attach(h: RingHandles): RingView {
  return {
    channels: h.channels,
    capacity: h.capacityFrames,
    control: new Int32Array(h.control),
    data: new Float32Array(h.data),
  };
}

function readableFrames(v: RingView): number {
  return Atomics.load(v.control, WRITE_POS) - Atomics.load(v.control, READ_POS);
}

function consumeReset(v: RingView, seenEpoch: number): number {
  const epoch = Atomics.load(v.control, RESET_EPOCH);
  if (epoch !== seenEpoch) {
    Atomics.store(v.control, READ_POS, Atomics.load(v.control, RESET_TARGET));
  }
  return epoch;
}

function readInto(v: RingView, outs: Float32Array[], offset: number, n: number): number {
  const avail = readableFrames(v);
  const toRead = Math.min(avail, n);
  if (toRead <= 0) return 0;
  const readPos = Atomics.load(v.control, READ_POS);
  const cap = v.capacity;
  const ringCh = v.channels;
  const outCh = outs.length;
  for (let i = 0; i < toRead; i++) {
    const base = ((readPos + i) % cap) * ringCh;
    for (let c = 0; c < outCh; c++) {
      const s = c < ringCh ? v.data[base + c] : v.data[base];
      outs[c][offset + i] = s;
    }
  }
  Atomics.add(v.control, READ_POS, toRead);
  return toRead;
}

type ControlMessage = { type: '__ring'; ring: RingHandles };

class PaulstretchProcessor extends AudioWorkletProcessor {
  private ring: RingView | null = null;
  private framesMissed = 0;
  private lastUnderrunReport = 0;
  private seenResetEpoch = 0;

  constructor() {
    super();
    this.port.onmessage = (e: MessageEvent<ControlMessage>) => {
      if (e.data?.type === '__ring' && e.data.ring) {
        this.ring = attach(e.data.ring);
      }
    };
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0];
    if (!out || out.length === 0) return true;
    const nFrames = out[0].length;

    if (!this.ring) {
      for (let c = 0; c < out.length; c++) out[c].fill(0);
      return true;
    }

    this.seenResetEpoch = consumeReset(this.ring, this.seenResetEpoch);
    const got = readInto(this.ring, out, 0, nFrames);
    if (got < nFrames) {
      // Zero-fill the underrun tail.
      for (let c = 0; c < out.length; c++) {
        for (let i = got; i < nFrames; i++) out[c][i] = 0;
      }
      this.framesMissed += nFrames - got;
      const now = currentTime;
      if (now - this.lastUnderrunReport > 0.1) {
        this.port.postMessage({ type: 'underrun', framesMissed: this.framesMissed });
        this.framesMissed = 0;
        this.lastUnderrunReport = now;
      }
    }
    return true;
  }
}

void sampleRate;

registerProcessor('paulstretch-processor', PaulstretchProcessor);
