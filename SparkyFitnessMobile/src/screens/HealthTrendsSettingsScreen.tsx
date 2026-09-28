import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { ScrollView, Text, View } from 'react-native';
import { useDerivedValue, useSharedValue } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import { ReorderSwitchRow } from '../components/ReorderSwitchRow';
import {
  computeReorderTargetIndex,
  REORDER_ROW_HEIGHT,
  resetReorderDragPreview,
  useReorderRowGeometry,
} from '../components/WorkoutReorderList';
import { HEALTH_TREND_LABELS } from '../constants/healthTrends';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import type { RootStackScreenProps } from '../types/navigation';
import { resolveHealthTrendOrder } from '../utils/healthTrendPreferences';
import { moveItem } from '../utils/reorderUtils';

type HealthTrendsSettingsScreenProps =
  RootStackScreenProps<'HealthTrendsSettings'>;

// Every row shares one height so the drag geometry has a single stride and the
// shared reorder worklets stay exact.
const ROW_HEIGHT = REORDER_ROW_HEIGHT;

const HealthTrendsSettingsScreen: React.FC<
  HealthTrendsSettingsScreenProps
> = () => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();

  const healthTrendOrder = useAppPreferencesStore((s) => s.healthTrendOrder);
  const hiddenHealthTrends = useAppPreferencesStore(
    (s) => s.hiddenHealthTrends
  );
  const setHealthTrendOrder = useAppPreferencesStore(
    (s) => s.setHealthTrendOrder
  );
  const setHealthTrendHidden = useAppPreferencesStore(
    (s) => s.setHealthTrendHidden
  );

  const orderedKeys = useMemo(
    () => resolveHealthTrendOrder(healthTrendOrder),
    [healthTrendOrder]
  );

  const { strides, offsets } = useReorderRowGeometry(orderedKeys.length);

  const activeDragIndex = useSharedValue(-1);
  const panY = useSharedValue(0);
  const committingTranslate = useSharedValue(0);
  const pendingDragResetRef = useRef(false);

  const targetIndex = useDerivedValue(() =>
    activeDragIndex.value < 0
      ? -1
      : computeReorderTargetIndex(
          strides,
          offsets,
          activeDragIndex.value,
          panY.value
        )
  );

  const handleMove = useCallback(
    (fromIndex: number, toIndex: number) => {
      if (fromIndex === toIndex) return;
      const newOrder = moveItem(orderedKeys, fromIndex, toIndex);
      pendingDragResetRef.current = true;
      setHealthTrendOrder(newOrder);
    },
    [orderedKeys, setHealthTrendOrder]
  );

  // Release the floating transform only once the reordered rows have rendered, so
  // clearing it is a visual no-op instead of a one-frame snap-back.
  useEffect(() => {
    if (!pendingDragResetRef.current) return;
    pendingDragResetRef.current = false;
    resetReorderDragPreview(activeDragIndex, panY, committingTranslate);
  }, [orderedKeys, committingTranslate, activeDragIndex, panY]);

  const header = useScreenHeader({
    title: t('screens.healthTrendsSettings', { defaultValue: 'Health Trends' }),
    left: { kind: 'back' },
  });

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        contentContainerStyle={{
          padding: 16,
          paddingTop: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        contentInsetAdjustmentBehavior={
          usesNativeHeader ? 'automatic' : 'never'
        }
      >
        <Text className="text-text-secondary text-sm mb-4">
          {t('healthTrendsSettings.description', {
            defaultValue:
              'Drag a graph by its handle to reorder it. Toggle off to hide it from your Dashboard.',
          })}
        </Text>

        <View className="bg-surface rounded-xl overflow-hidden shadow-sm">
          {orderedKeys.map((trendKey, index) => {
            const label = HEALTH_TREND_LABELS[trendKey](t);
            return (
              <ReorderSwitchRow
                key={trendKey}
                testID={`health-trend-row-${trendKey}`}
                dragHandleTestID={`health-trend-drag-handle-${trendKey}`}
                switchTestID={`health-trend-switch-${trendKey}`}
                index={index}
                lastIndex={orderedKeys.length - 1}
                title={label}
                isEnabled={!hiddenHealthTrends.includes(trendKey)}
                onToggle={(enabled) => setHealthTrendHidden(trendKey, !enabled)}
                onMove={handleMove}
                rowHeight={ROW_HEIGHT}
                reorderA11yLabel={t('healthTrendsSettings.reorder', {
                  defaultValue: 'Reorder {{name}}',
                  name: label,
                })}
                reorderA11yHint={t('healthTrendsSettings.reorderHint', {
                  defaultValue:
                    'Reorder this graph in your Dashboard health trends',
                })}
                activeDragIndex={activeDragIndex}
                panY={panY}
                committingTranslate={committingTranslate}
                targetIndex={targetIndex}
                strides={strides}
              />
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
};

export default HealthTrendsSettingsScreen;
