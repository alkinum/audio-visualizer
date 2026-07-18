import { describe, expect, it } from 'vitest';
import { serializeAnalysisError } from './analysis-protocol';

describe('analysis diagnostics serialization', () => {
  it('preserves Error identity, stack, cause, stage, and context', () => {
    const cause = new TypeError('FFT workspace failed', { cause: new Error('allocation rejected') });
    const serialized = serializeAnalysisError(cause, 'analyzing', { frame: 42, fftSize: 8192 });

    expect(serialized.name).toBe('TypeError');
    expect(serialized.message).toBe('FFT workspace failed');
    expect(serialized.stack).toContain('FFT workspace failed');
    expect(serialized.cause).toBe('Error: allocation rejected');
    expect(serialized.stage).toBe('analyzing');
    expect(serialized.context).toEqual({ frame: 42, fftSize: 8192 });
  });

  it('serializes non-Error values without throwing', () => {
    const circular: Record<string, unknown> = {};
    circular.self = circular;
    const serialized = serializeAnalysisError(circular, 'finalizing');

    expect(serialized.name).toBe('UnknownError');
    expect(serialized.message).toBe('[object Object]');
    expect(serialized.stage).toBe('finalizing');
  });
});
