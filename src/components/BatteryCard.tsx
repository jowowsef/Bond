import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, font, spacing } from '@/lib/theme';

export type BatteryRow = {
  label: string;
  level: number; // 0..100
  charging: boolean;
};

/** Battery for both phones, one tidy row each. */
export function BatteryCard({ rows }: { rows: BatteryRow[] }) {
  return (
    <Card>
      <Text style={styles.title}>Battery</Text>
      {rows.map((row, i) => (
        <View key={row.label} style={[styles.row, i > 0 && styles.divider]}>
          <Text style={styles.label}>{row.label}</Text>
          <View style={styles.right}>
            {row.charging ? <Ionicons name="flash" size={14} color={colors.success} style={styles.icon} /> : null}
            <Text style={styles.value}>{row.level}%</Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

const styles = StyleSheet.create({
  title: { ...font.h3, color: colors.text, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  label: { ...font.body, fontWeight: '600', color: colors.text },
  right: { flexDirection: 'row', alignItems: 'center' },
  icon: { marginRight: 4 },
  value: { ...font.body, fontWeight: '700', color: colors.text },
});
