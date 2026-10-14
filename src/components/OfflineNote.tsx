import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Text, View } from 'react-native';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * A small note while Bond can't reach the server: what's on screen is the
 * last saved data (each item still shows its own "updated" time). Hidden when
 * online. Bond reconnects by itself.
 */
export function OfflineNote({ style }: { style?: object }) {
  useThemeVersion();
  const { online, userId } = useCouple();
  if (online || !userId) return null;
  return (
    <View style={[styles.note, style]} accessibilityLiveRegion="polite" accessibilityLabel="Offline. Showing saved info.">
      <Ionicons name="cloud-offline-outline" size={14} color={colors.subtext} />
      <Text style={styles.text}>Offline · showing saved info</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  note: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.track,
    marginBottom: spacing.md,
  },
  text: { ...font.small, color: colors.subtext },
}));
