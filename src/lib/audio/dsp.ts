import type { AnalysisChannel, OfflineAnalysis } from './types';
import { spectrumRatioToFrequency } from './spectrum-frequency-scale';

export const FFT_SIZE = 4096;
export const SPECTRUM_BINS = 512;
export const MAX_SPECTRUM_FRAMES = 3600;
export const MIN_SPECTRUM_DB = -120;
export const MAX_SPECTRUM_DB = 0;

export interface AnalysisOptions {
  fftSize?: number;
  binCount?: number;
  maxFrames?: number;
  minDb?: number;
  maxDb?: number;
  onProgress?: (frame: number, totalFrames: number) => void;
}

interface FftPlan {
  size: number;
  reverse: Uint32Array;
  cosine: Float32Array;
  sine: Float32Array;
}

interface FftWorkspace {
  real: Float32Array;
  imag: Float32Array;
}

export interface LogBand {
  start: number;
  end: number;
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
  validateAnalysisInput(left, right, sampleRate, duration, fftSize, binCount, maxFrames, minDb, maxDb);

  const length = Math.max(left.length, right.length);
  const framePlan = makeFramePlan(length, fftSize, maxFrames);
  const channels = makeChannelBuffers(framePlan.frameCount, binCount);
  const window = makeHannWindow(fftSize);
  const bands = makeFrequencyBands(sampleRate, fftSize, binCount);
  const fftPlan = makeFftPlan(fftSize);
  const leftFft = makeFftWorkspace(fftSize);
  const rightFft = makeFftWorkspace(fftSize);

