import { AppState } from 'react-native';
import {
  createAudioPlayer,
  setAudioModeAsync,
  type AudioPlayer,
} from 'expo-audio';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import { addLog } from './LogService';

let restChimePlayer: AudioPlayer | null = null;
let audioModeConfigured = false;

/**
 * Whether the rest-timer chime should play. Also consulted by the foreground
 * notification handler: while the chime owns the foreground cue, the
 * rest-complete notification's default sound is suppressed so the two never
 * ding on top of each other.
 */
export function isRestTimerSoundEnabled(): boolean {
  // Independent of `soundsEnabled`, which the settings UI presents as the
  // camera-shutter toggle.
  return useAppPreferencesStore.getState().restTimerSoundEnabled;
}

/**
 * Whether the chime would actually play right now. Callers that stand down in
 * favour of it must test this, not the preference alone: it is foreground-only,
 * so off screen the notification ping owns the cue.
 */
export function willPlayRestCompleteSound(): boolean {
  return isRestTimerSoundEnabled() && AppState.currentState === 'active';
}

/**
 * Plays the rest-complete chime. Foreground-only by design — in the background
 * the scheduled notification's sound is the cue. Fire-and-forget: playback
 * failures log but never propagate into rest-state transitions.
 */
export function playRestCompleteSound(): void {
  if (!willPlayRestCompleteSound()) return;
  void (async () => {
    try {
      if (!audioModeConfigured) {
        try {
          // Short UI cue: mix with (never duck) the user's music, and stay
          // silent when the ringer/silent switch is off — the haptic still fires.
          await setAudioModeAsync({
            playsInSilentMode: false,
            interruptionMode: 'mixWithOthers',
          });
          audioModeConfigured = true;
        } catch (err) {
          // Retry on the next chime; a config failure must not mute the cue.
          addLog(
            `rest chime audio mode config failed: ${(err as Error).message}`,
            'WARNING'
          );
        }
      }
      if (restChimePlayer == null) {
        restChimePlayer = createAudioPlayer(
          require('../../assets/sounds/rest-chime.wav')
        );
      }
      await restChimePlayer.seekTo(0);
      restChimePlayer.play();
    } catch (err) {
      addLog(
        `playRestCompleteSound failed: ${(err as Error).message}`,
        'ERROR'
      );
    }
  })();
}

let intervalWorkPlayer: AudioPlayer | null = null;
let intervalRestPlayer: AudioPlayer | null = null;

// --- Music ducking (#1560) ---------------------------------------------
//
// Opt-in: with `duckMusicDuringCues` off, nothing below runs and the audio
// session behaves exactly as before (cues mix over music at full volume).
// With it on, the session switches to `duckOthers` while a cue or guided
// line is sounding, then back to `mixWithOthers`. The session itself is never
// deactivated here: expo-audio already deactivates it (notifying other apps,
// which brings their volume back) once its players finish, and a manual
// `setIsAudioActiveAsync(false)` would pause and block the next cue.
// Depth-counted so overlapping cues (a beep during a spoken line) duck once
// and restore once.

/** Interval cue sounds are about a second; keep music low a touch longer. */
const CUE_DUCK_MS = 1200;
/** Grace period so back-to-back cues don't pump the music up and down. */
const UNDUCK_DELAY_MS = 600;

let intervalSessionActive = false;
let duckDepth = 0;
let unduckTimer: ReturnType<typeof setTimeout> | null = null;
// Pending per-cue releases, cancelled on reset so a timer from a stopped
// session can't release a cue that belongs to the next one.
const cueReleaseTimers = new Set<ReturnType<typeof setTimeout>>();

function isDuckingEnabled(): boolean {
  return useAppPreferencesStore.getState().duckMusicDuringCues;
}

async function applyDuckMode(duck: boolean): Promise<void> {
  try {
    await setAudioModeAsync({
      playsInSilentMode: intervalSessionActive,
      interruptionMode: duck ? 'duckOthers' : 'mixWithOthers',
    });
  } catch (err) {
    addLog(`music ducking failed: ${(err as Error).message}`, 'WARNING');
  }
}

