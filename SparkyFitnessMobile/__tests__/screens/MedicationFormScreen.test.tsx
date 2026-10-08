import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { Alert } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { pressAction } from './helpers/nativeHeaderTestUtils';
import MedicationFormScreen from '../../src/screens/MedicationFormScreen';
import {
  useMedicationDetail,
  useCreateMedication,
  useUpdateMedication,
  useUpdateMedicationSchedule,
} from '../../src/hooks/useMedications';
import type { MedicationDetail } from '@workspace/shared';
import type { RootStackScreenProps } from '../../src/types/navigation';
import { formatLocalizedTimeOfDay } from '../../src/utils/medicationScheduleLocalization';

type ScreenProps = RootStackScreenProps<'MedicationForm'>;

jest.mock('../../src/hooks/useMedications', () => ({
  useMedicationDetail: jest.fn(),
  useCreateMedication: jest.fn(),
  useUpdateMedication: jest.fn(),
  useUpdateMedicationSchedule: jest.fn(),
}));

const mockEnsureCatalog = jest.fn();
jest.mock('../../src/hooks/useCustomNutrients', () => ({
  useCustomNutrients: () => ({ customNutrients: [] }),
  useEnsureCatalogNutrients: () => ({
    mutateAsync: mockEnsureCatalog,
    isPending: false,
  }),
}));

jest.mock('../../src/components/Icon', () => {
  const { View } = require('react-native');
  return {
    __esModule: true,
    default: ({ name }: { name: string }) => <View testID={`icon-${name}`} />,
  };
});

jest.mock('uniwind', () => ({
  useCSSVariable: (keys: string | string[]) =>
    Array.isArray(keys) ? keys.map(() => '#111827') : '#111827',
}));

jest.mock('../../src/components/BottomSheetPicker', () => {
  const React = require('react');
  const { Pressable, Text, View } = require('react-native');
  return {
    __esModule: true,
    default: ({
      options: optionsProp,
      sections,
      onSelect,
      value,
    }: {
      options?: { label: string; value: string }[];
      sections?: { options: { label: string; value: string }[] }[];
      onSelect: (value: string) => void;
      value: string;
    }) => {
      const options =
        optionsProp ?? (sections ?? []).flatMap((section) => section.options);
      return (
        <View>
          <Text>
            {options.find((option) => option.value === value)?.label ?? ''}
          </Text>
          {options.map((option) => (
            <Pressable
              key={option.value}
              onPress={() => onSelect(option.value)}
            >
              <Text>{`opt-${option.value}`}</Text>
            </Pressable>
          ))}
        </View>
      );
    },
  };
});

const mockNavigation = {
  setOptions: jest.fn(),
  goBack: jest.fn(),
  replace: jest.fn(),
  dispatch: jest.fn(),
  navigate: jest.fn(),
} as unknown as ScreenProps['navigation'];
jest.mock('@react-navigation/native', () => ({
  ...jest.requireActual('@react-navigation/native'),
  useNavigation: () => mockNavigation,
}));

const mockUseMedicationDetail = useMedicationDetail as jest.MockedFunction<
  typeof useMedicationDetail
>;
const mockUseCreateMedication = useCreateMedication as jest.MockedFunction<
  typeof useCreateMedication
>;
const mockUseUpdateSchedule =
  useUpdateMedicationSchedule as jest.MockedFunction<
    typeof useUpdateMedicationSchedule
  >;
const mockUseUpdateMedication = useUpdateMedication as jest.MockedFunction<
  typeof useUpdateMedication
>;

const mockUpdateScheduleAsync = jest.fn();
beforeEach(() => {
  mockUseUpdateSchedule.mockReturnValue({
    mutateAsync: mockUpdateScheduleAsync,
    isPending: false,
  } as unknown as ReturnType<typeof useUpdateMedicationSchedule>);
  mockUpdateScheduleAsync.mockReset().mockResolvedValue({});
});

const insets = { top: 0, bottom: 0, left: 0, right: 0 };
const frame = { x: 0, y: 0, width: 390, height: 844 };

