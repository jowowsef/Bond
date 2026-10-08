import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { Screen } from '@/components/Screen';
import { MOCK_ACTIVITY, type MockActivity } from '@/lib/placeholders';
import { colors, font, radius, spacing } from '@/lib/theme';

/**
 * ACTIVITY — a timeline of couple events. Uses placeholder events for now;
 * later it will read the real activity_logs table from Supabase.
 */
export default function Activity() {
  return (
    <Screen title="Activity" subtitle="What's happening between you two">
      <Card style={{ paddingVertical: spacing.sm }}>
        {MOCK_ACTIVITY.map((item, i) => (
          <TimelineRow key={item.id} item={item} last={i === MOCK_ACTIVITY.length - 1} />
        ))}
      </Card>
      <Text style={styles.note}>Example timeline — real events appear here as you use the app.</Text>
    </Screen>
  );
}

const TONES: Record<MockActivity['tone'], { bg: string; fg: string }> = {
  primary: { bg: colors.primarySoft, fg: colors.primary },
  success: { bg: colors.successSoft, fg: colors.success },
  blue: { bg: colors.blueSoft, fg: colors.blue },
  neutral: { bg: colors.border, fg: colors.subtext },
  warning: { bg: colors.warningSoft, fg: colors.warning },
};

function TimelineRow({ item, last }: { item: MockActivity; last: boolean }) {
  const tone = TONES[item.tone];
  return (
    <View style={styles.row}>
      <View style={styles.railColumn}>
        <View style={[styles.dot, { backgroundColor: tone.bg }]}>
          <Ionicons name={item.icon as React.ComponentProps<typeof Ionicons>['name']} size={16} color={tone.fg} />
        </View>
        {!last ? <View style={styles.line} /> : null}
      </View>
      <View style={styles.textCol}>
        <Text style={styles.title}>{item.title}</Text>
        <Text style={styles.time}>{item.time}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row' },
  railColumn: { alignItems: 'center', width: 44 },
  dot: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  line: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  textCol: { flex: 1, paddingVertical: spacing.sm, paddingBottom: spacing.lg, marginLeft: spacing.sm },
  title: { ...font.h3, fontWeight: '600', color: colors.text },
  time: { ...font.small, color: colors.muted, marginTop: 2 },
  note: { ...font.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
});
