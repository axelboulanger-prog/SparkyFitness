import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  Alert,
  ActivityIndicator,
  Linking,
  Platform,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQueryClient } from '@tanstack/react-query';
import Toast from 'react-native-toast-message';

import Button from '../components/ui/Button';
import FormInput from '../components/FormInput';
import RecordingVoiceCard from '../components/recording/RecordingVoiceCard';
import Switch from '../components/ui/Switch';
import SegmentedControl from '../components/SegmentedControl';
import { SplitRow, Stat } from '../components/recording/SplitRow';
import RunProgramSelect from '../components/recording/RunProgramSelect';
import { programWorkoutLabel } from '../components/recording/RunProgramCard';
import IntervalCard from '../components/recording/IntervalCard';
import IntervalSetup, {
  DEFAULT_CUSTOM_INTERVALS,
  type IntervalChoice,
} from '../components/recording/IntervalSetup';
import RouteMap from '../components/exerciseStats/RouteMap';
import { useScreenHeader } from '../hooks/useScreenHeader';
import { useIndoorDistanceEstimate } from '../hooks/useIndoorDistanceEstimate';
import { invalidateExerciseCache } from '../hooks/invalidateExerciseCache';
import { usePreferences } from '../hooks/usePreferences';
import { useRecordingHeartRate } from '../stores/liveHeartRateStore';
import { notificationText } from '../utils/recordingNotification';
import { DECIMAL_INPUT_REGEX, parseDecimalInput } from '../utils/numericInput';
import { formatLocalizedNumber, getAppLocale } from '../localization';
import {
  RecordingPermissionError,
  discardRecording,
  elapsedSeconds,
  finishRecording,
  COUNTDOWN_CHOICES,
  getHeartRateSamples,
  getRecordingPreferences,
  hydrate,
  markLap,
  pauseRecording,
  resumeRecording,
  setCountdownPreference,
  setRecordingPreference,
  startRecording,
  tickIntervals,
  useGpsRecording,
} from '../services/gpsRecordingService';
import {
  buildIntervalPlan,
  INTERVAL_PRESETS,
  intervalPosition,
  lastStepStarted,
  type IntervalOptions,
  type IntervalPlan,
  type RunProgramResponse,
} from '@workspace/shared';
import {
  completeProgramWorkout,
  useRunProgram,
} from '../services/runProgramService';
import { runProgramQueryKey } from '../hooks/queryKeys';
import { programSummary } from '../utils/runProgramSummary';
import {
  averageHeartRate,
  buildRunSummary,
  type RunSummaryParams,
} from '../utils/runSummary';
import { toLocalDateString } from '../utils/dateUtils';
import { saveRecordedActivity } from '../services/gpsRecordingSave';
import { fireSelectionHaptic } from '../services/haptics';
import { addLog } from '../services/LogService';
import {
  beginRecordingCues,
  speakRecordingCue,
  stopRecordingCues,
} from '../services/recordingCues';
import {
  computeLaps,
  computeSplits,
  currentPaceSecondsPerUnit,
  formatClock,
  formatPace,
  METERS_PER_KM,
  METERS_PER_MILE,
  paceSecondsPerUnit,
  splitBars,
  summarizeRecording,
  type RecordingActivity,
} from '../utils/gpsRecording';
import type { RootStackScreenProps } from '../types/navigation';

type Props = RootStackScreenProps<'RecordActivity'>;

const FEET_PER_METER = 3.28084;

