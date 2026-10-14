import { haversineMeters } from './gpsRecording';
import type { RawFix, RecordingActivity } from './gpsRecording';

/**
 * Decides, fix by fix, when a recording should pause itself because the person
 * stopped (a red light, tying a shoe) and when it should carry on. Pure, so it
 * runs under Jest; the recording service owns the state between calls.
 */

interface AutoPauseProfile {
  /** Below this speed (m/s) the person counts as stopped. */
  stoppedBelowMps: number;
  /** Above this speed (m/s) the person counts as moving again. */
  movingAboveMps: number;
  /** How long they must stay stopped before the recording pauses. */
  stoppedForMs: number;
  /** How long they must keep moving before the recording resumes. */
  movingForMs: number;
}

// The resume threshold sits well above the stop one so a shuffle at the
// lights does not flip the recording back and forth.
const PROFILES: Record<RecordingActivity, AutoPauseProfile> = {
  walk: {
    stoppedBelowMps: 0.4,
    movingAboveMps: 0.9,
    stoppedForMs: 10_000,
    movingForMs: 3_000,
  },
  run: {
    stoppedBelowMps: 0.6,
    movingAboveMps: 1.5,
    stoppedForMs: 8_000,
    movingForMs: 3_000,
  },
  ride: {
    stoppedBelowMps: 1,
    movingAboveMps: 2.2,
    stoppedForMs: 6_000,
    movingForMs: 2_000,
  },
};

/** A fix with a worse accuracy radius than this says nothing about speed. */
const MAX_ACCURACY_M = 30;

export interface AutoPauseState {
  /** Epoch ms the person was first seen stopped, or null while moving. */
  stoppedSince: number | null;
  /** Epoch ms the person was first seen moving again, or null. */
  movingSince: number | null;
  /** Last fix looked at, for a speed worked out from position. */
  last: { t: number; lat: number; lon: number } | null;
}

export const INITIAL_AUTO_PAUSE_STATE: AutoPauseState = {
  stoppedSince: null,
  movingSince: null,
  last: null,
};

export type AutoPauseAction =
  | { type: 'none' }
  /** Pause now; `at` is when the person actually stopped. */
  | { type: 'pause'; at: number }
  /** Resume now; `at` is when the person actually started moving. */
  | { type: 'resume'; at: number };

/**
 * The speed of a fix in m/s, or null when it cannot be trusted. Uses the
 * receiver's own Doppler speed when present and falls back to the distance
 * from the previous fix.
 */
function fixSpeed(fix: RawFix, last: AutoPauseState['last']): number | null {
  if (typeof fix.hacc === 'number' && fix.hacc > MAX_ACCURACY_M) return null;
  if (
    typeof fix.speed === 'number' &&
    Number.isFinite(fix.speed) &&
    fix.speed >= 0
  ) {
    return fix.speed;
  }
  if (!last || fix.t <= last.t) return null;
  return haversineMeters(last, fix) / ((fix.t - last.t) / 1000);
}

/**
 * Feeds one fix to the detector. `paused` is whether the recording is
 * currently auto-paused. The caller applies the returned action and passes the
 * returned state to the next call.
 */
export function stepAutoPause(
  state: AutoPauseState,
  fix: RawFix,
  activity: RecordingActivity,
  paused: boolean
): { state: AutoPauseState; action: AutoPauseAction } {
  const profile = PROFILES[activity];
  const speed = fixSpeed(fix, state.last);
  const last =
    Number.isFinite(fix.t) &&
    Number.isFinite(fix.lat) &&
    Number.isFinite(fix.lon)
      ? { t: fix.t, lat: fix.lat, lon: fix.lon }
      : state.last;
  if (speed === null) {
    return { state: { ...state, last }, action: { type: 'none' } };
  }

  if (!paused) {
    if (speed >= profile.stoppedBelowMps) {
      return {
        state: { stoppedSince: null, movingSince: null, last },
        action: { type: 'none' },
      };
    }
    const stoppedSince = state.stoppedSince ?? fix.t;
    if (fix.t - stoppedSince >= profile.stoppedForMs) {
      return {
        state: { stoppedSince: null, movingSince: null, last },
        action: { type: 'pause', at: stoppedSince },
      };
    }
    return {
      state: { stoppedSince, movingSince: null, last },
      action: { type: 'none' },
    };
  }

  if (speed < profile.movingAboveMps) {
    return {
      state: { stoppedSince: null, movingSince: null, last },
      action: { type: 'none' },
    };
  }
  const movingSince = state.movingSince ?? fix.t;
  if (fix.t - movingSince >= profile.movingForMs) {
    return {
      state: { stoppedSince: null, movingSince: null, last },
      action: { type: 'resume', at: movingSince },
    };
  }
  return {
    state: { stoppedSince: null, movingSince, last },
    action: { type: 'none' },
  };
}