const baseMed: MedicationDetail = {
  id: 'med-1',
  user_id: 'user-1',
  name: 'Lisinopril',
  display_name: null,
  type_id: 'pill',
  route_id: null,
  strength_value: 10,
  strength_unit: 'mg',
  dose_amount: 1,
  dose_unit: 'tablet',
  reason_text: 'Hypertension',
  effectiveness_rating: null,
  color: null,
  icon: null,
  photo_path: null,
  is_active: true,
  is_quick: false,
  is_glp1: false,
  notes: 'Take with food',
  source: 'manual',
  prescriber: 'Dr. Smith',
  pharmacy: 'Corner Pharmacy',
  custom_fields: {},
  created_at: '2026-01-01T00:00:00.000Z',
  updated_at: '2026-01-01T00:00:00.000Z',
  schedules: [],
};

const renderScreen = (medicationId?: string, isSupplement?: boolean) => {
  const route: ScreenProps['route'] = {
    key: 'MedicationForm-key',
    name: 'MedicationForm',
    params: medicationId
      ? { medicationId }
      : isSupplement
        ? { isSupplement }
        : {},
  };
  return render(
    <SafeAreaProvider initialMetrics={{ insets, frame }}>
      <MedicationFormScreen navigation={mockNavigation} route={route} />
    </SafeAreaProvider>
  );
};

describe('MedicationFormScreen — optional text fields', () => {
  const createMutate = jest.fn();
  const updateMutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    updateMutate.mockResolvedValue({ is_supplement: false, nutrients: {} });
    createMutate.mockResolvedValue({ id: 'new-1', nutrients: {} });
    mockUseMedicationDetail.mockReturnValue({
      data: baseMed,
    } as unknown as ReturnType<typeof useMedicationDetail>);
    mockUseCreateMedication.mockReturnValue({
      mutate: createMutate,
      mutateAsync: createMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateMedication>);
    mockUseUpdateMedication.mockReturnValue({
      mutate: updateMutate,
      mutateAsync: updateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateMedication>);
  });

  it('sends explicit null for cleared fields so the server clears them', () => {
    const screen = renderScreen('med-1');

    fireEvent.changeText(screen.getByPlaceholderText('Blood pressure'), '');
    fireEvent.changeText(screen.getByPlaceholderText('Dr. Ipsum'), '');
    fireEvent.changeText(screen.getByPlaceholderText('Sunny Pharmacy'), '');
    fireEvent.changeText(screen.getByDisplayValue('Take with food'), '');

    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'med-1',
      body: expect.objectContaining({
        reason_text: null,
        prescriber: null,
        pharmacy: null,
        notes: null,
      }),
    });
  });

  it('treats whitespace-only input as cleared', () => {
    const screen = renderScreen('med-1');

    fireEvent.changeText(screen.getByPlaceholderText('Blood pressure'), '   ');

    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'med-1',
      body: expect.objectContaining({ reason_text: null }),
    });
  });

  it('passes through non-empty values trimmed', () => {
    const screen = renderScreen('med-1');

    fireEvent.changeText(
      screen.getByPlaceholderText('Blood pressure'),
      '  Migraines  '
    );

    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledWith({
      id: 'med-1',
      body: expect.objectContaining({
        reason_text: 'Migraines',
        prescriber: 'Dr. Smith',
        pharmacy: 'Corner Pharmacy',
        notes: 'Take with food',
      }),
    });
  });

  it('collapses detail fields on create until the Details toggle is expanded', () => {
    mockUseMedicationDetail.mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useMedicationDetail>);
    const screen = renderScreen();

    expect(screen.queryByPlaceholderText('Dr. Ipsum')).toBeNull();

    fireEvent.press(screen.getByText('Details'));

    expect(screen.getByPlaceholderText('Dr. Ipsum')).toBeTruthy();
  });

  it('starts with detail fields expanded when the medication has detail content', () => {
    const screen = renderScreen('med-1');

    expect(screen.getByPlaceholderText('Dr. Ipsum')).toBeTruthy();
  });

  it('ignores a second create while the first is still in flight', async () => {
    mockUseMedicationDetail.mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useMedicationDetail>);
    let release: (value: unknown) => void = () => {};
    createMutate.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const screen = renderScreen();

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Metformin');
    pressAction(screen, mockNavigation, 'Save');
    pressAction(screen, mockNavigation, 'Save');

    expect(createMutate).toHaveBeenCalledTimes(1);
    release({ id: 'new-1', nutrients: {} });
    await waitFor(() =>
      expect(mockNavigation.replace as jest.Mock).toHaveBeenCalledWith(
        'MedicationDetail',
        { medicationId: 'new-1' }
      )
    );
  });

  it('sends null for empty optional fields on create', () => {
    mockUseMedicationDetail.mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useMedicationDetail>);
    const screen = renderScreen();

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Metformin');

    pressAction(screen, mockNavigation, 'Save');

    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Metformin',
        reason_text: null,
        prescriber: null,
        pharmacy: null,
        notes: null,
      })
    );
  });
});

