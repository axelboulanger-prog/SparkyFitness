import { log } from '../config/logging.js';
import exerciseRepository from '../models/exercise.js';
import exerciseEntryRepository, {
  type WatchTelemetryFields,
  type WatchTelemetryZoneSpec,
} from '../models/exerciseEntry.js';
import workoutPresetRepository from '../models/workoutPresetRepository.js';
import activityDetailsRepository from '../models/activityDetailsRepository.js';
import preferenceRepository from '../models/preferenceRepository.js';
import userRepository from '../models/userRepository.js';
import { parseISO, isValid } from 'date-fns';
import {
  setsDurationMinutes,
  type HeartRateSampleRequest,
} from '@workspace/shared';
import {
  computeHrZones,
  resolveMaxHr,
  type HrSample,
} from './hrZoneCalculator.js';
async function importExerciseEntriesFromCsv(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  authenticatedUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  actingUserId: any,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  entries: any
) {
  let createdCount = 0;
  const updatedCount = 0;
  let failedCount = 0;
  const failedEntries = [];
  for (const entryGroup of entries) {
    try {
      // 1. Validate and use the already formatted date
      const entryDate = entryGroup.entry_date;
      // Ensure the date string is valid by attempting to parse it as ISO.
      // The frontend now sends yyyy-MM-dd, which is a valid ISO subset.
      if (!isValid(parseISO(entryDate))) {
        throw new Error(
          `Invalid date: ${entryDate}. Expected yyyy-MM-dd format.`
        );
      }
      // 2. Lookup or Create Exercise
      let exercise = await exerciseRepository.findExerciseByNameAndUserId(
        entryGroup.exercise_name,
        authenticatedUserId
      );
      if (!exercise) {
        log(
          'debug',
          `Creating new exercise from CSV for user ${authenticatedUserId}. entryGroup:`,
          entryGroup
        );
        const newExerciseData = {
          user_id: authenticatedUserId,
          name: entryGroup.exercise_name,
          is_custom: true,
          shared_with_public: false,
          source: entryGroup.exercise_source || 'CSV_Import', // Use provided source or default
          category: entryGroup.exercise_category,
          calories_per_hour: entryGroup.calories_per_hour
            ? parseFloat(entryGroup.calories_per_hour)
            : undefined,
          description: entryGroup.exercise_description,
          force: entryGroup.exercise_force,
          level: entryGroup.exercise_level,
          mechanic: entryGroup.exercise_mechanic,
          equipment:
            entryGroup.exercise_equipment &&
            entryGroup.exercise_equipment.length > 0
              ? entryGroup.exercise_equipment
              : undefined,
          primary_muscles:
            entryGroup.primary_muscles && entryGroup.primary_muscles.length > 0
              ? entryGroup.primary_muscles
              : undefined,
          secondary_muscles:
            entryGroup.secondary_muscles &&
            entryGroup.secondary_muscles.length > 0
              ? entryGroup.secondary_muscles
              : undefined,
          instructions:
            entryGroup.instructions && entryGroup.instructions.length > 0
              ? entryGroup.instructions
              : undefined,
          // Images are not typically imported via CSV for exercise definitions
        };
        log(
          'debug',
          'Calling createExercise with newExerciseData:',
          newExerciseData
        );
        exercise = await exerciseRepository.createExercise(newExerciseData);
      }
      // 3. Lookup or Create Workout Preset (if preset_name is provided)
      // 3. Convert Distance and Weight based on user preferences and process sets
      const preferences =
        await preferenceRepository.getUserPreferences(authenticatedUserId);
      const distanceUnit = preferences?.default_distance_unit || 'km'; // Default to km
      const weightUnit = preferences?.default_weight_unit || 'kg'; // Default to kg
      let distanceInKm = entryGroup.distance;
      if (distanceInKm !== undefined && distanceInKm !== null) {
        if (distanceUnit === 'miles') {
          distanceInKm = parseFloat(distanceInKm) * 1.60934; // Convert miles to km
        } else {
          distanceInKm = parseFloat(distanceInKm);
        }
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const setsWithConvertedWeight = entryGroup.sets.map((set: any) => {
        let weightInKg = set.weight;
        if (weightInKg !== undefined && weightInKg !== null) {
          if (weightUnit === 'lbs') {
            weightInKg = parseFloat(weightInKg) * 0.453592; // Convert lbs to kg
          } else {
            weightInKg = parseFloat(weightInKg);
          }
        }
        return {
          ...set,
          weight: weightInKg,
          // CSV duration_min is minutes; stored per-set duration is integer seconds.
          duration:
            set.duration_min !== null && set.duration_min !== undefined
              ? Math.round(Number(set.duration_min) * 60)
              : null,
          rest_time: set.rest_time_sec, // Map frontend rest_time_sec to backend rest_time
        };
      });
      const totalDurationMinutes = setsDurationMinutes(setsWithConvertedWeight);
      // 4. Lookup or Create Workout Preset (if preset_name is provided)
      let workoutPresetId = null; // Initialize workoutPresetId once
      if (entryGroup.preset_name) {
        let workoutPreset =
          await workoutPresetRepository.getWorkoutPresetByName(
            authenticatedUserId,
            entryGroup.preset_name
          );
        if (!workoutPreset) {
          log(
            'debug',
            `Creating new workout preset from CSV for user ${authenticatedUserId}. preset_name: ${entryGroup.preset_name}`
          );
          // Create new workout preset and its exercises/sets from current entryGroup
          workoutPreset = await workoutPresetRepository.createWorkoutPreset({
            user_id: authenticatedUserId,
            name: entryGroup.preset_name,
            description: 'Auto-created from CSV import',
            is_public: false,
            exercises: [
              {
                exercise_id: exercise.id,
                image_url: null, // CSV doesn't provide exercise image for preset def
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                sets: setsWithConvertedWeight.map((set: any) => ({
                  // Use the processed sets
                  set_number: set.set_number,

                  set_type: set.set_type,
                  reps: set.reps,
                  weight: set.weight,
                  duration: set.duration,
                  rest_time: set.rest_time,
                  notes: set.notes,
                })),
              },
            ],
          });
        } else {
          log(
            'debug',
            `Linking to existing workout preset from CSV for user ${authenticatedUserId}. preset_name: ${entryGroup.preset_name}`
          );
        }
        workoutPresetId = workoutPreset.id;
      }
      // 5. Create Exercise Entry
      const newEntry = await exerciseEntryRepository.createExerciseEntry(
        authenticatedUserId,
        {
          exercise_id: exercise.id,
          duration_minutes: totalDurationMinutes || 0, // Sum of set durations
          calories_burned: entryGroup.calories_burned || 0, // Default to 0 if not provided
          entry_date: entryDate,
          notes: entryGroup.entry_notes,
          sets: setsWithConvertedWeight,
          distance: distanceInKm,
          avg_heart_rate: entryGroup.avg_heart_rate,
          exercise_preset_entry_id: workoutPresetId, // Link to preset if created/found
        },
        actingUserId,
        'CSV_Import'
      ); // Add source and actingUserId
      // 6. Create Activity Details
      if (
        entryGroup.activity_details &&
        entryGroup.activity_details.length > 0
      ) {
        for (const detail of entryGroup.activity_details) {
          await activityDetailsRepository.createActivityDetail(
            authenticatedUserId,
            {
              exercise_entry_id: newEntry.id,
              provider_name: 'CSV_Import_Custom',
              detail_type: detail.field_name,
              detail_data: detail.value,
              created_by_user_id: actingUserId,
              updated_by_user_id: actingUserId,
            }
          );
        }
      }
      createdCount++;
    } catch (error) {
      log(
        'error',
        `Error processing imported exercise entry for user ${authenticatedUserId}: ${entryGroup.exercise_name} on ${entryGroup.entry_date}`,
        error
      );
      failedCount++;
      // @ts-expect-error TS(2571): Object is of type 'unknown'.
      failedEntries.push({ entry: entryGroup, reason: error.message });
    }
  }
  if (failedEntries.length > 0) {
    const error = new Error('Some entries failed to import.');
    // @ts-expect-error TS(2339): Property 'status' does not exist on type 'Error'.
    error.status = 409; // Conflict or Partial Content
    // @ts-expect-error TS(2339): Property 'details' does not exist on type 'Error'.
    error.details = { createdCount, updatedCount, failedCount, failedEntries };
    throw error;
  }
  return {
    message: 'Historical exercise entries imported successfully.',
    created: createdCount,
    updated: updatedCount,
    failed: failedCount,
  };
}
/**
 * Attaches what a paired Apple Watch measured during a live workout to an
 * exercise entry that already exists — created by the live-workout
 * start/reconcile flow before any of this was known. Unlike the
 * HealthKit/Health Connect/Garmin sync path (healthDataHandlers.ts's
 * persistWorkoutTelemetry), this never creates the entry itself, so it
 * recomputes the zone breakdown directly with the same hrZoneCalculator
 * rather than routing through that entry-creating function.
 *
 * `activeEnergyKcal` overwrites `calories_burned`, which the server otherwise
 * derives from duration and sets. A watch on the wearer's wrist measured it;
 * the derivation is a formula, so the measurement wins.
 */
async function attachWatchTelemetryToExerciseEntry(
  userId: string,
  actingUserId: string,
  exerciseEntryId: string,
  hrSamples: HeartRateSampleRequest[] | undefined,
  activeEnergyKcal?: number,
  durationMinutes?: number
): Promise<void> {
  // Fail closed: family/delegate diary *read* can SELECT another user's
  // entry via RLS, but this route must not 204 after an UPDATE that
  // matches zero rows, or write HR zones under the caller's user_id onto
  // someone else's workout. Same owner check as getExerciseEntryById.
  const ownerId = await exerciseEntryRepository.getExerciseEntryOwnerId(
    exerciseEntryId,
    userId
  );
  if (!ownerId || ownerId !== userId) {
    const error = new Error('Exercise entry not found.');
    // @ts-expect-error TS(2339): Property 'status' does not exist on type 'Error'.
    error.status = 404;
    throw error;
  }

  // Only the fields supplied are written — the model does a partial UPDATE,
  // so a post carrying just calories must not blank out heart rate that an
  // earlier post already attached.
  const fields: WatchTelemetryFields = {};
  if (hrSamples && hrSamples.length > 0) {
    const bpmValues = hrSamples.map((s) => s.bpm);
    fields.avg_heart_rate = Math.round(
      bpmValues.reduce((sum, bpm) => sum + bpm, 0) / bpmValues.length
    );
    fields.max_heart_rate = Math.round(
      bpmValues.reduce((max, bpm) => (bpm > max ? bpm : max), -Infinity)
    );
    const observedMs = hrSamples
      .map((sample) => Date.parse(sample.t))
      .filter((ms) => Number.isFinite(ms))
      .reduce((max, ms) => (ms > max ? ms : max), -Infinity);
    if (Number.isFinite(observedMs)) {
      fields.watch_telemetry_observed_at = new Date(observedMs).toISOString();
    }
  }
  if (activeEnergyKcal !== undefined) {
    const measured = Math.round(activeEnergyKcal);
    // Written to both columns on purpose. `calories_burned` is what the diary
    // adds up; `active_calories` is a telemetry column the ordinary entry
    // update preserves, so it survives a later edit and is how that edit
    // knows these calories were measured rather than derived.
    fields.calories_burned = measured;
    fields.active_calories = measured;
  }
  if (typeof durationMinutes === 'number' && durationMinutes > 0) {
    fields.duration_minutes = Math.round(durationMinutes * 100) / 100;
  }

  // Zones need the series; a calories-only post has nothing to bucket.
  // Stale-snapshot rejection (and the zone write) happens under FOR UPDATE
  // inside applyWatchTelemetryAtomically so two in-flight flushes cannot
  // both pass the check against the same pre-lock row.
  let zones: WatchTelemetryZoneSpec[] | null = null;
  if (hrSamples && hrSamples.length > 0) {
    const samples: HrSample[] = hrSamples;
    // The same date of birth the sync path reads (healthDataHandlers.ts's
    // persistWorkoutTelemetry). Without it this path fell back to the observed
    // sample max, so one user's zones depended on where the workout came from:
    // a 55-year-old got a 190 ceiling from the wrist and 176 from a synced
    // copy of the same session, shifting every zone floor between them.
    const profile = await userRepository.getUserProfile(userId);
    const { maxHr } = resolveMaxHr(profile?.date_of_birth, samples);
    zones = computeHrZones(samples, maxHr);
  }

  await exerciseEntryRepository.applyWatchTelemetryAtomically(
    exerciseEntryId,
    userId,
    actingUserId,
    fields,
    zones
  );
}

export { importExerciseEntriesFromCsv, attachWatchTelemetryToExerciseEntry };
export default {
  importExerciseEntriesFromCsv,
  attachWatchTelemetryToExerciseEntry,
};
