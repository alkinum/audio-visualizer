import { describe, expect, it } from 'vitest';
import { analyzeStereo, fft, makeFramePlan, makeLogBands } from './dsp';

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

  it('matches a direct Fourier transform for a small deterministic signal', () => {
    const input = new Float32Array([0.25, -0.5, 0.75, 0.125, -0.25, 0.5, -0.75, -0.125]);
    const result = fft(input);

    for (let frequency = 0; frequency < input.length; frequency += 1) {
      let expectedReal = 0;
      let expectedImag = 0;
      for (let sample = 0; sample < input.length; sample += 1) {
        const angle = (-2 * Math.PI * frequency * sample) / input.length;
        expectedReal += input[sample] * Math.cos(angle);
        expectedImag += input[sample] * Math.sin(angle);
      }
      expect(result.real[frequency]).toBeCloseTo(expectedReal, 5);
      expect(result.imag[frequency]).toBeCloseTo(expectedImag, 5);
    }
  });

  it('keeps offline frame output bounded for long sources', () => {
    const plan = makeFramePlan(44_100 * 60 * 30, 2048, 1200);
    expect(plan.frameCount).toBeLessThanOrEqual(1200);
    expect(plan.hopSize).toBeGreaterThanOrEqual(1);
  });

  it('keeps every log-frequency band non-empty through Nyquist', () => {
    const fftSize = 4096;
    const bands = makeLogBands(48_000, fftSize, 512);
    expect(bands).toHaveLength(512);
    for (const band of bands) {
      expect(band.end).toBeGreaterThan(band.start);
      expect(band.start).toBeGreaterThanOrEqual(1);
      expect(band.end).toBeLessThanOrEqual(fftSize / 2 + 1);
    }
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
