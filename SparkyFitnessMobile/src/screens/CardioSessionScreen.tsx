import React from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { View, Text, ScrollView, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ExerciseActivityQueryItem } from '@workspace/shared';

import { useScreenHeader } from '../hooks/useScreenHeader';
import { useCardioSessionDetail } from '../hooks/useCardioSessionDetail';
import { formatLocalizedNumber, getAppLocale } from '../localization';
import { useNativeIOSHeadersActive } from '../services/nativeTabBarPreference';
import { useActiveWorkoutBarPadding } from '../components/ActiveWorkoutBar';
import RouteMap from '../components/exerciseStats/RouteMap';
import HeartRateChart from '../components/exerciseStats/HeartRateChart';
import HeartRateZones from '../components/exerciseStats/HeartRateZones';
import type { RootStackScreenProps } from '../types/navigation';

type CardioSessionScreenProps = RootStackScreenProps<'CardioSession'>;

interface Stat {
  key: string;
  label: string;
  value: string;
}

const minutesText = (t: TFunction, minutes: number) =>
  t('exerciseStatistics.cardio.minutes', {
    count: minutes,
    formattedCount: formatLocalizedNumber(minutes),
    defaultValue: '{{formattedCount}} min',
    defaultValue_one: '{{formattedCount}} min',
    defaultValue_other: '{{formattedCount}} min',
  });

const bpmText = (t: TFunction, bpm: number) =>
  t('exerciseStatistics.cardio.bpm', {
    defaultValue: '{{value}} bpm',
    value: formatLocalizedNumber(Math.round(bpm)),
  });

function sessionStats(
  t: TFunction,
  session: ExerciseActivityQueryItem,
  distanceUnit: 'km' | 'miles'
): Stat[] {
  const stats: Stat[] = [];
  if (session.distanceFormatted != null && session.distanceFormatted > 0) {
    stats.push({
      key: 'distance',
      label: t('exerciseStatistics.cardio.distance', {
        defaultValue: 'Distance',
      }),
      value: `${formatLocalizedNumber(session.distanceFormatted, {
        maximumFractionDigits: 2,
      })} ${
        distanceUnit === 'miles'
          ? t('exerciseStatistics.cardio.unitMi', { defaultValue: 'mi' })
          : t('exerciseStatistics.cardio.unitKm', { defaultValue: 'km' })
      }`,
    });
  }
  if (session.durationMinutes > 0) {
    stats.push({
      key: 'duration',
      label: t('exerciseStatistics.cardio.duration', {
        defaultValue: 'Duration',
      }),
      value: minutesText(t, Math.round(session.durationMinutes)),
    });
  }
  if (session.formattedPace) {
    stats.push({
      key: 'pace',
      label: t('exerciseStatistics.cardio.pace', { defaultValue: 'Pace' }),
      value: session.formattedPace,
    });
  }
  if (session.avgHeartRate != null && session.avgHeartRate > 0) {
    stats.push({
      key: 'hr',
      label: t('exerciseStatistics.cardio.avgHeartRate', {
        defaultValue: 'Avg heart rate',
      }),
      value: bpmText(t, session.avgHeartRate),
    });
  }
  if (session.caloriesBurned > 0) {
    stats.push({
      key: 'calories',
      label: t('exerciseStatistics.cardio.caloriesLabel', {
        defaultValue: 'Calories',
      }),
      value: t('exerciseStatistics.cardio.calories', {
        defaultValue: '{{value}} Cal',
        value: formatLocalizedNumber(Math.round(session.caloriesBurned)),
      }),
    });
  }
  return stats;
}

const Card: React.FC<{ title: string; children: React.ReactNode }> = ({
  title,
  children,
}) => (
  <View className="bg-surface rounded-xl p-4 mb-4 shadow-sm">
    <Text className="text-text-primary text-base font-bold mb-3">{title}</Text>
    {children}
  </View>
);

