/**
 * Moves one item in an array using remove-then-insert semantics.
 *
 * The destination index is clamped within bounds, and out-of-bounds source
 * lookups return a shallow copy unchanged.
 */
export function moveItem<T>(
  array: readonly T[],
  fromIndex: number,
  toIndex: number
): T[] {
  const item = array[fromIndex];
  if (item === undefined) return [...array];

  const remaining = array.filter((_, idx) => idx !== fromIndex);
  const insertIndex = Math.max(0, Math.min(toIndex, remaining.length));

  return [
    ...remaining.slice(0, insertIndex),
    item,
    ...remaining.slice(insertIndex),
  ];
}
