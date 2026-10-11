import { Ionicons } from '@expo/vector-icons';
import DateTimePicker, { DateTimePickerAndroid, type DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StackHeader } from '@/components/HeaderBar';
import {
  createEvent,
  editOccurrence,
  fetchEvent,
  newEventId,
  updateEvent,
  type CalendarEvent,
  type EventInput,
} from '@/lib/calendar';
import {
  formatLongDate,
  formatTime12,
  parseKey,
  REMINDER_LABELS,
  REPEAT_LABELS,
  todayKey,
  toKey,
  validateEvent,
  type Reminder,
  type Repeat,
} from '@/lib/calendarDates';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * CREATE / EDIT a shared event.
 *   /calendar-edit?date=2026-10-11                 new event on that day
 *   /calendar-edit?id=...                          edit the event (whole series)
 *   /calendar-edit?id=...&occurrence=2026-10-11    edit ONE occurrence of a series
 * Title and date are required; times, place, notes, reminder and repeat are
 * optional. No start time = all day. An end time is optional and can't be
 * earlier than the start. The new event's id is made once, here, so saving
 * again after a failed or slow attempt never creates a second copy.
 */
export default function CalendarEdit() {
  useThemeVersion();
  const router = useRouter();
  const params = useLocalSearchParams<{ id?: string; date?: string; occurrence?: string }>();
  const { couple } = useCouple();
  const editingId = params.id ?? null;
  const occurrence = params.occurrence ?? null;

  const [loading, setLoading] = useState(!!editingId);
  const [original, setOriginal] = useState<CalendarEvent | null>(null);
  const [title, setTitle] = useState('');
  const [date, setDate] = useState(params.date && /^\d{4}-\d{2}-\d{2}$/.test(params.date) ? params.date : todayKey());
  const [allDay, setAllDay] = useState(true);
  const [startTime, setStartTime] = useState<string | null>(null);
  const [endTime, setEndTime] = useState<string | null>(null);
  const [location, setLocation] = useState('');
  const [description, setDescription] = useState('');
  const [reminder, setReminder] = useState<Reminder>('none');
  const [repeat, setRepeat] = useState<Repeat>('none');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [iosPicker, setIosPicker] = useState<null | 'date' | 'start' | 'end'>(null);
  // One id per new event (and per "this occurrence only" copy), kept across retries.
  const newId = useRef(newEventId());

  useEffect(() => {
    if (!editingId) return;
    void (async () => {
      try {
        const e = await fetchEvent(editingId);
        if (!e) {
          setError('This event no longer exists.');
          return;
        }
        setOriginal(e);
        setTitle(e.title);
        setDate(occurrence ?? e.start_date);
        setAllDay(!e.start_time);
        setStartTime(e.start_time?.slice(0, 5) ?? null);
        setEndTime(e.end_time?.slice(0, 5) ?? null);
        setLocation(e.location ?? '');
        setDescription(e.description ?? '');
        setReminder(e.reminder);
        setRepeat(occurrence ? 'none' : e.repeat);
      } catch (err) {
        setError((err as Error).message);
      } finally {
        setLoading(false);
      }
    })();
  }, [editingId, occurrence]);

  // ---- pickers (Android's own dialogs; inline on other platforms) ----
  const toDate = (key: string, time?: string | null) => {
    const { y, m, d } = parseKey(key);
    const [h, min] = (time ?? '09:00').split(':').map(Number);
    return new Date(y, m - 1, d, h, min);
  };
  const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const apply = (which: 'date' | 'start' | 'end', picked: Date) => {
    if (which === 'date') setDate(toKey(picked.getFullYear(), picked.getMonth() + 1, picked.getDate()));
    else if (which === 'start') setStartTime(hhmm(picked));
    else setEndTime(hhmm(picked));
  };
  function pick(which: 'date' | 'start' | 'end') {
    const value = which === 'date' ? toDate(date) : toDate(date, which === 'start' ? startTime : endTime ?? startTime);
    if (Platform.OS === 'android') {
      DateTimePickerAndroid.open({
        value,
        mode: which === 'date' ? 'date' : 'time',
        onChange: (ev: DateTimePickerEvent, picked?: Date) => {
          if (ev.type === 'set' && picked) apply(which, picked);
        },
      });
    } else setIosPicker(which);
  }

  async function save() {
    if (saving) return;
    const input: EventInput = {
      title,
      start_date: date,
      start_time: allDay ? null : startTime,
      end_time: allDay ? null : endTime,
      description,
      location,
      reminder,
      repeat,
    };
    if (!allDay && !startTime) {
      setError('Choose a start time, or turn on All day.');
      return;
    }
    const check = validateEvent(input);
    if (!check.ok) {
      setError(check.message);
      return;
    }
    if (!couple?.id) {
      setError('You need to be paired to use the shared calendar.');
      return;
    }
    setError(null);
    setSaving(true);
    const result =
      editingId && original && occurrence
        ? await editOccurrence(original, occurrence, newId.current, input)
        : editingId
          ? await updateEvent(editingId, input)
          : await createEvent(newId.current, couple.id, input);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    router.back();
  }

  const heading = editingId ? (occurrence ? 'Edit this event only' : 'Edit event') : 'New event';

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title={heading} />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
            <Card>
              <Text style={styles.label}>Title</Text>
              <TextInput
                value={title}
                onChangeText={setTitle}
                placeholder="Date night, anniversary, birthday…"
                placeholderTextColor={colors.muted}
                style={styles.input}
                maxLength={120}
                autoFocus={!editingId}
              />

              <Text style={[styles.label, styles.gap]}>Date</Text>
              <Field icon="calendar-outline" text={formatLongDate(date)} onPress={() => pick('date')} />

              <View style={[styles.switchRow, styles.gap]}>
                <Text style={styles.switchLabel}>All day</Text>
                <Switch
                  value={allDay}
                  onValueChange={(v) => {
                    setAllDay(v);
                    if (!v && !startTime) setStartTime('19:00');
                  }}
                  trackColor={{ true: colors.primary, false: colors.border }}
                  thumbColor="#fff"
                />
              </View>
              {!allDay ? (
                <>
                  <Text style={[styles.label, styles.gap]}>Starts</Text>
                  <Field icon="time-outline" text={startTime ? formatTime12(startTime) : 'Choose a time'} onPress={() => pick('start')} />
                  <Text style={[styles.label, styles.gap]}>Ends (optional)</Text>
                  <View style={{ flexDirection: 'row', gap: spacing.sm }}>
                    <View style={{ flex: 1 }}>
                      <Field icon="time-outline" text={endTime ? formatTime12(endTime) : 'No end time'} onPress={() => pick('end')} />
                    </View>
                    {endTime ? <Button label="Clear" small variant="ghost" onPress={() => setEndTime(null)} /> : null}
                  </View>
                </>
              ) : null}
            </Card>

            <Card style={styles.gapCard}>
              <Text style={styles.label}>Place (optional)</Text>
              <TextInput value={location} onChangeText={setLocation} placeholder="Where" placeholderTextColor={colors.muted} style={styles.input} maxLength={200} />
              <Text style={[styles.label, styles.gap]}>Notes (optional)</Text>
              <TextInput
                value={description}
                onChangeText={setDescription}
                placeholder="Anything to remember"
                placeholderTextColor={colors.muted}
                style={[styles.input, styles.multiline]}
                multiline
                maxLength={2000}
              />
            </Card>

            <Card style={styles.gapCard}>
              <Text style={styles.label}>Reminder</Text>
              <Chips options={REMINDER_LABELS} value={reminder} onChange={setReminder} />
              {reminder !== 'none' && allDay ? <Text style={styles.hint}>All-day events remind at 9:00 AM.</Text> : null}
              {occurrence ? null : (
                <>
                  <Text style={[styles.label, styles.gap]}>Repeat</Text>
                  <Chips options={REPEAT_LABELS} value={repeat} onChange={setRepeat} />
                  {repeat === 'monthly' && Number(date.slice(8)) > 28 ? (
                    <Text style={styles.hint}>In shorter months it falls on the last day of the month.</Text>
                  ) : null}
                  {repeat === 'yearly' && date.slice(5) === '02-29' ? (
                    <Text style={styles.hint}>In years without February 29 it falls on February 28.</Text>
                  ) : null}
                </>
              )}
            </Card>

            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label={saving ? 'Saving…' : 'Save'} onPress={() => void save()} loading={saving} style={styles.save} />
            {Platform.OS !== 'android' && iosPicker ? (
              <DateTimePicker
                value={iosPicker === 'date' ? toDate(date) : toDate(date, iosPicker === 'start' ? startTime : endTime ?? startTime)}
                mode={iosPicker === 'date' ? 'date' : 'time'}
                display="spinner"
                onChange={(_ev, picked) => {
                  if (picked) apply(iosPicker, picked);
                }}
              />
            ) : null}
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

function Field({ icon, text, onPress }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; onPress: () => void }) {
  useThemeVersion();
  return (
    <Pressable onPress={onPress} accessibilityRole="button" style={({ pressed }) => [styles.field, pressed && { opacity: 0.7 }]}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.fieldText}>{text}</Text>
    </Pressable>
  );
}

