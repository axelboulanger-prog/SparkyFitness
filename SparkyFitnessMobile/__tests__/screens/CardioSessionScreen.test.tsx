import React from 'react';
import { render } from '@testing-library/react-native';
import type { ExerciseActivityQueryItem } from '@workspace/shared';

import CardioSessionScreen from '../../src/screens/CardioSessionScreen';
import { useCardioSessionDetail } from '../../src/hooks/useCardioSessionDetail';
import { initializeI18n } from '../../src/localization/i18n';
import type { RootStackScreenProps } from '../../src/types/navigation';

jest.mock('../../src/hooks/useCardioSessionDetail', () => ({
  useCardioSessionDetail: jest.fn(),
}));
const mockUseScreenHeader = jest.fn((_config: object) => null);
jest.mock('../../src/hooks/useScreenHeader', () => ({
  useScreenHeader: (config: object) => mockUseScreenHeader(config),
}));
jest.mock('../../src/services/nativeTabBarPreference', () => ({
  useNativeIOSHeadersActive: () => false,
}));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  useActiveWorkoutBarPadding: () => 0,
}));
jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('uniwind', () => ({
  useCSSVariable: (keys: string | string[]) =>
    Array.isArray(keys) ? keys.map(() => '#111827') : '#111827',
  useUniwind: () => ({ theme: 'light' }),
}));
// The chart draws with Skia; its data handling is covered by the hook tests.
jest.mock('../../src/components/exerciseStats/HeartRateChart', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ data }: { data: unknown[] }) => (
      <View testID="heart-rate-chart" accessibilityHint={String(data.length)} />
    ),
  };
});

const mockDetail = useCardioSessionDetail as jest.MockedFunction<
  typeof useCardioSessionDetail
>;
type Detail = ReturnType<typeof useCardioSessionDetail>;

const SESSION = {
  id: 'run-1',
  exerciseName: 'Morning Run',
  entryDate: '2026-09-26',
  distanceFormatted: 5.2,
  durationMinutes: 31,
  formattedPace: '5:58 /km',
  avgHeartRate: 148.4,
  caloriesBurned: 402,
} as ExerciseActivityQueryItem;

function detail(overrides: Partial<Detail> = {}): Detail {
  return {
    route: [
      { t: '2026-09-26T07:00:00Z', lat: 51.5, lon: -0.1 },
      { t: '2026-09-26T07:10:00Z', lat: 51.51, lon: -0.11 },
    ],
    heartRate: [
      { timestamp: 0, bpm: 130, elapsedMinutes: 0 },
      { timestamp: 60_000, bpm: 170, elapsedMinutes: 1 },
    ],
    zones: [
      { zone: 1, lowerBpm: 100, upperBpm: 120, seconds: 600, share: 0.4 },
      { zone: 2, lowerBpm: 120, upperBpm: 140, seconds: 900, share: 0.6 },
    ],
    isRouteLoading: false,
    isHeartRateLoading: false,
    isZonesLoading: false,
    isError: false,
    ...overrides,
  } as Detail;
}

const props = (session = SESSION) =>
  ({
    navigation: {},
    route: {
      key: 'CardioSession',
      name: 'CardioSession',
      params: { session, distanceUnit: 'km' },
    },
  }) as unknown as RootStackScreenProps<'CardioSession'>;

describe('CardioSessionScreen', () => {
  beforeAll(async () => {
    await initializeI18n('en');
  });

  it('shows the session stats, route, heart rate, and zones', () => {
    mockDetail.mockReturnValue(detail());
    const screen = render(<CardioSessionScreen {...props()} />);
    expect(mockDetail).toHaveBeenCalledWith('run-1', '2026-09-26');
    expect(screen.getByText('5.2 km')).toBeTruthy();
    expect(screen.getByText('5:58 /km')).toBeTruthy();
    expect(screen.getByText('148 bpm')).toBeTruthy();
    expect(
      screen.getByLabelText(
        'Route of this workout, from the green dot to the red ring'
      )
    ).toBeTruthy();
    expect(screen.getByTestId('heart-rate-chart')).toBeTruthy();
    expect(screen.getByText('Avg 150 bpm')).toBeTruthy();
    expect(screen.getByText('Max 170 bpm')).toBeTruthy();
    expect(screen.getByText('Heart Rate Zones')).toBeTruthy();
    expect(screen.getByText('15 min')).toBeTruthy();
  });

  it('titles the native header with the workout name', () => {
    mockDetail.mockReturnValue(detail());
    render(<CardioSessionScreen {...props()} />);
    expect(mockUseScreenHeader).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Morning Run',
        nativeTitle: 'Morning Run',
      })
    );
  });

  it('shows a brief zone as under a minute, not zero', () => {
    mockDetail.mockReturnValue(
      detail({
        zones: [
          { zone: 2, lowerBpm: 116, upperBpm: 134, seconds: 20, share: 0.02 },
          { zone: 4, lowerBpm: 154, upperBpm: 173, seconds: 1020, share: 0.98 },
        ],
      })
    );
    const screen = render(<CardioSessionScreen {...props()} />);
    expect(screen.getByText('<1 min')).toBeTruthy();
    expect(screen.getByText('17 min')).toBeTruthy();
    expect(screen.queryByText('0 min')).toBeNull();
  });

  it('explains a missing route and still shows heart rate', () => {
    mockDetail.mockReturnValue(detail({ route: [], zones: [] }));
    const screen = render(<CardioSessionScreen {...props()} />);
    expect(screen.getByText(/No GPS route stored/)).toBeTruthy();
    expect(screen.getByTestId('heart-rate-chart')).toBeTruthy();
    expect(screen.queryByText('Heart Rate Zones')).toBeNull();
  });

  it('falls back to the stored average without samples', () => {
    mockDetail.mockReturnValue(detail({ heartRate: [] }));
    const screen = render(<CardioSessionScreen {...props()} />);
    expect(screen.queryByTestId('heart-rate-chart')).toBeNull();
    expect(
      screen.getByText(
        'Average heart rate 148 bpm. Beat-by-beat samples were not stored.'
      )
    ).toBeTruthy();
  });
});
