/**
 * SQL mirror of `effectiveLoadKg` / `bodyWeightOnDay` in @workspace/shared,
 * for volume sums done in the database. Keep the two in step: a bodyweight
 * set (`bodyweight_reps`) moves the lifter's body weight plus its signed
 * weight, floored at zero, and with no reading at all only its weight.
 */

/**
 * `LEFT JOIN LATERAL` giving `bw.weight`: the latest check-in weight on or
 * before the entry's day, else the earliest one after it, else null. Uses the
 * `(user_id, entry_date)` unique index on check_in_measurements.
 */
export function bodyWeightJoinSql(entryAlias: string): string {
  return `
      LEFT JOIN LATERAL (
        SELECT COALESCE(
          (SELECT cim.weight FROM public.check_in_measurements cim
            WHERE cim.user_id = ${entryAlias}.user_id AND cim.weight > 0
              AND cim.entry_date <= ${entryAlias}.entry_date
            ORDER BY cim.entry_date DESC LIMIT 1),
          (SELECT cim.weight FROM public.check_in_measurements cim
            WHERE cim.user_id = ${entryAlias}.user_id AND cim.weight > 0
              AND cim.entry_date > ${entryAlias}.entry_date
            ORDER BY cim.entry_date ASC LIMIT 1)
        ) AS weight
      ) bw ON true`;
}

/** The load one set moved, given `bw` from `bodyWeightJoinSql`. */
export function setLoadSql(entryAlias: string, setAlias: string): string {
  return `CASE WHEN ${entryAlias}.modality = 'bodyweight_reps'
          THEN GREATEST(0, COALESCE(bw.weight, 0) + COALESCE(${setAlias}.weight, 0))
          ELSE ${setAlias}.weight END`;
}
