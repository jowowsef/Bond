import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StackHeader } from '@/components/HeaderBar';
import { cancelOccurrence, deleteEvent, deviceTimeZone, fetchEvent, type CalendarEvent } from '@/lib/calendar';
import { eventTimeText, formatLongDate, REMINDER_LABELS, REPEAT_LABELS } from '@/lib/calendarDates';
import { askChoice, askConfirm } from '@/lib/consent';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * EVENT DETAILS: /calendar-event?id=...&date=YYYY-MM-DD (the occurrence that
 * was tapped). Shows only the fields that have a value. Either partner can
 * edit or delete; deleting always asks first, and for a repeating event asks
 * "only this one" or "all of them".
 */
export default function CalendarEventScreen() {
  useThemeVersion();
  const router = useRouter();
  const { id, date } = useLocalSearchParams<{ id: string; date?: string }>();
  const { userId, partnerProfile } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Your partner';
  const [event, setEvent] = useState<CalendarEvent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const e = await fetchEvent(id);
      setEvent(e);
      setError(e ? null : 'This event was deleted.');
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [id]);

  // Fresh every time the screen is shown (for example after editing).
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const occurrence = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : event?.start_date ?? '';
  const repeating = !!event && event.repeat !== 'none';

  async function onEdit() {
    if (!event) return;
    if (!repeating) {
      router.push({ pathname: '/calendar-edit', params: { id: event.id } });
      return;
    }
    const choice = await askChoice({
      title: 'Edit a repeating event',
      body: `"${event.title}" repeats ${REPEAT_LABELS[event.repeat].toLowerCase()}.`,
      confirmLabel: 'Only this one',
      secondaryLabel: 'All of them',
      icon: 'calendar-outline',
    });
    if (choice === 'confirm') router.push({ pathname: '/calendar-edit', params: { id: event.id, occurrence } });
    else if (choice === 'secondary') router.push({ pathname: '/calendar-edit', params: { id: event.id } });
  }

  async function onDelete() {
    if (!event || busy) return;
    let scope: 'one' | 'all' | null = null;
    if (repeating) {
      const choice = await askChoice({
        title: 'Delete a repeating event?',
        body: `Delete only ${formatLongDate(occurrence)}, or every "${event.title}"? This is removed for both of you.`,
        confirmLabel: 'Only this one',
        secondaryLabel: 'All of them',
        icon: 'trash-outline',
      });
      scope = choice === 'confirm' ? 'one' : choice === 'secondary' ? 'all' : null;
    } else {
      const ok = await askConfirm(
        'Delete this event?',
        `"${event.title}" is removed from the calendar for both of you.`,
        'Delete',
        'Cancel',
        true,
        'trash-outline',
      );
      scope = ok ? 'all' : null;
    }
    if (!scope) return; // Cancel: nothing changes
    setBusy(true);
    const r = scope === 'one' ? await cancelOccurrence(event, occurrence) : await deleteEvent(event.id);
    setBusy(false);
    if (!r.ok) {
      setError(r.message);
      return;
    }
    router.back();
  }

  const createdBy = !event ? '' : event.created_by === userId ? 'You' : event.created_by ? partnerName : 'Someone who left';
  const otherZone = event && event.timezone !== deviceTimeZone() ? event.timezone : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="Event" />
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : !event ? (
        <Card style={{ margin: spacing.lg }}>
          <Text style={styles.muted}>{error ?? 'This event was deleted.'}</Text>
        </Card>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          <Text style={styles.title}>{event.title}</Text>
          <Card style={styles.card}>
            <Row icon="calendar-outline" text={formatLongDate(occurrence)} />
            <Row icon="time-outline" text={eventTimeText(event) + (otherZone ? ` (${otherZone})` : '')} />
            {event.location ? <Row icon="location-outline" text={event.location} /> : null}
            {event.repeat !== 'none' ? <Row icon="repeat" text={REPEAT_LABELS[event.repeat]} /> : null}
            {event.reminder !== 'none' ? (
              <Row icon="notifications-outline" text={REMINDER_LABELS[event.reminder] + (event.start_time ? '' : ' (at 9:00 AM)')} />
            ) : null}
            <Row icon="person-outline" text={`Created by ${createdBy}`} last />
          </Card>
          {event.description ? (
            <Card style={styles.card}>
              <Text style={styles.notes}>{event.description}</Text>
            </Card>
          ) : null}
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <View style={styles.actions}>
            <Button label="Edit" icon="create-outline" variant="secondary" onPress={() => void onEdit()} style={{ flex: 1 }} />
            <Button label="Delete" icon="trash-outline" variant="danger" loading={busy} onPress={() => void onDelete()} style={{ flex: 1 }} />
          </View>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

function Row({ icon, text, last }: { icon: React.ComponentProps<typeof Ionicons>['name']; text: string; last?: boolean }) {
  useThemeVersion();
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Ionicons name={icon} size={18} color={colors.primary} />
      <Text style={styles.rowText}>{text}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl },
  title: { ...font.title, color: colors.text },
  card: { marginTop: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowText: { ...font.body, color: colors.text, flex: 1 },
  notes: { ...font.body, color: colors.text, lineHeight: 22 },
  muted: { ...font.body, color: colors.muted },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.xl },
}));
