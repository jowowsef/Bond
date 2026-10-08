import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '@/lib/theme';

/**
 * A two-column row: a person on the left, a value (plus optional badge) on
 * the right. Used inside cards to compare "Me" and "Partner".
 */
export function PersonStatRow({
  who,
  value,
  valueColor = colors.text,
  badge,
  last = false,
}: {
  who: string;
  value: string;
  valueColor?: string;
  badge?: React.ReactNode;
  last?: boolean;
}) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text style={styles.who}>{who}</Text>
      <View style={styles.right}>
        {badge}
        <Text style={[styles.value, { color: valueColor }]}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm + 2,
  },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  who: { ...font.body, color: colors.subtext },
  right: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  value: { ...font.h3, color: colors.text },
});
