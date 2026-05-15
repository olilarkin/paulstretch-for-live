import type { Curve, CurvePoint, Envelope, EnvelopePoint } from '../../types';

const MIN_LOG_VALUE = 1e-8;
type ValueScale = 'linear' | 'log';

/**
 * Sample the envelope at evenly spaced positions in [0,1].
 * Inactive points are skipped (effectively bypassed in the curve).
 * Returns N values matching N positions = linspace(0,1,N).
 */
export function densify(env: Envelope | Curve, n = 256): { positions: Float32Array; values: Float32Array } {
  return densifyWithScale(env, n, 'linear');
}

/**
 * Sample a curve with interpolation in log-value space.
 * Useful for controls stored as positive linear values but displayed on a log scale.
 */
export function densifyLogValues(env: Envelope | Curve, n = 256): { positions: Float32Array; values: Float32Array } {
  return densifyWithScale(env, n, 'log');
}

export function densifyLogValuesWithBreakpoints(env: Envelope | Curve, n = 256): { positions: Float32Array; values: Float32Array } {
  return densifyWithScale(env, n, 'log', true);
}

function densifyWithScale(
  env: Envelope | Curve,
  n: number,
  scale: ValueScale,
  includeBreakpoints = false,
): { positions: Float32Array; values: Float32Array } {
  const active = env.points.filter((p) => p.enabled).sort((a, b) => a.position - b.position);
  if (active.length === 0) {
    const positions = new Float32Array(2);
    const values = new Float32Array([1, 1]);
    positions[0] = 0;
    positions[1] = 1;
    return { positions, values };
  }
  const samplePositions = evenlySpacedPositions(n);
  if (includeBreakpoints && env.smoothing <= 0) {
    for (const point of active) samplePositions.push(point.position);
    samplePositions.sort((a, b) => a - b);
  }
  const positions = new Float32Array(dedupeSortedPositions(samplePositions));
  const values = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i++) {
    const x = positions[i];
    values[i] = sampleAt(active, x, env.interp, scale);
  }
  if (env.smoothing > 0) {
    if (scale === 'log') {
      const logValues = new Float32Array(values.length);
      for (let i = 0; i < values.length; i++) logValues[i] = Math.log(Math.max(values[i], MIN_LOG_VALUE));
      smoothInPlace(logValues, env.smoothing);
      for (let i = 0; i < values.length; i++) values[i] = Math.exp(logValues[i]);
    } else {
      smoothInPlace(values, env.smoothing);
    }
  }
  return { positions, values };
}

function evenlySpacedPositions(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i / (n - 1));
}

function dedupeSortedPositions(positions: number[]): number[] {
  const deduped: number[] = [];
  for (const x of positions) {
    if (deduped.length === 0 || Math.abs(x - deduped[deduped.length - 1]) > 1e-7) {
      deduped.push(x);
    }
  }
  return deduped;
}

function sampleAt(points: Array<EnvelopePoint | CurvePoint>, x: number, interp: 'Linear' | 'Cosine', scale: ValueScale): number {
  if (x <= points[0].position) return points[0].value;
  if (x >= points[points.length - 1].position) return points[points.length - 1].value;
  // Find bracketing segment.
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid].position <= x) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const span = b.position - a.position;
  const t = span > 0 ? (x - a.position) / span : 0;
  const aValue = scaleValue(a.value, scale);
  const bValue = scaleValue(b.value, scale);
  let value: number;
  if (interp === 'Cosine') {
    const k = (1 - Math.cos(t * Math.PI)) * 0.5;
    value = aValue + (bValue - aValue) * k;
  } else {
    value = aValue + (bValue - aValue) * t;
  }
  return unscaleValue(value, scale);
}

function scaleValue(value: number, scale: ValueScale): number {
  return scale === 'log' ? Math.log(Math.max(value, MIN_LOG_VALUE)) : value;
}

function unscaleValue(value: number, scale: ValueScale): number {
  return scale === 'log' ? Math.exp(value) : value;
}

function smoothInPlace(values: Float32Array, amount: number): void {
  // Box-filter with radius proportional to amount.
  const radius = Math.max(1, Math.round(amount * values.length * 0.05));
  const tmp = new Float32Array(values.length);
  for (let i = 0; i < values.length; i++) {
    let sum = 0;
    let count = 0;
    const start = Math.max(0, i - radius);
    const end = Math.min(values.length - 1, i + radius);
    for (let j = start; j <= end; j++) {
      sum += values[j];
      count++;
    }
    tmp[i] = sum / count;
  }
  values.set(tmp);
}
