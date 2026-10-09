import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { formatDuration } from '@/lib/format';
import { colors, font, radius, spacing } from '@/lib/theme';

export type ScreenTimeRow = {
  label: string;
  minutes: number;
  color: string;
};

/**
 * Screen time for both of you: each person gets a name, a total, and a thin
 * bar in their colour. Bars share one scale (the bigger total, rounded up to
 * the next hour, plus one hour of headroom) so they're easy to compare.
 */
export function ScreenTimeCard({ rows, periodLabel = 'Today' }: { rows: ScreenTimeRow[]; periodLabel?: string }) {
  const biggest = Math.max(0, ...rows.map((r) => r.minutes));
  const scale = Math.max(240, (Math.ceil(biggest / 60) + 1) * 60);

  return (
    <Card>
      <View style={styles.header}>
        <Text style={styles.title}>Screen time</Text>
        <Text style={styles.period}>{periodLabel}</Text>
      </View>
      {rows.map((row, i) => (
        <View key={row.label} style={i > 0 ? styles.rowGap : null}>
          <View style={styles.rowTop}>
            <Text style={styles.label}>{row.label}</Text>
            <Text style={styles.value}>{formatDuration(row.minutes * 60_000)}</Text>
          </View>
          <View style={styles.track}>
            <View
              style={[styles.fill, { width: `${Math.min(100, (row.minutes / scale) * 100)}%`, backgroundColor: row.color }]}
            />
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.lg },
  title: { ...font.h3, color: colors.text },
  period: { ...font.small, color: colors.subtext },
  rowGap: { marginTop: spacing.md },
  rowTop: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.sm },
  label: { ...font.body, fontWeight: '600', color: colors.text },
  value: { ...font.body, fontWeight: '700', color: colors.text },
  track: { height: 8, borderRadius: radius.pill, backgroundColor: colors.track, overflow: 'hidden' },
  fill: { height: '100%', borderRadius: radius.pill },
});
