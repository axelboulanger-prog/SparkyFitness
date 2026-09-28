import { useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { fetchExerciseDashboard } from '../services/api/reportsApi';
import { exerciseDashboardQueryKey } from './queryKeys';
import { useTrendRangeBounds } from './useTrendRangeBounds';
import type { TrendRange } from '../utils/trendRange';

const exerciseDashboardFamily = ['exerciseDashboard'] as const;

export function useExerciseDashboard(range: TrendRange) {
  const queryClient = useQueryClient();
  // Refetches whichever range is on screen.
  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({
      queryKey: exerciseDashboardFamily,
      refetchType: 'active',
    });
  }, [queryClient]);
  const { startDate, endDate } = useTrendRangeBounds(range, refresh);

  const query = useQuery({
    queryKey: exerciseDashboardQueryKey(startDate, endDate),
    queryFn: () => fetchExerciseDashboard(startDate, endDate),
  });

  return {
    data: query.data,
    isLoading: query.isLoading,
    isError: query.isError,
  };
}
