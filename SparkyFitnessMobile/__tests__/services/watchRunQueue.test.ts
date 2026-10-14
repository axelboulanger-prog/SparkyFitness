import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  acceptPendingWatchRuns,
  enqueueWatchRun,
  onWatchRunRetry,
  processWatchRunQueue,
} from '../../src/services/watchRunQueue';
import { saveWatchRun } from '../../src/services/watchRunSave';
import { ApiError } from '../../src/services/api/errors';
import type { WatchRunPayload } from '../../src/utils/watchRun';

jest.mock('../../src/services/watchRunSave');
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));

const mockedSave = jest.mocked(saveWatchRun);

const run = (clientId: string): WatchRunPayload => ({
  clientId,
  kind: 'walk',
  place: 'outdoor',
  startedAt: new Date(2026, 9, 10, 8, 0).getTime(),
  endedAt: new Date(2026, 9, 10, 8, 30).getTime(),
  activeSeconds: 1800,
  distanceMeters: 2000,
  activeEnergyKcal: 100,
  route: [],
  heartRate: [],
  laps: [],
});

beforeEach(async () => {
  await AsyncStorage.clear();
  mockedSave.mockReset();
  onWatchRunRetry(null);
});

test('files a queued run once and ignores a re-delivered copy', async () => {
  mockedSave.mockResolvedValue('entry-1');
  expect(await enqueueWatchRun(run('a'))).toBe(true);
  expect(await processWatchRunQueue('km')).toEqual(['2026-10-10']);
  expect(await enqueueWatchRun(run('a'))).toBe(false);
  expect(await processWatchRunQueue('km')).toEqual([]);
  expect(mockedSave).toHaveBeenCalledTimes(1);
});

test('keeps a run for a retry after a network failure, reusing the entry', async () => {
  await enqueueWatchRun(run('b'));
  mockedSave.mockImplementationOnce(async (_p, _u, _e, onEntryCreated) => {
    await onEntryCreated('entry-9');
    throw new Error('offline');
  });
  expect(await processWatchRunQueue('km')).toEqual([]);

  mockedSave.mockResolvedValueOnce('entry-9');
  expect(await processWatchRunQueue('km')).toEqual(['2026-10-10']);
  expect(mockedSave).toHaveBeenLastCalledWith(
    expect.objectContaining({ clientId: 'b' }),
    'km',
    'entry-9',
    expect.any(Function)
  );
});

test('drops a run the server will never accept', async () => {
  jest.useFakeTimers();
  try {
    await enqueueWatchRun(run('c'));
    mockedSave.mockRejectedValueOnce(new ApiError('bad', 400));
    const again = jest.fn();
    onWatchRunRetry(again);
    expect(await processWatchRunQueue('km')).toEqual([]);
    await jest.advanceTimersByTimeAsync(30_000);
    expect(await processWatchRunQueue('km')).toEqual([]);
    expect(mockedSave).toHaveBeenCalledTimes(1);
    expect(again).not.toHaveBeenCalled();
  } finally {
    onWatchRunRetry(null);
    jest.useRealTimers();
  }
});

test('tries a retryable failure again after a delay, once', async () => {
  jest.useFakeTimers();
  try {
    const again = jest.fn();
    onWatchRunRetry(again);
    await enqueueWatchRun(run('retry-1'));
    await enqueueWatchRun(run('retry-2'));
    mockedSave.mockRejectedValue(new Error('offline'));
    await processWatchRunQueue('km');
    expect(again).not.toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(again).toHaveBeenCalledTimes(1);

    await jest.advanceTimersByTimeAsync(30_000);
    expect(again).toHaveBeenCalledTimes(1);
  } finally {
    onWatchRunRetry(null);
    jest.useRealTimers();
  }
});

test('files a run that arrives while another is being filed', async () => {
  await enqueueWatchRun(run('d'));
  mockedSave.mockImplementationOnce(async () => {
    await enqueueWatchRun(run('e'));
    return 'entry-d';
  });
  mockedSave.mockResolvedValueOnce('entry-e');
  const filed = processWatchRunQueue('km');
  // A second trigger while the first is running joins it.
  expect(await processWatchRunQueue('km')).toEqual(await filed);
  expect(mockedSave).toHaveBeenCalledTimes(2);
  expect(await filed).toHaveLength(2);
});

describe('acceptPendingWatchRuns', () => {
  const ack = jest.fn(async () => undefined);

  beforeEach(() => ack.mockClear());

  test('stores a run that arrived before the app was listening, including its laps', async () => {
    const enqueue = jest.fn(async () => true);
    await acceptPendingWatchRuns(
      [{ ...run('cold'), laps: [1_000, 2_000] }],
      enqueue,
      ack
    );
    expect(enqueue).toHaveBeenCalledWith(
      expect.objectContaining({ clientId: 'cold', laps: [1_000, 2_000] })
    );
    expect(ack).toHaveBeenCalledWith(['cold']);
  });

  test('acks a re-delivered run so the native queue can drop it', async () => {
    const enqueue = jest.fn(async () => false);
    await acceptPendingWatchRuns([run('again')], enqueue, ack);
    expect(ack).toHaveBeenCalledWith(['again']);
  });

  test('leaves a run pending when storing it fails', async () => {
    const enqueue = jest.fn(async (payload: WatchRunPayload) => {
      if (payload.clientId === 'fail') throw new Error('disk full');
      return true;
    });
    await acceptPendingWatchRuns([run('fail'), run('ok')], enqueue, ack);
    expect(ack).toHaveBeenCalledWith(['ok']);
  });
});
