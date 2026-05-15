import { describe, expect, it } from 'vitest';
import {
  readableFrames,
  ringCreate,
  ringRead,
  ringReset,
  ringResetTarget,
  ringWrite,
} from './ring-buffer';

const READ_POS = 0;

describe('ringReset', () => {
  it('does not make readable frames negative if a consumer finishes a stale read after reset', () => {
    const { view } = ringCreate(1, 8);
    ringWrite(view, [new Float32Array([1, 2, 3, 4])], 4);

    ringReset(view);
    Atomics.add(view.control, READ_POS, 2);

    expect(readableFrames(view)).toBeGreaterThanOrEqual(0);
  });

  it('drops old buffered audio while preserving samples written after the reset request', () => {
    const { view } = ringCreate(1, 8);
    ringWrite(view, [new Float32Array([1, 2, 3, 4])], 4);
    ringReset(view);
    ringWrite(view, [new Float32Array([9, 10])], 2);

    Atomics.store(view.control, READ_POS, ringResetTarget(view));

    expect(readableFrames(view)).toBe(2);
    const out = [new Float32Array(2)];
    expect(ringRead(view, out, 0, 2)).toBe(2);
    expect(Array.from(out[0])).toEqual([9, 10]);
  });
});

describe('ringWrite', () => {
  it('can write a slice from a larger produced block', () => {
    const { view } = ringCreate(1, 8);

    expect(ringWrite(view, [new Float32Array([1, 2, 3, 4])], 2, 2)).toBe(2);

    const out = [new Float32Array(2)];
    expect(ringRead(view, out, 0, 2)).toBe(2);
    expect(Array.from(out[0])).toEqual([3, 4]);
  });
});
