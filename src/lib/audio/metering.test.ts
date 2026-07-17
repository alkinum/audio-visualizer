import { describe, expect, it } from 'vitest';
import { calculateCorrelation, linearRmsDb } from './metering';

describe('live metering math', () => {
  it('preserves equal channel level in an RMS stereo combination', () => {
    expect(linearRmsDb(-18, -18)).toBeCloseTo(-18, 5);
  });

  it('reports full positive correlation for identical channels', () => {
    const signal = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    expect(calculateCorrelation(signal, signal)).toBeCloseTo(1, 5);
  });

  it('reports full negative correlation for inverted channels', () => {
    const left = new Float32Array([0.5, -0.5, 0.25, -0.25]);
    const right = new Float32Array([-0.5, 0.5, -0.25, 0.25]);
    expect(calculateCorrelation(left, right)).toBeCloseTo(-1, 5);
  });
});
