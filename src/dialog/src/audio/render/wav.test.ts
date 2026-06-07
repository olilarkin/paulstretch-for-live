import { describe, it, expect } from 'vitest';
import { encodeWavPcm16, encodeWavPcm16Async, estimateWavPcm16Size } from './wav';

async function bytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

// Includes exact-rail and out-of-range values to exercise PCM16 clamping.
function ramp(n: number, offset = 0): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const phase = (i + offset) % 7;
    a[i] = [0, 1, -1, 0.5, -0.5, 1.5, -1.5][phase];
  }
  return a;
}

describe('encodeWavPcm16Async parity', () => {
  it('matches the sync encoder byte-for-byte (mono)', async () => {
    const ch = [ramp(1000)];
    const sync = await bytes(encodeWavPcm16(ch, 44100));
    // Tiny framesPerYield forces many slices/yields.
    const async_ = await bytes(await encodeWavPcm16Async(ch, 44100, { framesPerYield: 64 }));
    expect(async_).toEqual(sync);
  });

  it('matches the sync encoder byte-for-byte (stereo)', async () => {
    const ch = [ramp(1000), ramp(1000, 3)];
    const sync = await bytes(encodeWavPcm16(ch, 48000));
    const async_ = await bytes(await encodeWavPcm16Async(ch, 48000, { framesPerYield: 50 }));
    expect(async_).toEqual(sync);
    expect(sync.length).toBe(estimateWavPcm16Size(1000, 2));
  });
});

describe('encodeWavPcm16Async progress', () => {
  it('reports a non-decreasing fraction that ends at 1', async () => {
    const fractions: number[] = [];
    await encodeWavPcm16Async([ramp(500)], 44100, {
      framesPerYield: 64,
      onProgress: (f) => fractions.push(f),
    });
    expect(fractions.length).toBeGreaterThan(1);
    for (let i = 1; i < fractions.length; i++) {
      expect(fractions[i]).toBeGreaterThanOrEqual(fractions[i - 1]);
    }
    expect(fractions[fractions.length - 1]).toBe(1);
  });

  it('short-circuits zero-length output to a header-only blob', async () => {
    const fractions: number[] = [];
    const blob = await encodeWavPcm16Async([new Float32Array(0)], 44100, {
      onProgress: (f) => fractions.push(f),
    });
    expect((await bytes(blob)).length).toBe(44);
    expect(fractions).toEqual([1]);
  });
});

describe('encodeWavPcm16Async cancellation', () => {
  it('throws AbortError when the signal is already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await expect(
      encodeWavPcm16Async([ramp(5000)], 44100, { signal: ac.signal, framesPerYield: 64 }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });
});
