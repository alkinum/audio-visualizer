import { describe, expect, it } from 'vitest';
import { clampAxisRange, panAxisRange, zoomAxisRange } from './chart-viewport';

describe('chart viewport', () => {
  it('clamps ranges without changing their requested span', () => {
    expect(clampAxisRange({ start: -4, end: 6 }, 0, 30)).toEqual({ start: 0, end: 10 });
    expect(clampAxisRange({ start: 25, end: 35 }, 0, 30)).toEqual({ start: 20, end: 30 });
  });

  it('zooms around the requested anchor', () => {
    expect(zoomAxisRange({ start: 0, end: 20 }, 0.5, 5, 0, 30)).toEqual({ start: 2.5, end: 12.5 });
  });

  it('honors minimum spans and boundary-aware panning', () => {
    expect(zoomAxisRange({ start: 0, end: 20 }, 0.01, 10, 0, 30, 2)).toEqual({ start: 9, end: 11 });
    expect(panAxisRange({ start: 8, end: 18 }, 20, 0, 20)).toEqual({ start: 10, end: 20 });
  });
});
