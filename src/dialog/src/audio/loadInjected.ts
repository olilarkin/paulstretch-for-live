import type { AudioSource } from '../types';
import { getAudioContext } from './playback';

interface InitialData {
  audioBase64: string;
  sampleRate: number;
  clipName: string;
  durationSec: number;
  uploadUrl: string | null;
  logUrl: string | null;
}

// True iff index.html's placeholders were actually filled in by the host.
// Standalone Vite serves the raw template, so we treat the literal markers
// as "no injection".
export function getInjectedData(): InitialData | null {
  const d = (window as unknown as { __INITIAL_DATA__?: Partial<InitialData> }).__INITIAL_DATA__;
  if (!d) return null;
  if (typeof d.audioBase64 !== 'string' || d.audioBase64 === '__AUDIO_BASE64__' || d.audioBase64.length === 0) return null;
  if (typeof d.sampleRate !== 'number' || !isFinite(d.sampleRate)) return null;
  const uploadUrl =
    typeof d.uploadUrl === 'string' && d.uploadUrl !== '__UPLOAD_URL__' && d.uploadUrl.length > 0
      ? d.uploadUrl
      : null;
  const logUrl =
    typeof d.logUrl === 'string' && d.logUrl !== '__LOG_URL__' && d.logUrl.length > 0
      ? d.logUrl
      : null;
  return {
    audioBase64: d.audioBase64,
    sampleRate: d.sampleRate,
    clipName: typeof d.clipName === 'string' && d.clipName !== '__CLIP_NAME__' ? d.clipName : 'Audio Clip',
    durationSec: typeof d.durationSec === 'number' && isFinite(d.durationSec) ? d.durationSec : 0,
    uploadUrl,
    logUrl,
  };
}

export function getUploadUrl(): string | null {
  return getInjectedData()?.uploadUrl ?? null;
}

export function getLogUrl(): string | null {
  return getInjectedData()?.logUrl ?? null;
}

function base64ToArrayBuffer(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const len = bin.length;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export async function loadInjectedAudio(
  data: InitialData,
  context: AudioContext = getAudioContext(data.sampleRate),
): Promise<AudioSource> {
  const arrayBuffer = base64ToArrayBuffer(data.audioBase64);
  const audioBuffer = await context.decodeAudioData(arrayBuffer.slice(0));

  const channels: Float32Array[] = [];
  const channelCount = Math.min(audioBuffer.numberOfChannels, 2);
  for (let c = 0; c < channelCount; c++) {
    channels.push(new Float32Array(audioBuffer.getChannelData(c)));
  }

  return {
    name: data.clipName,
    sampleRate: audioBuffer.sampleRate,
    durationSec: audioBuffer.duration,
    channels,
  };
}
