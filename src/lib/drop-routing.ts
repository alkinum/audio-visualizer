import type { ComparisonSlot } from '$lib/audio/types';

export type DropPlan<T> =
  | { kind: 'none' }
  | { kind: 'primary'; item: T }
  | { kind: 'comparison'; item: T }
  | { kind: 'pair'; primary: T; comparison: T };

export function planDroppedItems<T>(
  items: readonly T[],
  slot: ComparisonSlot,
  hasPrimary: boolean,
): DropPlan<T> {
  const [first, second] = items.slice(0, 2);
  if (first === undefined) return { kind: 'none' };
  if (second !== undefined) return { kind: 'pair', primary: first, comparison: second };
  if (slot === 'b' && hasPrimary) return { kind: 'comparison', item: first };
  return { kind: 'primary', item: first };
}
