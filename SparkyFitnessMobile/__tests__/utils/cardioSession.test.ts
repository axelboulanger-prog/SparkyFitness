import type { ExerciseEntryHrZones, GpsTrackPoint } from '@workspace/shared';
import {
  gpsHeartRateSeries,
  heartRateZoneRows,
  projectRoute,
} from '../../src/utils/cardioSession';

const point = (lat: number, lon: number, t = '2026-09-20T12:00:00Z') =>
  ({ t, lat, lon }) as GpsTrackPoint;

describe('projectRoute', () => {
  it('fits the track in the box with padding and keeps its aspect', () => {
    const route = projectRoute(
      [point(0.001, 0.001), point(0.002, 0.001), point(0.002, 0.003)],
      200,
      100,
      10
    );
    expect(route).not.toBeNull();
    const coords = route!.d
      .split(' ')
      .map((part) => part.slice(1).split(',').map(Number));
    for (const [x, y] of coords) {
      expect(x).toBeGreaterThanOrEqual(10 - 0.1);
      expect(x).toBeLessThanOrEqual(190 + 0.1);
      expect(y).toBeGreaterThanOrEqual(10 - 0.1);
      expect(y).toBeLessThanOrEqual(90 + 0.1);
    }
    // North is up: the later, more northern point sits higher.
    expect(route!.end.y).toBeLessThan(route!.start.y);
  });

  it('ignores 0,0 fixes and needs two usable points', () => {
    expect(projectRoute([point(0, 0), point(51.5, -0.1)], 200, 100)).toBeNull();
    expect(projectRoute([], 200, 100)).toBeNull();
  });

  it('draws a track that never moves as a dot in the middle', () => {
    const route = projectRoute(
      [point(51.5, -0.1), point(51.5, -0.1)],
      200,
      100,
      10
    );
    expect(route!.start).toEqual({ x: 100, y: 50 });
  });
});

describe('gpsHeartRateSeries', () => {
  it('keeps trackpoints with heart rate, in time order', () => {
    const series = gpsHeartRateSeries([
      { ...point(1, 1, '2026-09-20T12:02:00Z'), hr: 150 },
      { ...point(1, 1, '2026-09-20T12:00:00Z'), hr: 120 },
      point(1, 1, '2026-09-20T12:01:00Z'),
    ]);
    expect(series.map((p) => [p.bpm, p.elapsedMinutes])).toEqual([
      [120, 0],
      [150, 2],
    ]);
  });
});

describe('heartRateZoneRows', () => {
  it('orders zones and gives each its share of the time', () => {
    const zone = (index: number, seconds: number) =>
      ({
        zone_index: index,
        zone_lower_bpm: 100 + index * 10,
        zone_upper_bpm: null,
        seconds_in_zone: seconds,
      }) as ExerciseEntryHrZones;
    expect(heartRateZoneRows([zone(2, 300), zone(1, 100)])).toEqual([
      { zone: 1, lowerBpm: 110, upperBpm: null, seconds: 100, share: 0.25 },
      { zone: 2, lowerBpm: 120, upperBpm: null, seconds: 300, share: 0.75 },
    ]);
  });
});
