// 16-bit PCM WAV encoder. Output size is 44 bytes header + frames * channels * 2.
// Caller must check that totalBytes fits in a uint32 (4 GiB) before encoding.

export function estimateWavPcm16Size(numFrames: number, numChannels: number): number {
  return 44 + numFrames * numChannels * 2;
}

export const WAV_MAX_BYTES = 0xffffffff; // RIFF/WAVE chunk-size field is uint32.

function writeAscii(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

export function encodeWavPcm16(channels: Float32Array[], sampleRate: number): Blob {
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

  let offset = 44;
  for (let i = 0; i < numFrames; i++) {
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

  return new Blob([buf], { type: 'audio/wav' });
}

export function stretchedFilename(sourceName: string): string {
  const dot = sourceName.lastIndexOf('.');
  const base = dot > 0 ? sourceName.slice(0, dot) : sourceName;
  return `${base}_stretched.wav`;
}
