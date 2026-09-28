import { useCallback, useRef, useState } from 'react';
import { useRefetchOnFocus } from './useRefetchOnFocus';
import { getTodayDate } from '../utils/dateUtils';
import { trendRangeBounds, type TrendRange } from '../utils/trendRange';

/**
 * Date bounds for a range ending today, refreshed on screen focus.
 *
 * Today is held in state so a screen left open past midnight moves its range
 * forward on the next focus; the new bounds change the caller's query key,
 * which fetches on its own. On the same day, `refresh` runs instead, because
 * default staleTime is Infinity and a workout logged elsewhere should show.
 *
 * The first focus is the screen opening, when the caller's queries are
 * already fetching for the day just read, so it is skipped rather than
 * invalidating (or, for cardio, resetting) a request in flight.
 */
export function useTrendRangeBounds(range: TrendRange, refresh: () => void) {
  const [today, setToday] = useState(getTodayDate);
  const focusedBefore = useRef(false);

  const onFocus = useCallback(() => {
    if (!focusedBefore.current) {
      focusedBefore.current = true;
      return;
    }
    const now = getTodayDate();
    if (now !== today) {
      setToday(now);
      return;
    }
    refresh();
  }, [today, refresh]);
  useRefetchOnFocus(onFocus);

  return trendRangeBounds(range, today);
}
