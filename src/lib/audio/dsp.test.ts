import { describe, expect, it } from 'vitest';
import { analyzeStereo, fft, makeFramePlan } from './dsp';

describe('audio DSP', () => {
  it('places a sine-wave peak in the expected FFT bin', () => {
    const size = 1024;
    const bin = 37;
    const input = new Float32Array(size);
    for (let index = 0; index < size; index += 1) {
      input[index] = Math.sin((2 * Math.PI * bin * index) / size);
    }

    const result = fft(input);
    let peakIndex = 0;
    let peakMagnitude = 0;
    for (let index = 0; index < size / 2; index += 1) {
      const magnitude = Math.hypot(result.real[index], result.imag[index]);
      if (magnitude > peakMagnitude) {
        peakMagnitude = magnitude;
        peakIndex = index;
      }
    }

    expect(peakIndex).toBe(bin);
    expect(peakMagnitude).toBeGreaterThan(size * 0.4);
  });

  it('keeps offline frame output bounded for long sources', () => {
    const plan = makeFramePlan(44_100 * 60 * 30, 2048, 1200);
    expect(plan.frameCount).toBeLessThanOrEqual(1200);
    expect(plan.hopSize).toBeGreaterThanOrEqual(1);
  });

  it('keeps an in-phase stereo signal in Mid and suppresses Side', () => {
    const samples = new Float32Array(8192);
    for (let index = 0; index < samples.length; index += 1) {
      samples[index] = Math.sin((2 * Math.PI * 440 * index) / 48_000);
    }

    const analysis = analyzeStereo(samples, samples, 48_000, samples.length / 48_000, {
      maxFrames: 4,
      binCount: 64,
    });
    expect(Math.max(...analysis.channels.mid)).toBeGreaterThan(Math.max(...analysis.channels.side));
  });

  it('keeps a polarity-inverted stereo signal in Side and suppresses Mid', () => {
    const left = new Float32Array(8192);
    const right = new Float32Array(8192);
    for (let index = 0; index < left.length; index += 1) {
      left[index] = Math.sin((2 * Math.PI * 440 * index) / 48_000);
      right[index] = -left[index];
    }

    const analysis = analyzeStereo(left, right, 48_000, left.length / 48_000, {
      maxFrames: 4,
      binCount: 64,
    });
    expect(Math.max(...analysis.channels.side)).toBeGreaterThan(Math.max(...analysis.channels.mid));
  });
});
