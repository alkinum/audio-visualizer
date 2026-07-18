import type { AnalysisCapabilities, AnalysisPlan } from './types';

const CHANNEL_OUTPUT_COUNT = 5;
const BYTES_PER_FLOAT = Float32Array.BYTES_PER_ELEMENT;

export interface AnalysisPlanInput {
  sampleLength: number;
  sampleRate: number;
  duration: number;
}

export function getAnalysisCapabilities(): AnalysisCapabilities {
  if (typeof navigator === 'undefined') return { hardwareConcurrency: 4 };

  const deviceNavigator = navigator as Navigator & { deviceMemory?: number };
  return {
    hardwareConcurrency: Math.max(1, navigator.hardwareConcurrency || 4),
    deviceMemoryGb: deviceNavigator.deviceMemory,
  };
}

export function createAnalysisPlan(
  input: AnalysisPlanInput,
  capabilities: AnalysisCapabilities = getAnalysisCapabilities(),
): AnalysisPlan {
  validateInput(input);

  const constrained = capabilities.hardwareConcurrency <= 4 || (capabilities.deviceMemoryGb ?? 8) <= 4;
  const maximum =
    capabilities.hardwareConcurrency >= 8 &&
    (capabilities.deviceMemoryGb === undefined || capabilities.deviceMemoryGb >= 8);
  const quality = constrained ? 'efficient' : maximum ? 'maximum' : 'high';
  const fftSize = input.sampleRate > 50_000 ? 8192 : 4096;
  const binCount = constrained ? 384 : 512;
  const frameLimit = constrained ? 2400 : maximum ? 4800 : 3600;
  const outputBudget = (constrained ? 24 : maximum ? 52 : 40) * 1024 * 1024;
  const frameBudget = Math.max(
    1,
    Math.floor(outputBudget / (CHANNEL_OUTPUT_COUNT * binCount * BYTES_PER_FLOAT)),
  );
  const maxFrames = Math.min(frameLimit, frameBudget);
  const frameCount = estimateFrameCount(input.sampleLength, fftSize, maxFrames);
  const estimatedOutputBytes = frameCount * binCount * CHANNEL_OUTPUT_COUNT * BYTES_PER_FLOAT;
  const inputBytes = input.sampleLength * 2 * BYTES_PER_FLOAT;
  const workspaceBytes = fftSize * 7 * BYTES_PER_FLOAT;

  return {
    fftSize,
    binCount,
    maxFrames,
    frameCount,
    quality,
    estimatedOutputBytes,
    estimatedWorkerBytes: inputBytes + estimatedOutputBytes + workspaceBytes,
  };
}

function validateInput(input: AnalysisPlanInput): void {
  if (!Number.isSafeInteger(input.sampleLength) || input.sampleLength < 1) {
    throw new RangeError('Audio sample length must be a positive safe integer');
  }
  if (!Number.isFinite(input.sampleRate) || input.sampleRate <= 0) {
    throw new RangeError('Audio sample rate must be a positive finite number');
  }
  if (!Number.isFinite(input.duration) || input.duration <= 0) {
    throw new RangeError('Audio duration must be a positive finite number');
  }
}

function estimateFrameCount(length: number, fftSize: number, maxFrames: number): number {
  if (length <= fftSize) return 1;
  const hopSize = Math.max(1, Math.ceil((length - fftSize) / Math.max(1, maxFrames - 1)));
  return Math.min(maxFrames, Math.max(1, Math.floor((length - fftSize) / hopSize) + 1));
}
