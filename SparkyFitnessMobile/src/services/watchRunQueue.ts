import AsyncStorage from '@react-native-async-storage/async-storage';
import { ApiError } from './api/errors';
import { addLog } from './LogService';
import { saveWatchRun } from './watchRunSave';
import { toLocalDateString } from '../utils/dateUtils';
import { parseWatchRunPayload, type WatchRunPayload } from '../utils/watchRun';

/**
 * Walks and runs the watch sent that are not in the diary yet. A payload is
 * written here the moment it arrives, before any network call, because the
 * watch has already marked its Apple Health workout as handled (so the Health
 * import will skip it): if the phone dropped this one, it would be in neither
 * place.
 */
const QUEUE_KEY = '@SparkyFitness/watchRunQueue';
/** Ids already filed, so a re-delivered message is not logged twice. */
const DONE_KEY = '@SparkyFitness/watchRunDone';
const MAX_DONE = 50;
const RETRYABLE_CLIENT_STATUSES = new Set([401, 408, 429]);

interface QueuedRun {
  payload: WatchRunPayload;
  /** Set once the entry exists, so a retry only repeats the later steps. */
  entryId?: string;
}

async function readJson<T>(key: string, fallback: T): Promise<T> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

const readQueue = () => readJson<QueuedRun[]>(QUEUE_KEY, []);
const readDone = () => readJson<string[]>(DONE_KEY, []);

// Reads and writes on this key must not interleave.
let chain: Promise<unknown> = Promise.resolve();
function serial<T>(task: () => Promise<T>): Promise<T> {
  const next = chain.then(task, task);
  chain = next.catch(() => undefined);
  return next;
}

/** Stores a run that just arrived. Returns false for a copy already handled. */
export function enqueueWatchRun(payload: WatchRunPayload): Promise<boolean> {
  return serial(async () => {
    const [queue, done] = await Promise.all([readQueue(), readDone()]);
    if (
      done.includes(payload.clientId) ||
      queue.some((item) => item.payload.clientId === payload.clientId)
    ) {
      return false;
    }
    await AsyncStorage.setItem(
      QUEUE_KEY,
      JSON.stringify([...queue, { payload }])
    );
    return true;
  });
}

/**
 * Moves runs the native side kept (they arrived before JavaScript was
 * listening) into this queue. Each one is acknowledged only after it is
 * stored here, or was already stored. A failed write leaves it pending.
 */
export async function acceptPendingWatchRuns(
  pending: readonly unknown[],
  enqueue: (payload: WatchRunPayload) => Promise<boolean>,
  ack: (clientIds: string[]) => Promise<void>
): Promise<void> {
  const stored: string[] = [];
  for (const raw of pending) {
    const payload = parseWatchRunPayload(raw);
    if (!payload) continue;
    try {
      await enqueue(payload);
      stored.push(payload.clientId);
    } catch {
      // The native copy stays until a later launch can store it.
    }
  }
  if (stored.length > 0) await ack(stored);
}

async function update(
  clientId: string,
  change: (item: QueuedRun) => QueuedRun | null
): Promise<void> {
  const queue = await readQueue();
  const next = queue.flatMap((item) =>
    item.payload.clientId === clientId ? (change(item) ?? []) : [item]
  );
  await AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(next));
}

async function markDone(clientId: string): Promise<void> {
  const done = await readDone();
  await AsyncStorage.setItem(
    DONE_KEY,
    JSON.stringify(
      [...done.filter((id) => id !== clientId), clientId].slice(-MAX_DONE)
    )
  );
}

let processing: Promise<string[]> | null = null;
/** One delayed retry. A second failure while this is waiting does not add another. */
let retryTimer: ReturnType<typeof setTimeout> | null = null;
/** The bridge supplies this so the retry can wait until the server is reachable. */
let retry: (() => void) | null = null;
const RETRY_DELAY_MS = 30_000;

/** Registers the drain a retryable failure should call. Null clears a pending one. */
export function onWatchRunRetry(handler: (() => void) | null): void {
  retry = handler;
  if (!handler && retryTimer != null) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}

function scheduleRetry(): void {
  if (retryTimer != null || retry == null) return;
  retryTimer = setTimeout(() => {
    retryTimer = null;
    retry?.();
  }, RETRY_DELAY_MS);
}

/**
 * Files every queued run it can. A failure that may pass (offline, 5xx, auth)
 * leaves the run queued and tries it again after a delay; one the server
 * will never accept is dropped and logged. Returns the diary day of each run
 * it filed.
 */
export function processWatchRunQueue(
  distanceUnit: 'km' | 'miles'
): Promise<string[]> {
  if (processing) return processing;
  let needsRetry = false;
  processing = (async () => {
    const filed: string[] = [];
    // A run queued while this drain was going is picked up by the next pass of
    // the loop, so it is never left waiting for another trigger.
    const attempted = new Set<string>();
    for (;;) {
      const queue = await serial(readQueue);
      const item = queue.find((run) => !attempted.has(run.payload.clientId));
      if (!item) break;
      const { clientId } = item.payload;
      attempted.add(clientId);
      try {
        await saveWatchRun(
          item.payload,
          distanceUnit,
          item.entryId,
          (entryId) =>
            serial(() => update(clientId, (run) => ({ ...run, entryId })))
        );
        await serial(async () => {
          await update(clientId, () => null);
          await markDone(clientId);
        });
        filed.push(toLocalDateString(new Date(item.payload.startedAt)));
      } catch (error) {
        const status = error instanceof ApiError ? error.statusCode : undefined;
        const message = error instanceof Error ? error.message : String(error);
        if (
          status != null &&
          status >= 400 &&
          status < 500 &&
          !RETRYABLE_CLIENT_STATUSES.has(status)
        ) {
          addLog(
            `[Watch Run] Dropped watch run ${clientId}: server rejected it (${status})`,
            'ERROR'
          );
          await serial(() => update(clientId, () => null));
        } else {
          addLog(
            `[Watch Run] Will retry watch run ${clientId}: ${message}`,
            'WARNING'
          );
          needsRetry = true;
        }
      }
    }
    return filed;
  })().finally(() => {
    processing = null;
    if (needsRetry) scheduleRetry();
  });
  return processing;
}
