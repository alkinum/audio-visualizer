import { describe, expect, it } from 'vitest';
import { dbToAuditionPaletteIndex, makeAuditionSpectrumPalette } from './spectrogram-palette';

describe('Audition-style spectrum palette', () => {
  it('runs from a near-black noise floor to a warm near-white peak', () => {
    const palette = makeAuditionSpectrumPalette();
    expect(Array.from(palette.slice(0, 4))).toEqual([3, 4, 12, 255]);
    expect(Array.from(palette.slice(-4))).toEqual([255, 250, 221, 255]);
  });

  it('maps dB values through a clamped contrast curve', () => {
    expect(dbToAuditionPaletteIndex(-120, -100, 0)).toBe(0);
    expect(dbToAuditionPaletteIndex(-100, -100, 0)).toBe(0);
    expect(dbToAuditionPaletteIndex(-50, -100, 0)).toBeLessThan(128);
    expect(dbToAuditionPaletteIndex(0, -100, 0)).toBe(255);
    expect(dbToAuditionPaletteIndex(6, -100, 0)).toBe(255);
  });
});
