import React from 'react';
import { View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, radius, shadow, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/** A white, rounded container with a hairline border and a very soft shadow. */
export function Card({
  children,
  style,
  tint,
}: {
  children: React.ReactNode;
  style?: StyleProp<ViewStyle>;
  tint?: string;
}) {
  useThemeVersion();
  return <View style={[styles.card, tint ? { backgroundColor: tint } : null, style]}>{children}</View>;
}

const styles = themedStyles(() => ({
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    ...shadow,
  },
}));
