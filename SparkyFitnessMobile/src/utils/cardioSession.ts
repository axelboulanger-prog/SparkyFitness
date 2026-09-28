import type {
  ExerciseEntryHrZones,
  GpsTrackPoint,
  WorkoutHeartRatePoint,
} from '@workspace/shared';

/** Trackpoints kept when drawing a route; plenty for a phone-width figure. */
const MAX_ROUTE_POINTS = 1500;

export interface ProjectedRoute {
  /** SVG path data in a `width` × `height` box. */
  d: string;
  start: { x: number; y: number };
  end: { x: number; y: number };
}

/**
 * Projects a GPS track into a box for drawing without map tiles. Longitude
 * is scaled by the cosine of the mean latitude so the shape is not stretched
 * east-west, and the route is centered and fit with its aspect kept.
 * Returns null for fewer than two usable points.
 */
export function projectRoute(
  points: readonly Pick<GpsTrackPoint, 'lat' | 'lon'>[],
  width: number,
  height: number,
  padding = 12
): ProjectedRoute | null {
  // 0,0 is what a sensor reports before it has a fix, not a place.
  const usable = points.filter(
    (p) =>
      Number.isFinite(p.lat) &&
      Number.isFinite(p.lon) &&
      !(p.lat === 0 && p.lon === 0)
  );
  if (usable.length < 2) return null;

  const step = Math.ceil(usable.length / MAX_ROUTE_POINTS);
  const sampled = usable.filter(
    (_, index) => index % step === 0 || index === usable.length - 1
  );

  const meanLat = sampled.reduce((sum, p) => sum + p.lat, 0) / sampled.length;
  const lonScale = Math.cos((meanLat * Math.PI) / 180);
  const xs = sampled.map((p) => p.lon * lonScale);
  const ys = sampled.map((p) => -p.lat);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const spanX = maxX - minX;
  const spanY = maxY - minY;
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const scale =
    spanX === 0 && spanY === 0
      ? 1
      : Math.min(
          spanX > 0 ? innerW / spanX : Infinity,
          spanY > 0 ? innerH / spanY : Infinity
        );
  const offsetX = padding + (innerW - spanX * scale) / 2;
  const offsetY = padding + (innerH - spanY * scale) / 2;

  const projected = xs.map((x, index) => ({
    x: offsetX + (x - minX) * scale,
    y: offsetY + ((ys[index] ?? 0) - minY) * scale,
  }));
  const d = projected
    .map(
      (p, index) =>
        `${index === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`
    )
    .join(' ');
  return {
    d,
    start: projected[0] ?? { x: 0, y: 0 },
    end: projected[projected.length - 1] ?? { x: 0, y: 0 },
  };
}

/** Heart rate recorded on the trackpoints themselves, in time order. */
export function gpsHeartRateSeries(
  points: readonly GpsTrackPoint[]
): WorkoutHeartRatePoint[] {
  const series = points
    .filter((p) => typeof p.hr === 'number' && p.hr > 0)
    .map((p) => ({
      timestamp: Date.parse(p.t),
      bpm: p.hr as number,
      elapsedMinutes: 0,
    }))
    .filter((p) => Number.isFinite(p.timestamp))
    .sort((a, b) => a.timestamp - b.timestamp);
  const start = series[0]?.timestamp;
  if (start != null) {
    for (const point of series) {
      point.elapsedMinutes = (point.timestamp - start) / 60_000;
    }
  }
  return series;
}

export interface HeartRateZoneRow {
  zone: number;
  lowerBpm: number | null;
  upperBpm: number | null;
  seconds: number;
  /** Share of the time spent across all zones, 0-1. */
  share: number;
}

export function heartRateZoneRows(
  zones: readonly ExerciseEntryHrZones[]
): HeartRateZoneRow[] {
  const total = zones.reduce(
    (sum, zone) => sum + Math.max(0, zone.seconds_in_zone),
    0
  );
  return [...zones]
    .sort((a, b) => a.zone_index - b.zone_index)
    .map((zone) => ({
      zone: zone.zone_index,
      lowerBpm: zone.zone_lower_bpm,
      upperBpm: zone.zone_upper_bpm,
      seconds: Math.max(0, zone.seconds_in_zone),
      share: total > 0 ? Math.max(0, zone.seconds_in_zone) / total : 0,
    }));
}
