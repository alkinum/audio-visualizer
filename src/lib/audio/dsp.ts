import type { AnalysisChannel, OfflineAnalysis } from './types';

export const FFT_SIZE = 2048;
export const SPECTRUM_BINS = 192;
export const MAX_SPECTRUM_FRAMES = 1200;
export const MIN_SPECTRUM_DB = -100;
export const MAX_SPECTRUM_DB = 0;

export interface AnalysisOptions {
  fftSize?: number;
  binCount?: number;
  maxFrames?: number;
  minDb?: number;
  maxDb?: number;
  onProgress?: (frame: number, totalFrames: number) => void;
}

export function analyzeStereo(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  duration: number,
  options: AnalysisOptions = {},
): OfflineAnalysis {
  const fftSize = options.fftSize ?? FFT_SIZE;
  const binCount = options.binCount ?? SPECTRUM_BINS;
  const maxFrames = options.maxFrames ?? MAX_SPECTRUM_FRAMES;
  const minDb = options.minDb ?? MIN_SPECTRUM_DB;
  const maxDb = options.maxDb ?? MAX_SPECTRUM_DB;
  const length = Math.max(left.length, right.length);
  const framePlan = makeFramePlan(length, fftSize, maxFrames);
  const channels = makeChannelBuffers(framePlan.frameCount, binCount);
  const window = makeHannWindow(fftSize);
  const bands = makeLogBands(sampleRate, fftSize, binCount);

  for (let frame = 0; frame < framePlan.frameCount; frame += 1) {
    const start = frame * framePlan.hopSize;
    const leftFrame = readWindow(left, start, fftSize, window);
    const rightFrame = readWindow(right, start, fftSize, window);
    const leftFft = fft(leftFrame);
    const rightFft = fft(rightFrame);

    writeFrame(channels, 'left', frame, leftFft, undefined, bands, minDb, maxDb);
    writeFrame(channels, 'right', frame, rightFft, undefined, bands, minDb, maxDb);
    writeFrame(channels, 'combined', frame, leftFft, rightFft, bands, minDb, maxDb);
    writeFrame(channels, 'mid', frame, leftFft, rightFft, bands, minDb, maxDb, 'mid');
    writeFrame(channels, 'side', frame, leftFft, rightFft, bands, minDb, maxDb, 'side');
    options.onProgress?.(frame + 1, framePlan.frameCount);
  }

  return {
    channels,
    frameCount: framePlan.frameCount,
    binCount,
    duration,
    sampleRate,
    minDb,
    maxDb,
  };
}

export function makeFramePlan(length: number, fftSize: number, maxFrames: number): {
  frameCount: number;
  hopSize: number;
} {
  if (length <= fftSize) return { frameCount: 1, hopSize: fftSize };

  const hopSize = Math.max(1, Math.ceil((length - fftSize) / Math.max(1, maxFrames - 1)));
  const frameCount = Math.min(maxFrames, Math.max(1, Math.floor((length - fftSize) / hopSize) + 1));
  return { frameCount, hopSize };
}

export function fft(input: Float32Array): { real: Float32Array; imag: Float32Array } {
  const size = input.length;
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error('FFT size must be a power of two');
  }

  const real = new Float32Array(input);
  const imag = new Float32Array(size);

  let reverse = 0;
  for (let index = 0; index < size - 1; index += 1) {
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
    }

    let bit = size >> 1;
    while (reverse >= bit && bit > 0) {
      reverse -= bit;
      bit >>= 1;
    }
    reverse += bit;
  }

  for (let span = 2; span <= size; span <<= 1) {
    const half = span >> 1;
    const angle = -2 * Math.PI / span;
    const phaseReal = Math.cos(angle);
    const phaseImag = Math.sin(angle);
    let currentReal = 1;
    let currentImag = 0;

    for (let offset = 0; offset < half; offset += 1) {
      for (let index = offset; index < size; index += span) {
        const pair = index + half;
        const transformedReal = currentReal * real[pair] - currentImag * imag[pair];
        const transformedImag = currentReal * imag[pair] + currentImag * real[pair];
        real[pair] = real[index] - transformedReal;
        imag[pair] = imag[index] - transformedImag;
        real[index] += transformedReal;
        imag[index] += transformedImag;
      }

      [currentReal, currentImag] = [
        currentReal * phaseReal - currentImag * phaseImag,
        currentReal * phaseImag + currentImag * phaseReal,
      ];
    }
  }

  return { real, imag };
}

