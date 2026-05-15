import { describe, it, expect } from 'vitest';
import {
  MAX_STREAMING_FFT_SIZE,
  fftResolution,
  formatDuration,
  formatFftSize,
  formatStretchFactor,
  optimizeClassicFftSize,
  sliderToStreamingFftSize,
  sliderToFftSize,
  sliderToStretch,
} from './mappings';

describe('sliderToStretch', () => {
  it('returns 1× at x=0 for Stretch mode', () => {
    expect(sliderToStretch('Stretch', 0)).toBeCloseTo(1, 4);
  });
  it('returns 10,000× at x=1 for Stretch mode', () => {
    expect(sliderToStretch('Stretch', 1)).toBeCloseTo(10000, 0);
  });
  it('returns 1,000,000× at x=1 for HyperStretch', () => {
    expect(sliderToStretch('HyperStretch', 1)).toBeCloseTo(1e18, -16);
  });
  it('returns 1× at x=0 for Shorten', () => {
    expect(sliderToStretch('Shorten', 0)).toBeCloseTo(1, 4);
  });
  it('returns 0.01× at x=1 for Shorten', () => {
    expect(sliderToStretch('Shorten', 1)).toBeCloseTo(0.01, 4);
  });
});

describe('sliderToFftSize', () => {
  it('returns 512 at x=0', () => {
    expect(sliderToFftSize(0)).toBe(512);
  });
  it('monotonically increases with x', () => {
    let prev = sliderToFftSize(0);
    for (let x = 0.05; x <= 1; x += 0.05) {
      const size = sliderToFftSize(x);
      expect(size).toBeGreaterThanOrEqual(prev);
      prev = size;
    }
  });
  it('reaches ~2M at x=1', () => {
    expect(sliderToFftSize(1)).toBeCloseTo(2097152, -3);
  });
  it('uses the original Win32 KISSFFT-friendly size optimization', () => {
    expect(sliderToFftSize(0.47)).toBe(7500);
    expect(sliderToFftSize(0.5)).toBe(9720);
    expect(optimizeClassicFftSize(7468)).toBe(7500);
  });
});

describe('sliderToStreamingFftSize', () => {
  it('keeps the preview block below the fixed streaming ring capacity', () => {
    expect(sliderToStreamingFftSize(1)).toBe(MAX_STREAMING_FFT_SIZE);
    expect(sliderToStreamingFftSize(1)).toBeLessThan(96000);
  });

  it('matches the full-range mapping below the streaming cap', () => {
    expect(sliderToStreamingFftSize(0.5)).toBe(sliderToFftSize(0.5));
  });
});

describe('formatStretchFactor', () => {
  it('formats normal range with 2 decimals', () => {
    expect(formatStretchFactor(8.04)).toBe('8.04x');
  });
  it('formats sub-1 with 3 decimals', () => {
    expect(formatStretchFactor(0.5)).toBe('0.500x');
  });
});

describe('formatDuration', () => {
  it('formats hours:minutes:seconds', () => {
    expect(formatDuration(3661)).toBe('01:01:01');
  });
  it('handles zero', () => {
    expect(formatDuration(0)).toBe('00:00:00');
  });
});

describe('formatFftSize', () => {
  it('formats large sizes in K', () => {
    expect(formatFftSize(137216)).toBe('134.0K');
  });
  it('formats small sizes raw', () => {
    expect(formatFftSize(512)).toBe('512');
  });
});

describe('fftResolution', () => {
  it('computes seconds and Hz', () => {
    const r = fftResolution(44100, 44100);
    expect(r.seconds).toBeCloseTo(1.0);
    expect(r.hz).toBeCloseTo(1.0);
  });
});
