import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StackHeader } from '@/components/HeaderBar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { activityMessage, activityTitle, activityVisual, useActivityFeed } from '@/hooks/useActivityFeed';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { getActivitySeenAt, markActivitySeen } from '@/lib/activityUnread';
import { readInbox, type InboxItem } from '@/lib/notifications';
import { formatDayHeading, formatTime, startOfDay, shownName } from '@/lib/format';
import { colors, font, radius, spacing, themed, themedStyles, useThemeVersion } from '@/lib/theme';
import type { ActivityLog } from '@/lib/types';
import { useCouple } from '@/state/couple';

type Tone = ReturnType<typeof activityVisual>['tone'];

/** Icon colors per tone, from Bond's existing palette. */
const TONE: Record<Tone, { fg: string; bg: string }> = themed(() => ({
  primary: { fg: colors.primary, bg: colors.primarySoft },
  success: { fg: colors.success, bg: colors.successSoft },
  blue: { fg: colors.blue, bg: colors.meSoft },
  warning: { fg: colors.warning, bg: colors.warningSoft },
  neutral: { fg: colors.subtext, bg: colors.track },
}));

/**
 * ACTIVITY: the couple's real timeline (from activity_logs), grouped by day.
 * Opened from the bell next to the Settings gear; viewing it clears the bell
 * dot. Items that arrived since your previous visit keep a small red dot
 * while you are here, so you can see what is new.
 */
