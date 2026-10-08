import { useCallback } from 'react';
import type { HealthTrendKey } from '../constants/healthTrends';
import type {
  CaloriesDataPoint,
  HealthTrendDateRange,
  HealthTrendSeries,
  HydrationDataPoint,
} from '../types/healthTrends';
import type { SleepTimelineDay, SleepTimelineSummary } from '../types/sleep';
import {
  useMeasurementsRange,
  type StepsDataPoint,
  type WeightDataPoint,
} from './useMeasurementsRange';
import { useCaloriesRange } from './useCaloriesRange';
import { useHydrationRange } from './useHydrationRange';
import { useSleepRange } from './useSleepRange';

interface UseHealthTrendsOptions {
  range: HealthTrendDateRange;
  enabled?: boolean;
  activeTrends: readonly HealthTrendKey[];
}

/**
 * The sleep page needs more than a series: its headline tiles show window averages, and
 * `nightsWithData` is what decides whether the page appears at all — `data` is padded to
 * one entry per day and so is never empty.
 */
export type SleepTrendSeries = HealthTrendSeries<SleepTimelineDay> &
  Omit<SleepTimelineSummary, 'days'>;

/** The calories page's headline tile shows the window's average, same reasoning as sleep's. */
export type CaloriesTrendSeries = HealthTrendSeries<CaloriesDataPoint> & {
  averageCalories: number | null;
  /** The resolved calorie goal for each day in the window, same order as `data`. */
  calorieGoals: (number | null)[];
};

/** The resolved hydration goal for each day in the window, same order as `data`. */
export type HydrationTrendSeries = HealthTrendSeries<HydrationDataPoint> & {
  hydrationGoals: (number | null)[];
};

interface HealthTrends {
  steps: HealthTrendSeries<StepsDataPoint>;
  weight: HealthTrendSeries<WeightDataPoint>;
  sleep: SleepTrendSeries;
  hydration: HydrationTrendSeries;
  calories: CaloriesTrendSeries;
  refetch: () => Promise<void>;
}

/**
 * Every series behind the dashboard's Health Trends pager, from one call.
 */
export function useHealthTrends({
  range,
  enabled = true,
  activeTrends,
}: UseHealthTrendsOptions): HealthTrends {
  const isMeasurementsEnabled =
    enabled &&
    (activeTrends.includes('steps') || activeTrends.includes('weight'));
  const isSleepEnabled = enabled && activeTrends.includes('sleep');
  const isHydrationEnabled = enabled && activeTrends.includes('hydration');
  const isCaloriesEnabled = enabled && activeTrends.includes('calories');

  const {
    stepsData,
    weightData,
    isLoading: isMeasurementsLoading,
    isError: isMeasurementsError,
    refetch: refetchMeasurements,
  } = useMeasurementsRange({ range, enabled: isMeasurementsEnabled });

  const {
    sleep,
    isLoading: isSleepLoading,
    isError: isSleepError,
    refetch: refetchSleep,
  } = useSleepRange({ range, enabled: isSleepEnabled });

  const {
    hydrationData,
    hydrationGoals,
    isLoading: isHydrationLoading,
    isError: isHydrationError,
    refetch: refetchHydration,
  } = useHydrationRange({ range, enabled: isHydrationEnabled });

  const {
    caloriesData,
    averageCalories,
    calorieGoals,
    isLoading: isCaloriesLoading,
    isError: isCaloriesError,
    refetch: refetchCalories,
  } = useCaloriesRange({ range, enabled: isCaloriesEnabled });

  const refetch = useCallback(async () => {
    await Promise.all([
      isMeasurementsEnabled ? refetchMeasurements() : Promise.resolve(),
      isSleepEnabled ? refetchSleep() : Promise.resolve(),
      isHydrationEnabled ? refetchHydration() : Promise.resolve(),
      isCaloriesEnabled ? refetchCalories() : Promise.resolve(),
    ]);
  }, [
    isMeasurementsEnabled,
    isSleepEnabled,
    isHydrationEnabled,
    isCaloriesEnabled,
    refetchMeasurements,
    refetchSleep,
    refetchHydration,
    refetchCalories,
  ]);

  return {
    // Steps and weight share one request, so they necessarily share its fetch state.
    steps: {
      data: stepsData,
      isLoading: isMeasurementsLoading,
      isError: isMeasurementsError,
    },
    weight: {
      data: weightData,
      isLoading: isMeasurementsLoading,
      isError: isMeasurementsError,
    },
    sleep: {
      data: sleep.days,
      averageTimeInBedSeconds: sleep.averageTimeInBedSeconds,
      averageTimeAsleepSeconds: sleep.averageTimeAsleepSeconds,
      nightsWithData: sleep.nightsWithData,
      isLoading: isSleepLoading,
      isError: isSleepError,
    },
    hydration: {
      data: hydrationData,
      hydrationGoals,
      isLoading: isHydrationLoading,
      isError: isHydrationError,
    },
    calories: {
      data: caloriesData,
      averageCalories,
      calorieGoals,
      isLoading: isCaloriesLoading,
      isError: isCaloriesError,
    },
    refetch,
  };
}
