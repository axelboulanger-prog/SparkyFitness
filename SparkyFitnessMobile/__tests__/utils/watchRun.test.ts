import {
  parseWatchRunPayload,
  watchRunPoints,
  WATCH_NO_ALTITUDE,
} from '../../src/utils/watchRun';

const base = {
  clientId: 'abc',
  kind: 'walk',
  place: 'outdoor',
  startedAt: 1_000,
  endedAt: 2_000_000,
  activeSeconds: 1800,
  distanceMeters: 2500,
  activeEnergyKcal: 120,
  route: [
    [2000, 51.5, -0.12, WATCH_NO_ALTITUDE, 5, 0],
    [1000, 51.501, -0.12, 12, -1, 0],
    [3000, 'bad'],
  ],
  heartRate: [[1000, 110], [2000]],
};

describe('parseWatchRunPayload', () => {
  test('keeps good rows and drops malformed ones', () => {
    const parsed = parseWatchRunPayload(base);
    expect(parsed?.route).toHaveLength(2);
    expect(parsed?.heartRate).toEqual([[1000, 110]]);
  });

  test('keeps lap marks in order and drops junk', () => {
    expect(
      parseWatchRunPayload({ ...base, laps: [3000, 'x', 1000] })?.laps
    ).toEqual([1000, 3000]);
    expect(parseWatchRunPayload(base)?.laps).toEqual([]);
  });

  test.each([
    [null],
    [{ ...base, clientId: '' }],
    [{ ...base, kind: 'ride' }],
    [{ ...base, place: 'pool' }],
    [{ ...base, endedAt: 1 }],
  ])('rejects an unusable payload %#', (raw) => {
    expect(parseWatchRunPayload(raw)).toBeNull();
  });

  test('defaults missing figures to zero', () => {
    const parsed = parseWatchRunPayload({
      ...base,
      activeSeconds: undefined,
      distanceMeters: -4,
      route: undefined,
    });
    expect(parsed?.activeSeconds).toBe(0);
    expect(parsed?.distanceMeters).toBe(0);
    expect(parsed?.route).toEqual([]);
  });
});

describe('watchRunPoints', () => {
  test('sorts by time and maps the sentinels to null', () => {
    const points = watchRunPoints(parseWatchRunPayload(base)!);
    expect(points.map((p) => p.t)).toEqual([1000, 2000]);
    expect(points[0].alt).toBe(12);
    expect(points[0].hacc).toBeNull();
    expect(points[1].alt).toBeNull();
    expect(points[1].hacc).toBe(5);
  });
});