describe('MedicationFormScreen — supplements', () => {
  const createMutate = jest.fn();
  const updateMutate = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    createMutate.mockResolvedValue({
      id: 'new-1',
      nutrients: { vitamin_c: 90 },
    });
    mockEnsureCatalog.mockResolvedValue({
      resolved: [
        { catalogId: 'vitamin_c', name: 'Vitamin C', fixedField: 'vitamin_c' },
        { catalogId: 'magnesium', name: 'Magnesium' },
      ],
    });
    mockUseMedicationDetail.mockReturnValue({
      data: undefined,
    } as unknown as ReturnType<typeof useMedicationDetail>);
    mockUseCreateMedication.mockReturnValue({
      mutate: createMutate,
      mutateAsync: createMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useCreateMedication>);
    mockUseUpdateMedication.mockReturnValue({
      mutate: updateMutate,
      mutateAsync: updateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateMedication>);
  });

  it('opens as a supplement with forms, nutrients and no strength or dose', () => {
    const screen = renderScreen(undefined, true);

    expect(screen.getByText('Nutrition per serving')).toBeTruthy();
    expect(screen.getByText('opt-softgel')).toBeTruthy();
    expect(screen.queryByText('opt-injection')).toBeNull();
    expect(screen.queryByText('Strength')).toBeNull();
    expect(screen.queryByText('Dose')).toBeNull();
  });

  it('turns a medication form into a supplement form', () => {
    const screen = renderScreen();

    expect(screen.queryByText('Nutrition per serving')).toBeNull();
    fireEvent(screen.getAllByRole('switch')[0], 'valueChange', true);

    expect(screen.getByText('Nutrition per serving')).toBeTruthy();
    expect(screen.queryByText('Strength')).toBeNull();
  });

  it('saves the nutrients, creating the ones that are not built in', async () => {
    const screen = renderScreen(undefined, true);

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Daily Multi');
    fireEvent.press(screen.getByText('opt-catalog:vitamin_c'));
    fireEvent.press(screen.getByText('opt-catalog:magnesium'));
    fireEvent.changeText(screen.getByLabelText('Vitamin C amount in mg'), '90');
    fireEvent.changeText(
      screen.getByLabelText('Magnesium amount in mg'),
      '200'
    );

    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(mockEnsureCatalog).toHaveBeenCalledWith(['magnesium']);
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Daily Multi',
        is_supplement: true,
        type_id: 'capsule',
        dose_amount: 1,
        dose_unit: 'serving',
        strength_value: null,
        nutrients: { vitamin_c: 90, custom_nutrients: { Magnesium: 200 } },
      })
    );
  });

  it('does not create nutrients for rows left blank', async () => {
    const screen = renderScreen(undefined, true);

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Zinc');
    fireEvent.press(screen.getByText('opt-catalog:zinc'));

    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() => expect(createMutate).toHaveBeenCalled());
    expect(mockEnsureCatalog).not.toHaveBeenCalled();
    expect(createMutate).toHaveBeenCalledWith(
      expect.objectContaining({ nutrients: {} })
    );
  });

  it('refuses an amount that is not a number', () => {
    const screen = renderScreen(undefined, true);

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Zinc');
    fireEvent.press(screen.getByText('opt-catalog:zinc'));
    fireEvent.changeText(screen.getByLabelText('Zinc amount in mg'), 'lots');

    pressAction(screen, mockNavigation, 'Save');

    expect(createMutate).not.toHaveBeenCalled();
  });

  it('warns when a created supplement comes back without its nutrients', async () => {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    createMutate.mockResolvedValue({ id: 'new-1', nutrients: {} });
    const screen = renderScreen(undefined, true);

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Daily Multi');
    fireEvent.press(screen.getByText('opt-catalog:vitamin_c'));
    fireEvent.changeText(screen.getByLabelText('Vitamin C amount in mg'), '90');
    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls[0]?.[1])).toContain('nutrient values');
    expect(mockNavigation.replace as jest.Mock).toHaveBeenCalledWith(
      'MedicationDetail',
      { medicationId: 'new-1' }
    );
    alert.mockRestore();
  });

  it('opens the new supplement when its nutrients were saved', async () => {
    createMutate.mockResolvedValue({
      id: 'new-1',
      nutrients: { vitamin_c: 90 },
    });
    const screen = renderScreen(undefined, true);

    fireEvent.changeText(screen.getByPlaceholderText('Ipsumol'), 'Daily Multi');
    fireEvent.press(screen.getByText('opt-catalog:vitamin_c'));
    fireEvent.changeText(screen.getByLabelText('Vitamin C amount in mg'), '90');
    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() =>
      expect(mockNavigation.replace as jest.Mock).toHaveBeenCalledWith(
        'MedicationDetail',
        { medicationId: 'new-1' }
      )
    );
  });
});

