// The 700 Hz pivot follows the mel-scale shape: it preserves useful bass detail
// without compressing the upper octave into a narrow strip.
export const SPECTRUM_FREQUENCY_CURVE_HZ = 700;

export interface SpectrumFrequencyRange {
  minimum: number;
  maximum: number;
}

export function frequencyToSpectrumRatio(frequency: number, nyquist: number): number {
  if (!Number.isFinite(nyquist) || nyquist <= 0) throw new RangeError('Nyquist frequency must be positive');
  const clamped = Math.max(0, Math.min(nyquist, frequency));
  return Math.log1p(clamped / SPECTRUM_FREQUENCY_CURVE_HZ) /
    Math.log1p(nyquist / SPECTRUM_FREQUENCY_CURVE_HZ);
}

export function spectrumRatioToFrequency(ratio: number, nyquist: number): number {
  if (!Number.isFinite(nyquist) || nyquist <= 0) throw new RangeError('Nyquist frequency must be positive');
  const clamped = Math.max(0, Math.min(1, ratio));
  return SPECTRUM_FREQUENCY_CURVE_HZ *
    Math.expm1(clamped * Math.log1p(nyquist / SPECTRUM_FREQUENCY_CURVE_HZ));
}

export function panSpectrumFrequencyRange(
  range: SpectrumFrequencyRange,
  deltaRatio: number,
  nyquist: number,
): SpectrumFrequencyRange {
  if (!Number.isFinite(deltaRatio)) throw new RangeError('Pan delta must be finite');
  const minimumRatio = frequencyToSpectrumRatio(range.minimum, nyquist);
  const maximumRatio = frequencyToSpectrumRatio(range.maximum, nyquist);
  const span = Math.max(0, maximumRatio - minimumRatio);
  const nextMinimumRatio = Math.max(0, Math.min(1 - span, minimumRatio + deltaRatio));

  return {
    minimum: spectrumRatioToFrequency(nextMinimumRatio, nyquist),
    maximum: spectrumRatioToFrequency(nextMinimumRatio + span, nyquist),
  };
}
