import { useLocalSearchParams } from 'expo-router';
import React, { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AppUsageRow } from '@/components/AppUsageRow';
import { UsageChart } from '@/components/UsageChart';
import { StackHeader } from '@/components/HeaderBar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { useAppIcons } from '@/hooks/useAppIcons';
import { useMyUsage } from '@/hooks/useMyUsage';
import { PARTNER_STALE_MS, usePartnerUsage } from '@/hooks/usePartnerUsage';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { askConfirm } from '@/lib/consent';
import { dayKey, formatDuration, formatTime, startOfDay, timeAgo } from '@/lib/format';
import { requestUsageAccess } from '@/lib/usageAccessFlow';
import { mostUsedToday, partnerRowsForDay, recentlyUsedToday, type UsageRow } from '@/lib/screenTimeToday';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

type Tab = 'most' | 'recent';
/** Used within this long of the reading = still on screen ("Now"). */
const NOW_WINDOW_MS = 60 * 1000;

type Row = UsageRow;

/**
 * SCREEN TIME STATISTICS for ONE person, TODAY only (real data only; no
 * earlier days are shown or mixed in).
 *
 *   /screen-time-stats                 -> my phone, read live from Android
 *   /screen-time-stats?who=partner     -> what my partner's phone uploaded
 *                                         (only while they share screen time)
 *
 * Today's total, Most used (all of today's apps by time on screen, highest
 * first) and Recently used (when each app was last on screen today, newest
 * first), with names, durations and last-used times where they exist. Both
 * lists come from Android's usage log; nothing is estimated. Mine also has
 * today's hour-by-hour graph (my phone has it; the partner's phone shares
 * totals per app only). Opened from Home and the Screen Time tab.
 *
 * "Today" = this phone's local calendar day: from local midnight to now.
 */
