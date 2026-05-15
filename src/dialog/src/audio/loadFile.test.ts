import { describe, expect, it } from 'vitest';
import { sniffWavSampleRate } from './loadFile';

function makeWavHeader(sampleRate: number): ArrayBuffer {
  const buffer = new ArrayBuffer(44);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  writeAscii(0, 'RIFF');
  view.setUint32(4, 36, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 4, true);
  view.setUint16(32, 4, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, 0, true);

  return buffer;
}

describe('sniffWavSampleRate', () => {
  it('reads the sample rate from a PCM WAV header', () => {
    expect(sniffWavSampleRate(makeWavHeader(44100))).toBe(44100);
    expect(sniffWavSampleRate(makeWavHeader(48000))).toBe(48000);
  });

  it('returns null for non-WAV data', () => {
    expect(sniffWavSampleRate(new ArrayBuffer(16))).toBeNull();
  });
});
