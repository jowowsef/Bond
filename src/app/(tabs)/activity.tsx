import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { RefreshControl, StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { GearButton } from '@/components/GearButton';
import { Screen } from '@/components/Screen';
import { activityMessage, activityVisual, useActivityFeed } from '@/hooks/useActivityFeed';
import { formatDateTime } from '@/lib/format';
import { colors, font, radius, spacing } from '@/lib/theme';
import type { ActivityLog } from '@/lib/types';
import { useCouple } from '@/state/couple';

/**
 * ACTIVITY — the couple's real timeline (from activity_logs). Shows proper
 * loading, empty, and error states instead of mock events.
 */
export default function Activity() {
  const { logs, loading, error, reload } = useActivityFeed(50);
  const { myProfile, partnerProfile } = useCouple();
  const names = { myName: myProfile?.display_name, partnerName: partnerProfile?.display_name };

  return (
    <Screen
      title="Activity"
      subtitle="What's happening between you two"
      right={<GearButton />}
      refreshControl={<RefreshControl refreshing={false} onRefresh={reload} tintColor={colors.primary} />}
    >
      {loading ? (
        <Card>
          <Text style={styles.state}>Loading…</Text>
        </Card>
      ) : error ? (
        <Card>
          <Text style={styles.state}>Couldn&apos;t load activity. Pull down to try again.</Text>
        </Card>
      ) : logs.length === 0 ? (
        <Card style={styles.emptyCard}>
          <Ionicons name="pulse-outline" size={28} color={colors.muted} />
          <Text style={styles.emptyTitle}>No activity yet</Text>
          <Text style={styles.state}>Requests, approvals, and sharing changes will appear here.</Text>
        </Card>
      ) : (
        <Card style={{ paddingVertical: spacing.sm }}>
          {logs.map((log, i) => (
            <TimelineRow key={log.id} log={log} names={names} last={i === logs.length - 1} />
          ))}
        </Card>
      )}
    </Screen>
  );
}

function TimelineRow({
  log,
  names,
  last,
}: {
  log: ActivityLog;
  names: { myName?: string | null; partnerName?: string | null };
  last: boolean;
}) {
  const v = activityVisual(log.kind);
  return (
    <View style={styles.row}>
      <View style={styles.rail}>
        <View style={styles.dot}>
          <Ionicons name={v.icon as React.ComponentProps<typeof Ionicons>['name']} size={16} color={colors.primary} />
        </View>
        {!last ? <View style={styles.line} /> : null}
      </View>
      <View style={styles.rowText}>
        <Text style={styles.message}>{activityMessage(log, names)}</Text>
        <Text style={styles.time}>{formatDateTime(log.created_at)}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  state: { ...font.small, color: colors.muted, lineHeight: 19 },
  emptyCard: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs },
  emptyTitle: { ...font.h3, color: colors.text, marginTop: spacing.sm },
  row: { flexDirection: 'row' },
  rail: { alignItems: 'center', width: 40 },
  dot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { width: 2, flex: 1, backgroundColor: colors.border, marginVertical: 2 },
  rowText: { flex: 1, paddingVertical: spacing.sm, paddingBottom: spacing.lg, marginLeft: spacing.sm },
  message: { ...font.body, color: colors.text, lineHeight: 20 },
  time: { ...font.small, color: colors.muted, marginTop: 2 },
});
