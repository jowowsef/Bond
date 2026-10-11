import React from 'react';
import { Text, View } from 'react-native';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/** A small heading above a group of cards, with optional right-side content. */
export function SectionHeader({ title, right }: { title: string; right?: React.ReactNode }) {
  useThemeVersion();
  return (
    <View style={styles.row}>
      <Text style={styles.title}>{title}</Text>
      {right}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  title: { ...font.h3, color: colors.text },
}));