const RecordActivityScreen: React.FC<Props> = ({ navigation, route }) => {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { preferences } = usePreferences();
  const distanceUnit =
    (preferences?.default_distance_unit as 'km' | 'miles') ?? 'km';
  const unitMeters = distanceUnit === 'miles' ? METERS_PER_MILE : METERS_PER_KM;
  const unitLabel =
    distanceUnit === 'miles'
      ? t('recordActivity.unitMi', { defaultValue: 'mi' })
      : t('recordActivity.unitKm', { defaultValue: 'km' });

  const { session, points } = useGpsRecording();
  const heartRate = useRecordingHeartRate(session?.id ?? null);
  const [activity, setActivity] = useState<RecordingActivity>('run');
  const [busy, setBusy] = useState(false);
  const [autoPause, setAutoPause] = useState(true);
  const [audioCues, setAudioCues] = useState(false);
  const [countdownSeconds, setCountdownSeconds] = useState(0);
  const [intervalChoice, setIntervalChoice] = useState<IntervalChoice>('off');
  const [customIntervals, setCustomIntervals] = useState<IntervalOptions>(
    DEFAULT_CUSTOM_INTERVALS
  );
  const {
    status: storedProgram,
    enabled: programEnabled,
    loaded: programLoaded,
  } = useRunProgram();
  // The program only drives the screen while the person has it switched on.
  const programStatus = programEnabled ? storedProgram : null;
  const programWorkout = programStatus?.workout ?? null;
  // Today's program workout is chosen only when the person came here to do it
  // (the Diary card's Start, or Start today's workout); otherwise it is just
  // offered on its own card, because most recordings are a plain walk or run.
  const wantsProgramWorkout = route.params?.programWorkout === true;
  const programApplied = useRef(false);
  useEffect(() => {
    if (!wantsProgramWorkout || programApplied.current || !programLoaded)
      return;
    programApplied.current = true;
    if (programWorkout && programStatus) {
      setActivity(programStatus.program.activity);
      setIntervalChoice('program');
    }
  }, [wantsProgramWorkout, programLoaded, programWorkout, programStatus]);
  // A program that ended or was left while it was chosen.
  useEffect(() => {
    if (intervalChoice === 'program' && programLoaded && !programWorkout) {
      setIntervalChoice('off');
    }
  }, [intervalChoice, programLoaded, programWorkout]);
  const intervalPlan = useMemo<IntervalPlan | undefined>(() => {
    if (intervalChoice === 'off') return undefined;
    if (intervalChoice === 'program') return programWorkout?.plan;
    if (intervalChoice === 'custom') return buildIntervalPlan(customIntervals);
    const preset = INTERVAL_PRESETS.find((p) => p.id === intervalChoice);
    return preset ? buildIntervalPlan(preset.options) : undefined;
  }, [intervalChoice, customIntervals, programWorkout]);
  // Seconds left before recording begins, or null when no countdown is running.
  const [countdownLeft, setCountdownLeft] = useState<number | null>(null);
  const [permissionProblem, setPermissionProblem] = useState<
    'denied' | 'services-disabled' | null
  >(null);
  const [now, setNow] = useState(() => Date.now());
  // Whether the check for a recording an earlier run left on disk has finished.
  // Until it has, the screen cannot tell "nothing recording" from "not loaded
  // yet", and would show Start for a moment before jumping to a live recording.
  const [ready, setReady] = useState(false);
  // Set when the person taps Start here, so a session that is already there
  // when the screen opens can be told apart from one started on this visit.
  const [startedHere, setStartedHere] = useState(false);
  // Indoor (treadmill) recording: no GPS, and the distance is typed in at the
  // end from whatever the machine shows.
  const [indoor, setIndoor] = useState(false);
  // Null until the person types: the field then shows the step-based estimate,
  // and clearing it leaves it empty rather than bringing the estimate back.
  const [indoorDistanceText, setIndoorDistanceText] = useState<string | null>(
    null
  );
  // A change made before the stored preferences load must not be overwritten
  // by that read. Each flag is set in the control that changes it.
  const preferenceEdits = useRef({
    autoPause: false,
    audioCues: false,
    countdownSeconds: false,
  });

  useScreenHeader({
    title: t('screens.recordActivity', { defaultValue: 'Record Activity' }),
    nativeTitle: t('screens.recordActivity', {
      defaultValue: 'Record Activity',
    }),
    left: { kind: 'back' },
  });

  // Pick up a recording an earlier run left behind (app killed mid-activity).
  useEffect(() => {
    let active = true;
    void getRecordingPreferences().then((preferences) => {
      if (!active) return;
      if (!preferenceEdits.current.autoPause) {
        setAutoPause(preferences.autoPause);
      }
      if (!preferenceEdits.current.audioCues) {
        setAudioCues(preferences.audioCues);
      }
      if (!preferenceEdits.current.countdownSeconds) {
        setCountdownSeconds(preferences.countdownSeconds);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void hydrate().finally(() => {
      if (active) setReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const isLive = session?.status === 'recording';
  useEffect(() => {
    if (!isLive) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isLive]);

  // Each second, let a timed plan move on to its next step.
  const hasIntervals = Boolean(session?.intervals);
  useEffect(() => {
    if (!isLive || !hasIntervals) return;
    void tickIntervals();
  }, [isLive, hasIntervals, now]);

  const summary = useMemo(() => summarizeRecording(points), [points]);
  const mapPoints = useMemo(
    () =>
      points.map((p) => ({
        t: new Date(p.t).toISOString(),
        lat: p.lat,
        lon: p.lon,
      })),
    [points]
  );
  const splits = useMemo(
    () =>
      session?.status === 'finished' ? computeSplits(points, unitMeters) : [],
    [points, session?.status, unitMeters]
  );
  const lapMarks = session?.laps;
  const laps = useMemo(
    () =>
      session?.status === 'finished' && lapMarks && lapMarks.length > 0
        ? computeLaps(points, lapMarks, session.finishedAt ?? undefined)
        : [],
    [points, session?.status, session?.finishedAt, lapMarks]
  );
  const splitBarsFor = useMemo(
    () => splitBars(splits, unitMeters),
    [splits, unitMeters]
  );
  const lapBarsFor = useMemo(
    () => splitBars(laps, unitMeters),
    [laps, unitMeters]
  );

  const run = useCallback(
    async (work: () => Promise<void>, failure: string) => {
      setBusy(true);
      try {
        await work();
      } catch (error) {
        if (error instanceof RecordingPermissionError) {
          setPermissionProblem(error.reason);
        } else {
          addLog(`[GPS Recording] ${failure}: ${error}`, 'ERROR');
          Toast.show({
            type: 'error',
            text1: failure,
            text2: t('common.tryAgain', { defaultValue: 'Please try again.' }),
          });
        }
      } finally {
        setBusy(false);
      }
    },
    [t]
  );

  const handleStart = useCallback(
    () =>
      run(
        async () => {
          setPermissionProblem(null);
          // Before the await: the session publishes inside startRecording, and
          // the "already recording" notice must not flash for one render.
          setStartedHere(true);
          await startRecording({
            activity,
            // Indoors there are no location fixes for it to judge by.
            autoPause: autoPause && !indoor,
            audioCues: audioCues
              ? distanceUnit === 'miles'
                ? 'miles'
                : 'km'
              : undefined,
            intervals: intervalPlan,
            indoor,
            program:
              intervalChoice === 'program' && programStatus && intervalPlan
                ? { id: programStatus.program.id, index: programStatus.done }
                : undefined,
            notification: notificationText(t, activity),
          });
        },
        t('recordActivity.errors.start', {
          defaultValue: 'Could not start recording',
        })
      ),
    [
      activity,
      audioCues,
      autoPause,
      distanceUnit,
      indoor,
      intervalChoice,
      intervalPlan,
      programStatus,
      run,
      t,
    ]
  );
  // Counts down once a second, then starts. Each number is felt and, with
  // voice cues on, spoken.
  useEffect(() => {
    if (countdownLeft === null) return;
    if (countdownLeft === 0) {
      setCountdownLeft(null);
      void handleStart();
      return;
    }
    fireSelectionHaptic();
    if (audioCues) speakRecordingCue(String(countdownLeft));
    const id = setTimeout(() => setCountdownLeft(countdownLeft - 1), 1000);
    return () => clearTimeout(id);
  }, [countdownLeft, audioCues, handleStart]);

  const handleStartPress = useCallback(() => {
    if (countdownSeconds === 0) {
      void handleStart();
      return;
    }
    setPermissionProblem(null);
    if (audioCues) beginRecordingCues();
    setCountdownLeft(countdownSeconds);
  }, [audioCues, countdownSeconds, handleStart]);

  const cancelCountdown = useCallback(() => {
    setCountdownLeft(null);
    if (audioCues) stopRecordingCues();
  }, [audioCues]);

  const handleResume = useCallback(
    () =>
      run(
        () =>
          resumeRecording(notificationText(t, session?.activity ?? activity)),
        t('recordActivity.errors.resume', {
          defaultValue: 'Could not resume recording',
        })
      ),
    [activity, run, session?.activity, t]
  );

  const handleFinish = useCallback(
    () =>
      run(
        finishRecording,
        t('recordActivity.errors.finish', {
          defaultValue: 'Could not finish recording',
        })
      ),
    [run, t]
  );

  const handleDiscard = useCallback(() => {
    Alert.alert(
      t('recordActivity.discard.title', {
        defaultValue: 'Discard this activity?',
      }),
      t('recordActivity.discard.message', {
        defaultValue: 'The recorded route and stats will be deleted.',
      }),
      [
        {
          text: t('common.cancel', { defaultValue: 'Cancel' }),
          style: 'cancel',
        },
        {
          text: t('recordActivity.discard.confirm', {
            defaultValue: 'Discard',
          }),
          style: 'destructive',
          onPress: () =>
            void run(
              async () => {
                await discardRecording();
                // The screen stays mounted. A distance typed for this session
                // must not be offered as the next one's estimate.
                setIndoorDistanceText(null);
              },
              t('recordActivity.errors.discard', {
                defaultValue: 'Could not discard recording',
              })
            ),
        },
      ]
    );
  }, [run, t]);

  const indoorEstimate = useIndoorDistanceEstimate(session);
  const estimateText = indoorEstimate
    ? ((indoorEstimate.distanceKm * METERS_PER_KM) / unitMeters).toFixed(2)
    : '';
  const shownDistanceText = indoorDistanceText ?? estimateText;
  const indoorDistance =
    shownDistanceText.trim() === ''
      ? null
      : parseDecimalInput(shownDistanceText);
  const indoorDistanceInvalid =
    indoorDistance !== null &&
    (!Number.isFinite(indoorDistance) || indoorDistance < 0);
  const indoorDistanceKm =
    indoorDistance !== null && Number.isFinite(indoorDistance)
      ? (indoorDistance * unitMeters) / METERS_PER_KM
      : null;

  const handleSave = useCallback(async () => {
    if (!session) return;
    setBusy(true);
    try {
      const saved = await saveRecordedActivity(
        session,
        points,
        distanceUnit,
        session.indoor ? indoorDistanceKm : null,
        session.indoor ? indoorEstimate : null,
        session.indoor === true && indoorDistanceText === null
      );
      // Ticks a program workout off only if the plan was followed to its last
      // step; a run cut short can be tried again. The day is the one the run
      // started on, so a run saved after midnight still counts for its own day.
      let program: RunSummaryParams['program'] = null;
      if (session.program && lastStepStarted(session.intervals)) {
        // The activity is already saved, so a failure here only costs the
        // tick: say so and carry on rather than failing the save.
        try {
          await completeProgramWorkout(
            session.program.id,
            session.program.index,
            toLocalDateString(new Date(session.startedAt)),
            saved.entryId
          );
          program = programSummary(
            t,
            queryClient.getQueryData<RunProgramResponse>(runProgramQueryKey),
            toLocalDateString(new Date()),
            (workoutStatus) => programWorkoutLabel(t, workoutStatus),
            session.program.index
          );
        } catch (error) {
          addLog(
            `[Run Program] Could not tick off the workout: ${error}`,
            'WARNING'
          );
          Toast.show({
            type: 'info',
            text1: t('recordActivity.program.tickFailed', {
              defaultValue: 'Activity saved, program not updated',
            }),
            text2: t('recordActivity.program.tickFailedHint', {
              defaultValue:
                'Use "Count it" on the Diary card to tick the workout off.',
            }),
          });
        }
      }
      invalidateExerciseCache(queryClient, saved.entryDate);
      // The activity is filed. Nothing after this may report the save as
      // failed, or the person would be told to try again for no reason.
      let summaryParams: RunSummaryParams | null = null;
      try {
        summaryParams = buildRunSummary({
          activity: session.activity,
          entryDate: saved.entryDate,
          distanceUnit,
          points,
          lapMarks: session.laps,
          avgHeartRate: averageHeartRate(
            await getHeartRateSamples().catch(() => [])
          ),
          program,
        });
      } catch (error) {
        addLog(
          `[GPS Recording] Could not build the summary: ${error}`,
          'WARNING'
        );
      }
      await discardRecording().catch((error: unknown) =>
        addLog(
          `[GPS Recording] Could not clear the recording: ${error}`,
          'WARNING'
        )
      );
      if (summaryParams) navigation.replace('RunSummary', summaryParams);
      else navigation.goBack();
    } catch (error) {
      addLog(`[GPS Recording] Save failed: ${error}`, 'ERROR');
      Toast.show({
        type: 'error',
        text1: t('recordActivity.errors.save', {
          defaultValue: 'Could not save activity',
        }),
        text2: t('recordActivity.errors.saveHint', {
          defaultValue: 'Your recording is kept on this phone. Try again.',
        }),
      });
    } finally {
      setBusy(false);
    }
  }, [
    distanceUnit,
    indoorDistanceKm,
    indoorDistanceText,
    indoorEstimate,
    navigation,
    points,
    queryClient,
    session,
    t,
  ]);

  const number = (value: number, digits = 2) =>
    formatLocalizedNumber(value, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });

  const body = (() => {
    if (!ready) {
      return (
        <View
          testID="record-activity-loading"
          className="items-center justify-center py-16"
        >
          <ActivityIndicator />
        </View>
      );
    }
    if (!session && countdownLeft !== null) {
      return (
        <View className="items-center py-16">
          <Text
            className="text-text-primary text-8xl font-bold"
            accessibilityLiveRegion="assertive"
          >
            {countdownLeft}
          </Text>
          <Text className="text-text-secondary text-sm mt-2 mb-8">
            {t('recordActivity.countdown.getReady', {
              defaultValue: 'Get ready',
            })}
          </Text>
          <Button variant="outline" onPress={cancelCountdown}>
            {t('recordActivity.countdown.cancel', { defaultValue: 'Cancel' })}
          </Button>
        </View>
      );
    }
    if (!session) {
      return (
        <>
          <Text className="text-text-secondary text-sm mb-3">
            {indoor
              ? t('recordActivity.introIndoor', {
                  defaultValue:
                    'Record a treadmill or other indoor session. No GPS is used, and you can enter the distance your machine shows when you finish.',
                })
              : t('recordActivity.intro', {
                  defaultValue:
                    'Record a walk, run or ride with your phone’s GPS. Recording continues with the screen locked.',
                })}
          </Text>
          <SegmentedControl<RecordingActivity>
            segments={[
              {
                key: 'walk',
                label: t('recordActivity.activity.walk', {
                  defaultValue: 'Walk',
                }),
              },
              {
                key: 'run',
                label: t('recordActivity.activity.run', {
                  defaultValue: 'Run',
                }),
              },
              {
                key: 'ride',
                label: t('recordActivity.activity.ride', {
                  defaultValue: 'Ride',
                }),
              },
            ]}
            activeKey={activity}
            onSelect={setActivity}
          />
          <View className="mt-3">
            <SegmentedControl<'outdoor' | 'indoor'>
              segments={[
                {
                  key: 'outdoor',
                  label: t('recordActivity.location.outdoor', {
                    defaultValue: 'Outdoor',
                  }),
                },
                {
                  key: 'indoor',
                  label: t('recordActivity.location.indoor', {
                    defaultValue: 'Indoor',
                  }),
                },
              ]}
              activeKey={indoor ? 'indoor' : 'outdoor'}
              onSelect={(key) => setIndoor(key === 'indoor')}
            />
          </View>
          {indoor ? null : (
            <View className="flex-row items-center justify-between bg-surface rounded-xl p-4 mt-4">
              <View className="flex-1 mr-3">
                <Text className="text-text-primary text-sm font-semibold">
                  {t('recordActivity.autoPause.title', {
                    defaultValue: 'Auto-pause',
                  })}
                </Text>
                <Text className="text-text-secondary text-xs mt-0.5">
                  {t('recordActivity.autoPause.description', {
                    defaultValue:
                      'Pauses the clock when you stop and carries on when you move.',
                  })}
                </Text>
              </View>
              <Switch
                testID="auto-pause-switch"
                accessibilityLabel={t('recordActivity.autoPause.title', {
                  defaultValue: 'Auto-pause',
                })}
                value={autoPause}
                onValueChange={(value) => {
                  preferenceEdits.current.autoPause = true;
                  setAutoPause(value);
                  void setRecordingPreference('autoPause', value);
                }}
              />
            </View>
          )}
          <View className="flex-row items-center justify-between bg-surface rounded-xl p-4 mt-4">
            <View className="flex-1 mr-3">
              <Text className="text-text-primary text-sm font-semibold">
                {t('recordActivity.audioCues.title', {
                  defaultValue: 'Voice cues',
                })}
              </Text>
              <Text className="text-text-secondary text-xs mt-0.5">
                {t('recordActivity.audioCues.description', {
                  defaultValue:
                    'Speaks your time at each kilometer or mile, and when you pause or resume.',
                })}
              </Text>
            </View>
            <Switch
              testID="audio-cues-switch"
              accessibilityLabel={t('recordActivity.audioCues.title', {
                defaultValue: 'Voice cues',
              })}
              value={audioCues}
              onValueChange={(value) => {
                preferenceEdits.current.audioCues = true;
                setAudioCues(value);
                void setRecordingPreference('audioCues', value);
              }}
            />
          </View>
          {audioCues && <RecordingVoiceCard />}
          <View className="bg-surface rounded-xl p-4 mt-4">
            <Text className="text-text-primary text-sm font-semibold mb-2">
              {t('recordActivity.countdown.title', {
                defaultValue: 'Start countdown',
              })}
            </Text>
            <SegmentedControl<string>
              segments={COUNTDOWN_CHOICES.map((seconds) => ({
                key: String(seconds),
                label:
                  seconds === 0
                    ? t('recordActivity.countdown.off', {
                        defaultValue: 'Off',
                      })
                    : t('recordActivity.countdown.seconds', {
                        seconds,
                        defaultValue: '{{seconds}} s',
                      }),
              }))}
              activeKey={String(countdownSeconds)}
              onSelect={(key) => {
                const seconds = Number(key);
                preferenceEdits.current.countdownSeconds = true;
                setCountdownSeconds(seconds);
                void setCountdownPreference(seconds);
              }}
            />
          </View>
          <RunProgramSelect
            status={programStatus}
            loaded={programLoaded}
            selected={intervalChoice === 'program'}
            onSelect={() => {
              setActivity(programStatus?.program.activity ?? 'run');
              setIntervalChoice('program');
            }}
            onManage={() => navigation.navigate('RunPrograms')}
          />
          <IntervalSetup
            programLabel={
              programStatus?.workout
                ? programWorkoutLabel(t, programStatus)
                : undefined
            }
            choice={intervalChoice}
            onChoice={setIntervalChoice}
            custom={customIntervals}
            onCustom={setCustomIntervals}
          />
          {permissionProblem ? (
            <View className="bg-surface rounded-xl p-4 mt-4">
              <Text className="text-text-primary text-sm mb-3">
                {permissionProblem === 'denied'
                  ? t('recordActivity.permission.denied', {
                      defaultValue:
                        'SparkyFitness needs location access to record your route. You can allow it in Settings.',
                    })
                  : t('recordActivity.permission.servicesOff', {
                      defaultValue:
                        'Location services are turned off. Turn them on in Settings to record.',
                    })}
              </Text>
              <Button
                variant="outline"
                onPress={() => void Linking.openSettings()}
              >
                {t('recordActivity.permission.openSettings', {
                  defaultValue: 'Open Settings',
                })}
              </Button>
            </View>
          ) : null}
          {Platform.OS === 'android' && !indoor ? (
            <View className="bg-surface rounded-xl p-4 mt-4">
              <Text className="text-text-primary text-sm font-semibold mb-1">
                {t('recordActivity.androidTips.title', {
                  defaultValue: 'Recording with the screen off',
                })}
              </Text>
              <Text className="text-text-secondary text-sm mb-3">
                {t('recordActivity.androidTips.body', {
                  defaultValue:
                    'Some phones stop apps that run in the background. If a recording has gaps, set SparkyFitness to “Unrestricted” in the phone’s battery settings.',
                })}
              </Text>
              <Button
                variant="link"
                onPress={() =>
                  void Linking.openURL('https://dontkillmyapp.com')
                }
              >
                {t('recordActivity.androidTips.link', {
                  defaultValue: 'Phone-specific steps',
                })}
              </Button>
            </View>
          ) : null}
          <Button className="mt-6" loading={busy} onPress={handleStartPress}>
            {t('recordActivity.start', { defaultValue: 'Start' })}
          </Button>
        </>
      );
    }

    const active = elapsedSeconds(session, now);
    const distance = summary.distanceMeters;
    const avgPace = paceSecondsPerUnit(
      distance,
      summary.activeSeconds,
      unitMeters
    );
    const currentPace = currentPaceSecondsPerUnit(points, unitMeters);
    const elevation =
      distanceUnit === 'miles'
        ? summary.elevationGainMeters * FEET_PER_METER
        : summary.elevationGainMeters;
    const elevationUnit =
      distanceUnit === 'miles'
        ? t('recordActivity.unitFt', { defaultValue: 'ft' })
        : t('recordActivity.unitM', { defaultValue: 'm' });
    const paceUnit = t('recordActivity.perUnit', {
      defaultValue: '/{{unit}}',
      unit: unitLabel,
    });
    const finished = session.status === 'finished';
    const intervalPos = session.intervals
      ? intervalPosition(session.intervals.plan, active)
      : null;
    const indoorSession = session.indoor === true;
    // Still running from before this visit (or from earlier in it): say when it
    // began so a leftover recording is never mistaken for a new one.
    const carriedOver = !startedHere && !finished;

    return (
      <>
        {carriedOver ? (
          <View className="bg-surface rounded-xl p-4 mb-4">
            <Text className="text-text-primary text-sm">
              {t('recordActivity.carriedOver', {
                defaultValue:
                  'This recording started at {{time}} and was still running on this phone.',
                time: new Date(session.startedAt).toLocaleTimeString(
                  getAppLocale(),
                  { hour: 'numeric', minute: '2-digit' }
                ),
              })}
            </Text>
          </View>
        ) : null}
        {indoorSession ? null : points.length > 1 ? (
          <View className="mb-4">
            <RouteMap
              points={mapPoints}
              accessibilityLabel={t('recordActivity.routeA11y', {
                defaultValue: 'Map of your route so far',
              })}
            />
          </View>
        ) : (
          <View className="bg-surface rounded-xl p-4 mb-4 items-center">
            <ActivityIndicator />
            <Text className="text-text-muted text-sm mt-2">
              {t('recordActivity.waitingForGps', {
                defaultValue: 'Waiting for a GPS fix…',
              })}
            </Text>
          </View>
        )}
        <View className="items-center mb-4">
          <Text className="text-text-muted text-xs">
            {session.status === 'paused'
              ? session.autoPaused
                ? t('recordActivity.status.autoPaused', {
                    defaultValue: 'Auto-paused',
                  })
                : t('recordActivity.status.paused', { defaultValue: 'Paused' })
              : finished
                ? t('recordActivity.status.finished', {
                    defaultValue: 'Finished',
                  })
                : t('recordActivity.time', { defaultValue: 'Time' })}
          </Text>
          <Text
            className="text-text-primary text-5xl font-bold"
            accessibilityLabel={formatClock(active)}
          >
            {formatClock(active)}
          </Text>
        </View>
        {session.intervals && intervalPos && !finished ? (
          <IntervalCard plan={session.intervals.plan} position={intervalPos} />
        ) : null}
        {indoorSession ? null : (
          <>
            <View className="flex-row mb-3">
              <Stat
                label={t('recordActivity.distance', {
                  defaultValue: 'Distance',
                })}
                value={number(distance / unitMeters)}
                unit={unitLabel}
              />
              <Stat
                label={t('recordActivity.avgPace', {
                  defaultValue: 'Avg pace',
                })}
                value={formatPace(avgPace)}
                unit={paceUnit}
              />
            </View>
            <View className="flex-row mb-4">
              {finished ? (
                <Stat
                  label={t('recordActivity.elevationLoss', {
                    defaultValue: 'Elevation loss',
                  })}
                  value={number(
                    distanceUnit === 'miles'
                      ? summary.elevationLossMeters * FEET_PER_METER
                      : summary.elevationLossMeters,
                    0
                  )}
                  unit={elevationUnit}
                />
              ) : (
                <Stat
                  label={t('recordActivity.currentPace', {
                    defaultValue: 'Pace',
                  })}
                  value={formatPace(currentPace)}
                  unit={paceUnit}
                />
              )}
              <Stat
                label={t('recordActivity.elevationGain', {
                  defaultValue: 'Elevation gain',
                })}
                value={number(elevation, 0)}
                unit={elevationUnit}
              />
            </View>
          </>
        )}
        {heartRate != null && !finished ? (
          <View className="flex-row mb-4">
            <Stat
              label={t('recordActivity.heartRate', {
                defaultValue: 'Heart rate',
              })}
              value={number(heartRate, 0)}
              unit={t('recordActivity.unitBpm', { defaultValue: 'bpm' })}
            />
          </View>
        ) : null}
        {finished && laps.length > 0 ? (
          <View className="bg-surface rounded-xl p-4 mb-4">
            <Text className="text-text-primary text-base font-bold mb-2">
              {t('recordActivity.laps', { defaultValue: 'Laps' })}
            </Text>
            {laps.map((lap, i) => (
              <SplitRow
                key={lap.index}
                label={t('recordActivity.lapLabel', {
                  defaultValue: 'Lap {{number}}',
                  number: lap.index,
                })}
                detail={`${number(lap.distanceMeters / unitMeters, 2)} ${unitLabel} · ${formatClock(lap.durationSeconds)}`}
                pace={`${formatPace(
                  paceSecondsPerUnit(
                    lap.distanceMeters,
                    lap.durationSeconds,
                    unitMeters
                  )
                )} ${paceUnit}`}
                fraction={lapBarsFor[i].fraction}
                fastest={lapBarsFor[i].fastest}
                fastestLabel={t('recordActivity.fastest', {
                  defaultValue: 'Fastest',
                })}
              />
            ))}
          </View>
        ) : null}
        {finished && splits.length > 0 ? (
          <View className="bg-surface rounded-xl p-4 mb-4">
            <Text className="text-text-primary text-base font-bold mb-2">
              {t('recordActivity.splits', { defaultValue: 'Splits' })}
            </Text>
            {splits.map((split, i) => (
              <SplitRow
                key={split.index}
                label={`${
                  split.partial
                    ? number(split.distanceMeters / unitMeters)
                    : String(split.index)
                } ${unitLabel}`}
                pace={`${formatPace(
                  paceSecondsPerUnit(
                    split.distanceMeters,
                    split.durationSeconds,
                    unitMeters
                  )
                )} ${paceUnit}`}
                fraction={splitBarsFor[i].fraction}
                fastest={splitBarsFor[i].fastest}
                fastestLabel={t('recordActivity.fastest', {
                  defaultValue: 'Fastest',
                })}
              />
            ))}
          </View>
        ) : null}
        {finished && indoorSession ? (
          <View className="bg-surface rounded-xl p-4 mb-4">
            <Text className="text-text-primary text-base font-bold mb-1">
              {t('recordActivity.indoorDistance.title', {
                defaultValue: 'Distance',
              })}
            </Text>
            <Text className="text-text-secondary text-sm mb-3">
              {indoorEstimate
                ? indoorEstimate.calibrated
                  ? t('recordActivity.indoorDistance.estimateLearned', {
                      count: indoorEstimate.steps,
                      formattedCount: formatLocalizedNumber(
                        indoorEstimate.steps,
                        {
                          maximumFractionDigits: 0,
                        }
                      ),
                      defaultValue:
                        'Estimated from {{formattedCount}} steps using your stride. Change it to match your treadmill and the app keeps learning.',
                      defaultValue_one:
                        'Estimated from {{formattedCount}} step using your stride. Change it to match your treadmill and the app keeps learning.',
                      defaultValue_other:
                        'Estimated from {{formattedCount}} steps using your stride. Change it to match your treadmill and the app keeps learning.',
                    })
                  : t('recordActivity.indoorDistance.estimateRough', {
                      count: indoorEstimate.steps,
                      formattedCount: formatLocalizedNumber(
                        indoorEstimate.steps,
                        {
                          maximumFractionDigits: 0,
                        }
                      ),
                      defaultValue:
                        'A rough estimate from {{formattedCount}} steps with a typical stride. Enter what your treadmill shows and the app learns yours.',
                      defaultValue_one:
                        'A rough estimate from {{formattedCount}} step with a typical stride. Enter what your treadmill shows and the app learns yours.',
                      defaultValue_other:
                        'A rough estimate from {{formattedCount}} steps with a typical stride. Enter what your treadmill shows and the app learns yours.',
                    })
                : t('recordActivity.indoorDistance.hint', {
                    defaultValue:
                      'Optional. Enter the distance your treadmill or machine shows.',
                  })}
            </Text>
            <View className="flex-row items-center">
              <FormInput
                className="flex-1"
                keyboardType="decimal-pad"
                value={shownDistanceText}
                placeholder="0.00"
                accessibilityLabel={t('recordActivity.indoorDistance.title', {
                  defaultValue: 'Distance',
                })}
                onChangeText={(text) => {
                  if (text !== '' && !DECIMAL_INPUT_REGEX.test(text)) return;
                  setIndoorDistanceText(text);
                }}
              />
              <Text className="text-text-secondary text-base ml-3">
                {unitLabel}
              </Text>
            </View>
            {indoorDistanceInvalid ? (
              <Text className="text-text-danger-subtle text-sm mt-2">
                {t('recordActivity.indoorDistance.invalid', {
                  defaultValue: 'Enter a distance of zero or more.',
                })}
              </Text>
            ) : null}
          </View>
        ) : null}
        {finished ? (
          <>
            <Button
              loading={busy}
              disabled={indoorSession && indoorDistanceInvalid}
              onPress={() => void handleSave()}
            >
              {t('recordActivity.save', { defaultValue: 'Save activity' })}
            </Button>
            <Button
              variant="destructive"
              className="mt-2"
              disabled={busy}
              onPress={handleDiscard}
            >
              {t('recordActivity.discard.action', { defaultValue: 'Discard' })}
            </Button>
          </>
        ) : (
          <View>
            {session.status === 'recording' ? (
              <Button
                variant="outline"
                className="mb-2"
                disabled={busy}
                onPress={() => void markLap()}
              >
                {t('recordActivity.lap', { defaultValue: 'Lap' })}
              </Button>
            ) : null}
            <View className="flex-row">
              <Button
                variant="secondary"
                className="flex-1 mr-2"
                loading={busy}
                onPress={() =>
                  void (session.status === 'recording'
                    ? run(
                        pauseRecording,
                        t('recordActivity.errors.pause', {
                          defaultValue: 'Could not pause recording',
                        })
                      )
                    : handleResume())
                }
              >
                {session.status === 'recording'
                  ? t('recordActivity.pause', { defaultValue: 'Pause' })
                  : t('recordActivity.resume', { defaultValue: 'Resume' })}
              </Button>
              <Button
                className="flex-1 ml-2"
                disabled={busy}
                onPress={() => void handleFinish()}
              >
                {t('recordActivity.finish', { defaultValue: 'Finish' })}
              </Button>
            </View>
          </View>
        )}
        {finished ? null : (
          <Button
            variant="destructive"
            className="mt-2"
            disabled={busy}
            onPress={handleDiscard}
          >
            {t('recordActivity.discard.action', { defaultValue: 'Discard' })}
          </Button>
        )}
      </>
    );
  })();

  return (
    <ScrollView
      className="flex-1 bg-background"
      contentContainerStyle={{ padding: 16, paddingBottom: insets.bottom + 24 }}
    >
      {body}
    </ScrollView>
  );
};

export default RecordActivityScreen;
