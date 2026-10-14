import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { daysInMonth, monthTitle, toKey, weekdayOf } from '@/lib/calendarDates';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

const WEEK = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/** Who has events on a day: a blue dot for yours, a pink dot for your partner's. */
export type DayMarks = { me: boolean; partner: boolean };

/**
 * One month as a 7-column grid. Days from the months before and after fill
 * the first and last rows, dimmed. Each day with events gets a dot per person
 * (yours blue, your partner's pink); today is filled. Cells stretch with the
 * screen width, so it fits small and large Android phones.
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
  /** Dates ('YYYY-MM-DD') with events, and whose. */
  marked: Map<string, DayMarks>;
  onSelect: (key: string) => void;
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
}) {
  useThemeVersion();
  const first = toKey(year, month, 1);
  const lead = weekdayOf(first);
  const count = daysInMonth(year, month);
  const prevY = month === 1 ? year - 1 : year;
  const prevM = month === 1 ? 12 : month - 1;
  const nextY = month === 12 ? year + 1 : year;
  const nextM = month === 12 ? 1 : month + 1;
  const prevCount = daysInMonth(prevY, prevM);

  // { key, inMonth }: the grid always starts on Sunday and ends on Saturday.
  const cells: { key: string; inMonth: boolean }[] = [];
  for (let i = lead - 1; i >= 0; i--) cells.push({ key: toKey(prevY, prevM, prevCount - i), inMonth: false });
  for (let d = 1; d <= count; d++) cells.push({ key: toKey(year, month, d), inMonth: true });
  for (let d = 1; cells.length % 7 !== 0; d++) cells.push({ key: toKey(nextY, nextM, d), inMonth: false });
  const showToday = !today.startsWith(`${year}-${String(month).padStart(2, '0')}`);

  return (
    <View>
      <View style={styles.header}>
        <Pressable onPress={onPrev} hitSlop={10} accessibilityRole="button" accessibilityLabel="Previous month" style={styles.nav}>
          <Ionicons name="chevron-back" size={18} color={colors.text} />
        </Pressable>
        <Pressable onPress={showToday ? onToday : undefined} disabled={!showToday} style={{ flex: 1 }} accessibilityRole={showToday ? 'button' : 'header'}>
          <Text style={styles.title}>{monthTitle(year, month)}</Text>
          {showToday ? <Text style={styles.todayHint}>Tap to go to today</Text> : null}
        </Pressable>
        <Pressable onPress={onNext} hitSlop={10} accessibilityRole="button" accessibilityLabel="Next month" style={styles.nav}>
          <Ionicons name="chevron-forward" size={18} color={colors.text} />
        </Pressable>
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
          {cells.slice(r * 7, r * 7 + 7).map(({ key, inMonth }) => {
            const isSel = key === selected;
            const isToday = key === today;
            const marks = marked.get(key);
            const filled = isToday || isSel;
            return (
              <Pressable
                key={key}
                onPress={() => onSelect(key)}
                style={styles.cell}
                accessibilityRole="button"
                accessibilityState={{ selected: isSel }}
                accessibilityLabel={`${key}${marks ? ', has events' : ''}`}
              >
                <View
                  style={[
                    styles.day,
                    isToday && styles.dayToday,
                    isSel && !isToday && styles.daySelected,
                  ]}
                >
                  <Text
                    style={[
                      styles.dayText,
                      !inMonth && styles.dayOutside,
                      isToday && styles.dayTextToday,
                      isSel && !isToday && styles.dayTextSelected,
                    ]}
                  >
                    {Number(key.slice(8))}
                  </Text>
                </View>
                <View style={styles.dots}>
                  {marks?.me ? <View style={[styles.dot, { backgroundColor: colors.me }, !inMonth && styles.dotOutside]} /> : null}
                  {marks?.partner ? <View style={[styles.dot, { backgroundColor: colors.partner }, !inMonth && styles.dotOutside]} /> : null}
                  {!marks && !filled ? <View style={styles.dot} /> : null}
                </View>
              </Pressable>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = themedStyles(() => ({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  nav: {
    width: 32,
    height: 32,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { ...font.h3, color: colors.text, textAlign: 'center' },
  todayHint: { ...font.tiny, color: colors.primary, textAlign: 'center', letterSpacing: 0 },
  row: { flexDirection: 'row' },
  weekday: { flex: 1, textAlign: 'center', ...font.tiny, color: colors.muted, paddingVertical: 4 },
  cell: { flex: 1, alignItems: 'center', paddingVertical: 3 },
  day: { width: 34, height: 34, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  dayToday: { backgroundColor: colors.primary },
  daySelected: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: colors.primarySoft },
  dayText: { ...font.body, color: colors.text },
  dayOutside: { color: colors.muted, opacity: 0.6 },
  dayTextToday: { color: '#fff', fontWeight: '700' },
  dayTextSelected: { color: colors.primary, fontWeight: '700' },
  dots: { flexDirection: 'row', gap: 3, height: 5, marginTop: 2 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  dotOutside: { opacity: 0.5 },
}));
