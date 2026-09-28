import { NativeModule, requireOptionalNativeModule } from 'expo';
import { Platform } from 'react-native';

/** A morning check-in captured on the Apple Watch. */
export interface WatchCheckInPayload {
  /** Stable id generated on the watch, used to dedupe re-delivered transfers. */
  clientId: string;
  /** Calendar day (`yyyy-MM-dd`) in the wearer's local timezone. */
  entryDate: string;
  weightKg: number;
  /**
   * Null/undefined when the wearer skipped it because the scale gave no
   * impedance reading. Callers MUST omit the field from the check-in upsert in
   * that case — the API upserts by date, so sending null erases whatever body
   * fat value the day already had.
   */
  bodyFatPercentage: number | null;
}

/** One day of history relayed to the watch for its trend chart. */
export interface WatchHistoryPoint {
  day: string;
  weightKg: number;
  bodyFatPercentage?: number | null;
}

/** A water container tap captured on the Apple Watch. */
export interface WatchWaterIntakePayload {
  /** Stable id generated on the watch. Not acknowledged back like a check-in
   * is — see the comment on `containers` below — so this only guards against
   * one queued transfer being delivered to this listener twice. */
  clientId: string;
  /** Calendar day (`yyyy-MM-dd`) in the wearer's local timezone. */
  entryDate: string;
  containerId: number;
}

/** A request from the watch to delete one logged drink. */
export interface WatchWaterDeletePayload {
  /** Stable id generated on the watch, to dedupe a re-delivered transfer. */
  clientId: string;
  /** The `water_intake_entries` row id, as relayed in `waterLog` below. */
  entryId: string;
}

/**
 * One logged drink relayed to the watch's water log view. Manual entries
 * only — synced records (Apple Health and friends) carry no container and
 * are filtered out phone-side rather than shown as nameless rows.
 */
export interface WatchWaterLogPayload {
  /** The server row id, needed to delete this specific drink. */
  id: string;
  name: string;
  volumeMl: number;
  /** Wall-clock time this was logged, pre-formatted by the phone (see the
   * comment on `waterLog` for why the watch doesn't format it itself). */
  time: string;
}

/** One water container configured on the server, as relayed to the watch. */
export interface WatchContainerPayload {
  id: number;
  name: string;
  /**
   * This container's per-tap amount in ml, servings already divided out
   * (`getServingVolume`) — the watch adds exactly this much locally the
   * instant a square is tapped, before the phone's write even lands.
   */
  servingVolumeMl: number;
  /** Display only — `ml` | `oz` | `liter`. `servingVolumeMl` is always ml. */
  unit: string;
}

/** Seed values, history and acknowledgements pushed to the watch. */
export interface WatchContextPayload {
  /**
   * Milliseconds since the epoch at push time. Not read by the watch — it
   * exists purely to guarantee two consecutive pushes are never byte-identical.
   *
   * `updateApplicationContext` will not redeliver a dictionary equal to the
   * one already set, and every other field here is derived from data. So on a
   * day with nothing logged, re-opening the phone app re-pushed exactly what
   * was already there, the system dropped it, and a watch waiting on that
   * push (a fresh install, say) never heard anything.
   */
  pushedAt: number;
  today: string;
  todayWeightKg?: number | null;
  todayBodyFatPercentage?: number | null;
  lastWeightKg?: number | null;
  lastBodyFatPercentage?: number | null;
  lastEntryDate?: string | null;
  history: WatchHistoryPoint[];
  ackedClientIds: string[];
  /**
   * Client ids the phone tried to write and couldn't — check-ins and water
   * taps alike. Rides in the context for the same reason `ackedClientIds`
   * does: an immediate `sendAck` needs the watch reachable right then, and a
   * failure the watch never hears about leaves a tap queued forever.
   */
  failedClientIds: string[];
  /**
   * Mirrors the phone's Settings → default weight unit, so the watch's crown
   * dial and trend chart display in the same unit as the phone. The watch
   * always stores and transmits kg regardless — this only affects what's
   * drawn on screen there. Missing/unrecognized defaults to kg on the watch.
   */
  weightUnit?: 'kg' | 'lbs' | null;
  /**
   * Today's progress toward the phone's daily nutrition goals, each already
   * clamped to 0...1 — reaching or passing a goal always reads as 1, same
   * convention the iOS calorie widget already uses. Powers the watch's
   * "Daily Energy Goal" complication; the watch app itself doesn't display
   * these, it only relays them into shared storage the complication reads.
   */
  calorieGoalProgress?: number | null;
  proteinGoalProgress?: number | null;
  carbsGoalProgress?: number | null;
  fatGoalProgress?: number | null;
  /**
   * Today's nutrition totals, for the watch's Goals summary page — the same
   * numbers the phone's own summary bar shows.
   *
   * The three calorie figures MUST come from `DailySummary.calorieBalance`
   * (`eaten` / `burned` / `remaining`), never from the flatter top-level
   * `caloriesConsumed` / `caloriesBurned` / `remainingCalories` fields: those
   * are rawer inputs that disagree with what's on screen, because the balance
   * additionally accounts for the day's exercise source and BMR.
   *
   * Sent as flat keys (rather than a nested object) so the watch's existing
   * payload parsing and the complication's storage path stay untouched; the
   * watch reassembles them into a structured snapshot on arrival.
   */
  caloriesConsumed?: number | null;
  caloriesBurned?: number | null;
  caloriesRemaining?: number | null;
  proteinConsumed?: number | null;
  proteinGoal?: number | null;
  carbsConsumed?: number | null;
  carbsGoal?: number | null;
  fatConsumed?: number | null;
  fatGoal?: number | null;
  /**
   * Configured water containers, for the watch's Water page — one tappable
   * square per entry. Sent in full on every push rather than fetched once by
   * the watch itself: there's no path for the watch to call the server
   * directly, the list rarely changes, and staying self-contained here means
   * no separate "ask for the container list" round trip.
   */
  containers?: WatchContainerPayload[] | null;
  /** Today's water totals in ml, for the same page's bottle fill. */
  waterConsumedMl?: number | null;
  waterGoalMl?: number | null;
  /**
   * The app's globally configured water display unit (Settings → water
   * display unit) — independent of any one container's own `unit` — for the
   * "11% * 0.31L" label above the bottle. Null/unset defaults to `ml` on the
   * watch, same fallback the phone itself uses.
   */
  waterDisplayUnit?: 'ml' | 'oz' | 'liter' | null;
  /**
   * Today's individual logged drinks, newest first, for the watch's water log
   * view. Rides the context push rather than being fetched on demand so the
   * view opens instantly with no round trip — the phone is often out of
   * reach, and a spinner that may never resolve is worse than a list that's
   * at most one push stale.
   *
   * `time` is pre-formatted here rather than sent as a timestamp: the phone
   * knows the user's configured time format (12h/24h) from preferences, and
   * duplicating that resolution on the watch would be a second place to get
   * it wrong.
   */
  waterLog?: WatchWaterLogPayload[] | null;
}

