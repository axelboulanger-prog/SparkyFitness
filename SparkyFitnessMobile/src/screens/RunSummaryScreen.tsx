import React, { useState } from 'react';
import Toast from 'react-native-toast-message';
import { Pressable, ScrollView, Text, View } from 'react-native';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Button from '../components/ui/Button';
import Icon from '../components/Icon';
import RouteMap from '../components/exerciseStats/RouteMap';
import { SplitRow, Stat } from '../components/recording/SplitRow';
import {
  EASY_RATING,
  HARD_RATING,
  suggestFromEffort,
  type EffortSuggestion,
} from '@workspace/shared';
import {
  rateProgramWorkout,
  setProgramPosition,
} from '../services/runProgramService';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { formatLocalizedNumber } from '../localization';
import { formatDayLabel } from '../utils/dayLabel';
import {
  formatClock,
  formatPace,
  METERS_PER_KM,
  METERS_PER_MILE,
  paceSecondsPerUnit,
  splitBars,
} from '../utils/gpsRecording';
import type { RootStackScreenProps } from '../types/navigation';

type Props = RootStackScreenProps<'RunSummary'>;

const FEET_PER_METER = 3.28084;

/**
 * What a recorded walk, run or ride came to, shown once it is saved: the
 * headline figures, the route, each split (or the laps the person marked) and,
 * for a program workout, how far along they are and what is next.
 */
const RunSummaryScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const summary = route.params;
  const miles = summary.distanceUnit === 'miles';
  const unitMeters = miles ? METERS_PER_MILE : METERS_PER_KM;
  const unitLabel = miles
    ? t('recordActivity.unitMi', { defaultValue: 'mi' })
    : t('recordActivity.unitKm', { defaultValue: 'km' });
  const paceUnit = t('recordActivity.perUnit', {
    defaultValue: '/{{unit}}',
    unit: unitLabel,
  });
  const number = (value: number, digits = 2) =>
    formatLocalizedNumber(value, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });

  const done = () => navigation.goBack();
  const [rating, setRating] = useState<number | null>(null);
  const [suggestion, setSuggestion] = useState<EffortSuggestion | null>(null);
  const [moved, setMoved] = useState<'repeat' | 'skip' | null>(null);
  const showFailure = (message: string) =>
    Toast.show({
      type: 'error',
      text1: message,
      text2: t('common.tryAgain', { defaultValue: 'Please try again.' }),
    });
  // Saves the rating, then reads what the last two say. A failure is shown,
  // but the buttons below still work off this rating alone.
  const rate = async (value: number) => {
    const target = summary.program?.rate;
    if (!target) return;
    setRating(value);
    setSuggestion(null);
    try {
      const program = await rateProgramWorkout(
        target.programId,
        target.index,
        value
      );
      if (program) {
        setSuggestion(
          suggestFromEffort(program.effort_log, program.next_index)
        );
      }
    } catch {
      showFailure(
        t('runSummary.rateFailed', {
          defaultValue: 'Could not save how hard that was.',
        })
      );
    }
  };
  // Hard offers a repeat; easy offers to skip the next, unless it is the last.
  const advice: 'repeat' | 'skip' | null =
    rating === null
      ? null
      : rating >= HARD_RATING
        ? 'repeat'
        : rating <= EASY_RATING &&
            summary.program != null &&
            summary.program.done < summary.program.total - 1
          ? 'skip'
          : null;
  // Moves the place in the program, then says so; a failure is shown, not lost.
  const move = async (kind: 'repeat' | 'skip', index: number) => {
    try {
      await setProgramPosition(index);
      setMoved(kind);
    } catch {
      showFailure(
        t('runSummary.moveFailed', {
          defaultValue: 'Could not change the program.',
        })
      );
    }
  };

  const header = useScreenHeader({
    title: t('screens.runSummary', { defaultValue: 'Activity saved' }),
    right: {
      kind: 'primary',
      label: t('runSummary.done', { defaultValue: 'Done' }),
      onPress: done,
    },
  });

  const title =
    summary.activity === 'walk'
      ? t('runSummary.walkSaved', { defaultValue: 'Walk saved' })
      : summary.activity === 'ride'
        ? t('runSummary.rideSaved', { defaultValue: 'Ride saved' })
        : t('runSummary.runSaved', { defaultValue: 'Run saved' });

  const avgPace = paceSecondsPerUnit(
    summary.distanceMeters,
    summary.activeSeconds,
    unitMeters
  );
  const elevation = miles
    ? summary.elevationGainMeters * FEET_PER_METER
    : summary.elevationGainMeters;
  // Marked laps replace the per-unit splits, as they do in the diary entry.
  const rows = summary.laps.length > 0 ? summary.laps : summary.splits;
  const usesLaps = summary.laps.length > 0;
  const bars = splitBars(rows, unitMeters);
  const fastestLabel = t('recordActivity.fastest', { defaultValue: 'Fastest' });

  return (
    <>
      {header}
      <ScrollView
        className="flex-1 bg-background"
        contentContainerStyle={{
          padding: 16,
          paddingBottom: insets.bottom + 24,
        }}
      >
        <View className="items-center mb-4">
          <View className="w-14 h-14 rounded-full bg-accent-primary items-center justify-center">
            <Icon name="checkmark" size={28} color="#ffffff" />
          </View>
          <Text className="text-text-primary text-xl font-bold mt-3">
            {title}
          </Text>
          <Text className="text-text-muted text-sm mt-1">
            {formatDayLabel(summary.entryDate)}
          </Text>
        </View>

        <View className="flex-row mb-3">
          <Stat
            label={t('recordActivity.distance', { defaultValue: 'Distance' })}
            value={number(summary.distanceMeters / unitMeters)}
            unit={unitLabel}
          />
          <Stat
            label={t('recordActivity.time', { defaultValue: 'Time' })}
            value={formatClock(summary.activeSeconds)}
          />
          <Stat
            label={t('recordActivity.avgPace', { defaultValue: 'Avg pace' })}
            value={formatPace(avgPace)}
            unit={paceUnit}
          />
        </View>
        {summary.elevationGainMeters >= 1 || summary.avgHeartRate != null ? (
          <View className="flex-row mb-3">
            {summary.elevationGainMeters >= 1 ? (
              <Stat
                label={t('recordActivity.elevationGain', {
                  defaultValue: 'Elevation gain',
                })}
                value={number(elevation, 0)}
                unit={
                  miles
                    ? t('recordActivity.unitFt', { defaultValue: 'ft' })
                    : t('recordActivity.unitM', { defaultValue: 'm' })
                }
              />
            ) : null}
            {summary.avgHeartRate != null ? (
              <Stat
                label={t('runSummary.avgHeartRate', {
                  defaultValue: 'Avg heart rate',
                })}
                value={number(summary.avgHeartRate, 0)}
                unit={t('recordActivity.unitBpm', { defaultValue: 'bpm' })}
              />
            ) : null}
          </View>
        ) : null}

        {summary.program ? (
          <View className="bg-surface rounded-xl p-4 mb-4">
            <Text className="text-text-primary text-base font-bold">
              {summary.program.finished
                ? t('runSummary.programDone', {
                    defaultValue: 'Program complete',
                  })
                : t('runSummary.programProgress', {
                    done: summary.program.done,
                    total: summary.program.total,
                    defaultValue: 'Workout {{done}} of {{total}} done',
                  })}
            </Text>
            <View className="h-2 rounded-full bg-raised mt-2 overflow-hidden">
              <View
                className="h-2 rounded-full bg-accent-primary"
                style={{
                  width: `${Math.round(
                    (summary.program.total > 0
                      ? summary.program.done / summary.program.total
                      : 0) * 100
                  )}%`,
                }}
              />
            </View>
            <Text className="text-text-secondary text-sm mt-2">
              {summary.program.nextLine}
            </Text>
            {summary.program.rate ? (
              <View className="mt-3">
                <Text className="text-text-primary text-sm font-semibold mb-2">
                  {t('runSummary.effortQuestion', {
                    defaultValue: 'How hard was that?',
                  })}
                </Text>
                <View className="flex-row flex-wrap" style={{ gap: 6 }}>
                  {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                    <Pressable
                      key={n}
                      accessibilityRole="button"
                      accessibilityState={{ selected: rating === n }}
                      accessibilityLabel={t('runSummary.effortA11y', {
                        defaultValue: 'Effort {{rating}} of 10',
                        rating: n,
                      })}
                      disabled={moved != null}
                      onPress={() => rate(n)}
                      className={`h-10 rounded-lg items-center justify-center ${
                        rating === n ? 'bg-accent-primary' : 'bg-raised'
                      }`}
                      style={{ width: '17.5%' }}
                    >
                      <Text
                        className={`text-base font-semibold ${
                          rating === n ? 'text-white' : 'text-text-primary'
                        }`}
                      >
                        {n}
                      </Text>
                    </Pressable>
                  ))}
                </View>
                <View className="flex-row justify-between mt-1">
                  <Text className="text-text-muted text-xs">
                    {t('runSummary.effortLow', {
                      defaultValue: '1 = very easy',
                    })}
                  </Text>
                  <Text className="text-text-muted text-xs">
                    {t('runSummary.effortHigh', {
                      defaultValue: '10 = all out',
                    })}
                  </Text>
                </View>
                {moved ? (
                  <Text className="text-text-secondary text-sm mt-2">
                    {moved === 'repeat'
                      ? t('runSummary.repeating', {
                          defaultValue: 'Done. You will do this workout again.',
                        })
                      : t('runSummary.skipping', {
                          defaultValue: 'Done. The next workout is skipped.',
                        })}
                  </Text>
                ) : suggestion || advice ? (
                  <>
                    <Text className="text-text-secondary text-sm mt-2">
                      {suggestion === 'ease'
                        ? t('runSummary.easeSuggestion', {
                            defaultValue:
                              'Two hard workouts in a row. Repeating this one is a good way to build up safely.',
                          })
                        : suggestion === 'advance'
                          ? t('runSummary.advanceSuggestion', {
                              defaultValue:
                                'Two easy workouts in a row. You could skip the next one and move on.',
                            })
                          : advice === 'repeat'
                            ? t('runSummary.hardHint', {
                                defaultValue:
                                  'Repeating a workout that felt hard is a good way to build up safely.',
                              })
                            : t('runSummary.easyHint', {
                                defaultValue:
                                  'Felt easy? You can skip the next workout and move on.',
                              })}
                    </Text>
                    {advice === 'repeat' ? (
                      <Button
                        variant="secondary"
                        onPress={() =>
                          move('repeat', summary.program!.rate!.index)
                        }
                      >
                        {t('runSummary.repeat', {
                          defaultValue: 'Repeat this workout',
                        })}
                      </Button>
                    ) : advice === 'skip' ? (
                      <Button
                        variant="secondary"
                        onPress={() =>
                          move('skip', summary.program!.rate!.index + 2)
                        }
                      >
                        {t('runSummary.skipNext', {
                          defaultValue: 'Skip the next workout',
                        })}
                      </Button>
                    ) : null}
                  </>
                ) : null}
              </View>
            ) : null}
            <Button
              variant="link"
              onPress={() => navigation.navigate('RunPrograms')}
            >
              {t('runSummary.viewProgram', { defaultValue: 'View program' })}
            </Button>
          </View>
        ) : null}

        {summary.route.length > 1 ? (
          <View className="mb-4">
            <RouteMap
              points={summary.route}
              accessibilityLabel={t('runSummary.routeA11y', {
                defaultValue: 'Map of your route',
              })}
            />
          </View>
        ) : null}

        {rows.length > 0 ? (
          <View className="bg-surface rounded-xl p-4 mb-4">
            <Text className="text-text-primary text-base font-bold mb-2">
              {usesLaps
                ? t('recordActivity.laps', { defaultValue: 'Laps' })
                : t('recordActivity.splits', { defaultValue: 'Splits' })}
            </Text>
            {rows.map((row, i) => (
              <SplitRow
                key={row.index}
                label={
                  usesLaps
                    ? t('recordActivity.lapLabel', {
                        defaultValue: 'Lap {{number}}',
                        number: row.index,
                      })
                    : `${
                        row.partial
                          ? number(row.distanceMeters / unitMeters)
                          : String(row.index)
                      } ${unitLabel}`
                }
                detail={
                  usesLaps
                    ? `${number(row.distanceMeters / unitMeters, 2)} ${unitLabel} · ${formatClock(row.durationSeconds)}`
                    : undefined
                }
                pace={`${formatPace(
                  paceSecondsPerUnit(
                    row.distanceMeters,
                    row.durationSeconds,
                    unitMeters
                  )
                )} ${paceUnit}`}
                fraction={bars[i].fraction}
                fastest={bars[i].fastest}
                fastestLabel={fastestLabel}
              />
            ))}
          </View>
        ) : null}

        <Button onPress={done}>
          {t('runSummary.done', { defaultValue: 'Done' })}
        </Button>
      </ScrollView>
    </>
  );
};

export default RunSummaryScreen;
