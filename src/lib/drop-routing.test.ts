import { describe, expect, it } from 'vitest';
import { planDroppedItems } from './drop-routing';

describe('drop routing', () => {
  it('routes a single item to the highlighted comparison slot when A exists', () => {
    expect(planDroppedItems(['reference.wav'], 'b', true)).toEqual({
      kind: 'comparison',
      item: 'reference.wav',
    });
  });

  it('routes a single item to A when there is no existing primary', () => {
    expect(planDroppedItems(['primary.wav'], 'b', false)).toEqual({
      kind: 'primary',
      item: 'primary.wav',
    });
  });

  it('uses the first two items as A and B regardless of the highlighted slot', () => {
    expect(planDroppedItems(['first.wav', 'second.wav', 'ignored.wav'], 'b', true)).toEqual({
      kind: 'pair',
      primary: 'first.wav',
      comparison: 'second.wav',
    });
  });

  it('does nothing for an empty drop', () => {
    expect(planDroppedItems([], 'a', true)).toEqual({ kind: 'none' });
  });
});
