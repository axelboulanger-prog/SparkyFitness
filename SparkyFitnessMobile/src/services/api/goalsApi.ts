import { apiFetch } from './apiClient';
import type { DailyGoals } from '../../types/goals';

/**
 * Fetches daily goals for a given date.
 */
export const fetchDailyGoals = async (date: string): Promise<DailyGoals> => {
  return apiFetch<DailyGoals>({
    endpoint: `/api/goals/for-date?date=${date}`,
    serviceName: 'Goals API',
    operation: 'fetch goals',
  });
};

/**
 * Fetches the resolved goal for every day in `[startDate, endDate]`, walking the same
 * `goal_date` timeline `fetchDailyGoals` resolves for a single day.
 */
export const fetchGoalsRange = async (
  startDate: string,
  endDate: string,
  adjust: boolean
): Promise<Record<string, DailyGoals>> => {
  return apiFetch<Record<string, DailyGoals>>({
    endpoint: `/api/goals/for-date?date=${startDate}&end_date=${endDate}&adjust=${adjust}`,
    serviceName: 'Goals API',
    operation: 'fetch goals range',
  });
};
