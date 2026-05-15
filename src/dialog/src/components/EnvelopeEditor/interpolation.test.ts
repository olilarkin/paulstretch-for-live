import { describe, it, expect } from 'vitest';
import { densify, densifyLogValues, densifyLogValuesWithBreakpoints } from './interpolation';
import type { Envelope } from '../../types';

const baseEnv = (overrides: Partial<Envelope> = {}): Envelope => ({
  enabled: true,
  points: [
    { position: 0, value: 1, enabled: true },
    { position: 1, value: 1, enabled: true },
  ],
  interp: 'Linear',
  valueMin: 0.1,
  valueMax: 50,
  smoothing: 0,
  selectedIndex: null,
  ...overrides,
});

describe('densify', () => {
  it('produces N samples', () => {
    const env = baseEnv();
    const { positions, values } = densify(env, 64);
    expect(positions.length).toBe(64);
    expect(values.length).toBe(64);
  });

  it('returns flat curve for two equal points', () => {
    const env = baseEnv();
    const { values } = densify(env, 32);
    for (const v of values) expect(v).toBeCloseTo(1);
  });

  it('linear interpolation hits mid-value at mid-position', () => {
    const env = baseEnv({
      points: [
        { position: 0, value: 1, enabled: true },
        { position: 1, value: 3, enabled: true },
      ],
    });
    const { positions, values } = densify(env, 11); // step 0.1
    expect(positions[5]).toBeCloseTo(0.5);
    expect(values[5]).toBeCloseTo(2, 5);
  });

  it('log-value interpolation hits the geometric mid-value at mid-position', () => {
    const env = baseEnv({
      points: [
        { position: 0, value: 0.001, enabled: true },
        { position: 1, value: 10, enabled: true },
      ],
    });
    const { positions, values } = densifyLogValues(env, 3);
    expect(positions[1]).toBeCloseTo(0.5);
    expect(values[1]).toBeCloseTo(0.1, 5);
  });

  it('log-value interpolation can include exact breakpoint positions', () => {
    const env = baseEnv({
      points: [
        { position: 0, value: 1, enabled: true },
        { position: 0.333, value: 8, enabled: true },
        { position: 1, value: 2, enabled: true },
      ],
    });
    const { positions, values } = densifyLogValuesWithBreakpoints(env, 5);
    const idx = Array.from(positions).findIndex((x) => Math.abs(x - 0.333) < 1e-7);
    expect(idx).toBeGreaterThanOrEqual(0);
    expect(values[idx]).toBeCloseTo(8, 5);
  });

  it('cosine interpolation produces smooth curve through endpoints', () => {
    const env = baseEnv({
      interp: 'Cosine',
      points: [
        { position: 0, value: 0, enabled: true },
        { position: 1, value: 1, enabled: true },
      ],
    });
    const { values } = densify(env, 101);
    expect(values[0]).toBeCloseTo(0, 6);
    expect(values[100]).toBeCloseTo(1, 6);
    expect(values[50]).toBeCloseTo(0.5, 4);
  });

  it('smoothing produces unchanged length', () => {
    const env = baseEnv({ smoothing: 0.5 });
    const { values } = densify(env, 64);
    expect(values.length).toBe(64);
  });
});
