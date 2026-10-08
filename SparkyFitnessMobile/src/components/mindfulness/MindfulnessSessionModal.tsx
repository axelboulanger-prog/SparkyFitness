import React, { useState, useEffect } from 'react';
import {
  Modal,
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  SafeAreaView,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import FormInput from '../FormInput';
import Icon from '../Icon';
import Toast from 'react-native-toast-message';
import { BreathworkModal } from './BreathworkModal';
import { MeditationTimerModal } from './MeditationTimerModal';
import type {
  CreateMindfulnessSessionBody,
  UpdateMindfulnessSessionBody,
  MindfulnessSessionResponse,
} from '@workspace/shared';

interface MindfulnessSessionModalProps {
  visible: boolean;
  onClose: () => void;
  onSave: (data: CreateMindfulnessSessionBody) => Promise<unknown>;
  onUpdate?: (
    id: string,
    data: UpdateMindfulnessSessionBody
  ) => Promise<unknown>;
  initialSession?: MindfulnessSessionResponse | null;
  selectedDate: string;
}

const SESSION_TYPES = [
  'meditation',
  'breathwork',
  'reflection',
  'walking',
  'yoga',
  'guided',
  'unguided',
  'other',
] as const;

export const MindfulnessSessionModal: React.FC<
  MindfulnessSessionModalProps
> = ({ visible, onClose, onSave, onUpdate, initialSession, selectedDate }) => {
  const { t } = useTranslation();
  const [durationMinutes, setDurationMinutes] = useState('15');
  const [durationSeconds, setDurationSeconds] = useState('0');
  const [sessionType, setSessionType] = useState('meditation');
  const [notes, setNotes] = useState('');
  const [heartRateAvg, setHeartRateAvg] = useState('');
  const [heartRateStart, setHeartRateStart] = useState('');
  const [heartRateEnd, setHeartRateEnd] = useState('');
  const [hrvRmssd, setHrvRmssd] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [breathworkVisible, setBreathworkVisible] = useState(false);
  const [timerVisible, setTimerVisible] = useState(false);

  useEffect(() => {
    if (initialSession) {
      const totalSecs = initialSession.duration_seconds || 0;
      setDurationMinutes(String(Math.floor(totalSecs / 60)));
      setDurationSeconds(String(totalSecs % 60));
      setSessionType(initialSession.session_type || 'meditation');
      setNotes(initialSession.notes || '');
      setHeartRateAvg(
        initialSession.heart_rate_avg != null
          ? String(initialSession.heart_rate_avg)
          : ''
      );
      setHeartRateStart(
        initialSession.heart_rate_start != null
          ? String(initialSession.heart_rate_start)
          : ''
      );
      setHeartRateEnd(
        initialSession.heart_rate_end != null
          ? String(initialSession.heart_rate_end)
          : ''
      );
      setHrvRmssd(
        initialSession.hrv_rmssd != null ? String(initialSession.hrv_rmssd) : ''
      );
    } else {
      setDurationMinutes('15');
      setDurationSeconds('0');
      setSessionType('meditation');
      setNotes('');
      setHeartRateAvg('');
      setHeartRateStart('');
      setHeartRateEnd('');
      setHrvRmssd('');
    }
  }, [initialSession, visible]);

  const getSessionTypeLabel = (type: (typeof SESSION_TYPES)[number]) => {
    switch (type) {
      case 'meditation':
        return t('mindfulness.types.meditation', {
          defaultValue: 'Meditation',
        });
      case 'breathwork':
        return t('mindfulness.types.breathwork', {
          defaultValue: 'Breathwork',
        });
      case 'reflection':
        return t('mindfulness.types.reflection', {
          defaultValue: 'Reflection',
        });
      case 'walking':
        return t('mindfulness.types.walking', {
          defaultValue: 'Mindful Walking',
        });
      case 'yoga':
        return t('mindfulness.types.yoga', {
          defaultValue: 'Yoga',
        });
      case 'guided':
        return t('mindfulness.types.guided', {
          defaultValue: 'Guided',
        });
      case 'unguided':
        return t('mindfulness.types.unguided', {
          defaultValue: 'Unguided',
        });
      case 'other':
        return t('mindfulness.types.other', {
          defaultValue: 'Other',
        });
    }
  };

  const handleBreathworkSave = async (durationSecs: number, sType: string) => {
    try {
      await onSave({
        entry_date: selectedDate,
        duration_seconds: durationSecs,
        session_type: sType,
        provider: 'manual',
      });
      setBreathworkVisible(false);
      onClose();
    } catch {
      Toast.show({
        type: 'error',
        text1: t('common.error', { defaultValue: 'Error' }),
      });
    }
  };

  const handleTimerSave = async (durationSecs: number, sType: string) => {
    try {
      await onSave({
        entry_date: selectedDate,
        duration_seconds: durationSecs,
        session_type: sType,
        provider: 'manual',
      });
      setTimerVisible(false);
      onClose();
    } catch {
      Toast.show({
        type: 'error',
        text1: t('common.error', { defaultValue: 'Error' }),
      });
    }
  };

  const handleSubmit = async () => {
    const mins = parseInt(durationMinutes, 10) || 0;
    const secs = parseInt(durationSeconds, 10) || 0;
    const totalSeconds = mins * 60 + secs;
    if (totalSeconds <= 0) return;

    setIsSubmitting(true);
    try {
      if (initialSession && onUpdate) {
        const payload: UpdateMindfulnessSessionBody = {
          duration_seconds: totalSeconds,
          session_type: sessionType,
          notes: notes.trim() || null,
          heart_rate_avg: heartRateAvg ? parseFloat(heartRateAvg) : null,
          heart_rate_start: heartRateStart
            ? parseInt(heartRateStart, 10)
            : null,
          heart_rate_end: heartRateEnd ? parseInt(heartRateEnd, 10) : null,
          hrv_rmssd: hrvRmssd ? parseFloat(hrvRmssd) : null,
        };
        await onUpdate(initialSession.id, payload);
      } else {
        const payload: CreateMindfulnessSessionBody = {
          entry_date: selectedDate,
          duration_seconds: totalSeconds,
          session_type: sessionType,
          provider: initialSession?.provider || 'manual',
          notes: notes.trim() || null,
          heart_rate_avg: heartRateAvg ? parseFloat(heartRateAvg) : null,
          heart_rate_start: heartRateStart
            ? parseInt(heartRateStart, 10)
            : null,
          heart_rate_end: heartRateEnd ? parseInt(heartRateEnd, 10) : null,
          hrv_rmssd: hrvRmssd ? parseFloat(hrvRmssd) : null,
        };
        await onSave(payload);
      }
      onClose();
    } catch {
      Toast.show({
        type: 'error',
        text1: t('common.error', { defaultValue: 'Error' }),
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View className="flex-1 bg-black/80 justify-end">
        <SafeAreaView className="bg-surface rounded-t-3xl max-h-[85%] border-t border-border-subtle">
          <View className="flex-row justify-between items-center px-5 py-4 border-b border-border-subtle">
            <Text className="text-text-primary text-lg font-bold">
              {initialSession
                ? t('mindfulness.modal.editTitle', {
                    defaultValue: 'Edit Mindful Session',
                  })
                : t('mindfulness.modal.addTitle', {
                    defaultValue: 'Log Mindful Session',
                  })}
            </Text>
            <TouchableOpacity onPress={onClose} className="p-1">
              <Icon name="close" size={20} color="#9CA3AF" />
            </TouchableOpacity>
          </View>

          <ScrollView className="px-5 py-4">
            {!initialSession && (
              <View className="mb-4 pb-4 border-b border-border-subtle">
                <Text className="text-text-secondary text-xs font-semibold mb-2 uppercase">
                  {t('mindfulness.tools.title', {
                    defaultValue: 'Interactive Practice',
                  })}
                </Text>
                <View className="flex-row gap-2">
                  <TouchableOpacity
                    onPress={() => setBreathworkVisible(true)}
                    className="flex-1 p-3 rounded-2xl bg-blue-500/10 border border-blue-500/25 flex-row items-center gap-2.5"
                    accessibilityRole="button"
                  >
                    <Text className="text-2xl">🌊</Text>
                    <View className="flex-1">
                      <Text className="text-blue-600 dark:text-blue-400 font-bold text-sm">
                        {t('mindfulness.tools.breatheTitle', {
                          defaultValue: 'Paced Breathing',
                        })}
                      </Text>
                      <Text
                        className="text-text-secondary text-[10px]"
                        numberOfLines={1}
                      >
                        {t('mindfulness.tools.breatheSubtitle', {
                          defaultValue: 'Box, 4-7-8, Coherence protocols',
                        })}
                      </Text>
                    </View>
                  </TouchableOpacity>

                  <TouchableOpacity
                    onPress={() => setTimerVisible(true)}
                    className="flex-1 p-3 rounded-2xl bg-purple-500/10 border border-purple-500/25 flex-row items-center gap-2.5"
                    accessibilityRole="button"
                  >
                    <Text className="text-2xl">⏱️</Text>
                    <View className="flex-1">
                      <Text className="text-purple-600 dark:text-purple-400 font-bold text-sm">
                        {t('mindfulness.tools.timerTitle', {
                          defaultValue: 'Meditation Timer',
                        })}
                      </Text>
                      <Text
                        className="text-text-secondary text-[10px]"
                        numberOfLines={1}
                      >
                        {t('mindfulness.tools.timerSubtitle', {
                          defaultValue: 'Timed countdown & open stopwatch',
                        })}
                      </Text>
                    </View>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {/* Session Type */}
            <Text className="text-text-secondary text-xs font-semibold mb-2 uppercase">
              {t('mindfulness.modal.type', { defaultValue: 'Session Type' })}
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {SESSION_TYPES.map((typeKey) => {
                const isSelected = sessionType === typeKey;
                return (
                  <TouchableOpacity
                    key={typeKey}
                    onPress={() => setSessionType(typeKey)}
                    className={`px-3.5 py-2 rounded-xl border ${
                      isSelected
                        ? 'bg-accent-primary/20 border-accent-primary'
                        : 'bg-surface-elevated border-border-subtle'
                    }`}
                  >
                    <Text
                      className={`text-sm font-medium ${
                        isSelected
                          ? 'text-accent-primary font-semibold'
                          : 'text-text-secondary'
                      }`}
                    >
                      {getSessionTypeLabel(typeKey)}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>

            {/* Duration */}
            <View className="flex-row gap-3">
              <View className="flex-1">
                <Text className="text-text-secondary text-xs font-semibold mb-1 uppercase">
                  {t('mindfulness.modal.minutes', {
                    defaultValue: 'Minutes',
                  })}
                </Text>
                <FormInput
                  value={durationMinutes}
                  onChangeText={setDurationMinutes}
                  keyboardType="numeric"
                  placeholder="15"
                  accessibilityLabel={t(
                    'mindfulness.modal.durationMinutesAccessibility',
                    {
                      defaultValue: 'Duration in minutes',
                    }
                  )}
                />
              </View>
              <View className="flex-1">
                <Text className="text-text-secondary text-xs font-semibold mb-1 uppercase">
                  {t('mindfulness.modal.seconds', {
                    defaultValue: 'Seconds',
                  })}
                </Text>
                <FormInput
                  value={durationSeconds}
                  onChangeText={setDurationSeconds}
                  keyboardType="numeric"
                  placeholder="0"
                  accessibilityLabel={t(
                    'mindfulness.modal.durationSecondsAccessibility',
                    {
                      defaultValue: 'Duration in seconds',
                    }
                  )}
                />
              </View>
            </View>

            {/* Vitals & Heart Rate (Optional) */}
            <Text className="text-text-secondary text-xs font-semibold mt-4 mb-2 uppercase">
              {t('mindfulness.modal.vitalsHeader', {
                defaultValue: 'Heart Rate & HRV (Optional)',
              })}
            </Text>
            <View className="flex-row gap-3 mb-2">
              <View className="flex-1">
                <Text className="text-text-muted text-xs mb-1">
                  {t('mindfulness.modal.avgHr', {
                    defaultValue: 'Avg HR (bpm)',
                  })}
                </Text>
                <FormInput
                  value={heartRateAvg}
                  onChangeText={setHeartRateAvg}
                  keyboardType="numeric"
                  placeholder="65"
                  accessibilityLabel={t(
                    'mindfulness.modal.avgHrAccessibility',
                    {
                      defaultValue: 'Average heart rate',
                    }
                  )}
                />
              </View>
              <View className="flex-1">
                <Text className="text-text-muted text-xs mb-1">
                  {t('mindfulness.modal.hrv', { defaultValue: 'HRV (ms)' })}
                </Text>
                <FormInput
                  value={hrvRmssd}
                  onChangeText={setHrvRmssd}
                  keyboardType="numeric"
                  placeholder="50"
                  accessibilityLabel={t('mindfulness.modal.hrvAccessibility', {
                    defaultValue: 'HRV RMSSD',
                  })}
                />
              </View>
            </View>

            <View className="flex-row gap-3 mb-4">
              <View className="flex-1">
                <Text className="text-text-muted text-xs mb-1">
                  {t('mindfulness.modal.startHr', {
                    defaultValue: 'Start HR',
                  })}
                </Text>
                <FormInput
                  value={heartRateStart}
                  onChangeText={setHeartRateStart}
                  keyboardType="numeric"
                  placeholder="75"
                  accessibilityLabel={t(
                    'mindfulness.modal.startHrAccessibility',
                    {
                      defaultValue: 'Start heart rate',
                    }
                  )}
                />
              </View>
              <View className="flex-1">
                <Text className="text-text-muted text-xs mb-1">
                  {t('mindfulness.modal.endHr', { defaultValue: 'End HR' })}
                </Text>
                <FormInput
                  value={heartRateEnd}
                  onChangeText={setHeartRateEnd}
                  keyboardType="numeric"
                  placeholder="60"
                  accessibilityLabel={t(
                    'mindfulness.modal.endHrAccessibility',
                    {
                      defaultValue: 'End heart rate',
                    }
                  )}
                />
              </View>
            </View>

            {/* Notes */}
            <Text className="text-text-secondary text-xs font-semibold mb-1 uppercase">
              {t('mindfulness.modal.notes', {
                defaultValue: 'Notes (Optional)',
              })}
            </Text>
            <FormInput
              value={notes}
              onChangeText={setNotes}
              placeholder={t('mindfulness.modal.notesPlaceholder', {
                defaultValue: 'How was your practice?',
              })}
              accessibilityLabel={t('mindfulness.modal.notesAccessibility', {
                defaultValue: 'Notes',
              })}
              multiline
              numberOfLines={3}
            />

            <View className="h-6" />
          </ScrollView>

          <View className="p-4 border-t border-border-subtle flex-row gap-3">
            <TouchableOpacity
              onPress={onClose}
              className="flex-1 py-3.5 rounded-xl border border-border-subtle items-center"
            >
              <Text className="text-text-primary font-semibold text-base">
                {t('common.cancel', { defaultValue: 'Cancel' })}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              onPress={handleSubmit}
              disabled={isSubmitting}
              className="flex-1 py-3.5 rounded-xl bg-accent-primary items-center"
            >
              <Text className="text-white font-bold text-base">
                {isSubmitting
                  ? t('common.saving', { defaultValue: 'Saving…' })
                  : t('common.save', { defaultValue: 'Save' })}
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>

      <BreathworkModal
        visible={breathworkVisible}
        onClose={() => setBreathworkVisible(false)}
        onSave={handleBreathworkSave}
      />

      <MeditationTimerModal
        visible={timerVisible}
        onClose={() => setTimerVisible(false)}
        onSave={handleTimerSave}
      />
    </Modal>
  );
};
