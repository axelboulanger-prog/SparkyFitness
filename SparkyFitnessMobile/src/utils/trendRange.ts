import type { TFunction } from 'i18next';
import type { Segment } from '../components/SegmentedControl';
import { addDays, getTodayDate } from './dateUtils';

export type TrendRange = '7d' | '30d' | '90d';

export const TREND_RANGE_DAYS: Record<TrendRange, number> = {
  '7d': 7,
  '30d': 30,
  '90d': 90,
};

/** Inclusive `YYYY-MM-DD` bounds ending on `endDate` (today by default). */
export function trendRangeBounds(
  range: TrendRange,
  endDate: string = getTodayDate()
): {
  startDate: string;
  endDate: string;
} {
  return {
    startDate: addDays(endDate, -(TREND_RANGE_DAYS[range] - 1)),
    endDate,
  };
}

export const trendRangeSegments = (t: TFunction): Segment<TrendRange>[] => [
  { key: '7d', label: t('ranges.7d', { defaultValue: '7d' }) },
  { key: '30d', label: t('ranges.30d', { defaultValue: '30d' }) },
  { key: '90d', label: t('ranges.90d', { defaultValue: '90d' }) },
];
