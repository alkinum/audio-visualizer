import type { DecodedAudio, PeakSeries, WaveformData } from './types';

const DEFAULT_PEAK_COUNT = 8192;

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
  const leftSamples = buffer.getChannelData(0);
  const rightSamples = buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : leftSamples;
  const left = createPeakSeries(count);
  const right = createPeakSeries(count);
  const combined = createPeakSeries(count);

  for (let bucket = 0; bucket < count; bucket += 1) {
    const start = Math.floor((bucket * buffer.length) / count);
    const end = Math.min(buffer.length, Math.max(start + 1, Math.floor(((bucket + 1) * buffer.length) / count)));
    let leftMinimum = 1;
    let leftMaximum = -1;
    let rightMinimum = 1;
    let rightMaximum = -1;
    let combinedMinimum = 1;
    let combinedMaximum = -1;

    for (let index = start; index < end; index += 1) {
      const leftSample = leftSamples[index];
      const rightSample = rightSamples[index];
      const combinedSample = (leftSample + rightSample) * 0.5;
      leftMinimum = Math.min(leftMinimum, leftSample);
      leftMaximum = Math.max(leftMaximum, leftSample);
      rightMinimum = Math.min(rightMinimum, rightSample);
      rightMaximum = Math.max(rightMaximum, rightSample);
      combinedMinimum = Math.min(combinedMinimum, combinedSample);
      combinedMaximum = Math.max(combinedMaximum, combinedSample);
    }

    left.min[bucket] = leftMinimum;
    left.max[bucket] = leftMaximum;
    right.min[bucket] = rightMinimum;
    right.max[bucket] = rightMaximum;
    combined.min[bucket] = combinedMinimum;
    combined.max[bucket] = combinedMaximum;
  }

  return { left, right, combined };
}

function createPeakSeries(count: number): PeakSeries {
  return {
    min: new Float32Array(count),
    max: new Float32Array(count),
  };
}