const CardioSessionScreen: React.FC<CardioSessionScreenProps> = ({ route }) => {
  const { session, distanceUnit } = route.params;
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const activeWorkoutBarPadding = useActiveWorkoutBarPadding('stack');
  const usesNativeHeader = useNativeIOSHeadersActive();

  const header = useScreenHeader({
    title: session.exerciseName,
    // The native iOS header only takes a title through nativeTitle; without
    // it the route's static "Cardio Session" shows instead.
    nativeTitle: session.exerciseName,
    left: { kind: 'back' },
  });

  const detail = useCardioSessionDetail(session.id, session.entryDate);
  const stats = sessionStats(t, session, distanceUnit);
  const [year, month, day] = session.entryDate
    .slice(0, 10)
    .split('-')
    .map(Number);
  const dateText = new Date(
    year ?? 1970,
    (month ?? 1) - 1,
    day ?? 1
  ).toLocaleDateString(getAppLocale(), {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  const peak = detail.heartRate.reduce((max, p) => Math.max(max, p.bpm), 0);
  const average =
    detail.heartRate.length > 0
      ? detail.heartRate.reduce((sum, p) => sum + p.bpm, 0) /
        detail.heartRate.length
      : 0;

  return (
    <View
      className="flex-1 bg-background"
      style={usesNativeHeader ? undefined : { paddingTop: insets.top }}
    >
      {header}
      <ScrollView
        className="flex-1"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 80 + activeWorkoutBarPadding,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Text className="text-text-secondary text-sm mb-3">{dateText}</Text>

        {stats.length > 0 ? (
          <View className="bg-surface rounded-xl p-4 mb-4 shadow-sm flex-row flex-wrap">
            {stats.map((stat) => (
              <View key={stat.key} className="w-1/2 py-1.5">
                <Text className="text-text-secondary text-xs">
                  {stat.label}
                </Text>
                <Text className="text-text-primary text-base font-semibold">
                  {stat.value}
                </Text>
              </View>
            ))}
          </View>
        ) : null}

        <Card
          title={t('exerciseStatistics.cardio.route', {
            defaultValue: 'Route',
          })}
        >
          {detail.isRouteLoading ? (
            <ActivityIndicator />
          ) : detail.route.length > 1 ? (
            <RouteMap
              points={detail.route}
              accessibilityLabel={t('exerciseStatistics.cardio.routeA11y', {
                defaultValue:
                  'Route of this workout, from the green dot to the red ring',
              })}
            />
          ) : (
            <Text className="text-text-secondary text-sm">
              {t('exerciseStatistics.cardio.noRoute', {
                defaultValue:
                  'No GPS route stored. Indoor workouts do not have one. An outdoor walk only has a route if Apple Health shared it when the workout synced.',
              })}
            </Text>
          )}
        </Card>

        <Card
          title={t('exerciseStatistics.cardio.heartRate', {
            defaultValue: 'Heart Rate',
          })}
        >
          {detail.isHeartRateLoading ? (
            <ActivityIndicator />
          ) : detail.heartRate.length > 0 ? (
            <>
              <View className="flex-row mb-2">
                <Text className="text-text-secondary text-sm mr-4">
                  {t('exerciseStatistics.cardio.average', {
                    defaultValue: 'Avg {{value}}',
                    value: bpmText(t, average),
                  })}
                </Text>
                <Text className="text-text-secondary text-sm">
                  {t('exerciseStatistics.cardio.peak', {
                    defaultValue: 'Max {{value}}',
                    value: bpmText(t, peak),
                  })}
                </Text>
              </View>
              <HeartRateChart
                data={detail.heartRate}
                xAxisCaption={t('exerciseStatistics.cardio.minutesAxis', {
                  defaultValue: 'Minutes from start',
                })}
              />
            </>
          ) : session.avgHeartRate != null && session.avgHeartRate > 0 ? (
            <Text className="text-text-secondary text-sm">
              {t('exerciseStatistics.cardio.onlyAverage', {
                defaultValue:
                  'Average heart rate {{value}}. Beat-by-beat samples were not stored.',
                value: bpmText(t, session.avgHeartRate),
              })}
            </Text>
          ) : (
            <Text className="text-text-secondary text-sm">
              {t('exerciseStatistics.cardio.noHeartRate', {
                defaultValue: 'No heart-rate samples for this workout.',
              })}
            </Text>
          )}
        </Card>

        {detail.zones.length > 0 ? (
          <Card
            title={t('exerciseStatistics.cardio.zones', {
              defaultValue: 'Heart Rate Zones',
            })}
          >
            <HeartRateZones zones={detail.zones} />
          </Card>
        ) : null}
      </ScrollView>
    </View>
  );
};

export default CardioSessionScreen;
