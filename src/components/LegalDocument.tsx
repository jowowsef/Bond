import React from 'react';
import { ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackHeader } from '@/components/HeaderBar';
import type { LegalDoc } from '@/content/legal';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/** Renders a Privacy Policy / Terms document as plain, readable text. */
export function LegalDocument({ doc }: { doc: LegalDoc }) {
  useThemeVersion();
  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title={doc.title} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.intro}>{doc.intro}</Text>
        {doc.sections.map((s) => (
          <View key={s.heading} style={styles.section}>
            <Text style={styles.heading} accessibilityRole="header">
              {s.heading}
            </Text>
            {s.body?.map((p) => (
              <Text key={p} style={styles.body}>
                {p}
              </Text>
            ))}
            {s.bullets?.map((b) => (
              <View key={b} style={styles.bulletRow}>
                <Text style={styles.dot}>•</Text>
                <Text style={[styles.body, styles.bulletText]}>{b}</Text>
              </View>
            ))}
          </View>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2 },
  intro: { ...font.body, color: colors.subtext, lineHeight: 22 },
  section: { marginTop: spacing.xl, gap: spacing.sm },
  heading: { ...font.h3, color: colors.text },
  body: { ...font.body, color: colors.subtext, lineHeight: 22 },
  bulletRow: { flexDirection: 'row', gap: spacing.sm },
  dot: { ...font.body, color: colors.muted, lineHeight: 22 },
  bulletText: { flex: 1 },
}));
