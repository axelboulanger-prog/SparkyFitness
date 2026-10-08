import * as Notifications from 'expo-notifications';
import {
  addNotificationResponseListener,
  dismissDeliveredNotification,
  MEDICATION_TAKEN_ACTION,
  MEDICATION_SKIP_ACTION,
} from './notifications';
import { createEntry, listEntries } from './api/medicationsApi';
import { queryClient } from '../hooks/queryClient';
import { invalidateMedicationEntryCaches } from '../hooks/invalidateMedicationEntryCaches';
import { addLog } from '../services/LogService';
import type { MedicationEntryStatus } from '@workspace/shared';
import { isDoseLogged } from '../utils/medications';

let initialized = false;

export function initMedicationNotificationActions(): void {
  if (initialized) return;
  initialized = true;

  addNotificationResponseListener((response) => {
    const actionId = response.actionIdentifier;

    let status: MedicationEntryStatus | null = null;
    if (actionId === MEDICATION_TAKEN_ACTION) {
      status = 'taken';
    } else if (actionId === MEDICATION_SKIP_ACTION) {
      status = 'skipped';
    }

    if (!status) return;

    const content = response.notification.request.content;
    const data = content.data as Record<string, string | undefined>;
    const medicationId = data?.medicationId;
    const scheduleId = data?.scheduleId;
    const entryDate = data?.entryDate;

    if ((!medicationId && !data?.doses) || !entryDate) {
      addLog(
        '[MedicationNotificationAction] Missing required data in notification',
        'WARNING'
      );
      return;
    }

    let doses: { medicationId: string; scheduleId: string | null }[] = [];
    if (data?.doses) {
      try {
        const parsed = JSON.parse(data.doses);
        if (Array.isArray(parsed)) {
          doses = parsed;
        }
      } catch {
        // fallback below
      }
    }
    if (doses.length === 0 && medicationId) {
      doses = [{ medicationId, scheduleId: scheduleId ?? null }];
    }

    void handleNotificationAction(
      status,
      doses,
      entryDate,
      response.notification.request.identifier,
      data?.baseKey ?? data?.key ?? null
    );
  });
}

async function handleNotificationAction(
  status: MedicationEntryStatus,
  doses: { medicationId: string; scheduleId: string | null }[],
  entryDate: string,
  notificationId: string,
  key: string | null
): Promise<void> {
  try {
    const existing = await listEntries({
      fromDate: entryDate,
      toDate: entryDate,
      ...(doses.length === 1 ? { medicationId: doses[0].medicationId } : {}),
    });

    const unlogged = doses.filter(
      (d) => !isDoseLogged(existing, d.medicationId, d.scheduleId)
    );

    if (unlogged.length === 0) {
      await dismissDeliveredNotification(notificationId);
      return;
    }

    const takenAt = status === 'taken' ? new Date().toISOString() : undefined;

    await Promise.all(
      unlogged.map((d) =>
        createEntry({
          medication_id: d.medicationId,
          schedule_id: d.scheduleId,
          status,
          entry_date: entryDate,
          taken_at: takenAt,
        })
      )
    );

    // This path writes the entry through the API directly rather than through the
    // mutations, so nothing else marks the caches stale. With an infinite stale time the
    // app can resume onto an already-focused dashboard, skip the focus refetch, and show
    // calories that do not include the dose the user just marked taken from the reminder.
    invalidateMedicationEntryCaches(queryClient);

    if (key) {
      const allPending =
        await Notifications.getAllScheduledNotificationsAsync();
      const toCancel = allPending.filter(
        (n) => n.content.data?.baseKey === key
      );
      await Promise.all(
        toCancel.map((n) =>
          Notifications.cancelScheduledNotificationAsync(n.identifier).catch(
            () => {}
          )
        )
      );
    }

    await dismissDeliveredNotification(notificationId);
    addLog(
      `[MedicationNotificationAction] Logged ${unlogged.length} medication(s) as ${status}`,
      'DEBUG'
    );
  } catch (error) {
    addLog(
      `[MedicationNotificationAction] Failed to log medication: ${(error as Error).message}`,
      'ERROR'
    );
  }
}
