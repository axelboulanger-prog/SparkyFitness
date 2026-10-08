import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import WatchConnectivity, {
  type WatchWorkoutStartPayload,
} from '../../modules/watch-connectivity';
import { isTempSetId } from '../utils/workoutSession';
import { buildWatchWorkoutStartPayload } from './useStartLiveWorkout';

type ActiveWorkoutState = ReturnType<typeof useActiveWorkoutStore.getState>;

/**
 * The plan's shape: exercises, their sets and supersets, and the set order.
 * Weight/reps targets are left out; `useWatchSetTargetsSync` keeps those in
 * step on its own.
 */
function watchPlanStructureKey(plan: WatchWorkoutStartPayload): string {
  return JSON.stringify([
    plan.exercises.map((exercise) => [
      exercise.exerciseEntryId,
      exercise.name,
      exercise.supersetRun,
      exercise.bodyweight ?? false,
      exercise.sets.map((set) => [set.setId, set.setType, set.restSeconds]),
    ]),
    plan.setOrder,
  ]);
}

/**
 * Keeps a paired watch's workout plan in step when exercises, supersets or
 * sets are added, removed or regrouped on the phone mid-workout. The watch is
 * armed once at live start; without this it keeps the original plan, and
 * anything added later can only be logged on the phone.
 *
 * Waits while any set still has a temporary id: the autosave swaps those for
 * server ids within moments, and a set the watch logged under the temporary
 * id would no longer match anything on the phone.
 */
export function useWatchPlanSync(enabled: boolean): void {
  const { t } = useTranslation();
  useEffect(() => {
    if (!enabled || !WatchConnectivity?.isSupported()) return;
    const watch = WatchConnectivity;
    // The structure the watch has for this arm, so only a change is sent.
    // `key` is null when the arm went out while a set still had a temporary
    // id: the watch's plan then has that id, so the first plan with server
    // ids must be sent even though nothing else changed.
    let known: { armedAt: number; key: string | null } | null = null;
    let lastRevision = 0;

    const sync = (state: ActiveWorkoutState): void => {
      const { session, watchArmedAt } = state;
      if (session == null || session.type !== 'preset' || watchArmedAt == null)
        return;
      if (
        session.exercises.some((exercise) =>
          exercise.sets.some((set) => isTempSetId(set.id))
        )
      ) {
        if (known?.armedAt !== watchArmedAt) {
          known = { armedAt: watchArmedAt, key: null };
        }
        return;
      }
      const plan = buildWatchWorkoutStartPayload(session, t, watchArmedAt);
      const key = watchPlanStructureKey(plan);
      if (known?.armedAt !== watchArmedAt) {
        // A new arm: the start just sent already carries this structure.
        known = { armedAt: watchArmedAt, key };
        return;
      }
      if (known.key === key) return;
      known = { armedAt: watchArmedAt, key };
      // Wall-clock based so a JS restart cannot send a revision the watch
      // already has; bumped past the last one for sends in the same ms.
      lastRevision = Math.max(lastRevision + 1, Date.now());
      void watch.updateWorkoutPlan({ ...plan, revision: lastRevision });
    };

    sync(useActiveWorkoutStore.getState());
    return useActiveWorkoutStore.subscribe((state, prev) => {
      if (
        state.session === prev.session &&
        state.steps === prev.steps &&
        state.watchArmedAt === prev.watchArmedAt
      ) {
        return;
      }
      sync(state);
    });
  }, [enabled, t]);
}
