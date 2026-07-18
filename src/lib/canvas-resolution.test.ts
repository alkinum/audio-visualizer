import { describe, expect, it, vi } from 'vitest';
import { prepareCanvas } from './canvas-resolution';

describe('canvas resolution', () => {
  it('uses exact backing-to-CSS transforms for fractional layout sizes', () => {
    const context = { setTransform: vi.fn() };
    const canvas = {
      width: 0,
      height: 0,
      getContext: vi.fn(() => context),
    } as unknown as HTMLCanvasElement;

    expect(prepareCanvas(canvas, 453.2890625, 246, 3)).toBe(context);
    expect(canvas.width).toBe(1360);
    expect(canvas.height).toBe(738);
    expect(context.setTransform).toHaveBeenCalledWith(1360 / 453.2890625, 0, 0, 3, 0, 0);
  });
});