export default function Activity() {
  useThemeVersion();
  const { logs, loading, error, reload } = useActivityFeed(50);
  const { userId, myProfile, partnerProfile } = useCouple();
  const names = { myName: myProfile?.display_name, partnerName: shownName(partnerProfile?.display_name, 'Your partner'), myUserId: userId };
  // Notifications Bond showed on this phone (low battery, reminders, daily summary).
  const [inbox, setInbox] = useState<InboxItem[]>([]);
  const loadInbox = useCallback(() => void readInbox().then(setInbox), []);
  useFocusEffect(loadInbox);
  const { refreshing, onRefresh } = usePullToRefresh(async () => {
    loadInbox();
    await reload();
  });

  // "New" = after the previous visit; captured before this visit marks all seen.
  const [previousSeenAt] = useState(() => getActivitySeenAt());

  // Seen while open: on focus, and again whenever new rows arrive here.
  useFocusEffect(
    useCallback(() => {
      markActivitySeen();
    }, []),
  );
  useEffect(() => {
    if (logs.length > 0) markActivitySeen();
  }, [logs]);

  // Both kinds in one timeline, newest first, grouped by day.
  type Entry = { at: number; log?: ActivityLog; note?: InboxItem };
  const groups = useMemo(() => {
    const entries: Entry[] = [
      ...logs.map((log) => ({ at: new Date(log.created_at).getTime(), log })),
      ...inbox.map((note) => ({ at: note.at, note })),
    ].sort((a, b) => b.at - a.at);
    const out: { key: number; heading: string; items: Entry[] }[] = [];
    for (const e of entries) {
      const key = startOfDay(new Date(e.at)).getTime();
      const last = out[out.length - 1];
      if (last && last.key === key) last.items.push(e);
      else out.push({ key, heading: formatDayHeading(new Date(e.at).toISOString()), items: [e] });
    }
    return out;
  }, [logs, inbox]);

  const isNew = (log: ActivityLog) =>
    previousSeenAt != null && log.actor_id !== userId && new Date(log.created_at).getTime() > previousSeenAt;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title="Notifications" />
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
        }
      >
        {loading ? (
          <Card style={styles.stateCard}>
            <Text style={styles.stateText}>Loading…</Text>
          </Card>
        ) : error && logs.length === 0 ? (
          <Card style={styles.stateCard}>
            <Ionicons name="cloud-offline-outline" size={28} color={colors.muted} />
            <Text style={styles.stateTitle}>Couldn&apos;t load notifications</Text>
            <Text style={styles.stateText}>Check your connection, then pull down or try again.</Text>
            <Button label="Try again" small variant="secondary" onPress={onRefresh} style={{ marginTop: spacing.sm }} />
          </Card>
        ) : logs.length === 0 && inbox.length === 0 ? (
          <Card style={styles.stateCard}>
            <Ionicons name="notifications-outline" size={28} color={colors.muted} />
            <Text style={styles.stateTitle}>No notifications yet</Text>
            <Text style={styles.stateText}>Requests and sharing changes show up here.</Text>
          </Card>
        ) : (
          <>
            {error ? <Text style={styles.inlineError}>Couldn&apos;t refresh. Showing saved notifications.</Text> : null}
            {groups.map((g) => (
              <View key={g.key} style={styles.group}>
                <Text style={styles.groupHeading}>{g.heading}</Text>
                <View style={styles.items}>
                  {g.items.map((e) =>
                    e.log ? (
                      <ActivityItem key={e.log.id} log={e.log} names={names} unread={isNew(e.log)} />
                    ) : e.note ? (
                      <NoteItem key={`n-${e.note.id}`} note={e.note} unread={previousSeenAt != null && e.note.at > previousSeenAt} />
                    ) : null,
                  )}
                </View>
              </View>
            ))}
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

/** A notification Bond showed on this phone (same look as the activity rows). */
function NoteItem({ note, unread }: { note: InboxItem; unread: boolean }) {
  useThemeVersion();
  const icon: React.ComponentProps<typeof Ionicons>['name'] =
    note.kind === 'battery_low' ? 'battery-dead-outline' : note.kind === 'calendar_reminder' ? 'calendar-outline' : note.kind === 'daily_summary' ? 'moon-outline' : 'notifications-outline';
  const tone = note.kind === 'battery_low' ? TONE.warning : TONE.primary;
  const time = formatTime(new Date(note.at).toISOString());
  return (
    <Card style={styles.item}>
      <View style={styles.itemRow} accessible accessibilityLabel={`${unread ? 'New. ' : ''}${note.title}. ${note.body}. ${time}`}>
        <View style={[styles.icon, { backgroundColor: tone.bg }]}>
          <Ionicons name={icon} size={18} color={tone.fg} />
        </View>
        <View style={styles.itemText}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {note.title}
            </Text>
            <Text style={styles.time}>{time}</Text>
            {unread ? <View style={styles.unreadDot} /> : null}
          </View>
          <Text style={styles.message}>{note.body}</Text>
        </View>
      </View>
    </Card>
  );
}

function ActivityItem({
  log,
  names,
  unread,
}: {
  log: ActivityLog;
  names: { myName?: string | null; partnerName?: string | null; myUserId?: string | null };
  unread: boolean;
}) {
  useThemeVersion();
  const v = activityVisual(log.kind);
  const tone = TONE[v.tone];
  const title = activityTitle(log.kind);
  const message = activityMessage(log, names);
  const time = formatTime(log.created_at);
  return (
    <Card style={styles.item}>
      <View
        style={styles.itemRow}
        accessible
        accessibilityLabel={`${unread ? 'New. ' : ''}${title}. ${message}. ${time}`}
      >
        <View style={[styles.icon, { backgroundColor: tone.bg }]}>
          <Ionicons name={v.icon as React.ComponentProps<typeof Ionicons>['name']} size={18} color={tone.fg} />
        </View>
        <View style={styles.itemText}>
          <View style={styles.titleRow}>
            <Text style={styles.title} numberOfLines={1}>
              {title}
            </Text>
            <Text style={styles.time}>{time}</Text>
            {unread ? <View style={styles.unreadDot} /> : null}
          </View>
          <Text style={styles.message}>{message}</Text>
        </View>
      </View>
    </Card>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl * 2 },
  stateCard: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.xs, marginTop: spacing.md },
  stateTitle: { ...font.h3, color: colors.text, marginTop: spacing.sm },
  stateText: { ...font.small, color: colors.muted, lineHeight: 19, textAlign: 'center' },
  inlineError: { ...font.small, color: colors.danger, marginTop: spacing.sm },
  group: { marginTop: spacing.lg },
  groupHeading: {
    ...font.tiny,
    color: colors.muted,
    textTransform: 'uppercase',
    marginBottom: spacing.sm,
    paddingHorizontal: spacing.xs,
  },
  items: { gap: spacing.sm },
  item: { paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  itemRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  icon: { width: 36, height: 36, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  itemText: { flex: 1, minWidth: 0 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, minHeight: 20 },
  title: { ...font.body, fontWeight: '700', color: colors.text, flex: 1 },
  time: { ...font.small, color: colors.muted },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: colors.danger },
  message: { ...font.small, color: colors.subtext, lineHeight: 19, marginTop: 2 },
}));