/** One target set the watch shows for a planned exercise. */
export interface WatchPlannedSetPayload {
  /** The exercise_entry_sets id, stringified — matches the phone's own
   * `WorkoutStep.setId` (activeWorkoutStore.ts) so a `setCompleted` echoing
   * this back can be handed straight to `completeSet(setId)`. */
  setId: string;
  targetReps?: number | null;
  /** Always kg, like every other weight this app moves to the watch. */
  targetWeightKg?: number | null;
  /** Rest to run after this set, in seconds — the phone's own `WorkoutStep.restSec`. */
  restSeconds: number;
  /** `normal` | `warmup` | `drop` … drives the watch's "Warmup 1/2" label. */
  setType?: string | null;
}

/** One exercise in the plan the watch was armed with. */
export interface WatchPlannedExercisePayload {
  /** The exercise_entries id — what a heart-rate batch for this exercise names. */
  exerciseEntryId: string;
  name: string;
  /**
   * Index of the valid superset this exercise belongs to, shared with its
   * partners. Null when it is not in a superset. A stored group id of one
   * exercise, or the same id on exercises that are not next to each other,
   * is not a superset and stays null.
   */
  supersetRun: number | null;
  sets: WatchPlannedSetPayload[];
}

/** The workout plan pushed to the watch when a live session starts. */
export interface WatchWorkoutStartPayload {
  /** The live-workout session id (`activeWorkoutStore.sessionId` on the phone). */
  sessionId: string;
  workoutName: string;
  exercises: WatchPlannedExercisePayload[];
  /**
   * Set ids in the phone's live cursor order (including interleaved
   * supersets). The watch walks this instead of flattening each exercise's
   * sets in library order, so rest and next-set agree with the phone.
   */
  setOrder: string[];
  /**
   * `standard` when omitted. Interval formats still send the starting sets;
   * the watch uses these to show the format and the time cap instead of
   * looking like an ordinary set workout.
   */
  workoutFormat?: string | null;
  timeCapSeconds?: number | null;
  /** When the phone started the live session, ISO 8601. */
  startedAt?: string | null;
  /**
   * When this arm was sent, ISO 8601. A saved workout reuses `sessionId`,
   * so the watch rejects only a start at or before the stop, not a later
   * "Start workout here".
   */
  armedAt?: string | null;
  /**
   * When the cap reaches 0:00, ISO 8601, already past the phone's lead-in
   * countdown. Pauses are added on top of this rather than recomputed from
   * `startedAt`.
   */
  capEndsAt?: string | null;
}

/** One set logged on the watch during an active workout. */
export interface WatchSetCompletedPayload {
  /** Stable id generated on the watch, to dedupe a re-delivered transfer. */
  clientId: string;
  sessionId: string;
  setId: string;
  /**
   * What the wearer actually did, as edited on the watch. Null/undefined
   * means the watch had no value — callers MUST omit the field from the set
   * patch in that case rather than writing null, which would clear the
   * planned value instead of leaving it alone.
   */
  weightKg?: number | null;
  reps?: number | null;
  /**
   * When the wearer tapped the set on the watch, ISO 8601. The phone stamps
   * its own clock when this is absent (an older watch build, or a set logged
   * here). Using arrival time instead pulls the next exercise's readings
   * back onto the previous one for as long as the transfer took.
   */
  completedAt?: string | null;
}