/**
 * Lower other apps' audio for a cue about to play. Returns true when ducking
 * started (the caller must then call {@link endCueDucking} exactly once).
 */
export function beginCueDucking(): boolean {
  if (!isDuckingEnabled()) return false;
  if (unduckTimer != null) {
    clearTimeout(unduckTimer);
    unduckTimer = null;
  }
  duckDepth += 1;
  if (duckDepth === 1) void applyDuckMode(true);
  return true;
}

/** Release one {@link beginCueDucking}; the last release restores the music. */
export function endCueDucking(): void {
  if (duckDepth === 0) return;
  duckDepth -= 1;
  if (duckDepth > 0) return;
  unduckTimer = setTimeout(() => {
    unduckTimer = null;
    if (duckDepth === 0) void applyDuckMode(false);
  }, UNDUCK_DELAY_MS);
}

function resetDucking(): void {
  cueReleaseTimers.forEach((timer) => clearTimeout(timer));
  cueReleaseTimers.clear();
  duckDepth = 0;
  if (unduckTimer != null) {
    clearTimeout(unduckTimer);
    unduckTimer = null;
  }
}

/**
 * Starts an audio session configured for interval workouts (`playsInSilentMode: true`).
 * This ensures cues are audible mid-workout even if the phone's silent switch is on.
 */
export async function startIntervalAudioSession(): Promise<void> {
  intervalSessionActive = true;
  try {
    await setAudioModeAsync({
      playsInSilentMode: true,
      interruptionMode: 'mixWithOthers',
    });
    audioModeConfigured = true;
  } catch (err) {
    addLog(
      `startIntervalAudioSession failed: ${(err as Error).message}`,
      'WARNING'
    );
  }
}

/**
 * Ends the interval audio session, restoring the standard audio mode.
 */
export async function stopIntervalAudioSession(): Promise<void> {
  intervalSessionActive = false;
  resetDucking();
  try {
    await setAudioModeAsync({
      playsInSilentMode: false,
      interruptionMode: 'mixWithOthers',
    });
    audioModeConfigured = true;
  } catch (err) {
    addLog(
      `stopIntervalAudioSession failed: ${(err as Error).message}`,
      'WARNING'
    );
  }
}

/**
 * Plays a sound cue for interval transitions (work, rest, countdown beep, or workout finish).
 */
export function playIntervalCue(
  type: 'work' | 'rest' | 'countdown' | 'finish'
): void {
  if (!isRestTimerSoundEnabled()) return;
  if (beginCueDucking()) {
    const release = setTimeout(() => {
      cueReleaseTimers.delete(release);
      endCueDucking();
    }, CUE_DUCK_MS);
    cueReleaseTimers.add(release);
  }
  void (async () => {
    try {
      if (type === 'work' || type === 'finish') {
        if (intervalWorkPlayer == null) {
          intervalWorkPlayer = createAudioPlayer(
            require('../../assets/sounds/rest-chime.wav')
          );
        }
        await intervalWorkPlayer.seekTo(0);
        intervalWorkPlayer.play();
      } else {
        if (intervalRestPlayer == null) {
          intervalRestPlayer = createAudioPlayer(
            require('../../assets/sounds/rest-chime-2.wav')
          );
        }
        await intervalRestPlayer.seekTo(0);
        intervalRestPlayer.play();
      }
    } catch (err) {
      addLog(
        `playIntervalCue (${type}) failed: ${(err as Error).message}`,
        'ERROR'
      );
    }
  })();
}

/** Test-only helper — drops the cached player and audio-mode flag. */
export function __resetSoundsForTests(): void {
  restChimePlayer = null;
  intervalWorkPlayer = null;
  intervalRestPlayer = null;
  audioModeConfigured = false;
  intervalSessionActive = false;
  resetDucking();
}
