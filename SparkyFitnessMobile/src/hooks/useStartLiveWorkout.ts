import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { useQueryClient } from '@tanstack/react-query';
import type { QueryClient } from '@tanstack/react-query';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type {
  PresetSessionExerciseRequest,
  PresetSessionResponse,
  WorkoutFormat,
} from '@workspace/shared';
import { useCreateWorkout } from './useExerciseMutations';
import { flushActiveWorkoutBeforeClear } from './useActiveWorkoutAutosave';
import { serverConnectionQueryKey } from './queryKeys';
import { defaultWorkoutName } from './useWorkoutForm';
import { useActiveWorkoutStore } from '../stores/activeWorkoutStore';
import WatchConnectivity, {
  type WatchWorkoutStartPayload,
} from '../../modules/watch-connectivity';
import {
  ensureNotificationPermission,
  maybePromptForExactAlarmPermission,
} from '../services/notifications';
import { getActiveServerConfig } from '../services/storage';
import { getTodayDate } from '../utils/dateUtils';
import {
  extractPlannedSetValues,
  stripPlannedSetValues,
} from '../utils/workoutSession';
import type { LiveExerciseConfig } from '../utils/workoutSession';
import { getSupersetRuns } from '../utils/workoutSupersets';
import type { RootStackParamList } from '../types/navigation';

export { syncWatchIntervalTiming } from '../stores/activeWorkoutStore';

type StartLiveWorkoutNavigation = Pick<
  NativeStackNavigationProp<RootStackParamList>,
  'replace' | 'isFocused' | 'navigate'
>;

interface StartLiveWorkoutArgs {
  /** Session name; defaults to the form path's dated name ("Workout - Jul 6"). */
  name?: string;
  exercises: PresetSessionExerciseRequest[];
  /**
   * Preset progression/ramp settings, positional with `exercises`. The server
   * session doesn't store them, so the live store keeps them client-side.
   */
  exerciseConfigs?: LiveExerciseConfig[];
  /**
   * Preset the exercises came from. Recorded in the store (with the active
   * server config id, since preset ids collide across servers) so the finish
   * flow can offer to update the preset. Omit for empty starts.
   */
  sourcePresetId?: number;
  /** Plan assignment id if starting from a workout plan session. */
  workoutPlanAssignmentId?: number;
  workoutFormat?: WorkoutFormat;
  timeCapSeconds?: number | null;
}

/**
 * Builds the plan a paired Apple Watch's Workout tab is armed with, from the
 * session and derived state `startWorkout` just committed to the store —
 * read back rather than recomputed so the watch's targets and rest agree
 * with whatever the phone's own active-workout screen would show for the
 * same session.
 */
function buildWatchWorkoutStartPayload(
  session: PresetSessionResponse,
  t: TFunction
): WatchWorkoutStartPayload {
  const {
    steps,
    plannedSetValues,
    workoutFormat,
    timeCapSeconds,
    startedAt,
    intervalPhases,
  } = useActiveWorkoutStore.getState();
  const restSecBySetId = new Map(
    steps.map((step) => [step.setId, step.restSec])
  );
  const capEndsAtMs =
    timeCapSeconds != null && intervalPhases.length > 0
      ? Math.max(...intervalPhases.map((phase) => phase.endsAt))
      : null;
  const supersetRunByEntryId = new Map<string, number>();
  getSupersetRuns(session.exercises).forEach((run, index) => {
    for (const entryId of run.entryIds) {
      supersetRunByEntryId.set(entryId, index);
    }
  });

  return {
    sessionId: session.id,
    workoutName: session.name,
    exercises: session.exercises.map((exercise) => ({
      exerciseEntryId: exercise.id,
      name:
        exercise.exercise_snapshot?.name ??
        t('workout.exercise', { defaultValue: 'Exercise' }),
      supersetRun: supersetRunByEntryId.get(exercise.id) ?? null,
      sets: exercise.sets.map((set) => {
        const setId = String(set.id);
        const planned = plannedSetValues[setId];
        return {
          setId,
          targetReps: set.reps ?? planned?.reps ?? null,
          targetWeightKg: set.weight ?? planned?.weight ?? null,
          restSeconds: restSecBySetId.get(setId) ?? 0,
          setType: set.set_type ?? null,
        };
      }),
    })),
    setOrder: steps.map((step) => step.setId),
    workoutFormat,
    timeCapSeconds,
    startedAt: startedAt != null ? new Date(startedAt).toISOString() : null,
    armedAt: new Date().toISOString(),
    capEndsAt: capEndsAtMs != null ? new Date(capEndsAtMs).toISOString() : null,
  };
}

