import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { InfoCard } from './InfoCard';
import { colors, font, radius, spacing } from '@/lib/theme';

/**
 * Shows two people's screen time side by side with a simple comparison bar.
 * Values are plain strings like "2h 14m" so this works with placeholder
 * data now and real data later.
 */
export function ScreenTimeCard({
  myLabel,
  partnerLabel,
  myText,
  partnerText,
  myFraction = 0.5,
}: {
  myLabel: string;
  partnerLabel: string;
  myText: string;
  partnerText: string;
  /** 0..1 — how much of the bar is "me" vs "partner" (visual only). */
  myFraction?: number;
}) {
  const left = Math.max(0.08, Math.min(0.92, myFraction));
  return (
    <InfoCard icon="hourglass-outline" title="Screen Time" accent={colors.blue} accentBg={colors.blueSoft}>
      <View style={styles.row}>
        <Side label={myLabel} value={myText} align="flex-start" color={colors.blue} />
        <Side label={partnerLabel} value={partnerText} align="flex-end" color={colors.primary} />
      </View>
      <View style={styles.barTrack}>
        <View style={[styles.barFill, { flex: left, backgroundColor: colors.blue }]} />
        <View style={[styles.barFill, { flex: 1 - left, backgroundColor: colors.primary }]} />
      </View>
    </InfoCard>
  );
}

function Side({ label, value, align, color }: { label: string; value: string; align: 'flex-start' | 'flex-end'; color: string }) {
  return (
    <View style={{ alignItems: align, flex: 1 }}>
      <Text style={styles.label}>{label}</Text>
      <Text style={[styles.value, { color }]}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: spacing.md },
  label: { ...font.small, color: colors.muted },
  value: { ...font.number, fontSize: 24 },
  barTrack: {
    flexDirection: 'row',
    height: 10,
    borderRadius: radius.pill,
    overflow: 'hidden',
    backgroundColor: colors.border,
  },
  barFill: { height: '100%' },
});
