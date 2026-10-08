import * as Notifications from 'expo-notifications';
import i18n from '../localization/i18n';

import { addDays, getDeviceTimezone, getTodayDate } from '../utils/dateUtils';
import { getDueDosesForDate } from '@workspace/shared';
import {
  ensureMedicationReminderChannel,
  hasNotificationPermission,
  MEDICATION_REMINDER_CATEGORY,
  MEDICATION_REMINDER_GROUP_CATEGORY,
  MEDICATION_REMINDER_CHANNEL_ID,
} from './notifications';
import { useAppPreferencesStore } from '../stores/appPreferencesStore';
import type { MedicationDetail, MedicationEntry } from '@workspace/shared';
import { isDoseLogged } from '../utils/medications';
import { addLog } from './LogService';

const REPEAT_MINUTES = [10, 20, 30];
// iOS keeps only the 64 soonest pending notifications, so base reminders get a
// bounded lookahead and the repeat pings stay today-only.
const REMINDER_LOOKAHEAD_DAYS = 7;
const schedulingLock = new Set<string>();

function medReminderKey(
  medicationId: string,
  scheduleId: string,
  date: string,
  timeOfDay: string
) {
  return `med_${date}_${medicationId}_${scheduleId}_${timeOfDay}`;
}

function medGroupReminderKey(
  date: string,
  timeOfDay: string,
  doses: { medication: { id: string }; schedule: { id: string } }[]
) {
  const ids = doses
    .map((d) => `${d.medication.id}:${d.schedule.id}`)
    .sort()
    .join('_');
  return `med_group_${date}_${timeOfDay}_${ids}`;
}

function repeatMedReminderKey(baseKey: string, offset: number) {
  return `${baseKey}_${offset}`;
}

async function cancelReminders(ids: string[]): Promise<void> {
  await Promise.all(
    ids.map(async (id) => {
      try {
        await Notifications.cancelScheduledNotificationAsync(id);
      } catch {
        // already cancelled or invalid
      }
    })
  );
}

async function scheduleReminder(
  body: string,
  triggerDate: Date,
  data: Record<string, string>,
  categoryIdentifier: string = MEDICATION_REMINDER_CATEGORY
): Promise<string | null> {
  try {
    return await Notifications.scheduleNotificationAsync({
      content: {
        title: i18n.t('medications.notificationTitle', {
          defaultValue: 'Medication reminder',
        }),
        body,
        sound: true,
        categoryIdentifier,
        data,
      },
      trigger: {
        type: Notifications.SchedulableTriggerInputTypes.DATE,
        date: triggerDate,
        channelId: MEDICATION_REMINDER_CHANNEL_ID,
      },
    });
  } catch (err) {
    addLog(`scheduleReminder failed: ${(err as Error).message}`, 'ERROR');
    return null;
  }
}

/**
 * Reconcile medication reminder notifications.
 * Can be called from the foreground or background.
 *
 * Base reminders cover the next REMINDER_LOOKAHEAD_DAYS days so doses still
 * fire on days the app never wakes; repeat pings are today-only.
 *
 * Uses Notifications.getAllScheduledNotificationsAsync() instead of an
 * AsyncStorage ledger — every pending request already carries its content.data.
 *
 * @param medications - Active medications from the API
 * @param entries - Today's medication entries from the API
 */
