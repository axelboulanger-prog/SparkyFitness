import type { RecordedPoint, RecordingActivity } from './gpsRecording';

/**
 * A walk or run the watch recorded on its own, as it arrives over the watch
 * connection. Route fixes and heart-rate readings are packed as number arrays
 * because the connection carries property lists and a long run has thousands.
 */
export interface WatchRunPayload {
  /** The id the watch stamped on its Apple Health workout. */
  clientId: string;
  kind: 'walk' | 'run';
  place: 'indoor' | 'outdoor';
  /** Epoch ms. */
  startedAt: number;
  endedAt: number;
  /** Clock time with pauses removed, from the workout builder. */
  activeSeconds: number;
  distanceMeters: number;
  activeEnergyKcal: number;
  /** `[t (epoch ms), lat, lon, alt, hacc, seg]`; `alt` is `NO_ALTITUDE` when unknown. */
  route: number[][];
  /** `[t (epoch ms), bpm]`. */
  heartRate: number[][];
  /** Epoch ms of each Lap press on the watch, oldest first. */
  laps: number[];
}

/** Stands in for "no altitude": a property list cannot carry null. */
export const WATCH_NO_ALTITUDE = -9999;

const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/**
 * Checks a payload from the wire and returns it cleaned, or null when it is
 * unusable. Drops malformed route and heart-rate rows rather than failing the
 * whole run, since the activity itself is still worth logging.
 */
export function parseWatchRunPayload(raw: unknown): WatchRunPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;
  if (typeof p.clientId !== 'string' || p.clientId.length === 0) return null;
  if (p.kind !== 'walk' && p.kind !== 'run') return null;
  if (p.place !== 'indoor' && p.place !== 'outdoor') return null;
  if (!finite(p.startedAt) || !finite(p.endedAt) || p.endedAt < p.startedAt) {
    return null;
  }
  const rows = (value: unknown, width: number): number[][] =>
    Array.isArray(value)
      ? value.filter(
          (row): row is number[] =>
            Array.isArray(row) &&
            row.length >= width &&
            row.slice(0, width).every(finite)
        )
      : [];
  return {
    clientId: p.clientId,
    kind: p.kind,
    place: p.place,
    startedAt: p.startedAt,
    endedAt: p.endedAt,
    activeSeconds: finite(p.activeSeconds) ? Math.max(0, p.activeSeconds) : 0,
    distanceMeters: finite(p.distanceMeters)
      ? Math.max(0, p.distanceMeters)
      : 0,
    activeEnergyKcal: finite(p.activeEnergyKcal)
      ? Math.max(0, p.activeEnergyKcal)
      : 0,
    route: rows(p.route, 6),
    heartRate: rows(p.heartRate, 2),
    laps: Array.isArray(p.laps)
      ? p.laps.filter(finite).sort((a, b) => a - b)
      : [],
  };
}

export function watchRunActivity(payload: WatchRunPayload): RecordingActivity {
  return payload.kind;
}

/** The route as the recorder's own point type, for splits and the upload. */
export function watchRunPoints(payload: WatchRunPayload): RecordedPoint[] {
  return payload.route
    .map(([t, lat, lon, alt, hacc, seg]) => ({
      t,
      lat,
      lon,
      alt: alt === WATCH_NO_ALTITUDE ? null : alt,
      hacc: hacc >= 0 ? hacc : null,
      vacc: null,
      speed: null,
      course: null,
      seg,
    }))
    .sort((a, b) => a.t - b.t);
}
