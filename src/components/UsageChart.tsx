import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { formatDuration } from '@/lib/format';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import type { UsageHour } from '../../modules/bond-usage';

const CHART_H = 112;
const HOUR_MS = 60 * 60 * 1000;

/** 0 -> "12 AM", 13 -> "1 PM" */
export function hourLabel(startMs: number): string {
  const h = new Date(startMs).getHours();
  return `${h % 12 || 12} ${h < 12 ? 'AM' : 'PM'}`;
}

/**
 * Hourly screen time for one day, straight from Android's usage log.
 * The scale is fixed at 60 minutes (one hour can never hold more), so bar
 * heights are honest and comparable between days. Tap a bar for its value.
 * Hours that have not happened yet are left empty, not drawn as zero use.
 */
export function UsageChart({ hours, now = Date.now(), color = colors.me }: { hours: UsageHour[]; now?: number; color?: string }) {
  useThemeVersion();
  const peakIndex = useMemo(() => {
    let best = -1;
    hours.forEach((h, i) => {
      if (h.ms > 0 && (best < 0 || h.ms > hours[best].ms)) best = i;
    });
    return best;
  }, [hours]);
  const [selected, setSelected] = useState<number | null>(null);
  const shown = selected ?? peakIndex;
  const n = hours.length;

  const caption =
    shown < 0
      ? 'No screen time yet today'
      : selected == null
        ? `Busiest hour: ${hourLabel(hours[shown].startMs)}, ${formatDuration(hours[shown].ms)}`
        : `${hourLabel(hours[shown].startMs)} to ${hourLabel(hours[shown].startMs + HOUR_MS)}: ${formatDuration(hours[shown].ms)}`;

  return (
    <View accessible accessibilityLabel={`Screen time by hour today. ${caption}`}>
      <Text style={styles.caption}>{caption}</Text>
      <View style={styles.chartRow}>
        <View style={styles.plot}>
          {/* Grid lines at 60m (top), 30m and 0 */}
          <View style={[styles.grid, { top: 0 }]} />
          <View style={[styles.grid, { top: CHART_H / 2 }]} />
          <View style={[styles.grid, styles.baseline, { top: CHART_H }]} />
          <View style={styles.bars}>
            {hours.map((h, i) => {
              const future = h.startMs > now;
              const height = h.ms > 0 ? Math.max(3, (Math.min(h.ms, HOUR_MS) / HOUR_MS) * CHART_H) : 0;
              const active = i === selected;
              return (
                <Pressable
                  key={h.startMs}
                  style={styles.column}
                  disabled={future}
                  onPress={() => setSelected(active ? null : i)}
                  accessibilityLabel={`${hourLabel(h.startMs)}, ${formatDuration(h.ms)}`}
                >
                  {height > 0 ? (
                    <View style={[styles.bar, { height, backgroundColor: active ? colors.primary : color }]} />
                  ) : null}
                </Pressable>
              );
            })}
          </View>
        </View>
        <View style={styles.yAxis}>
          <Text style={[styles.axisText, { top: -7 }]}>60m</Text>
          <Text style={[styles.axisText, { top: CHART_H / 2 - 7 }]}>30m</Text>
          <Text style={[styles.axisText, { top: CHART_H - 7 }]}>0</Text>
        </View>
      </View>
      <View style={styles.xAxis}>
        {hours.map((h, i) =>
          new Date(h.startMs).getHours() % 6 === 0 ? (
            <Text key={h.startMs} style={[styles.axisText, styles.xLabel, { left: `${(i / Math.max(1, n)) * 100}%` }]}>
              {hourLabel(h.startMs)}
            </Text>
          ) : null,
        )}
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  caption: { ...font.small, color: colors.subtext, marginBottom: spacing.md },
  chartRow: { flexDirection: 'row' },
  plot: { flex: 1, height: CHART_H },
  grid: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: colors.track },
  baseline: { backgroundColor: colors.border },
  bars: { position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, flexDirection: 'row', alignItems: 'flex-end' },
  column: { flex: 1, height: '100%', justifyContent: 'flex-end', paddingHorizontal: 1.5 },
  bar: { width: '100%', borderTopLeftRadius: 3, borderTopRightRadius: 3 },
  yAxis: { width: 34, height: CHART_H },
  axisText: { ...font.tiny, fontWeight: '500', letterSpacing: 0, color: colors.muted, position: 'absolute', right: 0 },
  xAxis: { height: 18, marginTop: spacing.xs, marginRight: 34 },
  xLabel: { right: undefined, width: 44 },
}));

