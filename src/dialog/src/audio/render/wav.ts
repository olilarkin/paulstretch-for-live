// 16-bit PCM WAV encoder. Output size is 44 bytes header + frames * channels * 2.
// Caller must check that totalBytes fits in a uint32 (4 GiB) before encoding.

export function estimateWavPcm16Size(numFrames: number, numChannels: number): number {
  return 44 + numFrames * numChannels * 2;
}

export const WAV_MAX_BYTES = 0xffffffff; // RIFF/WAVE chunk-size field is uint32.

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

// Validate the channels, allocate the output buffer, and write the 44-byte
// header. Shared by the sync and async encoders so the two can't drift.
function prepareWavBuffer(
  channels: Float32Array[],
  sampleRate: number,
): { buf: ArrayBuffer; view: DataView; numChannels: number; numFrames: number } {
  if (channels.length === 0) throw new Error('encodeWavPcm16: no channels');
  const numChannels = channels.length;
  const numFrames = channels[0].length;
  for (const c of channels) {
    if (c.length !== numFrames) throw new Error('encodeWavPcm16: channel length mismatch');
  }
  const bytesPerSample = 2;
  const blockAlign = numChannels * bytesPerSample;
  const byteRate = sampleRate * blockAlign;
  const dataSize = numFrames * blockAlign;
  const totalSize = 44 + dataSize;
  if (totalSize > WAV_MAX_BYTES) {
    throw new Error(
      `WAV output (${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GiB) exceeds the 4 GiB WAV limit.`,
    );
  }

  const buf = new ArrayBuffer(totalSize);
  const view = new DataView(buf);

  writeAscii(view, 0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, 'WAVE');
  writeAscii(view, 12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, 'data');
  view.setUint32(40, dataSize, true);

  return { buf, view, numChannels, numFrames };
}

// Write interleaved PCM16 for frames [start, end) into `view` (header is 44 bytes).
function writeSamples(view: DataView, channels: Float32Array[], start: number, end: number): void {
  const numChannels = channels.length;
  let offset = 44 + start * numChannels * 2;
  for (let i = start; i < end; i++) {
    for (let c = 0; c < numChannels; c++) {
      let s = channels[c][i];
      if (s > 1) s = 1;
      else if (s < -1) s = -1;
      // Symmetric scale so 1.0 → 32767 and -1.0 → -32768 (clamped).
      const int16 = s < 0 ? Math.round(s * 0x8000) : Math.round(s * 0x7fff);
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }
}

export function encodeWavPcm16(channels: Float32Array[], sampleRate: number): Blob {
  const { buf, view, numFrames } = prepareWavBuffer(channels, sampleRate);
  writeSamples(view, channels, 0, numFrames);
  return new Blob([buf], { type: 'audio/wav' });
}

export interface EncodeWavOptions {
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
  /** Frames written per event-loop slice; lower = smoother bar, higher = faster. */
  framesPerYield?: number;
}

// Async, cancellable WAV encoder. Encoding a long file is an O(frames) loop that
// would freeze the UI thread; this writes in slices and yields a macrotask
// (setTimeout 0 — a microtask wouldn't let the browser paint) between them so a
// progress bar can repaint and a cancel can land.
export async function encodeWavPcm16Async(
  channels: Float32Array[],
  sampleRate: number,
  opts: EncodeWavOptions = {},
): Promise<Blob> {
  const { onProgress, signal, framesPerYield = 1 << 20 } = opts;
  const { buf, view, numFrames } = prepareWavBuffer(channels, sampleRate);
  if (numFrames === 0) {
    onProgress?.(1);
    return new Blob([buf], { type: 'audio/wav' });
  }
  for (let start = 0; start < numFrames; start += framesPerYield) {
    if (signal?.aborted) throw new DOMException('Encode cancelled', 'AbortError');
    const end = Math.min(start + framesPerYield, numFrames);
    writeSamples(view, channels, start, end);
    onProgress?.(end / numFrames);
    if (end < numFrames) await new Promise<void>((r) => setTimeout(r, 0));
  }
  return new Blob([buf], { type: 'audio/wav' });
}

export function stretchedFilename(sourceName: string): string {
  const dot = sourceName.lastIndexOf('.');
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${base}_stretched.wav`;
}
