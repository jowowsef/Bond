import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * ONE source for header placement, measured from Home's "bond" logo row.
 * Every main screen's header row starts HEADER_TOP below the safe area (so it
 * never touches the status bar or camera cutout), is HEADER_HEIGHT tall with
 * its content centered, and is inset HEADER_SIDE from the left and right.
 */
export const HEADER_TOP = spacing.lg + spacing.xs; // 20
export const HEADER_HEIGHT = 54;
export const HEADER_SIDE = spacing.lg; // 16

/** The header row itself: left content (logo / title) and right actions. */
export function HeaderBar({
  left,
  right,
  style,
}: {
  left: React.ReactNode;
  right?: React.ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  useThemeVersion();
  return (
    <View style={[styles.bar, style]}>
      <View style={styles.left}>{left}</View>
      {right}
    </View>
  );
}

/**
 * A screen title. It starts at the left inset and is vertically centered in
 * the header row, exactly where Home's logo sits. One style for every screen.
 */
export function HeaderTitle({ title }: { title: string }) {
  useThemeVersion();
  return (
    <Text style={styles.title} numberOfLines={1}>
      {title}
    </Text>
  );
}

/**
 * Header for pushed screens (Activity, Settings, Statistics). The title sits
 * in the same upper-left spot as on Home and the tabs; the back button is a
 * round button on the right, styled like the bell and gear, so it never
 * pushes the title sideways. Sits above the scroll view so it stays put.
 */
export function StackHeader({ title, right, onBack }: { title: string; right?: React.ReactNode; onBack?: () => void }) {
  useThemeVersion();
  const router = useRouter();
  return (
    <View style={styles.stackWrap}>
      <HeaderBar
        left={<HeaderTitle title={title} />}
        right={
          <View style={styles.actions}>
            {right}
            <Pressable
              onPress={onBack ?? (() => router.back())}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel="Back"
              style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="chevron-back" size={20} color={colors.subtext} />
            </Pressable>
          </View>
        }
      />
    </View>
  );
}

const styles = themedStyles(() => ({
  bar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', height: HEADER_HEIGHT },
  left: { flex: 1, justifyContent: 'center', marginRight: spacing.sm },
  title: { ...font.title, color: colors.text },
  // Same offsets as the tab screens; bottom gap matches the old back header.
  stackWrap: { paddingHorizontal: HEADER_SIDE, paddingTop: HEADER_TOP, paddingBottom: spacing.md },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  // Same size and look as the gear / bell buttons.
  back: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));

/** The round Back button used by StackHeader, for screens that use <Screen>. */
export function BackButton() {
  useThemeVersion();
  const router = useRouter();
  return (
    <Pressable
      onPress={() => router.back()}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel="Back"
      style={({ pressed }) => [styles.back, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name="chevron-back" size={20} color={colors.subtext} />
    </Pressable>
  );
}
