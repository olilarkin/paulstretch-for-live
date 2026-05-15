import type { StretchMode } from '../types';

const FFT_MIN = 512;
// Matches the original C++: 2^12 * 512 ≈ 2,097,152 at slider=1.
const FFT_MAX = 2097152;
// Preview streaming writes one whole stretcher block into a fixed-size SAB ring.
// Keep the preview block comfortably below the ring capacity so the worker can
// always produce at least one block. Offline rendering can still use FFT_MAX.
export const MAX_STREAMING_FFT_SIZE = 65536;

export function sliderToStretch(mode: StretchMode, x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  switch (mode) {
    case 'Stretch':
      return Math.pow(10, Math.pow(clamped, 1.2) * 4);
    case 'HyperStretch':
      return Math.pow(10, Math.pow(clamped, 1.5) * 18);
    case 'Shorten':
      return 1 / Math.pow(10, clamped * 2);
  }
}

function isClassicFastSize(n: number): boolean {
  let m = n;
  while (m % 5 === 0) m /= 5;
  while (m % 3 === 0) m /= 3;
  while (m % 2 === 0) m /= 2;
  return m < 2;
}

export function optimizeClassicFftSize(n: number): number {
  const target = Math.max(FFT_MIN, Math.min(FFT_MAX, Math.round(n)));
  let down = target;
  let up = target;
  while (down > FFT_MIN && !isClassicFastSize(down)) down--;
  while (up < FFT_MAX && !isClassicFastSize(up)) up++;
  return (target - down) < (up - target) ? down : up;
}

export function sliderToFftSize(x: number): number {
  const clamped = Math.max(0, Math.min(1, x));
  const raw = 512 * Math.pow(2, Math.pow(clamped, 1.5) * 12);
  return optimizeClassicFftSize(raw);
}

export function sliderToStreamingFftSize(x: number): number {
  return Math.min(sliderToFftSize(x), MAX_STREAMING_FFT_SIZE);
}

export function formatStretchFactor(stretch: number): string {
  if (stretch >= 1000) return stretch.toExponential(2) + 'x';
  if (stretch >= 100) return stretch.toFixed(1) + 'x';
  if (stretch >= 1) return stretch.toFixed(2) + 'x';
  return stretch.toFixed(3) + 'x';
}

export function formatDuration(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '--:--:--';
  const total = Math.floor(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(h)}:${pad(m)}:${pad(s)}`;
}

export function formatFftSize(n: number): string {
  if (n >= 1024) return (n / 1024).toFixed(1) + 'K';
  return n.toString();
}

export function fftResolution(fftSize: number, sampleRate: number): { seconds: number; hz: number } {
  return {
    seconds: fftSize / sampleRate,
    hz: sampleRate / fftSize,
  };
}
