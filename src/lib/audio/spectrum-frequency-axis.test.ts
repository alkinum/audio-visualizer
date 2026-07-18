import { describe, expect, it } from 'vitest';
import { layoutSpectrumFrequencyTicks } from './spectrum-frequency-axis';
import { frequencyToSpectrumRatio } from './spectrum-frequency-scale';

describe('spectrum frequency axis', () => {
  it('keeps the Nyquist label and suppresses a colliding 20 kHz label', () => {
    const frequencies = [0, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 15_000, 20_000, 24_000];
    const ticks = layoutSpectrumFrequencyTicks(
      frequencies,
      (frequency) => frequencyToSpectrumRatio(frequency, 24_000),
      25,
      405,
    );

    expect(ticks.find((tick) => tick.frequency === 24_000)?.showLabel).toBe(true);
    expect(ticks.find((tick) => tick.frequency === 20_000)?.showLabel).toBe(false);
    expect(ticks.find((tick) => tick.frequency === 20_000)?.lineY).toBeGreaterThan(25);
  });

  it('restores interior labels when the visible scale gives them enough room', () => {
    const frequencies = [15_000, 20_000, 24_000];
    const ticks = layoutSpectrumFrequencyTicks(
      frequencies,
      (frequency) => (frequency - 15_000) / 9_000,
      25,
      405,
    );

    expect(ticks.every((tick) => tick.showLabel)).toBe(true);
  });
});
