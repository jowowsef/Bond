import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, radius } from '@/lib/theme';

export type BadgeTone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'blue';

const TONES: Record<BadgeTone, { bg: string; fg: string }> = {
  neutral: { bg: colors.border, fg: colors.subtext },
  primary: { bg: colors.primarySoft, fg: colors.primary },
  success: { bg: colors.successSoft, fg: colors.success },
  warning: { bg: colors.warningSoft, fg: colors.warning },
  danger: { bg: colors.dangerSoft, fg: colors.danger },
  blue: { bg: colors.blueSoft, fg: colors.blue },
};

/** A small rounded status label, e.g. "ON", "Pending", "Online". */
export function StatusBadge({ label, tone = 'neutral', dot = false }: { label: string; tone?: BadgeTone; dot?: boolean }) {
  const { bg, fg } = TONES[tone];
  return (
    <View style={[styles.badge, { backgroundColor: bg }]}>
      {dot ? <View style={[styles.dot, { backgroundColor: fg }]} /> : null}
      <Text style={[styles.text, { color: fg }]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    borderRadius: radius.pill,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  text: { fontSize: 12, fontWeight: '700', letterSpacing: 0.2 },
});
