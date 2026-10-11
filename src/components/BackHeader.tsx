import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * A simple screen header with a back chevron and a title.
 * Used across the mutual-pairing screens so they share one look.
 * `right`: an optional control at the top right (for example Settings).
 */
export function BackHeader({ title, onBack, right }: { title?: string; onBack?: () => void; right?: React.ReactNode }) {
  useThemeVersion();
  const router = useRouter();
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack ?? (() => router.back())} hitSlop={12} style={styles.backBtn}>
        <Ionicons name="chevron-back" size={24} color={colors.text} />
      </Pressable>
      <Text style={styles.title} numberOfLines={1}>
        {title ?? ''}
      </Text>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingVertical: spacing.md },
  backBtn: { marginRight: spacing.sm },
  title: { ...font.h2, color: colors.text, flex: 1 },
  right: { marginLeft: spacing.sm },
}));
