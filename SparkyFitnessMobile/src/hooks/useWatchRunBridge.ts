import { useEffect, useRef } from 'react';
import WatchConnectivity, {
  type WatchRunFinishedPayload,
} from '../../modules/watch-connectivity';
import { queryClient } from './queryClient';
import { invalidateExerciseCache } from './invalidateExerciseCache';
import { usePreferences } from './usePreferences';
import { addLog } from '../services/LogService';
import {
  acceptPendingWatchRuns,
  enqueueWatchRun,
  processWatchRunQueue,
  onWatchRunRetry,
} from '../services/watchRunQueue';
import { parseWatchRunPayload } from '../utils/watchRun';

/**
 * Files walks and runs the watch recorded on its own. The watch sends each one
 * when it finishes (queued, so a phone out of range gets it later); it lands
 * in a stored queue first and is then saved to the diary, retrying whenever
 * the server is reachable. Mounted headlessly, like the other watch bridges.
 */
export function useWatchRunBridge(
  enabled: boolean,
  isServerConnected: boolean
): void {
  const { preferences } = usePreferences();
  const unit: 'km' | 'miles' =
    preferences?.default_distance_unit === 'miles' ? 'miles' : 'km';
  const unitRef = useRef(unit);
  const connectedRef = useRef(isServerConnected);
  useEffect(() => {
    unitRef.current = unit;
    connectedRef.current = isServerConnected;
  }, [unit, isServerConnected]);

  const drain = useRef(async () => {
    if (!connectedRef.current) return;
    const days = await processWatchRunQueue(unitRef.current);
    for (const day of new Set(days)) invalidateExerciseCache(queryClient, day);
  });

  useEffect(() => {
    if (!enabled || !WatchConnectivity) return;
    const sub = WatchConnectivity.addListener(
      'onRunFinished',
      (raw: WatchRunFinishedPayload) => {
        const payload = parseWatchRunPayload(raw);
        if (!payload) {
          addLog(
            '[Watch Run] Ignored an unreadable run from the watch',
            'WARNING'
          );
          return;
        }
        void enqueueWatchRun(payload)
          .then(() => drain.current())
          .catch((error: unknown) =>
            addLog(
              `[Watch Run] Could not store watch run: ${error instanceof Error ? error.message : String(error)}`,
              'ERROR'
            )
          );
      }
    );
    return () => sub.remove();
  }, [enabled]);

  // A run can arrive while the app is not running. The native queue kept it;
  // store it before anything tries to file it, and only then tell native it
  // can drop its copy.
  useEffect(() => {
    if (
      !enabled ||
      !WatchConnectivity?.pendingWatchRuns ||
      !WatchConnectivity.ackWatchRuns
    ) {
      return;
    }
    const pending = WatchConnectivity.pendingWatchRuns.bind(WatchConnectivity);
    const ack = WatchConnectivity.ackWatchRuns.bind(WatchConnectivity);
    void pending()
      .then(async (runs) => {
        await acceptPendingWatchRuns(runs, enqueueWatchRun, ack);
        // The connection effect may already have drained an empty queue.
        await drain.current().catch(() => undefined);
      })
      .catch((error: unknown) =>
        addLog(
          `[Watch Run] Could not read runs queued on the phone: ${error instanceof Error ? error.message : String(error)}`,
          'ERROR'
        )
      );
  }, [enabled]);

  // Anything left from an earlier launch or an offline stretch.
  useEffect(() => {
    if (!enabled || !isServerConnected) return;
    void drain.current().catch(() => undefined);
  }, [enabled, isServerConnected]);

  // A diary request can fail while the identity check still says the server
  // is up. Try that run again once; the drain itself waits if it is not.
  useEffect(() => {
    if (!enabled) return;
    onWatchRunRetry(() => {
      void drain.current().catch(() => undefined);
    });
    return () => onWatchRunRetry(null);
  }, [enabled]);
}