/** One heart-rate reading captured on the watch. */
export interface WatchHeartRateSamplePayload {
  /** ISO 8601 instant. */
  t: string;
  bpm: number;
}

/**
 * One batch of what the watch measured while a given exercise was on screen.
 *
 * Named for heart rate because that is what it started as, and still its
 * bulk; `activeEnergyKcal` rides along because HealthKit reports both from
 * the same `HKLiveWorkoutBuilder` and they share the same per-exercise
 * attribution.
 */
export interface WatchHeartRateBatchPayload {
  /**
   * Stable id generated on the watch, to dedupe a re-delivered
   * `transferUserInfo`. Absent on a batch from an older watch build —
   * those must not apply `activeEnergyKcal` again, because a redelivery
   * would double the diary calories.
   */
  clientId?: string;
  /**
   * Present only when `clientId` is missing, so the phone can still remove
   * the batch from the native queue. Not a dedupe key — a batch with no
   * `clientId` must not apply `activeEnergyKcal`.
   */
  queueId?: string;
  sessionId: string;
  exerciseEntryId: string;
  samples: WatchHeartRateSamplePayload[];
  /**
   * Active energy burned SINCE THE LAST BATCH, in kcal — a delta, not a
   * running total, so the phone can sum per exercise and have the parts add
   * up to the workout's real total. Absent when HealthKit reported no energy
   * (permission refused, or nothing measured yet).
   */
  activeEnergyKcal?: number;
  /**
   * Minutes the watch spent showing this exercise, including rest between
   * its sets. Cumulative. Absent on a batch that only carries samples.
   */
  durationMinutes?: number;
  /**
   * Server config that was active when the phone received this batch. The
   * phone only applies a batch whose owner is the active config; a batch for
   * another config stays queued and is not posted or acked. Absent when no
   * config was active, in which case the batch was not queued either.
   */
  ownerId?: string;
}

/** The wearer ended the workout on the watch. */
export interface WatchWorkoutStopPayload {
  sessionId: string;
}

export type WatchConnectivityEvents = {
  onReachabilityChange: (payload: { isReachable: boolean }) => void;
  onCheckIn: (payload: WatchCheckInPayload) => void;
  onContextRequest: () => void;
  onWaterIntake: (payload: WatchWaterIntakePayload) => void;
  onWaterDelete: (payload: WatchWaterDeletePayload) => void;
  onSetCompleted: (payload: WatchSetCompletedPayload) => void;
  onHeartRateBatch: (payload: WatchHeartRateBatchPayload) => void;
  onWorkoutStop: (payload: WatchWorkoutStopPayload) => void;
};

declare class WatchConnectivityModuleType extends NativeModule<WatchConnectivityEvents> {
  isSupported(): boolean;
  isReachable(): boolean;
  isPaired(): boolean;
  updateContext(context: WatchContextPayload): Promise<void>;
  sendAck(clientId: string, ok: boolean): Promise<void>;
  startWorkout(plan: WatchWorkoutStartPayload): Promise<void>;
  /**
   * Tells the watch the workout it was armed with has ended on the phone, so
   * it stops its HealthKit session and clears the Workout tab. Takes the
   * session id rather than being argument-less so a stop for an already
   * superseded workout can be ignored watch-side.
   */
  stopWorkout(sessionId: string, stoppedAt: string): Promise<void>;
  /**
   * Absolute pause snapshot for the live session. `revision` only increases.
   * `excludedPauseMs` is time already resumed, so a late pause cannot undo it.
   */
  updateIntervalTiming(timing: {
    sessionId: string;
    revision: number;
    paused: boolean;
    pausedAt?: string;
    excludedPauseMs: number;
  }): Promise<void>;
  /**
   * Heart-rate batches received before JavaScript was listening. Kept until
   * `ackHeartRateBatches` says the phone has stored them. Async so the read
   * is not on the JS thread.
   */
  pendingHeartRateBatches(): Promise<WatchHeartRateBatchPayload[]>;
  ackHeartRateBatches(clientIds: string[]): Promise<void>;
  /**
   * Server config that owns batches received after this call. Persisted
   * natively, so a batch that arrives on a cold start is stamped before
   * JavaScript runs. An empty id means no config is active, and batches are
   * then not queued.
   */
  setTelemetryOwner(ownerId: string): Promise<void>;
  /**
   * Batches the native queue evicted (over its cap) or refused (no owner, or
   * malformed) since the last call. Resets to zero.
   */
  takeDroppedHeartRateBatchCount(): Promise<number>;
}

// iOS-only: WatchConnectivity has no Android equivalent, so this resolves to
// null there and every caller must guard on it. Prefer the guarded hook in
// src/hooks/useWatchCheckInBridge.ts over importing this module directly.
const WatchConnectivityModule: WatchConnectivityModuleType | null =
  Platform.OS === 'ios'
    ? requireOptionalNativeModule<WatchConnectivityModuleType>(
        'WatchConnectivity'
      )
    : null;

export default WatchConnectivityModule;
