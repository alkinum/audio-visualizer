export type SpectrumRgb = readonly [red: number, green: number, blue: number];

interface SpectrumColorStop {
  position: number;
  color: SpectrumRgb;
}

const AUDITION_STYLE_STOPS: readonly SpectrumColorStop[] = [
  { position: 0, color: [3, 4, 12] },
  { position: 0.1, color: [7, 10, 28] },
  { position: 0.22, color: [13, 25, 65] },
  { position: 0.35, color: [39, 29, 94] },
  { position: 0.48, color: [93, 30, 88] },
  { position: 0.6, color: [154, 38, 65] },
  { position: 0.72, color: [210, 64, 43] },
  { position: 0.84, color: [241, 125, 44] },
  { position: 0.93, color: [250, 196, 74] },
  { position: 1, color: [255, 250, 221] },
];

const DB_CONTRAST_GAMMA = 1.08;

export function makeAuditionSpectrumPalette(size = 256): Uint8ClampedArray {
  if (!Number.isInteger(size) || size < 2) throw new RangeError('Spectrum palette size must be at least two');

  const palette = new Uint8ClampedArray(size * 4);
  for (let index = 0; index < size; index += 1) {
    const position = index / (size - 1);
    const color = interpolateStops(position);
    const offset = index * 4;
    palette[offset] = color[0];
    palette[offset + 1] = color[1];
    palette[offset + 2] = color[2];
    palette[offset + 3] = 255;
  }
  return palette;
}

export function dbToAuditionPaletteIndex(db: number, minDb: number, maxDb: number, size = 256): number {
  if (!Number.isFinite(db)) return 0;
  if (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || minDb >= maxDb) {
    throw new RangeError('Spectrum dB range is invalid');
  }
  if (!Number.isInteger(size) || size < 2) throw new RangeError('Spectrum palette size must be at least two');

  const normalized = Math.max(0, Math.min(1, (db - minDb) / (maxDb - minDb)));
  const contrasted = normalized ** DB_CONTRAST_GAMMA;
  return Math.round(contrasted * (size - 1));
}

function interpolateStops(position: number): SpectrumRgb {
  const upperIndex = AUDITION_STYLE_STOPS.findIndex((stop) => stop.position >= position);
  if (upperIndex <= 0) return AUDITION_STYLE_STOPS[0].color;

  const lower = AUDITION_STYLE_STOPS[upperIndex - 1];
  const upper = AUDITION_STYLE_STOPS[upperIndex];
  const progress = (position - lower.position) / (upper.position - lower.position);
  return [
    Math.round(lower.color[0] + (upper.color[0] - lower.color[0]) * progress),
    Math.round(lower.color[1] + (upper.color[1] - lower.color[1]) * progress),
    Math.round(lower.color[2] + (upper.color[2] - lower.color[2]) * progress),
  ];
}