/**
 * Arms a paired watch with whatever session is currently live in the store.
 * No-op off iOS / with no watch. Shared by the instant-start path and by
 * WorkoutDetail's "Start workout here", which used to skip this and leave
 * the watch on "Start a workout on your phone".
 */
export function armWatchForActiveSession(t: TFunction): void {
  if (!WatchConnectivity?.isSupported()) return;
  const { session } = useActiveWorkoutStore.getState();
  if (session == null || session.type !== 'preset') return;
  void WatchConnectivity.startWorkout(
    buildWatchWorkoutStartPayload(session, t)
  );
}

/**
 * When another workout is already live, prompt before starting a new one:
 * go to the active workout screen, or clear it and start fresh (with a
 * best-effort save first, mirroring the HUD's Clear action). Returns true
 * when a workout was active — the prompt owns the flow and the caller must
 * bail out; false means no conflict and the caller may start directly.
 */
export function promptForActiveWorkoutConflict(
  queryClient: QueryClient,
  options: {
    /** "Go to Workout": open the ActiveWorkout screen, leaving the session live. */
    onGoToWorkout: () => void;
    /** "Clear & Start": runs after the flush and store clear. */
    onClearAndStart: () => void | Promise<void>;
  },
  t: TFunction
): boolean {
  if (useActiveWorkoutStore.getState().sessionId === null) return false;
  Alert.alert(
    t('liveWorkout.inProgressTitle', { defaultValue: 'Workout in progress' }),
    t('liveWorkout.inProgressMessage', {
      defaultValue:
        'You already have a workout in progress. Starting another clears it here. Any sets already saved stay in your diary.',
    }),
    [
      { text: t('common.cancel', { defaultValue: 'Cancel' }), style: 'cancel' },
      {
        text: t('liveWorkout.goToWorkout', { defaultValue: 'Go to Workout' }),
        onPress: options.onGoToWorkout,
      },
      {
        text: t('liveWorkout.clearAndStart', { defaultValue: 'Clear & Start' }),
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await flushActiveWorkoutBeforeClear(queryClient);
            useActiveWorkoutStore.getState().clearWorkout();
            await options.onClearAndStart();
          })();
        },
      },
    ]
  );
  return true;
}

/**
 * Create a session server-side and enter the live ActiveWorkout screen.
 *
 * Shared by the instant preset start and the empty (first-exercise-first)
 * start. Owns the guard ordering: connection → no-other-workout → non-empty
 * payload → single-flight create → seed the store BEFORE navigating (the
 * ActiveWorkout screen auto-pops when entered without a session) → replace.
 * The replace is skipped when the calling screen lost focus mid-create (a
 * replace dispatched from an unfocused route is an unhandled action); the
 * session and store are already live, so the HUD bar covers re-entry.
 */
