import type { AudioSource } from '../types';
import { getAudioContext } from './playback';

function ascii(view: DataView, offset: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

export function sniffWavSampleRate(arrayBuffer: ArrayBuffer): number | null {
  if (arrayBuffer.byteLength < 44) return null;

  const view = new DataView(arrayBuffer);
  if (ascii(view, 0, 4) !== 'RIFF' || ascii(view, 8, 4) !== 'WAVE') return null;

  let offset = 12;
  while (offset + 8 <= view.byteLength) {
    const id = ascii(view, offset, 4);
    const size = view.getUint32(offset + 4, true);
    const dataOffset = offset + 8;
    if (dataOffset + size > view.byteLength) return null;

    if (id === 'fmt ' && size >= 16) {
      const sampleRate = view.getUint32(dataOffset + 4, true);
      return sampleRate > 0 ? sampleRate : null;
    }

    offset = dataOffset + size + (size & 1);
  }

  return null;
}

export async function loadAudioFile(
  file: File,
  context: AudioContext = getAudioContext(),
  arrayBuffer?: ArrayBuffer,
): Promise<AudioSource> {
  const audioData = arrayBuffer ?? await file.arrayBuffer();
  const audioBuffer = await context.decodeAudioData(audioData.slice(0));

  const channels: Float32Array[] = [];
  const channelCount = Math.min(audioBuffer.numberOfChannels, 2);
  for (let c = 0; c < channelCount; c++) {
    // Copy because the underlying buffer is owned by the AudioBuffer.
    channels.push(new Float32Array(audioBuffer.getChannelData(c)));
  }

  return {
    name: file.name,
    sampleRate: audioBuffer.sampleRate,
    durationSec: audioBuffer.duration,
    channels,
  };
}
