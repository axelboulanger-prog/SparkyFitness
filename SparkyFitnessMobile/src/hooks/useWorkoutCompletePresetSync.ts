import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Alert } from 'react-native';
import Toast from 'react-native-toast-message';
import { useIsFocused } from '@react-navigation/native';
import type { PresetSessionResponse } from '@workspace/shared';
import { useProfile } from './useProfile';
import { useUpdateWorkoutPreset } from './useWorkoutPresetMutations';
import { getWorkoutPresetById } from '../services/api/workoutPresetsApi';
import { getActiveServerConfig } from '../services/storage';
import {
  buildPresetUpdateExercises,
  type AssumedSetValues,
  type AssumedValueSources,
} from '../utils/workoutSession';
import type { WorkoutPreset } from '../types/workoutPresets';
import type { CompletedSetMap } from '../stores/activeWorkoutStore';

const UPDATE_PRESET_PROMPT_DELAY_MS = 800;

interface UseWorkoutCompletePresetSyncArgs {
  session: PresetSessionResponse;
  sourcePresetId?: number | null;
  sourceServerConfigId?: string | null;
  completedSetIds: CompletedSetMap;
  plannedSetValues: Record<string, AssumedSetValues>;
  /** Live placeholder inputs; see buildPresetUpdateExercises. */
  assumeSources?: Omit<AssumedValueSources, 'plannedSetValues'>;
}

export function useWorkoutCompletePresetSync({
  session,
  sourcePresetId,
  sourceServerConfigId,
  completedSetIds,
  plannedSetValues,
  assumeSources,
}: UseWorkoutCompletePresetSyncArgs) {
  const { t } = useTranslation();
  const { profile } = useProfile();
  const isFocused = useIsFocused();
  const { updatePresetAsync } = useUpdateWorkoutPreset();
  const [sourcePreset, setSourcePreset] = useState<WorkoutPreset | null>(null);
  const promptedRef = useRef(false);

  useEffect(() => {
    if (sourcePresetId == null) return;
    let cancelled = false;
    void (async () => {
      try {
        const config = await getActiveServerConfig();
        if (cancelled || config?.id !== sourceServerConfigId) return;
        const preset = await getWorkoutPresetById(sourcePresetId);
        if (!cancelled) setSourcePreset(preset);
      } catch {
        // Deleted mid-workout (404) or unreachable — no prompt.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sourcePresetId, sourceServerConfigId]);

  const presetUpdateExercises = useMemo(
    () =>
      sourcePreset == null
        ? null
        : buildPresetUpdateExercises(session, sourcePreset, {
            completedSetIds,
            plannedSetValues,
            assumeSources,
          }),
    [sourcePreset, session, completedSetIds, plannedSetValues, assumeSources]
  );

  useEffect(() => {
    if (promptedRef.current || !isFocused) return;
    if (sourcePreset == null || presetUpdateExercises == null) return;
    if (!sourcePreset.user_id || profile?.id !== sourcePreset.user_id) return;
    const presetId = sourcePreset.id;
    const exercises = presetUpdateExercises;
    const timer = setTimeout(() => {
      promptedRef.current = true;
      Alert.alert(
        t('workoutComplete.confirm.updatePresetTitle', {
          defaultValue: 'Update preset?',
        }),
        t('workoutComplete.confirm.updatePresetMessage', {
          defaultValue:
            'Today\'s workout differs from "{{preset}}". Update the preset to match?',
          preset: sourcePreset.name,
        }),
        [
          {
            text: t('workoutComplete.actions.keepPreset', {
              defaultValue: 'Keep Preset',
            }),
            style: 'cancel',
          },
          {
            text: t('workoutComplete.actions.update', {
              defaultValue: 'Update',
            }),
            onPress: () => {
              void (async () => {
                try {
                  await updatePresetAsync({
                    id: presetId,
                    payload: { exercises },
                  });
                  Toast.show({
                    type: 'success',
                    text1: t('workoutComplete.success.presetUpdated', {
                      defaultValue: 'Preset updated',
                    }),
                  });
                } catch {
                  // useUpdateWorkoutPreset already showed the failure toast.
                }
              })();
            },
          },
        ]
      );
    }, UPDATE_PRESET_PROMPT_DELAY_MS);
    return () => clearTimeout(timer);
  }, [
    isFocused,
    sourcePreset,
    presetUpdateExercises,
    profile?.id,
    updatePresetAsync,
    t,
  ]);
}
