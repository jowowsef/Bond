import React from 'react';
import { ScrollView, View, type RefreshControlProps } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { HEADER_SIDE, HEADER_TOP, HeaderBar, HeaderTitle } from '@/components/HeaderBar';
import { OfflineNote } from '@/components/OfflineNote';
import { colors, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * A page wrapper used by most screens: safe-area padding, the soft
 * background, an optional title header, and (optionally) scrolling.
 */
export function Screen({
  children,
  title,
  headerLeft,
  right,
  scroll = true,
  refreshControl,
}: {
  children: React.ReactNode;
  title?: string;
  /** Custom left header content (e.g. the logo on Home) instead of a title. */
  headerLeft?: React.ReactNode;
  right?: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  useThemeVersion();
  // A fixed-height header row keeps the right-side gear in exactly the same
  // position on every tab, whether the left side is a title or the logo.
  const header =
    title || headerLeft || right ? (
      <HeaderBar
        style={styles.header}
        left={headerLeft ?? (title ? <HeaderTitle title={title} /> : null)}
        right={right}
      />
    ) : null;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      {scroll ? (
        <ScrollView
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {header}
          <OfflineNote />
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.flex]}>
          {header}
          <OfflineNote />
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: HEADER_SIDE, paddingBottom: spacing.xxl * 2 },
  // The header row (fixed height, see HeaderBar) sits inside the padded
  // content, so it only adds what is left of HEADER_TOP after that padding.
  // Same row on every screen, whether the left side is a title or Home's logo.
  header: { marginTop: HEADER_TOP - HEADER_SIDE, marginBottom: spacing.lg },
}));
