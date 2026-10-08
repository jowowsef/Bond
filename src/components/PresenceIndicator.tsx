import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { PresenceState } from '@/lib/presence';
import { colors, font } from '@/lib/theme';

/**
 * A small status line: a coloured dot + text, e.g. "● Online" or
 * "● Last active 5 min ago". Uses a plain coloured dot (a View), not an emoji.
 */
const DOT_COLOR: Record<PresenceState, string> = {
  online: colors.success,
  last_active: colors.muted,
  unavailable: colors.muted,
};

export function PresenceIndicator({ state, label }: { state: PresenceState; label: string }) {
  const online = state === 'online';
  return (
    <View style={styles.row}>
      <View style={[styles.dot, { backgroundColor: DOT_COLOR[state] }]} />
      <Text style={[styles.text, online && styles.textOnline]} numberOfLines={1}>
        {label}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, marginRight: 6 },
  text: { ...font.small, color: colors.subtext },
  textOnline: { color: colors.success, fontWeight: '700' },
});