function Chips<T extends string>({ options, value, onChange }: { options: Record<T, string>; value: T; onChange: (v: T) => void }) {
  useThemeVersion();
  return (
    <View style={styles.chips}>
      {(Object.keys(options) as T[]).map((k) => {
        const on = k === value;
        return (
          <Pressable
            key={k}
            onPress={() => onChange(k)}
            accessibilityRole="radio"
            accessibilityState={{ selected: on }}
            style={[styles.chip, on && styles.chipOn]}
          >
            <Text style={[styles.chipText, on && styles.chipTextOn]}>{options[k]}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl * 2 },
  label: { ...font.small, color: colors.muted, marginBottom: 6 },
  gap: { marginTop: spacing.lg },
  gapCard: { marginTop: spacing.md },
  input: { ...font.body, color: colors.text, borderBottomWidth: 1, borderBottomColor: colors.border, paddingVertical: 6 },
  multiline: { minHeight: 70, textAlignVertical: 'top' },
  field: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fieldText: { ...font.body, color: colors.text },
  switchRow: { flexDirection: 'row', alignItems: 'center' },
  switchLabel: { ...font.body, fontWeight: '600', color: colors.text, flex: 1 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  chip: { paddingVertical: 6, paddingHorizontal: spacing.md, borderRadius: radius.pill, borderWidth: 1, borderColor: colors.border },
  chipOn: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  chipText: { ...font.small, color: colors.subtext },
  chipTextOn: { color: colors.primary, fontWeight: '700' },
  hint: { ...font.small, color: colors.muted, marginTop: spacing.sm },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md },
  save: { marginTop: spacing.lg },
}));
