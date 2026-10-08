import type {
  ExerciseEntryHrZones,
  GpsTrackPoint,
  IndividualSessionResponse,
} from '@workspace/shared';
import {
  cardioSessionFromDiaryEntry,
  gpsHeartRateSeries,
  combinedHeartRateZoneRows,
  heartRateZoneRows,
  projectRoute,
  routeRegion,
  usableRoutePoints,
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

describe('usableRoutePoints', () => {
  it('drops 0,0 and non-finite fixes and keeps order', () => {
    expect(
      usableRoutePoints([
        point(0, 0),
        point(51.5, -0.1),
        point(Number.NaN, 1),
        point(51.6, -0.2),
      ])
    ).toEqual([point(51.5, -0.1), point(51.6, -0.2)]);
  });

  it('drops fixes off the globe', () => {
    expect(
      usableRoutePoints([
        point(91, 0.5),
        point(51.5, -0.1),
        point(51.6, 181),
        point(51.6, -0.2),
      ])
    ).toEqual([point(51.5, -0.1), point(51.6, -0.2)]);
  });

  it('thins a long track and keeps its last point', () => {
    const track = Array.from({ length: 4000 }, (_, i) =>
      point(51 + i / 10000, 0.5)
    );
    const kept = usableRoutePoints(track);
    expect(kept.length).toBeLessThanOrEqual(1500);
    expect(kept[kept.length - 1]).toBe(track[track.length - 1]);
  });
});

describe('routeRegion', () => {
  it('centers on the route with a margin around it', () => {
    expect(routeRegion([point(51.5, -0.2), point(51.6, -0.1)])).toEqual({
      latitude: expect.closeTo(51.55),
      longitude: expect.closeTo(-0.15),
      latitudeDelta: expect.closeTo(0.13),
      longitudeDelta: expect.closeTo(0.13),
    });
  });

  it('frames a route over the date line narrowly, not around the globe', () => {
    const region = routeRegion([point(-17, 179.9), point(-17.1, -179.9)]);
    // ±180 is the same meridian.
    expect(Math.abs(region?.longitude ?? 0)).toBeCloseTo(180);
    expect(region?.longitudeDelta).toBeCloseTo(0.26);
  });

  it('frames the shortest arc when the points spread over the globe', () => {
    // Both the plain and the date-line span are 340°; the points leave a
    // 150° gap between -160 and -10, so they fit in 210°, from -10 east
    // through 170 to -160.
    const region = routeRegion(
      [-170, -160, -10, 10, 20, 170].map((lon) => point(10, lon))
    );
    expect(region?.longitudeDelta).toBeCloseTo(210 * 1.3);
    expect(region?.longitude).toBeCloseTo(95);
  });

  it('keeps the spans under a full turn for a route around the globe', () => {
    // A 288° arc plus the margin would be 374°; at 360° the region's edges
    // are one meridian and the map cannot fit it.
    const region = routeRegion(
      [-144, -72, 0, 72, 144].map((lon) => point(lon / 2, lon))
    );
    expect(region?.longitudeDelta).toBeLessThan(360);
    expect(region?.latitudeDelta).toBeLessThan(180);
  });

  it("keeps an ordinary route's plain span", () => {
    const region = routeRegion([point(51.5, -0.2), point(51.6, 0.1)]);
    expect(region?.longitude).toBeCloseTo(-0.05);
    expect(region?.longitudeDelta).toBeCloseTo(0.39);
  });

  it('keeps some context around a track that barely moves', () => {
    const region = routeRegion([point(51.5, -0.1), point(51.5, -0.1)]);
    expect(region?.latitudeDelta).toBe(0.002);
    expect(region?.longitudeDelta).toBe(0.002);
  });

  it('needs two usable points', () => {
    expect(routeRegion([point(0, 0), point(51.5, -0.1)])).toBeNull();
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

describe('combinedHeartRateZoneRows', () => {
  const zone = (
    index: number,
    seconds: number,
    lower: number | null,
    upper: number | null = null
  ) =>
    ({
      zone_index: index,
      zone_lower_bpm: lower,
      zone_upper_bpm: upper,
      seconds_in_zone: seconds,
    }) as ExerciseEntryHrZones;

  it('adds each zone up across entries and shares the total between them', () => {
    expect(
      combinedHeartRateZoneRows([
        [zone(2, 300, 120, 140), zone(1, 100, 100, 120)],
        [zone(2, 500, null, null), zone(3, 100, 140, 160)],
      ])
    ).toEqual([
      { zone: 1, lowerBpm: 100, upperBpm: 120, seconds: 100, share: 0.1 },
      { zone: 2, lowerBpm: 120, upperBpm: 140, seconds: 800, share: 0.8 },
      { zone: 3, lowerBpm: 140, upperBpm: 160, seconds: 100, share: 0.1 },
    ]);
  });

  it('ignores negative seconds and is empty for no entries', () => {
    expect(combinedHeartRateZoneRows([[zone(1, -50, 100)]])).toEqual([
      { zone: 1, lowerBpm: 100, upperBpm: null, seconds: 0, share: 0 },
    ]);
    expect(combinedHeartRateZoneRows([])).toEqual([]);
  });
});

describe('cardioSessionFromDiaryEntry', () => {
  const entry = (
    overrides: Partial<IndividualSessionResponse> = {}
  ): IndividualSessionResponse =>
    ({
      type: 'individual',
      id: 'e1',
      name: 'Stair Climbing',
      entry_date: '2026-10-01',
      entry_time: '07:30:00',
      duration_minutes: 20,
      calories_burned: 150,
      avg_heart_rate: 128,
      distance: 2,
      source: 'apple_health',
      notes: null,
      category: null,
      sets: [],
      exercise_snapshot: null,
      ...overrides,
    }) as IndividualSessionResponse;

  it('maps a synced workout, converting distance to the display unit', () => {
    const item = cardioSessionFromDiaryEntry(entry(), 'miles');
    expect(item).toMatchObject({
      id: 'e1',
      exerciseName: 'Stair Climbing',
      entryDate: '2026-10-01',
      durationMinutes: 20,
      avgHeartRate: 128,
      distanceMeters: 2000,
    });
    expect(item!.distanceFormatted).toBeCloseTo(1.243, 2);
  });

  it('leaves in-app entries on the basic screen', () => {
    for (const source of [
      'manual',
      'Manual',
      'sparky',
      'workout plan',
      null,
      undefined,
    ]) {
      expect(cardioSessionFromDiaryEntry(entry({ source }), 'km')).toBeNull();
    }
  });

  it('titles a nameless synced workout', () => {
    const item = cardioSessionFromDiaryEntry(
      entry({ name: null, category: null, exercise_snapshot: null }),
      'km'
    );
    expect(item?.exerciseName).toBe('Workout');
  });

  it('leaves strength sessions on the basic screen', () => {
    const sets = [{ weight: 50, reps: 8 }] as IndividualSessionResponse['sets'];
    expect(cardioSessionFromDiaryEntry(entry({ sets }), 'km')).toBeNull();
  });

  it('leaves a weight_reps snapshot with no sets on the basic screen', () => {
    const exercise_snapshot = {
      modality: 'weight_reps',
    } as IndividualSessionResponse['exercise_snapshot'];
    expect(
      cardioSessionFromDiaryEntry(entry({ sets: [], exercise_snapshot }), 'km')
    ).toBeNull();
  });
});
