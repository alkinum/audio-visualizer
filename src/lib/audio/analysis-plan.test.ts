import { describe, expect, it } from 'vitest';
import { createAnalysisPlan } from './analysis-plan';

describe('adaptive analysis plan', () => {
  it('selects maximum 48 kHz resolution on a capable device', () => {
    const plan = createAnalysisPlan(
      { sampleLength: 48_000 * 30, sampleRate: 48_000, duration: 30 },
      { hardwareConcurrency: 10, deviceMemoryGb: 16 },
    );

    expect(plan.quality).toBe('maximum');
    expect(plan.fftSize).toBe(4096);
    expect(plan.binCount).toBe(512);
    expect(plan.maxFrames).toBe(4800);
    expect(plan.frameCount).toBeLessThanOrEqual(4800);
    expect(plan.estimatedOutputBytes).toBeLessThanOrEqual(52 * 1024 * 1024);
  });

  it('uses a bounded efficient plan for constrained high-sample-rate devices', () => {
    const plan = createAnalysisPlan(
      { sampleLength: 96_000 * 60, sampleRate: 96_000, duration: 60 },
      { hardwareConcurrency: 4, deviceMemoryGb: 4 },
    );

    expect(plan.quality).toBe('efficient');
    expect(plan.fftSize).toBe(8192);
    expect(plan.binCount).toBe(384);
    expect(plan.maxFrames).toBe(2400);
    expect(plan.estimatedOutputBytes).toBeLessThanOrEqual(24 * 1024 * 1024);
  });

  it('rejects invalid decoded-audio metadata before creating a Worker', () => {
    expect(() =>
      createAnalysisPlan(
        { sampleLength: 0, sampleRate: 48_000, duration: 0 },
        { hardwareConcurrency: 8, deviceMemoryGb: 8 },
      ),
    ).toThrow('sample length');
  });
});