  for (let frame = 0; frame < framePlan.frameCount; frame += 1) {
    const start = frame * framePlan.hopSize;
    prepareFftFrame(left, start, window, leftFft);
    prepareFftFrame(right, start, window, rightFft);
    transformFft(leftFft, fftPlan);
    transformFft(rightFft, fftPlan);
    writeChannelFrame(channels, frame, leftFft, rightFft, bands, minDb, maxDb);
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
  const plan = makeFftPlan(input.length);
  const workspace = makeFftWorkspace(input.length);
  workspace.real.set(input);
  transformFft(workspace, plan);
  return workspace;
}

export function makeHannWindow(size: number): Float32Array {
  const window = new Float32Array(size);
  for (let index = 0; index < size; index += 1) {
    window[index] = 0.5 * (1 - Math.cos((2 * Math.PI * index) / Math.max(1, size - 1)));
  }
  return window;
}

export function makeFrequencyBands(sampleRate: number, fftSize: number, binCount: number): LogBand[] {
  const nyquist = sampleRate / 2;
  const maxIndex = Math.floor(fftSize / 2);
  const bands: LogBand[] = [];

  for (let index = 0; index < binCount; index += 1) {
    const lower = spectrumRatioToFrequency(index / binCount, nyquist);
    const upper = spectrumRatioToFrequency((index + 1) / binCount, nyquist);
    const start = Math.min(maxIndex, Math.max(0, Math.floor((lower * fftSize) / sampleRate)));
    const rawEnd = index === binCount - 1 ? maxIndex + 1 : Math.ceil((upper * fftSize) / sampleRate);
    const end = Math.min(maxIndex + 1, Math.max(start + 1, rawEnd));
    bands.push({ start, end });
  }

  return bands;
}

function makeFftPlan(size: number): FftPlan {
  if (size < 2 || (size & (size - 1)) !== 0) {
    throw new Error('FFT size must be a power of two');
  }

  const reverse = new Uint32Array(size);
  const bits = Math.log2(size);
  for (let index = 0; index < size; index += 1) {
    let source = index;
    let target = 0;
    for (let bit = 0; bit < bits; bit += 1) {
      target = (target << 1) | (source & 1);
      source >>= 1;
    }
    reverse[index] = target;
  }

  const cosine = new Float32Array(size / 2);
  const sine = new Float32Array(size / 2);
  for (let index = 0; index < size / 2; index += 1) {
    const angle = (-2 * Math.PI * index) / size;
    cosine[index] = Math.cos(angle);
    sine[index] = Math.sin(angle);
  }

  return { size, reverse, cosine, sine };
}

function makeFftWorkspace(size: number): FftWorkspace {
  return {
    real: new Float32Array(size),
    imag: new Float32Array(size),
  };
}

function prepareFftFrame(
  samples: Float32Array,
  start: number,
  window: Float32Array,
  workspace: FftWorkspace,
): void {
  workspace.imag.fill(0);
  for (let index = 0; index < window.length; index += 1) {
    const sampleIndex = start + index;
    workspace.real[index] = (sampleIndex < samples.length ? samples[sampleIndex] : 0) * window[index];
  }
}

function transformFft(workspace: FftWorkspace, plan: FftPlan): void {
  const { real, imag } = workspace;
  for (let index = 0; index < plan.size; index += 1) {
    const reverse = plan.reverse[index];
    if (index >= reverse) continue;
    [real[index], real[reverse]] = [real[reverse], real[index]];
    [imag[index], imag[reverse]] = [imag[reverse], imag[index]];
  }

  for (let span = 2; span <= plan.size; span *= 2) {
    const half = span / 2;
    const tableStep = plan.size / span;
    for (let offset = 0; offset < half; offset += 1) {
      const twiddle = offset * tableStep;
      const phaseReal = plan.cosine[twiddle];
      const phaseImag = plan.sine[twiddle];

      for (let index = offset; index < plan.size; index += span) {
        const pair = index + half;
        const transformedReal = phaseReal * real[pair] - phaseImag * imag[pair];
        const transformedImag = phaseReal * imag[pair] + phaseImag * real[pair];
        real[pair] = real[index] - transformedReal;
        imag[pair] = imag[index] - transformedImag;
        real[index] += transformedReal;
        imag[index] += transformedImag;
      }
    }
  }
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

function writeChannelFrame(
  channels: Record<AnalysisChannel, Float32Array>,
  frame: number,
  left: FftWorkspace,
  right: FftWorkspace,
  bands: LogBand[],
  minDb: number,
  maxDb: number,
): void {
  const outputOffset = frame * bands.length;
  const scale = 2 / left.real.length;
  const nyquistIndex = left.real.length / 2;

  for (let band = 0; band < bands.length; band += 1) {
    const range = bands[band];
    let leftEnergy = 0;
    let rightEnergy = 0;
    let midEnergy = 0;
    let sideEnergy = 0;

    for (let index = range.start; index < range.end; index += 1) {
      const leftReal = left.real[index];
      const leftImag = left.imag[index];
      const rightReal = right.real[index];
      const rightImag = right.imag[index];
      const endpointScale = index === 0 || index === nyquistIndex ? 0.25 : 1;
      leftEnergy += (leftReal * leftReal + leftImag * leftImag) * endpointScale;
      rightEnergy += (rightReal * rightReal + rightImag * rightImag) * endpointScale;
      const midReal = (leftReal + rightReal) * Math.SQRT1_2;
      const midImag = (leftImag + rightImag) * Math.SQRT1_2;
      const sideReal = (leftReal - rightReal) * Math.SQRT1_2;
      const sideImag = (leftImag - rightImag) * Math.SQRT1_2;
      midEnergy += (midReal * midReal + midImag * midImag) * endpointScale;
      sideEnergy += (sideReal * sideReal + sideImag * sideImag) * endpointScale;
    }

    const count = range.end - range.start;
    const outputIndex = outputOffset + band;
    channels.left[outputIndex] = energyToDb(leftEnergy, count, scale, minDb, maxDb);
    channels.right[outputIndex] = energyToDb(rightEnergy, count, scale, minDb, maxDb);
    channels.combined[outputIndex] = energyToDb((leftEnergy + rightEnergy) * 0.5, count, scale, minDb, maxDb);
    channels.mid[outputIndex] = energyToDb(midEnergy, count, scale, minDb, maxDb);
    channels.side[outputIndex] = energyToDb(sideEnergy, count, scale, minDb, maxDb);
  }
}

function energyToDb(energy: number, count: number, scale: number, minDb: number, maxDb: number): number {
  const magnitude = Math.sqrt(energy / Math.max(1, count)) * scale;
  return Math.max(minDb, Math.min(maxDb, 20 * Math.log10(Math.max(1e-7, magnitude))));
}

function validateAnalysisInput(
  left: Float32Array,
  right: Float32Array,
  sampleRate: number,
  duration: number,
  fftSize: number,
  binCount: number,
  maxFrames: number,
  minDb: number,
  maxDb: number,
): void {
  if (left.length === 0 || right.length === 0) throw new RangeError('Audio channels must contain samples');
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new RangeError('Sample rate must be positive');
  if (!Number.isFinite(duration) || duration <= 0) throw new RangeError('Duration must be positive');
  if (!Number.isInteger(fftSize) || fftSize < 2 || (fftSize & (fftSize - 1)) !== 0) {
    throw new RangeError('FFT size must be a power of two');
  }
  if (!Number.isInteger(binCount) || binCount < 1) throw new RangeError('Spectrum bin count must be positive');
  if (!Number.isInteger(maxFrames) || maxFrames < 1) throw new RangeError('Spectrum frame count must be positive');
  if (!Number.isFinite(minDb) || !Number.isFinite(maxDb) || minDb >= maxDb) {
    throw new RangeError('Spectrum dB range is invalid');
  }
}
