import React from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  type RefreshControlProps,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { colors, font, spacing } from '@/lib/theme';

/**
 * A page wrapper used by most screens: safe-area padding, the soft
 * background, an optional title/subtitle header, and (optionally) scrolling.
 */
export function Screen({
  children,
  title,
  subtitle,
  headerLeft,
  right,
  scroll = true,
  refreshControl,
}: {
  children: React.ReactNode;
  title?: string;
  subtitle?: string;
  /** Custom left header content (e.g. the logo on Home) instead of a title. */
  headerLeft?: React.ReactNode;
  right?: React.ReactNode;
  scroll?: boolean;
  refreshControl?: React.ReactElement<RefreshControlProps>;
}) {
  // A fixed-height header row keeps the right-side gear in exactly the same
  // position on every tab, whether the left side is a title or the logo.
  const header =
    title || headerLeft || right ? (
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          {headerLeft ?? (
            <>
              {title ? <Text style={styles.title}>{title}</Text> : null}
              {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
            </>
          )}
        </View>
        {right}
      </View>
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
          {children}
        </ScrollView>
      ) : (
        <View style={[styles.content, styles.flex]}>
          {header}
          {children}
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl * 2 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    // Constant height (not minHeight) so the row is identical on every tab.
    // This keeps the right-side gear centered at the same vertical position
    // whether the left side is a title+subtitle (Activity/Location/Controls)
    // or just the logo (Home), which previously made Home's gear sit higher.
    height: 54,
    marginBottom: spacing.lg,
    marginTop: spacing.xs,
  },
  headerLeft: { flex: 1, justifyContent: 'center' },
  title: { ...font.title, color: colors.text },
  subtitle: { ...font.small, color: colors.subtext, marginTop: 2 },
});
