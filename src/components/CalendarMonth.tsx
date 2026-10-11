import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { daysInMonth, monthTitle, toKey, weekdayOf } from '@/lib/calendarDates';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * One month as a 7-column grid. Days with events get a dot; today has a ring;
 * the selected day is filled. Cells stretch with the screen width, so it fits
 * small and large Android phones.
 */
export function CalendarMonth({
  year,
  month,
  today,
  selected,
  marked,
  onSelect,
  onPrev,
  onNext,
  onToday,
}: {
  year: number;
  month: number;
  today: string;
  selected: string;
  /** Dates ('YYYY-MM-DD') that have at least one event. */
  marked: Set<string>;
  onSelect: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  useThemeVersion();
  const first = toKey(year, month, 1);
  const lead = weekdayOf(first);
  const count = daysInMonth(year, month);
  const cells: (string | null)[] = [...Array(lead).fill(null)];
  for (let d = 1; d <= count; d++) cells.push(toKey(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  const showToday = !today.startsWith(`${year}-${String(month).padStart(2, '0')}`) || selected !== today;

  return (
    <View>
      <View style={styles.header}>
        <Pressable onPress={onPrev} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.nav}>
          <Ionicons name="chevron-back" size={20} color={colors.text} />
        </Pressable>
        <Text style={styles.title} accessibilityRole="header">
          {monthTitle(year, month)}
        </Text>
        <Pressable onPress={onNext} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month" style={styles.nav}>
          <Ionicons name="chevron-forward" size={20} color={colors.text} />
        </Pressable>
        {showToday ? (
          <Pressable onPress={onToday} hitSlop={8} accessibilityRole="button" style={styles.todayBtn}>
            <Text style={styles.todayText}>Today</Text>
          </Pressable>
        ) : null}
      </View>
      <View style={styles.row}>
        {WEEK.map((w, i) => (
          <Text key={i} style={styles.weekday}>
            {w}
          </Text>
        ))}
      </View>
      {Array.from({ length: cells.length / 7 }, (_, r) => (
        <View key={r} style={styles.row}>
          {cells.slice(r * 7, r * 7 + 7).map((key, i) => {
            if (!key) return <View key={i} style={styles.cell} />;
            const isSel = key === selected;
            const isToday = key === today;
            const has = marked.has(key);
            return (
              <Pressable
                key={key}
                onPress={() => onSelect(key)}
                style={styles.cell}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                accessibilityLabel={`${key}${has ? ', has events' : ''}`}
              >
                <View style={[styles.day, isToday && styles.dayToday, isSel && styles.daySelected]}>
                  <Text style={[styles.dayText, isSel && styles.dayTextSelected]}>{Number(key.slice(8))}</Text>
                </View>
                <View style={[styles.dot, has && { backgroundColor: isSel ? colors.primary : colors.partner }]} />
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = themedStyles(() => ({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  nav: { padding: spacing.xs },
  title: { ...font.h3, color: colors.text, flex: 1, textAlign: 'center' },
  todayBtn: {
    marginLeft: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  todayText: { ...font.small, fontWeight: '700', color: colors.primary },
  row: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', ...font.tiny, color: colors.muted, paddingVertical: 4 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayToday: { borderWidth: 1.5, borderColor: colors.primary },
  daySelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  dayText: { ...font.body, color: colors.text },
  dayTextSelected: { color: '#fff', fontWeight: '700' },
  dot: { width: 5, height: 5, borderRadius: 3, marginTop: 2 },
}));
