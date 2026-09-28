import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import type { WorkoutFormat } from '@workspace/shared';
import {
  startIntervalAudioSession,
  stopIntervalAudioSession,
} from '../services/sounds';
import { stopGuidedSpeech } from '../services/speech';

/**
 * Manages interval audio session lifecycle (enabling audio mid-workout in silent mode)
 * and provides a synchronized 1-second ticker for workout elapsed clock and interval HUDs.
 *
 * Guided mode (#1507) opts into the same session: turning it on is the user's
 * choice to hear cues with the phone pocketed on silent, exactly like picking
 * a clock-driven format. With neither, the audio mode is never touched.
 */
export function useActiveWorkoutIntervalLifecycle(
  workoutFormat?: WorkoutFormat | null,
  guidedWorkoutEnabled = false
): { now: number } {
  const needsAudioSession =
    (workoutFormat != null && workoutFormat !== 'standard') ||
    guidedWorkoutEnabled;

  // Interval audio session management: keep background/silent-mode audio active
  // for countdown beeps, phase cues and guided narration.
  useEffect(() => {
    if (!needsAudioSession) return;
    void startIntervalAudioSession();
    return () => {
      void stopIntervalAudioSession();
    };
  }, [needsAudioSession]);

  // Narration queued while backgrounded would play late and out of step with
  // the clock, so leaving the app drops it; the next cue resumes on return.
  useEffect(() => {
    if (!guidedWorkoutEnabled) return;
    const sub = AppState.addEventListener('change', (next) => {
      if (next !== 'active') stopGuidedSpeech();
    });
    return () => sub.remove();
  }, [guidedWorkoutEnabled]);

  // One 1s tick drives the elapsed clock and re-renders the rest countdown.
  // Set rows are memoized, so ticks only re-render the header and rest bar.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  return { now };
}
