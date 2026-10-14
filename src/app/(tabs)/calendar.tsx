import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { Avatar } from '@/components/Avatar';
import { CalendarMonth, type DayMarks } from '@/components/CalendarMonth';
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
import { tintForProfile } from '@/lib/avatar';
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
  const { couple, userId, myProfile, partnerProfile } = useCouple();
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

  // Days with events in the shown grid (with the days shown from the months
  // around it), and whose: yours or your partner's. Repeats expanded,
  // cancelled ones left out.
  const marked = useMemo(() => {
    const prevY = view.m === 1 ? view.y - 1 : view.y;
    const prevM = view.m === 1 ? 12 : view.m - 1;
    const nextY = view.m === 12 ? view.y + 1 : view.y;
    const nextM = view.m === 12 ? 1 : view.m + 1;
    const from = toKey(prevY, prevM, Math.max(1, daysInMonth(prevY, prevM) - 6));
    const to = toKey(nextY, nextM, 14);
    const map = new Map<string, DayMarks>();
    for (const e of events) {
      const mine = e.created_by === userId;
      for (const d of occurrencesBetween(e, from, to, cancelled.get(e.id))) {
        const m = map.get(d) ?? { me: false, partner: false };
        if (mine) m.me = true;
        else m.partner = true;
        map.set(d, m);
      }
    }
    return map;
  }, [events, cancelled, view, userId]);

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
  // Tapping a dimmed day from the month before or after also shows that month.
  function select(key: string) {
    const { y, m } = parseKey(key);
    if (y !== view.y || m !== view.m) setView({ y, m });
    setSelected(key);
  }

  const dayLabel = selected === today ? `Today · ${shortDay(selected)}` : formatLongDate(selected);

  return (
    <Screen
      title="Our calendar"
      right={
        <HeaderActions
          before={
            <Pressable onPress={add} accessibilityRole="button" accessibilityLabel="Add event" style={styles.addBtn}>
              <Ionicons name="add" size={22} color="#fff" />
            </Pressable>
          }
        />
      }
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

      <Card style={styles.monthCard}>
        <CalendarMonth
          year={view.y}
          month={view.m}
          today={today}
          selected={selected}
          marked={marked}
          onSelect={select}
          onPrev={() => shiftMonth(-1)}
          onNext={() => shiftMonth(1)}
          onToday={goToday}
        />
      </Card>

      <View style={styles.dayHeader}>
        <Text style={styles.dayTitle}>{dayLabel}</Text>
        <Text style={styles.dayCount}>
          {dayEvents.length === 0 ? '' : `${dayEvents.length} ${dayEvents.length === 1 ? 'event' : 'events'}`}
        </Text>
      </View>
      {loading && events.length === 0 ? (
        <Card>
          <ActivityIndicator color={colors.primary} />
        </Card>
      ) : dayEvents.length === 0 ? (
        <Card>
          <Text style={styles.empty}>
            {events.length === 0
              ? `Nothing planned yet. Add a date night, an anniversary or anything you want to remember with ${partnerName}.`
              : 'Nothing on this day.'}
          </Text>
          <Button label="Add event" icon="add" small variant="secondary" onPress={add} style={{ alignSelf: 'flex-start', marginTop: spacing.md }} />
        </Card>
      ) : (
        <View style={styles.eventList}>
          {dayEvents.map((e) => {
            const mine = e.created_by === userId;
            return (
              <Pressable
                key={e.id}
                onPress={() => open(e, selected)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.eventCard, pressed && { opacity: 0.7 }]}
              >
                <View style={[styles.bar, { backgroundColor: mine ? colors.me : colors.partner }]} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.eventTitle} numberOfLines={1}>
                    {e.title}
                  </Text>
                  <Text style={styles.eventMeta} numberOfLines={1}>
                    {eventTimeText(e)} · {creator(e)}
                    {e.location ? ` · ${e.location}` : ''}
                  </Text>
                </View>
                {e.repeat !== 'none' ? <Ionicons name="repeat" size={16} color={colors.muted} /> : null}
                <Avatar
                  name={mine ? myProfile?.display_name : partnerProfile?.display_name}
                  size={26}
                  tint={tintForProfile(mine ? myProfile : partnerProfile)}
                />
              </Pressable>
            );
          })}
        </View>
      )}

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
      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

/** "Mon, Oct 12" */
function shortDay(key: string): string {
  return new Date(`${key}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
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
  addBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  monthCard: { marginTop: spacing.sm },
  dayHeader: { flexDirection: 'row', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm },
  dayTitle: { ...font.h3, color: colors.text, flex: 1 },
  dayCount: { ...font.small, color: colors.muted },
  eventList: { gap: spacing.sm },
  eventCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
  },
  empty: { ...font.small, color: colors.muted, lineHeight: 19 },
  eventRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  bar: { width: 4, alignSelf: 'stretch', borderRadius: 2, minHeight: 36 },
  eventTitle: { ...font.body, fontWeight: '700', color: colors.text },
  eventMeta: { ...font.small, color: colors.subtext, marginTop: 2 },
}));
