import {
  HEALTH_TREND_KEYS,
  type HealthTrendKey,
} from '../constants/healthTrends';

const isHealthTrendKey = (value: string): value is HealthTrendKey =>
  (HEALTH_TREND_KEYS as readonly string[]).includes(value);

/**
 * The user's saved graph order, reconciled against the current registry.
 *
 * Keys the saved order does not know about — graphs shipped after it was written — are
 * appended in registry order, so registering a new graph never needs a store migration.
 * Keys that no longer exist, and duplicates from a corrupted write, are dropped.
 */
export function resolveHealthTrendOrder(
  savedOrder: readonly string[]
): HealthTrendKey[] {
  const resolvedOrder: HealthTrendKey[] = [];
  const seenKeys = new Set<HealthTrendKey>();

  for (const key of savedOrder) {
    if (!isHealthTrendKey(key) || seenKeys.has(key)) continue;
    seenKeys.add(key);
    resolvedOrder.push(key);
  }

  for (const key of HEALTH_TREND_KEYS) {
    if (seenKeys.has(key)) continue;
    resolvedOrder.push(key);
  }

  return resolvedOrder;
}

/** The ordered graphs the pager should render, with the user's hidden ones removed. */
export function selectVisibleHealthTrends(
  order: readonly HealthTrendKey[],
  hiddenKeys: readonly string[]
): HealthTrendKey[] {
  return order.filter((key) => !hiddenKeys.includes(key));
}
