// Single-producer / single-consumer Float32 ring buffer on SharedArrayBuffer.
// Used to pipe audio samples from the stretch worker to the AudioWorklet
// without per-block postMessage on the audio thread.
//
// Layout:
//   control: Int32Array(4) in its own SAB
//     [0] = readPos  (frames; monotonic, written only by consumer)
//     [1] = writePos (frames; monotonic, written only by producer)
//     [2] = resetEpoch  (incremented by producer when old buffered audio
//                        should be dropped)
//     [3] = resetTarget (writePos at the time resetEpoch was incremented;
//                        consumer snaps readPos here on its next block)
//   data: Float32Array(capacity * channels) in its own SAB
//     Interleaved: data[(frame % capacity) * channels + ch].
//
// Frame-count positions are monotonic Int32; subtraction is correct under
// modular arithmetic as long as `writePos - readPos` stays within Int32
// range (~12 hours at 48 kHz before any concern).

export interface RingHandles {
  control: SharedArrayBuffer;
  data: SharedArrayBuffer;
  channels: number;
  capacityFrames: number;
}

export interface RingView {
  channels: number;
  capacity: number;
  control: Int32Array;
  data: Float32Array;
}

const READ_POS = 0;
const WRITE_POS = 1;
const RESET_EPOCH = 2;
const RESET_TARGET = 3;

export function ringCreate(channels: number, capacityFrames: number): {
  view: RingView;
  handles: RingHandles;
} {
  const controlSab = new SharedArrayBuffer(4 * Int32Array.BYTES_PER_ELEMENT);
  const dataSab = new SharedArrayBuffer(
    capacityFrames * channels * Float32Array.BYTES_PER_ELEMENT,
  );
  return {
    view: {
      channels,
      capacity: capacityFrames,
      control: new Int32Array(controlSab),
      data: new Float32Array(dataSab),
    },
    handles: { control: controlSab, data: dataSab, channels, capacityFrames },
  };
}

export function ringAttach(handles: RingHandles): RingView {
  return {
    channels: handles.channels,
    capacity: handles.capacityFrames,
    control: new Int32Array(handles.control),
    data: new Float32Array(handles.data),
  };
}

export function writableFrames(v: RingView): number {
  return v.capacity - (Atomics.load(v.control, WRITE_POS) - Atomics.load(v.control, READ_POS));
}

export function readableFrames(v: RingView): number {
  return Atomics.load(v.control, WRITE_POS) - Atomics.load(v.control, READ_POS);
}

/**
 * Producer: write up to n frames from channel chunks into the ring.
 * `chunks[ch]` is a Float32Array of at least sourceOffset + n samples for
 * channel `ch`.
 * Channels beyond `v.channels` are ignored; missing channels are filled
 * from chunks[0] (so mono input becomes stereo in the ring).
 * Returns the number of frames actually written.
 */
export function ringWrite(
  v: RingView,
  chunks: Float32Array[],
  n: number,
  sourceOffset = 0,
): number {
  const avail = writableFrames(v);
  const toWrite = Math.min(avail, n);
  if (toWrite <= 0) return 0;
  const writePos = Atomics.load(v.control, WRITE_POS);
  const cap = v.capacity;
  const channels = v.channels;
  for (let i = 0; i < toWrite; i++) {
    const ringFrame = (writePos + i) % cap;
    const base = ringFrame * channels;
    for (let ch = 0; ch < channels; ch++) {
      const src = ch < chunks.length ? chunks[ch] : chunks[0];
      v.data[base + ch] = src[sourceOffset + i];
    }
  }
  Atomics.add(v.control, WRITE_POS, toWrite);
  return toWrite;
}

/**
 * Consumer: read up to n frames into the output channel arrays starting
 * at `offset` in each output array. Returns frames actually read.
 * If the ring has fewer than n available, only that many are read; the
 * caller is responsible for zero-filling the rest.
 */
export function ringRead(v: RingView, outs: Float32Array[], offset: number, n: number): number {
  const avail = readableFrames(v);
  const toRead = Math.min(avail, n);
  if (toRead <= 0) return 0;
  const readPos = Atomics.load(v.control, READ_POS);
  const cap = v.capacity;
  const channels = v.channels;
  const outChannels = outs.length;
  for (let i = 0; i < toRead; i++) {
    const ringFrame = (readPos + i) % cap;
    const base = ringFrame * channels;
    for (let ch = 0; ch < outChannels; ch++) {
      // Replicate channel 0 if the ring has fewer channels than the
      // output (mono ring → stereo output).
      const sample = ch < channels ? v.data[base + ch] : v.data[base];
      outs[ch][offset + i] = sample;
    }
  }
  Atomics.add(v.control, READ_POS, toRead);
  return toRead;
}

/**
 * Producer-side reset request. The producer never writes readPos; the consumer
 * applies the reset on its own thread before its next read. Samples written
 * after resetTarget remain readable once the consumer has dropped the old tail.
 */
export function ringReset(v: RingView): void {
  const writePos = Atomics.load(v.control, WRITE_POS);
  Atomics.store(v.control, RESET_TARGET, writePos);
  Atomics.add(v.control, RESET_EPOCH, 1);
}

export function ringResetEpoch(v: RingView): number {
  return Atomics.load(v.control, RESET_EPOCH);
}

export function ringResetTarget(v: RingView): number {
  return Atomics.load(v.control, RESET_TARGET);
}
