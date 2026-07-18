export const SPECTRUM_FREQUENCY_CURVE_HZ = 20;

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
