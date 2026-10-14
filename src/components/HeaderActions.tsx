import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { GearButton } from '@/components/GearButton';
import { useUnreadActivityCount } from '@/lib/activityUnread';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * Upper-right header buttons on every tab: Notifications (bell, with the
 * number of new ones) immediately left of the Settings gear. The gear stays in its usual spot at the far right.
 * `before` lets Home keep its avatar stack to the left of both.
 */
export function HeaderActions({ gearBadge = false, before }: { gearBadge?: boolean; before?: React.ReactNode }) {
  useThemeVersion();
  const router = useRouter();
  const unread = useUnreadActivityCount();
  return (
    <View style={styles.row}>
      {before}
      <Pressable
        onPress={() => router.push('/activity')}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={unread ? `Notifications, ${unread} new` : 'Notifications'}
        style={({ pressed }) => [styles.button, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="notifications-outline" size={20} color={colors.subtext} />
        {unread ? (
          <View style={styles.badge}>
            <Text style={styles.badgeText} numberOfLines={1}>
              {unread > 9 ? '9+' : unread}
            </Text>
          </View>
        ) : null}
      </Pressable>
      <GearButton badge={gearBadge} />
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Same size and look as the gear so the pair reads as one group.
  button: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -4,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: colors.danger,
    borderWidth: 1.5,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...font.tiny, fontSize: 10, letterSpacing: 0, color: '#fff', fontWeight: '800' },
}));
