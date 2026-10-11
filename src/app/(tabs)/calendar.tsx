import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { CalendarMonth } from '@/components/CalendarMonth';
import { Card } from '@/components/Card';
import { HeaderActions } from '@/components/HeaderActions';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { useCalendar } from '@/hooks/useCalendar';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import type { CalendarEvent } from '@/lib/calendar';
import {
  countdownLabel,
  eventTimeText,
  formatLongDate,
  formatShortDate,
  formatTime12,
  nextOccurrence,
  occurrencesBetween,
  parseKey,
  todayKey,
  toKey,
  daysInMonth,
} from '@/lib/calendarDates';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * CALENDAR tab: the couple's shared calendar (both partners see and change
 * the same events, live). Upcoming countdowns, the month, and the chosen
 * day's events. Settings stay in the header (gear), as on every tab.
 */
export default function CalendarTab() {
  useThemeVersion();
  const router = useRouter();
  const { couple, userId, partnerProfile } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Your partner';
  const { events, cancelled, loading, error, reload } = useCalendar(couple?.id ?? null);
  const { refreshing, onRefresh } = usePullToRefresh(reload);

  // "now" ticks every minute while this tab is open (countdowns, "Today").
  const [now, setNow] = useState(() => new Date());
  useFocusEffect(
    useCallback(() => {
      setNow(new Date());
      const t = setInterval(() => setNow(new Date()), 60_000);
      return () => clearInterval(t);
    }, []),
  );
  const today = todayKey(now);

  const [selected, setSelected] = useState(today);
  const [view, setView] = useState(() => {
    const { y, m } = parseKey(today);
    return { y, m };
  });

  // Days with events in the shown month (repeats expanded, cancelled ones left out).
  const marked = useMemo(() => {
    const from = toKey(view.y, view.m, 1);
    const to = toKey(view.y, view.m, daysInMonth(view.y, view.m));
    const set = new Set<string>();
    for (const e of events) for (const d of occurrencesBetween(e, from, to, cancelled.get(e.id))) set.add(d);
    return set;
  }, [events, cancelled, view]);

  const dayEvents = useMemo(
    () =>
      events
        .filter((e) => occurrencesBetween(e, selected, selected, cancelled.get(e.id)).length > 0)
        .sort((a, b) => (a.start_time ?? '').localeCompare(b.start_time ?? '') || a.title.localeCompare(b.title)),
    [events, cancelled, selected],
  );

  const upcoming = useMemo(
    () =>
      events
        .map((e) => ({ e, date: nextOccurrence(e, now, cancelled.get(e.id)) }))
        .filter((x): x is { e: CalendarEvent; date: string } => !!x.date)
        .sort((a, b) => a.date.localeCompare(b.date) || (a.e.start_time ?? '').localeCompare(b.e.start_time ?? ''))
        .slice(0, 3),
    [events, cancelled, now],
  );

  const creator = (e: CalendarEvent) => (e.created_by === userId ? 'You' : e.created_by ? partnerName : 'Unknown');
  const open = (e: CalendarEvent, date: string) => router.push({ pathname: '/calendar-event', params: { id: e.id, date } });
  const add = () => router.push({ pathname: '/calendar-edit', params: { date: selected } });

  function shiftMonth(delta: number) {
    setView((v) => {
      const total = v.y * 12 + (v.m - 1) + delta;
      return { y: Math.floor(total / 12), m: (total % 12) + 1 };
    });
  }
  function goToday() {
    const { y, m } = parseKey(today);
    setView({ y, m });
    setSelected(today);
  }

  return (
    <Screen
      title="Calendar"
      right={<HeaderActions />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
    >
      {error ? (
        <Card style={styles.errorCard}>
          <Text style={styles.errorText}>
            {events.length ? "Couldn't update the calendar. Showing what was loaded last." : error}
          </Text>
          <Button label="Try again" small variant="secondary" onPress={() => void reload().catch(() => undefined)} style={{ alignSelf: 'flex-start' }} />
        </Card>
      ) : null}

      {upcoming.length > 0 ? (
        <>
          <SectionHeader title="Coming up" />
          <View style={styles.countdowns}>
            {upcoming.map(({ e, date }) => (
              <Pressable
                key={`${e.id}-${date}`}
                onPress={() => open(e, date)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.countdown, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.countdownLabel}>{countdownLabel(date, now)}</Text>
                <Text style={styles.countdownTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={styles.countdownDate} numberOfLines={1}>
                  {formatShortDate(date)}
                  {e.start_time ? ` · ${formatTime12(e.start_time)}` : ''}
                </Text>
              </Pressable>
            ))}
          </View>
        </>
      ) : null}

      <Card style={styles.monthCard}>
        <CalendarMonth
          year={view.y}
          month={view.m}
          today={today}
          selected={selected}
          marked={marked}
          onSelect={setSelected}
          onPrev={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
          onToday={goToday}
        />
      </Card>

      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{selected === today ? 'Today' : formatLongDate(selected)}</Text>
        <Button label="Add" icon="add" small onPress={add} />
      </View>
      <Card>
        {loading && events.length === 0 ? (
          <ActivityIndicator color={colors.primary} />
        ) : dayEvents.length === 0 ? (
          <Text style={styles.empty}>
            {events.length === 0
              ? `Nothing planned yet. Add a date night, an anniversary or anything you want to remember with ${partnerName}.`
              : 'Nothing on this day.'}
          </Text>
        ) : (
          dayEvents.map((e, i) => (
            <Pressable
              key={e.id}
              onPress={() => open(e, selected)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.eventRow, i > 0 && styles.divider, pressed && { opacity: 0.7 }]}
            >
              <View style={[styles.bar, { backgroundColor: e.created_by === userId ? colors.me : colors.partner }]} />
              <View style={{ flex: 1 }}>
                <Text style={styles.eventTitle} numberOfLines={1}>
                  {e.title}
                </Text>
                <Text style={styles.eventMeta} numberOfLines={1}>
                  {eventTimeText(e)}
                  {e.location ? ` · ${e.location}` : ''} · by {creator(e)}
                </Text>
              </View>
              {e.repeat !== 'none' ? <Ionicons name="repeat" size={16} color={colors.muted} /> : null}
              <Ionicons name="chevron-forward" size={18} color={colors.muted} />
            </Pressable>
          ))
        )}
      </Card>
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = themedStyles(() => ({
  errorCard: { marginTop: spacing.md, gap: spacing.sm },
  errorText: { ...font.small, color: colors.danger },
  countdowns: { gap: spacing.sm },
  countdown: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
  },
  countdownLabel: { ...font.small, fontWeight: '700', color: colors.primary },
  countdownTitle: { ...font.h3, color: colors.text, marginTop: 2 },
  countdownDate: { ...font.small, color: colors.subtext, marginTop: 2 },
  monthCard: { marginTop: spacing.lg },
  dayHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm },
  dayTitle: { ...font.h3, color: colors.text, flex: 1 },
  empty: { ...font.small, color: colors.muted, lineHeight: 19 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2 },
  eventTitle: { ...font.body, fontWeight: '700', color: colors.text },
  eventMeta: { ...font.small, color: colors.subtext, marginTop: 2 },
}));