export function makeHannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / Math.max(1, size - 1)));
  }
  return window;
}

interface LogBand {
  start: number;
  end: number;
}

function makeLogBands(sampleRate: number, fftSize: number, binCount: number): LogBand[] {
  const minFrequency = 20;
  const maxFrequency = Math.max(minFrequency, sampleRate / 2);
  const bands: LogBand[] = [];
  const logMin = Math.log(minFrequency);
  const logMax = Math.log(maxFrequency);

  for (let index = 0; index < binCount; index += 1) {
    const lower = Math.exp(logMin + ((logMax - logMin) * index) / binCount);
    const upper = Math.exp(logMin + ((logMax - logMin) * (index + 1)) / binCount);
    const start = Math.max(1, Math.floor((lower * fftSize) / sampleRate));
    const end = Math.max(start + 1, Math.ceil((upper * fftSize) / sampleRate));
    bands.push({ start, end: Math.min(fftSize / 2, end) });
  }

  return bands;
}

function readWindow(samples: Float32Array, start: number, size: number, window: Float32Array): Float32Array {
  const frame = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    const sampleIndex = start + index;
    frame[index] = (sampleIndex < samples.length ? samples[sampleIndex] : 0) * window[index];
  }
  return frame;
}

function makeChannelBuffers(frameCount: number, binCount: number): Record<AnalysisChannel, Float32Array> {
  const length = frameCount * binCount;
  return {
    combined: new Float32Array(length),
    left: new Float32Array(length),
    right: new Float32Array(length),
    mid: new Float32Array(length),
    side: new Float32Array(length),
  };
}

type DerivedMode = 'mid' | 'side';

function writeFrame(
  channels: Record<AnalysisChannel, Float32Array>,
  target: AnalysisChannel,
  frame: number,
  left: { real: Float32Array; imag: Float32Array },
  right: { real: Float32Array; imag: Float32Array } | undefined,
  bands: LogBand[],
  minDb: number,
  maxDb: number,
  derivedMode?: DerivedMode,
): void {
  const output = channels[target];
  const scale = 2 / left.real.length;

  for (let band = 0; band < bands.length; band += 1) {
    const range = bands[band];
    let energy = 0;
    let count = 0;

    for (let index = range.start; index < range.end; index += 1) {
      const leftReal = left.real[index];
      const leftImag = left.imag[index];
      let real = leftReal;
      let imag = leftImag;

      if (right) {
        const rightReal = right.real[index];
        const rightImag = right.imag[index];
        if (target === 'combined') {
          energy += (leftReal * leftReal + leftImag * leftImag + rightReal * rightReal + rightImag * rightImag) * 0.5;
        } else if (derivedMode === 'mid') {
          real = (leftReal + rightReal) * Math.SQRT1_2;
          imag = (leftImag + rightImag) * Math.SQRT1_2;
          energy += real * real + imag * imag;
        } else if (derivedMode === 'side') {
          real = (leftReal - rightReal) * Math.SQRT1_2;
          imag = (leftImag - rightImag) * Math.SQRT1_2;
          energy += real * real + imag * imag;
        } else {
          energy += real * real + imag * imag;
        }
      } else {
        energy += real * real + imag * imag;
      }
      count += 1;
    }

    const magnitude = Math.sqrt(energy / Math.max(1, count)) * scale;
    const db = Math.max(minDb, Math.min(maxDb, 20 * Math.log10(Math.max(1e-7, magnitude))));
    output[frame * bands.length + band] = db;
  }
}