export async function reconcileMedicationReminders(
  medications: MedicationDetail[],
  entries: MedicationEntry[]
): Promise<void> {
  if (schedulingLock.has('medication-reminders')) return;
  schedulingLock.add('medication-reminders');

  try {
    const prefs = useAppPreferencesStore.getState();
    if (!prefs.medicationRemindersEnabled || !prefs.notificationsEnabled) {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      const medIds = all
        .filter((n) => n.content.data?.medicationId)
        .map((n) => n.identifier);
      if (medIds.length > 0) await cancelReminders(medIds);
      return;
    }

    const granted = await hasNotificationPermission();
    if (!granted) {
      const all = await Notifications.getAllScheduledNotificationsAsync();
      const medIds = all
        .filter((n) => n.content.data?.medicationId)
        .map((n) => n.identifier);
      if (medIds.length > 0) await cancelReminders(medIds);
      return;
    }

    await ensureMedicationReminderChannel();

    const today = getTodayDate();
    const tz = getDeviceTimezone();
    const hideNames = prefs.medicationReminderHideNames;
    const consolidate = prefs.medicationReminderConsolidate;
    const reminderLocale =
      i18n.resolvedLanguage?.split('-')[0] === 'pl' ? 'pl' : 'en';

    const desiredKeys = new Set<string>();

    type DueDose = ReturnType<
      typeof getDueDosesForDate<MedicationDetail>
    >[number];

    interface ReminderSlot {
      doses: DueDose[];
      timeOfDay: string;
      date: string;
      withRepeats: boolean;
      baseKey: string;
    }

    const slotsToSchedule: ReminderSlot[] = [];

    for (let dayOffset = 0; dayOffset < REMINDER_LOOKAHEAD_DAYS; dayOffset++) {
      const date = addDays(today, dayOffset);
      const isToday = dayOffset === 0;
      const dueDoses = getDueDosesForDate(medications, date, tz);

      const unloggedDoses: DueDose[] = [];
      for (const due of dueDoses) {
        const timeOfDay = due.schedule.time_of_day;
        if (!timeOfDay) continue;

        // Entries only cover today; future doses can't have been logged yet.
        if (
          isToday &&
          isDoseLogged(entries, due.medication.id, due.schedule.id)
        ) {
          continue;
        }

        unloggedDoses.push(due);
      }

      if (unloggedDoses.length === 0) continue;

      if (consolidate) {
        const byTime = new Map<string, DueDose[]>();
        for (const due of unloggedDoses) {
          const time = due.schedule.time_of_day!;
          const group = byTime.get(time) ?? [];
          group.push(due);
          byTime.set(time, group);
        }

        for (const [timeOfDay, doses] of byTime.entries()) {
          const baseKey =
            doses.length === 1
              ? medReminderKey(
                  doses[0].medication.id,
                  doses[0].schedule.id,
                  date,
                  timeOfDay
                )
              : medGroupReminderKey(date, timeOfDay, doses);

          desiredKeys.add(baseKey);

          const withRepeats = isToday && prefs.medicationReminderRepeats;
          if (withRepeats) {
            for (const offset of REPEAT_MINUTES) {
              desiredKeys.add(repeatMedReminderKey(baseKey, offset));
            }
          }

          slotsToSchedule.push({
            doses,
            timeOfDay,
            date,
            withRepeats,
            baseKey,
          });
        }
      } else {
        for (const due of unloggedDoses) {
          const timeOfDay = due.schedule.time_of_day!;
          const baseKey = medReminderKey(
            due.medication.id,
            due.schedule.id,
            date,
            timeOfDay
          );
          desiredKeys.add(baseKey);

          const withRepeats = isToday && prefs.medicationReminderRepeats;
          if (withRepeats) {
            for (const offset of REPEAT_MINUTES) {
              desiredKeys.add(repeatMedReminderKey(baseKey, offset));
            }
          }

          slotsToSchedule.push({
            doses: [due],
            timeOfDay,
            date,
            withRepeats,
            baseKey,
          });
        }
      }
    }

    const allPending = await Notifications.getAllScheduledNotificationsAsync();
    const toCancel = allPending
      .filter((n) => {
        if (!n.content.data?.medicationId) return false;
        const key = n.content.data.key as string | undefined;
        if (!key || !desiredKeys.has(key)) return true;
        // Notification copy is language-sensitive as well as privacy-sensitive:
        // changing EN ↔ PL must replace pending notifications created earlier.
        return (
          (n.content.data.hideNames === 'true') !== hideNames ||
          (n.content.data.locale ?? 'en') !== reminderLocale
        );
      })
      .map((n) => n.identifier);
    if (toCancel.length > 0) await cancelReminders(toCancel);

    const pendingKeys = new Set(
      allPending
        .filter(
          (n) =>
            n.content.data?.medicationId &&
            toCancel.indexOf(n.identifier) === -1
        )
        .map((n) => n.content.data?.key as string)
    );

    for (const {
      doses,
      timeOfDay,
      date,
      withRepeats,
      baseKey,
    } of slotsToSchedule) {
      const isGroup = doses.length > 1;
      const categoryIdentifier = isGroup
        ? MEDICATION_REMINDER_GROUP_CATEGORY
        : MEDICATION_REMINDER_CATEGORY;

      let body: string;
      if (hideNames) {
        body = isGroup
          ? i18n.t('medications.notificationScheduledDoses', {
              count: doses.length,
              defaultValue: 'You have {{count}} scheduled doses',
              defaultValue_one: 'You have {{count}} scheduled dose',
            })
          : i18n.t('medications.notificationScheduledDose', {
              defaultValue: 'You have a scheduled dose',
            });
      } else if (!isGroup) {
        const due = doses[0];
        const doseSuffix =
          due.medication.dose_amount != null
            ? ` (${due.medication.dose_amount}${due.medication.dose_unit ? ` ${due.medication.dose_unit}` : ''})`
            : '';
        body = i18n.t('medications.notificationScheduledDoseNamed', {
          defaultValue: 'Scheduled dose: {{name}}{{dose}}',
          name: due.medication.name,
          dose: doseSuffix,
        });
      } else {
        const doseNames = doses.map((d) => {
          const doseSuffix =
            d.medication.dose_amount != null
              ? ` (${d.medication.dose_amount}${d.medication.dose_unit ? ` ${d.medication.dose_unit}` : ''})`
              : '';
          return `${d.medication.name}${doseSuffix}`;
        });

        body =
          doseNames.length <= 3
            ? i18n.t('medications.notificationScheduledDosesNamed', {
                defaultValue: 'Scheduled doses: {{names}}',
                names: doseNames.join(', '),
              })
            : i18n.t('medications.notificationScheduledDosesOverflow', {
                count: doseNames.length - 3,
                names: doseNames.slice(0, 3).join(', '),
                defaultValue: 'Scheduled doses: {{names}}, and {{count}} more',
                defaultValue_one:
                  'Scheduled doses: {{names}}, and {{count}} more',
              });
      }

      const data: Record<string, string> = {
        medicationId: doses[0].medication.id,
        scheduleId: doses[0].schedule.id,
        entryDate: date,
        key: baseKey,
        baseKey,
        hideNames: String(hideNames),
        locale: reminderLocale,
      };

      if (isGroup) {
        data.doses = JSON.stringify(
          doses.map((d) => ({
            medicationId: d.medication.id,
            scheduleId: d.schedule.id,
          }))
        );
        data.isGroup = 'true';
      }

      const [hours, minutes] = timeOfDay.split(':').map(Number);
      const [year, month, day] = date.split('-').map(Number);
      const triggerDate = new Date(year, month - 1, day, hours, minutes, 0, 0);
      if (!pendingKeys.has(baseKey) && triggerDate.getTime() > Date.now()) {
        await scheduleReminder(body, triggerDate, data, categoryIdentifier);
      }

      // Checked per key, not per dose: enabling repeats mid-day must still add
      // the repeat pings behind an already-pending base reminder.
      if (withRepeats) {
        for (const offset of REPEAT_MINUTES) {
          const repeatKey = repeatMedReminderKey(baseKey, offset);
          if (pendingKeys.has(repeatKey)) continue;
          const repeatDate = new Date(triggerDate.getTime() + offset * 60000);
          if (repeatDate.getTime() > Date.now()) {
            await scheduleReminder(
              body,
              repeatDate,
              {
                ...data,
                key: repeatKey,
              },
              categoryIdentifier
            );
          }
        }
      }
    }
  } finally {
    schedulingLock.delete('medication-reminders');
  }
}
