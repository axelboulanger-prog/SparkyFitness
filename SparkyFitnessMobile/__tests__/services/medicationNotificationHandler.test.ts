import * as Notifications from 'expo-notifications';
import { initMedicationNotificationActions } from '../../src/services/medicationNotificationHandler';
import {
  addNotificationResponseListener,
  dismissDeliveredNotification,
  MEDICATION_TAKEN_ACTION,
  MEDICATION_SKIP_ACTION,
} from '../../src/services/notifications';
import {
  createEntry,
  listEntries,
} from '../../src/services/api/medicationsApi';
import { queryClient } from '../../src/hooks/queryClient';

jest.mock('../../src/services/notifications', () => ({
  addNotificationResponseListener: jest.fn(),
  dismissDeliveredNotification: jest.fn(async () => undefined),
  MEDICATION_TAKEN_ACTION: 'MEDICATION_TAKEN',
  MEDICATION_SKIP_ACTION: 'MEDICATION_SKIP',
}));

jest.mock('../../src/services/api/medicationsApi', () => ({
  createEntry: jest.fn(),
  listEntries: jest.fn(),
}));

jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));

const DATE = '2026-08-12';

type ResponseListener = (response: unknown) => void;

function takenResponse() {
  return {
    actionIdentifier: MEDICATION_TAKEN_ACTION,
    notification: {
      request: {
        identifier: 'notif-1',
        content: {
          data: { medicationId: 'm1', scheduleId: 's1', entryDate: DATE },
        },
      },
    },
  };
}

function groupResponse(actionIdentifier = MEDICATION_TAKEN_ACTION) {
  return {
    actionIdentifier,
    notification: {
      request: {
        identifier: 'group-notif-1',
        content: {
          data: {
            medicationId: 'm1',
            entryDate: DATE,
            baseKey: 'med_group_2026-08-12_09:00_m1:s1_m2:s2',
            doses: JSON.stringify([
              { medicationId: 'm1', scheduleId: 's1' },
              { medicationId: 'm2', scheduleId: 's2' },
            ]),
            isGroup: 'true',
          },
        },
      },
    },
  };
}

/**
 * A dose marked Taken from an OS reminder never touches a React hook, so the entry
 * mutations' invalidation cannot run for it. Mobile queries have an infinite stale time,
 * so the miss is silent: the app resumes onto a dashboard that keeps showing pre-dose
 * calories until something else forces a refetch.
 */
describe('logging a dose from a notification action', () => {
  let spy: jest.SpyInstance;
  let listener: ResponseListener;

  // The handler latches on first call, so it registers exactly one listener per module
  // instance. Capture it up front rather than re-initialising per test.
  beforeAll(() => {
    initMedicationNotificationActions();
    listener = (addNotificationResponseListener as jest.Mock).mock
      .calls[0]?.[0] as ResponseListener;
    if (!listener)
      throw new Error('no notification response listener registered');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    spy = jest
      .spyOn(queryClient, 'invalidateQueries')
      .mockImplementation(() => undefined as never);
    (listEntries as jest.Mock).mockResolvedValue([]);
    (createEntry as jest.Mock).mockResolvedValue({ id: 'e1' });
    (
      Notifications.getAllScheduledNotificationsAsync as jest.Mock
    ).mockResolvedValue([]);
    (
      Notifications.cancelScheduledNotificationAsync as jest.Mock
    ).mockResolvedValue(undefined);
  });

  afterEach(() => spy.mockRestore());

  const fireTakenAction = async () => {
    listener(takenResponse());
    // The listener dispatches the write without awaiting it.
    await new Promise(process.nextTick);
  };

  const invalidatedKeys = () =>
    spy.mock.calls
      .map(([arg]) => (arg as { queryKey?: readonly unknown[] })?.queryKey)
      .filter(Array.isArray);

  const invalidatedPrefix = (...prefix: unknown[]) =>
    invalidatedKeys().some((key) =>
      prefix.every((segment, index) => key[index] === segment)
    );

  it('invalidates the daily summary, which carries the dose nutrition', async () => {
    await fireTakenAction();

    expect(createEntry).toHaveBeenCalledTimes(1);
    expect(invalidatedPrefix('dailySummary')).toBe(true);
  });

  it('invalidates the entry and medication lists the action also moved', async () => {
    await fireTakenAction();

    expect(invalidatedPrefix('medications', 'entries')).toBe(true);
    expect(invalidatedPrefix('medications')).toBe(true);
  });

  describe('consolidated group reminders', () => {
    it('logs all unlogged doses when a group notification taken action fires', async () => {
      listener(groupResponse(MEDICATION_TAKEN_ACTION));
      await new Promise(process.nextTick);

      expect(createEntry).toHaveBeenCalledTimes(2);
      expect(createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          medication_id: 'm1',
          schedule_id: 's1',
          status: 'taken',
          entry_date: DATE,
        })
      );
      expect(createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          medication_id: 'm2',
          schedule_id: 's2',
          status: 'taken',
          entry_date: DATE,
        })
      );
      expect(dismissDeliveredNotification).toHaveBeenCalledWith(
        'group-notif-1'
      );
      expect(invalidatedPrefix('medications', 'entries')).toBe(true);
    });

    it('logs all doses as skipped when a group notification skip action fires', async () => {
      listener(groupResponse(MEDICATION_SKIP_ACTION));
      await new Promise(process.nextTick);

      expect(createEntry).toHaveBeenCalledTimes(2);
      expect(createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          medication_id: 'm1',
          schedule_id: 's1',
          status: 'skipped',
          entry_date: DATE,
          taken_at: undefined,
        })
      );
      expect(createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          medication_id: 'm2',
          schedule_id: 's2',
          status: 'skipped',
          entry_date: DATE,
          taken_at: undefined,
        })
      );
    });

    it('skips doses that are already logged in the group', async () => {
      (listEntries as jest.Mock).mockResolvedValue([
        {
          id: 'existing-e1',
          medication_id: 'm1',
          schedule_id: 's1',
          status: 'taken',
        },
      ]);

      listener(groupResponse(MEDICATION_TAKEN_ACTION));
      await new Promise(process.nextTick);

      expect(createEntry).toHaveBeenCalledTimes(1);
      expect(createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          medication_id: 'm2',
          schedule_id: 's2',
          status: 'taken',
        })
      );
    });

    it('cancels scheduled repeat notifications matching baseKey', async () => {
      const baseKey = 'med_group_2026-08-12_09:00_m1:s1_m2:s2';
      (
        Notifications.getAllScheduledNotificationsAsync as jest.Mock
      ).mockResolvedValue([
        {
          identifier: 'repeat-10',
          content: { data: { baseKey } },
        },
        {
          identifier: 'unrelated',
          content: { data: { baseKey: 'other_key' } },
        },
      ]);

      listener(groupResponse(MEDICATION_TAKEN_ACTION));
      await new Promise(process.nextTick);

      expect(
        Notifications.cancelScheduledNotificationAsync
      ).toHaveBeenCalledWith('repeat-10');
      expect(
        Notifications.cancelScheduledNotificationAsync
      ).not.toHaveBeenCalledWith('unrelated');
    });
  });
});
