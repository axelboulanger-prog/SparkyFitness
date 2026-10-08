import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as QuickActions from 'expo-quick-actions';
import { Platform } from 'react-native';
import Toast from 'react-native-toast-message';
import {
  drainQuickActionNavigation,
  quickActionItems,
  runQuickAction,
  useQuickActions,
} from '../../src/hooks/useQuickActions';
import {
  changeWaterIntake,
  fetchWaterContainers,
} from '../../src/services/api/measurementsApi';
import { navigationRef } from '../../src/components/ActiveWorkoutBar';
import { DEFAULT_WATER_CONTAINER_ID } from '../../src/hooks/useWaterIntakeMutation';

jest.mock('expo-quick-actions', () => ({
  setItems: jest.fn(() => Promise.resolve()),
  addListener: jest.fn(() => ({ remove: jest.fn() })),
  initial: undefined,
}));
jest.mock('react-native-toast-message', () => ({ show: jest.fn() }));
jest.mock('../../src/services/api/measurementsApi', () => ({
  changeWaterIntake: jest.fn(),
  fetchWaterContainers: jest.fn(),
}));
jest.mock('../../src/services/LogService', () => ({ addLog: jest.fn() }));
jest.mock('../../src/components/ActiveWorkoutBar', () => ({
  navigationRef: { isReady: jest.fn(() => true), navigate: jest.fn() },
}));

describe('quickActionItems', () => {
  it('gives every shortcut a readable title', () => {
    const titles = quickActionItems().map((item) => item.title);
    expect(titles).toEqual(['Scan food', 'Log food', 'Log water', 'Fasting']);
  });
});

describe('runQuickAction', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the scanner, search and fasting screens', () => {
    runQuickAction('scan-food');
    runQuickAction('search-food');
    runQuickAction('fasting');
    expect(navigationRef.navigate).toHaveBeenNthCalledWith(1, 'FoodScan');
    expect(navigationRef.navigate).toHaveBeenNthCalledWith(2, 'FoodSearch');
    expect(navigationRef.navigate).toHaveBeenNthCalledWith(3, 'FastingDetail');
  });

  it('logs one drink of the primary container', async () => {
    (fetchWaterContainers as jest.Mock).mockResolvedValue([
      { id: 1, is_primary: false },
      { id: 2, is_primary: true },
    ]);
    runQuickAction('log-water');
    await waitFor(() =>
      expect(changeWaterIntake).toHaveBeenCalledWith(
        expect.objectContaining({ changeDrinks: 1, containerId: 2 })
      )
    );
  });

  it('logs one drink of the fallback container when none are saved', async () => {
    (fetchWaterContainers as jest.Mock).mockResolvedValue([]);
    runQuickAction('log-water');
    await waitFor(() =>
      expect(changeWaterIntake).toHaveBeenCalledWith(
        expect.objectContaining({
          changeDrinks: 1,
          containerId: DEFAULT_WATER_CONTAINER_ID,
        })
      )
    );
  });

  it('shows an error toast when logging water fails', async () => {
    (fetchWaterContainers as jest.Mock).mockRejectedValue(new Error('offline'));
    runQuickAction('log-water');
    await waitFor(() =>
      expect(Toast.show).toHaveBeenCalledWith({
        type: 'error',
        text1: 'Could not log water',
      })
    );
    expect(changeWaterIntake).not.toHaveBeenCalled();
  });

  it('opens a screen once navigation is ready', () => {
    (navigationRef.isReady as jest.Mock)
      .mockReturnValueOnce(false)
      .mockReturnValueOnce(true);
    runQuickAction('scan-food');
    expect(navigationRef.navigate).not.toHaveBeenCalled();
    drainQuickActionNavigation();
    expect(navigationRef.navigate).toHaveBeenCalledWith('FoodScan');
  });

  it('ignores unknown actions', () => {
    runQuickAction('nope');
    expect(navigationRef.navigate).not.toHaveBeenCalled();
  });
});

describe('useQuickActions', () => {
  const originalOS = Platform.OS;

  beforeEach(() => jest.clearAllMocks());

  afterEach(() => {
    Object.defineProperty(Platform, 'OS', {
      get: () => originalOS,
      configurable: true,
    });
    (QuickActions as { initial?: { id: string } }).initial = undefined;
  });

  it('logs a launch drink only once when the effect reruns', async () => {
    Object.defineProperty(Platform, 'OS', {
      get: () => 'ios',
      configurable: true,
    });
    (QuickActions as { initial?: { id: string } }).initial = {
      id: 'log-water',
    };
    (fetchWaterContainers as jest.Mock).mockResolvedValue([
      { id: 2, is_primary: true },
    ]);

    const { rerender } = renderHook(
      ({ enabled }: { enabled: boolean }) => useQuickActions(enabled),
      { initialProps: { enabled: true } }
    );

    await waitFor(() => expect(changeWaterIntake).toHaveBeenCalledTimes(1));

    rerender({ enabled: false });
    rerender({ enabled: true });

    await act(async () => {
      await Promise.resolve();
    });

    expect(changeWaterIntake).toHaveBeenCalledTimes(1);
  });
});
