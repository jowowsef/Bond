import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, font, radius, spacing } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * A titled card with an icon header and any content inside. Used all over
 * Home / Controls / Location for the "Screen Time", "Battery", etc. boxes.
 */
export function InfoCard({
  icon,
  title,
  accent = colors.primary,
  accentBg = colors.primarySoft,
  right,
  children,
}: {
  icon: IconName;
  title: string;
  accent?: string;
  accentBg?: string;
  right?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <Card>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
          <Ionicons name={icon} size={18} color={accent} />
        </View>
        <Text style={styles.title}>{title}</Text>
        <View style={styles.right}>{right}</View>
      </View>
      {children}
    </Card>
  );
}

const styles = StyleSheet.create({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  iconWrap: {
    width: 34,
    height: 34,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  title: { ...font.h3, color: colors.text, flex: 1 },
  right: { marginLeft: spacing.sm },
});
