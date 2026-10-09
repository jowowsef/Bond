import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, font, spacing } from '@/lib/theme';

/**
 * Website protection status for both phones. This is STATUS ONLY — it can't
 * switch anything on or off from Home, because changing protection on a
 * phone always needs that phone's owner to agree. Tapping opens Controls.
 */
export function SafeBrowsingCard({
  meOn,
  partnerOn,
  partnerName,
  onPress,
}: {
  meOn: boolean;
  partnerOn: boolean;
  partnerName: string;
  onPress?: () => void;
}) {
  const subtitle =
    meOn && partnerOn
      ? 'On for both of you'
      : partnerOn
        ? `On for ${partnerName}`
        : meOn
          ? 'On for you'
          : 'Off for both of you';

  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card style={styles.row}>
        <View style={styles.text}>
          <Text style={styles.title}>Safe browsing</Text>
          <Text style={styles.subtitle}>{subtitle}</Text>
        </View>
        <Ionicons name="chevron-forward" size={20} color={colors.muted} />
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
  text: { flex: 1, marginRight: spacing.md },
  title: { ...font.h3, color: colors.text },
  subtitle: { ...font.small, color: colors.subtext, marginTop: 2 },
});