export function useStartLiveWorkout(navigation: StartLiveWorkoutNavigation): {
  startLiveWorkout: (args: StartLiveWorkoutArgs) => Promise<void>;
  isStarting: boolean;
} {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const { createSession, invalidateCache } = useCreateWorkout();
  const inFlightRef = useRef(false);
  const [isStarting, setIsStarting] = useState(false);

  // The actual create → seed store → navigate flow, run once the active-session
  // guard has cleared. Split out so the "Workout in progress" prompt can
  // clear the in-progress session and then call straight through.
  const runStart = useCallback(
    async ({
      name,
      exercises,
      exerciseConfigs,
      sourcePresetId,
      workoutPlanAssignmentId,
      workoutFormat,
      timeCapSeconds,
    }: StartLiveWorkoutArgs) => {
      if (exercises.length === 0) {
        Toast.show({
          type: 'error',
          text1: t('liveWorkout.nothingToStart', {
            defaultValue: 'Nothing to start',
          }),
          text2: t('liveWorkout.noExercises', {
            defaultValue: 'This preset has no exercises.',
          }),
        });
        return;
      }
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      setIsStarting(true);

      const entryDate = getTodayDate();
      try {
        // Resolved before the create so a storage failure can't strand an
        // already-created session. Preset ids collide across servers, so the
        // link is only meaningful scoped to the active config.
        const sourceServerConfigId =
          sourcePresetId != null
            ? (await getActiveServerConfig())?.id
            : undefined;
        let resolvedExercises = exercises;
        if (workoutFormat === 'tabata') {
          resolvedExercises = exercises.map((ex) => {
            if (ex.sets.length < 8 && ex.sets.length > 0) {
              const baseSets = ex.sets;
              const expandedSets = Array.from({ length: 8 }, (_, i) => {
                const templateSet = baseSets[i % baseSets.length]!;
                return {
                  ...templateSet,
                  set_number: i + 1,
                  duration: templateSet.duration ?? 20,
                  rest_time: templateSet.rest_time ?? 10,
                };
              });
              return { ...ex, sets: expandedSets };
            }
            return ex;
          });
        } else if (
          workoutFormat === 'emom' &&
          timeCapSeconds != null &&
          timeCapSeconds >= 60
        ) {
          const emomRounds = Math.floor(timeCapSeconds / 60);
          if (emomRounds > 1) {
            resolvedExercises = exercises.map((ex) => {
              if (ex.sets.length < emomRounds && ex.sets.length > 0) {
                const baseSets = ex.sets;
                const expandedSets = Array.from(
                  { length: emomRounds },
                  (_, i) => {
                    const templateSet = baseSets[i % baseSets.length]!;
                    return {
                      ...templateSet,
                      set_number: i + 1,
                    };
                  }
                );
                return { ...ex, sets: expandedSets };
              }
              return ex;
            });
          }
        }

        // Hevy-style start: sets are created with empty weight/reps — the
        // plan renders as gray placeholders and is only recorded when a set
        // is completed or typed over.
        const plannedSetValues = extractPlannedSetValues(resolvedExercises);
        const session = await createSession({
          name: name ?? defaultWorkoutName(entryDate),
          entry_date: entryDate,
          source: 'sparky',
          exercises: stripPlannedSetValues(resolvedExercises),
          // Tags the created session to the preset (recentSessions stats
          // scoping, server-side) without changing how it's built — the
          // server keeps the client-supplied exercises verbatim when both
          // fields are present instead of substituting the preset's own.
          workout_preset_id: sourcePresetId,
          workoutPlanAssignmentId,
        });
        invalidateCache(entryDate);
        // Chained so the exact-alarm prompt never stacks on top of the OS
        // notification-permission dialog.
        void ensureNotificationPermission().then(() =>
          maybePromptForExactAlarmPermission()
        );
        useActiveWorkoutStore.getState().startWorkout(session, {
          createdByLiveStart: true,
          plannedSetValues,
          exerciseConfigs,
          sourcePresetId,
          sourceServerConfigId,
          workoutFormat,
          timeCapSeconds,
        });
        armWatchForActiveSession(t);
        if (navigation.isFocused()) {
          navigation.replace('ActiveWorkout');
          // The lock stays engaged: the replace unmounts the calling screen.
        } else {
          // The caller may still be mounted under a pushed screen — release
          // the lock so it isn't stuck on "Starting…" forever. (A popped
          // caller is unmounted and the resets are harmless no-ops.)
          inFlightRef.current = false;
          setIsStarting(false);
        }
      } catch {
        // useCrudMutation already showed the failure toast; re-enable the UI.
        inFlightRef.current = false;
        setIsStarting(false);
      }
    },
    [createSession, invalidateCache, navigation, t]
  );

  const startLiveWorkout = useCallback(
    async (args: StartLiveWorkoutArgs) => {
      if (!queryClient.getQueryData(serverConnectionQueryKey)) {
        Alert.alert(
          t('liveWorkout.noServerTitle', {
            defaultValue: 'No Server Connected',
          }),
          t('liveWorkout.noServerMessage', {
            defaultValue:
              'Configure your server connection in Settings to start a workout.',
          })
        );
        return;
      }
      const prompted = promptForActiveWorkoutConflict(
        queryClient,
        {
          onGoToWorkout: () => navigation.navigate('ActiveWorkout'),
          onClearAndStart: () => runStart(args),
        },
        t
      );
      if (prompted) return;
      await runStart(args);
    },
    [queryClient, navigation, runStart, t]
  );

  return { startLiveWorkout, isStarting };
}