export default function ScreenTimeStats() {
  useThemeVersion();
  const { who } = useLocalSearchParams<{ who?: string }>();
  const forPartner = who === 'partner';
  const { partnerId, partnerProfile } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Your partner';

  // Today, as this phone's local date (recomputed on every render, so it moves
  // on after midnight).
  const day = dayKey();
  const todayStart = startOfDay().getTime();
  const dayLabel = 'today';

  // Both loaders exist (hooks can't be conditional); only the chosen one is
  // loaded: mine reads this phone, the partner's reads THEIR uploaded rows.
  const mine = useMyUsage();
  const partner = usePartnerUsage(forPartner ? partnerId : null, day);
  const reload = forPartner ? partner.reload : mine.reload;
  const { refreshing, onRefresh, failed } = usePullToRefresh(reload);
  const [tab, setTab] = useState<Tab>('most');

  // ---- normalise into one shape ----
  let rows: Row[] = [];
  let totalMs = 0;
  let launches: number | null = null;
  let readAt = Date.now();
  let status: React.ReactNode = null; // a message instead of the statistics
  let updatedAt: string | null = null;
  let hasLastUsed = true;

  if (forPartner) {
    if (!partnerId) status = <Text style={styles.muted}>No partner connected.</Text>;
    else if (partner.loading) status = <Text style={styles.muted}>Loading…</Text>;
    else if (partner.error && !partner.total)
      status = <Text style={styles.muted}>Couldn&apos;t load {partnerName}&apos;s screen time. Pull down to try again.</Text>;
    else if (partner.sharing === false)
      status = <Text style={styles.muted}>{partnerName} isn&apos;t sharing screen time right now.</Text>;
    else if (!partner.total)
      status = (
        <Text style={styles.muted}>
          No screen time from {partnerName} {dayLabel}. It appears once their phone has Usage access on and sends an
          update.
        </Text>
      );
    else {
      totalMs = partner.total.total_ms;
      launches = partner.total.launches;
      updatedAt = partner.total.updated_at;
      readAt = new Date(partner.total.updated_at).getTime();
      rows = partnerRowsForDay(partner.apps, day); // only today's rows, never an earlier day
      hasLastUsed = rows.some((r) => r.lastUsedMs !== null);
    }
  } else {
    const s = mine.state;
    if (s.kind === 'loading') status = <Text style={styles.muted}>Loading…</Text>;
    else if (s.kind === 'needs-update' || s.kind === 'unsupported')
      status = (
        <Text style={styles.muted}>
          {s.kind === 'unsupported' ? 'Screen Time works on Android only.' : 'Statistics need the newest version of Bond on this phone.'}
        </Text>
      );
    else if (s.kind === 'no-access')
      status = (
        <View style={{ gap: spacing.md }}>
          <Text style={styles.muted}>Turn on &quot;Usage access&quot; for Bond in Android Settings to see your statistics.</Text>
          <Button
            label="Open Usage access settings"
            small
            onPress={() => void requestUsageAccess('Statistics read app names and time spent on this phone, never what you do inside apps.')}
            style={{ alignSelf: 'flex-start' }}
          />
        </View>
      );
    else if (s.kind === 'error') status = <Text style={styles.muted}>Couldn&apos;t read this phone&apos;s usage. Pull down to try again.</Text>;
    else {
      totalMs = s.usage.totalMs;
      launches = s.usage.launches;
      readAt = s.readAt;
      rows = s.usage.apps.map((a) => ({
        packageName: a.packageName,
        appName: a.appName,
        ms: a.foregroundMs,
        lastUsedMs: typeof a.lastUsedMs === 'number' && a.lastUsedMs > 0 ? a.lastUsedMs : null,
      }));
      hasLastUsed = s.usage.apps.every((a) => typeof a.lastUsedMs === 'number');
    }
  }

  const mostUsed = mostUsedToday(rows);
  // Recently used: only apps last used since local midnight (an older time
  // would belong to an earlier day), newest first.
  const recent = recentlyUsedToday(rows, todayStart);
  const myHours = !forPartner && mine.state.kind === 'ready' ? mine.state.usage.hourly ?? null : null;
  const list = tab === 'most' ? mostUsed : recent;
  const icons = useAppIcons(list.map((a) => a.packageName));
  const top = mostUsed[0]?.ms ?? 0;
  const stale = forPartner && !!updatedAt && partner.now - new Date(updatedAt).getTime() > PARTNER_STALE_MS;

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <StackHeader title={forPartner ? `${partnerName}'s statistics` : 'Your statistics'} />
      <Text style={[styles.whose, { color: forPartner ? colors.partner : colors.me }]}>
        {forPartner ? `${partnerName}'s phone · Today` : 'Your phone · Today'}
      </Text>
      <ScrollView
        contentContainerStyle={styles.content}
        showsVerticalScrollIndicator={false}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
      >
        {failed ? <Text style={styles.error}>Couldn&apos;t refresh. Pull down to try again.</Text> : null}

        {status ? (
          <Card>{status}</Card>
        ) : (
          <>
            <Card style={styles.summary}>
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Screen time</Text>
                <Text style={styles.summaryValue}>{formatDuration(totalMs)}</Text>
              </View>
              <View style={styles.summaryDivider} />
              <View style={styles.summaryItem}>
                <Text style={styles.summaryLabel}>Apps used</Text>
                <Text style={styles.summaryValue}>{rows.length}</Text>
              </View>
              {launches !== null ? (
                <>
                  <View style={styles.summaryDivider} />
                  <View style={styles.summaryItem}>
                    <Text style={styles.summaryLabel}>App opens</Text>
                    <Text style={styles.summaryValue}>{launches}</Text>
                  </View>
                </>
              ) : null}
            </Card>
            {updatedAt ? (
              <Text style={[styles.hint, stale && { color: colors.warning }]}>
                Last synced from {partnerName}&apos;s phone {timeAgo(updatedAt, partner.now)} ({formatTime(updatedAt)})
                {stale ? ' · not current' : ''}.
              </Text>
            ) : null}

            {myHours && myHours.length > 0 ? (
              <Card style={styles.chartCard}>
                <Text style={styles.chartLabel}>Today by hour</Text>
                <UsageChart hours={myHours} now={readAt} />
              </Card>
            ) : null}

            <View style={styles.segment} accessibilityRole="tablist">
              {(
                [
                  ['most', 'Most used'],
                  ['recent', 'Recently used'],
                ] as const
              ).map(([key, label]) => {
                const active = tab === key;
                return (
                  <Pressable
                    key={key}
                    onPress={() => setTab(key)}
                    accessibilityRole="tab"
                    accessibilityState={{ selected: active }}
                    style={[styles.segmentItem, active && styles.segmentActive]}
                  >
                    <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{label}</Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>
              {tab === 'most'
                ? `Sorted by time on screen ${dayLabel}, highest first.`
                : `Sorted by when each app was last on screen ${dayLabel}, newest first.`}
            </Text>

            <Card style={styles.listCard}>
              {rows.length === 0 ? (
                <Text style={styles.muted}>No app use recorded {dayLabel}.</Text>
              ) : tab === 'recent' && !hasLastUsed ? (
                <Text style={styles.muted}>
                  {forPartner
                    ? `Last-used times aren't available for ${partnerName} yet. They appear after the next update from their phone (Bond also needs a small server update for this).`
                    : 'Recently used needs the newest version of Bond on this phone.'}
                </Text>
              ) : (
                list.map((a, i) => (
                  <AppUsageRow
                    key={a.packageName}
                    name={a.appName}
                    iconUri={icons[a.packageName]}
                    ms={a.ms}
                    share={tab === 'most' && top > 0 ? a.ms / top : undefined}
                    barColor={forPartner ? colors.partner : colors.me}
                    detail={
                      a.lastUsedMs
                        ? !forPartner && readAt - a.lastUsedMs < NOW_WINDOW_MS
                          ? 'On screen now'
                          : `Last used ${formatTime(new Date(a.lastUsedMs).toISOString())}`
                        : undefined
                    }
                    last={i === list.length - 1}
                  />
                ))
              )}
            </Card>
            <Text style={styles.footnote}>
              {forPartner
                ? `From Android's usage log on ${partnerName}'s phone, as last sent (the top 30 apps). Android decides when their phone can send updates in the background.`
                : "From Android's usage log on this phone. Apps used for less than a second and the home screen are not counted."}
            </Text>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl * 2 },
  error: { ...font.small, color: colors.danger, marginBottom: spacing.md },
  muted: { ...font.small, color: colors.muted, lineHeight: 19 },
  whose: { ...font.small, fontWeight: '700', paddingHorizontal: spacing.lg, marginBottom: spacing.sm },
  chartCard: { marginTop: spacing.md },
  chartLabel: { ...font.tiny, color: colors.muted, textTransform: 'uppercase', marginBottom: spacing.sm },
  summary: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.lg },
  summaryItem: { flex: 1, alignItems: 'center' },
  summaryDivider: { width: 1, alignSelf: 'stretch', backgroundColor: colors.border },
  summaryLabel: { ...font.small, color: colors.subtext },
  summaryValue: { ...font.h2, color: colors.text, marginTop: 2 },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.track,
    borderRadius: radius.pill,
    padding: 4,
    marginTop: spacing.lg,
  },
  segmentItem: { flex: 1, minHeight: 40, borderRadius: radius.pill, alignItems: 'center', justifyContent: 'center' },
  segmentActive: { backgroundColor: colors.card },
  segmentText: { ...font.small, fontWeight: '600', color: colors.subtext },
  segmentTextActive: { color: colors.primary, fontWeight: '700' },
  hint: { ...font.small, color: colors.muted, marginTop: spacing.sm, marginBottom: spacing.sm, paddingHorizontal: spacing.xs },
  listCard: { paddingVertical: spacing.xs },
  footnote: { ...font.small, color: colors.muted, lineHeight: 18, marginTop: spacing.md, paddingHorizontal: spacing.xs },
}));
