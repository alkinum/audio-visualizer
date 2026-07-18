import { describe, expect, it } from 'vitest';
import { frequencyToSpectrumRatio, spectrumRatioToFrequency } from './spectrum-frequency-scale';

describe('spectrum frequency scale', () => {
  it('anchors a perceptual logarithmic scale at zero and Nyquist', () => {
    expect(frequencyToSpectrumRatio(0, 24_000)).toBe(0);
    expect(frequencyToSpectrumRatio(24_000, 24_000)).toBe(1);
  });

  it('balances bass detail with enough room above 10 kHz', () => {
    const lowInterval = frequencyToSpectrumRatio(1000, 24_000) - frequencyToSpectrumRatio(0, 24_000);
    const highInterval = frequencyToSpectrumRatio(11_000, 24_000) - frequencyToSpectrumRatio(10_000, 24_000);
    const upperBand = 1 - frequencyToSpectrumRatio(10_000, 24_000);
    expect(lowInterval).toBeGreaterThan(highInterval * 5);
    expect(upperBand).toBeGreaterThan(0.23);
  });

  it('round-trips display positions and frequencies', () => {
    for (const frequency of [0, 20, 100, 440, 1000, 10_000, 24_000]) {
      const ratio = frequencyToSpectrumRatio(frequency, 24_000);
      expect(spectrumRatioToFrequency(ratio, 24_000)).toBeCloseTo(frequency, 8);
    }
  });
});