describe('MedicationFormScreen — converting to a supplement', () => {
  const updateMutate = jest.fn();
  const schedule = (id: string, doseAmount: number | null) =>
    ({
      id,
      medication_id: 'med-1',
      schedule_type_id: 'daily',
      time_of_day: '08:00',
      dose_amount: doseAmount,
    }) as unknown as MedicationDetail['schedules'][number];

  const setup = (isSupplement: boolean) => {
    mockUseMedicationDetail.mockReturnValue({
      data: {
        ...baseMed,
        is_supplement: isSupplement,
        nutrients: {},
        schedules: [schedule('s-1', 2), schedule('s-2', null)],
      },
    } as unknown as ReturnType<typeof useMedicationDetail>);
    mockUseUpdateMedication.mockReturnValue({
      mutate: updateMutate,
      mutateAsync: updateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateMedication>);
    mockUseCreateMedication.mockReturnValue({
      mutate: jest.fn(),
      mutateAsync: jest.fn(),
      isPending: false,
    } as unknown as ReturnType<typeof useCreateMedication>);
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUpdateScheduleAsync.mockResolvedValue({});
    updateMutate.mockResolvedValue({ is_supplement: true, nutrients: {} });
  });

  it('clears the schedule doses that would count extra servings', async () => {
    setup(false);
    const screen = renderScreen('med-1');

    fireEvent(screen.getAllByRole('switch')[0], 'valueChange', true);
    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'med-1',
        body: expect.objectContaining({
          is_supplement: true,
          dose_amount: 1,
          dose_unit: 'serving',
        }),
      })
    );
    expect(mockUpdateScheduleAsync).toHaveBeenCalledTimes(1);
    expect(mockUpdateScheduleAsync).toHaveBeenCalledWith({
      id: 's-1',
      medicationId: 'med-1',
      body: { dose_amount: null },
    });
  });

  it('does not save the medication if the schedules could not be reset', async () => {
    setup(false);
    mockUpdateScheduleAsync.mockRejectedValue(new Error('boom'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = renderScreen('med-1');

    fireEvent(screen.getAllByRole('switch')[0], 'valueChange', true);
    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() => expect(alert).toHaveBeenCalled());
    const message = String(alert.mock.calls[0]?.[1]);
    expect(message).toContain('boom');
    expect(message).toContain(formatLocalizedTimeOfDay('08:00'));
    expect(updateMutate).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('puts the schedule doses back if saving the supplement fails', async () => {
    setup(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    updateMutate.mockRejectedValue(new Error('nope'));
    const screen = renderScreen('med-1');

    fireEvent(screen.getAllByRole('switch')[0], 'valueChange', true);
    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() =>
      expect(mockUpdateScheduleAsync).toHaveBeenCalledWith({
        id: 's-1',
        medicationId: 'med-1',
        body: { dose_amount: 2 },
      })
    );
    expect(mockUpdateScheduleAsync).toHaveBeenCalledWith({
      id: 's-1',
      medicationId: 'med-1',
      body: { dose_amount: null },
    });
    expect(mockNavigation.goBack as jest.Mock).not.toHaveBeenCalled();
    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls.at(-1)?.[1])).not.toContain(
      'could not be restored'
    );
    alert.mockRestore();
  });

  it('stays open when the server keeps the old supplement setting', async () => {
    setup(false);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    updateMutate.mockResolvedValue({ is_supplement: false });
    const screen = renderScreen('med-1');

    fireEvent(screen.getAllByRole('switch')[0], 'valueChange', true);
    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls[0]?.[1])).toContain(
      'supplement mode was not applied'
    );
    expect(mockUpdateScheduleAsync).toHaveBeenCalledWith({
      id: 's-1',
      medicationId: 'med-1',
      body: { dose_amount: 2 },
    });
    expect(mockNavigation.goBack as jest.Mock).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('leaves the form when the server applied the supplement setting', async () => {
    setup(false);
    updateMutate.mockResolvedValue({ is_supplement: true, nutrients: {} });
    const screen = renderScreen('med-1');

    fireEvent(screen.getAllByRole('switch')[0], 'valueChange', true);
    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() =>
      expect(mockNavigation.goBack as jest.Mock).toHaveBeenCalled()
    );
  });

  it('ignores a second save while the first is still in flight', async () => {
    setup(true);
    let release: (value: unknown) => void = () => {};
    updateMutate.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    const screen = renderScreen('med-1');

    pressAction(screen, mockNavigation, 'Save');
    pressAction(screen, mockNavigation, 'Save');

    expect(updateMutate).toHaveBeenCalledTimes(1);
    release({ is_supplement: true, nutrients: {} });
    await waitFor(() =>
      expect(mockNavigation.goBack as jest.Mock).toHaveBeenCalled()
    );
  });

  it('stays open when the server drops nutrient edits', async () => {
    mockUseMedicationDetail.mockReturnValue({
      data: {
        ...baseMed,
        is_supplement: true,
        type_id: 'capsule',
        nutrients: { vitamin_c: 90 },
        schedules: [],
      },
    } as unknown as ReturnType<typeof useMedicationDetail>);
    mockUseUpdateMedication.mockReturnValue({
      mutate: updateMutate,
      mutateAsync: updateMutate,
      isPending: false,
    } as unknown as ReturnType<typeof useUpdateMedication>);
    updateMutate.mockResolvedValue({
      is_supplement: true,
      nutrients: { vitamin_c: 90 },
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    const screen = renderScreen('med-1');

    fireEvent.changeText(
      screen.getByLabelText('Vitamin C amount in mg'),
      '100'
    );
    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() => expect(alert).toHaveBeenCalled());
    expect(String(alert.mock.calls[0]?.[1])).toContain(
      'nutrient changes were not saved'
    );
    expect(mockNavigation.goBack as jest.Mock).not.toHaveBeenCalled();
    alert.mockRestore();
  });

  it('keeps the schedule doses of a supplement that is already one', async () => {
    setup(true);
    const screen = renderScreen('med-1');

    pressAction(screen, mockNavigation, 'Save');

    await waitFor(() => expect(updateMutate).toHaveBeenCalled());
    expect(updateMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        body: expect.objectContaining({
          dose_amount: 1,
          dose_unit: 'tablet',
        }),
      })
    );
    expect(mockUpdateScheduleAsync).not.toHaveBeenCalled();
  });
});
