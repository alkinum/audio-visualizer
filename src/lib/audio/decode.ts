import type { DecodedAudio, PeakSeries, WaveformData } from './types';

const DEFAULT_PEAK_COUNT = 1600;

export async function decodeAudioFile(file: File): Promise<DecodedAudio> {
  const context = new AudioContext();

  try {
    const encoded = await file.arrayBuffer();
    const buffer = await context.decodeAudioData(encoded.slice(0));

    return {
      buffer,
      waveform: extractWaveform(buffer),
    };
  } finally {
    await context.close().catch(() => undefined);
  }
}

export function extractWaveform(buffer: AudioBuffer, peakCount = DEFAULT_PEAK_COUNT): WaveformData {
  const count = Math.max(1, Math.min(peakCount, buffer.length));
  const left = buffer.getChannelData(0);
  const right = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : left;

  return {
    left: extractChannelPeaks(left, count),
    right: extractChannelPeaks(right, count),
    combined: extractCombinedPeaks(left, right, count),
  };
}

function createPeakSeries(count: number): PeakSeries {
  return {
    min: new Float32Array(count),
    max: new Float32Array(count),
  };
}

function extractChannelPeaks(samples: Float32Array, count: number): PeakSeries {
  const peaks = createPeakSeries(count);

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor((bucket * samples.length) / count);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * samples.length) / count));
    let minimum = 1;
    let maximum = -1;

    for (let index = start; index < end && index < samples.length; index += 1) {
      const sample = samples[index];
      minimum = Math.min(minimum, sample);
      maximum = Math.max(maximum, sample);
    }

    peaks.min[bucket] = minimum;
    peaks.max[bucket] = maximum;
  }

  return peaks;
}

function extractCombinedPeaks(left: Float32Array, right: Float32Array, count: number): PeakSeries {
  const peaks = createPeakSeries(count);

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor((bucket * left.length) / count);
    const end = Math.max(start + 1, Math.floor(((bucket + 1) * left.length) / count));
    let minimum = 1;
    let maximum = -1;

    for (let index = start; index < end && index < left.length; index += 1) {
      const sample = (left[index] + right[index]) * 0.5;
      minimum = Math.min(minimum, sample);
      maximum = Math.max(maximum, sample);
    }

    peaks.min[bucket] = minimum;
    peaks.max[bucket] = maximum;
  }

  return peaks;
}
