import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { AppState, RefreshControl, Text, View } from 'react-native';
import { ApprovalRequestCard } from '@/components/ApprovalRequestCard';
import { AvatarStack } from '@/components/AvatarStack';
import { BondLogo } from '@/components/BondLogo';
import { Card } from '@/components/Card';
import { CurrentlyUsingCard } from '@/components/CurrentlyUsingCard';
import { HeaderActions } from '@/components/HeaderActions';
import { NavCard } from '@/components/NavCard';
import { Screen } from '@/components/Screen';
import { ScreenTimeSummaryCard } from '@/components/ScreenTimeSummaryCard';
import { SectionHeader } from '@/components/SectionHeader';
import { useMyBattery, usePartnerBattery } from '@/hooks/useBattery';
import { activityMessage, activityVisual, useActivityFeed } from '@/hooks/useActivityFeed';
import { usePartnerCurrentApp } from '@/hooks/useCurrentApp';
import { useMyUsage } from '@/hooks/useMyUsage';
import { usePartnerUsage } from '@/hooks/usePartnerUsage';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { syncBatteryIfSharing } from '@/lib/battery';
import { syncCurrentAppIfSharing } from '@/lib/currentApp';
import { dayKey, greeting, timeAgo } from '@/lib/format';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * HOME: a calm overview for two partners.
 *
 * Real: names, avatars, pending approval requests, screen time, battery,
 * Currently Using and the recent activity feed. (No Online / Offline status:
 * Currently Using shows what the partner's phone last reported instead.) The section cards are shortcuts into each area; they
 * show honest status and never invented numbers.
 */
export default function Home() {
  useThemeVersion();
  const router = useRouter();
  const { userId, myProfile, partnerProfile, partnerId, incomingRequests, outgoingRequests, refresh, refreshRequests } =
    useCouple();
  const { logs, reload: reloadActivity } = useActivityFeed(3);
  const myBattery = useMyBattery();
  const {
    battery: partnerBattery,
    stale: partnerBatteryStale,
    sharing: partnerBatterySharing,
    reload: reloadPartnerBattery,
  } = usePartnerBattery(partnerId);
  // Loaded here (not inside the cards) so pull to refresh re-reads them too.
  const partnerApp = usePartnerCurrentApp(partnerId, userId);
  const myUsage = useMyUsage();
  const partnerUsage = usePartnerUsage(partnerId, dayKey());

  // While Home is on screen and Bond is in front: re-read the partner's data
  // now and then, as a backup for live updates (a dropped live connection used
  // to leave an old app on screen until Bond was reopened). Only records the
  // partner's phone actually sent are shown, with their own times.
  const reloadersRef = useRef({ app: partnerApp.reload, battery: reloadPartnerBattery, usage: partnerUsage.reload });
  reloadersRef.current = { app: partnerApp.reload, battery: reloadPartnerBattery, usage: partnerUsage.reload };
  useFocusEffect(
    useCallback(() => {
      let tick = 0;
      const t = setInterval(() => {
        if (AppState.currentState !== 'active') return;
        tick += 1;
        const r = reloadersRef.current;
        void r.app().catch(() => {}); // every 30 s
        if (tick % 2 === 0) void r.battery().catch(() => {}); // every minute
        if (tick % 4 === 0) void r.usage().catch(() => {}); // every 2 minutes
      }, 30_000);
      return () => clearInterval(t);
    }, []),
  );

  // Pull to refresh: re-read everything shown here straight from the server
  // (pairing, requests, activity, the partner's battery, current app and
  // screen time) and this phone's own battery and usage; also send my own
  // battery and current app now (each only if I share it). It shows the
  // newest thing the partner's phone has SENT; it can't make that phone
  // take a new reading. One refresh at a time; the spinner always stops.
  const { refreshing, onRefresh, failed: refreshFailed } = usePullToRefresh(async () => {
    const results = await Promise.allSettled([
      refresh(),
      reloadActivity(),
      reloadPartnerBattery(),
      partnerApp.reload(),
      partnerUsage.reload(),
      myUsage.reload(),
      myBattery.refresh(),
      userId ? syncBatteryIfSharing(userId) : Promise.resolve(false),
      userId ? syncCurrentAppIfSharing(userId) : Promise.resolve(false),
    ]);
    if (results.some((r) => r.status === 'rejected')) throw new Error('refresh failed');
  });

  const myName = myProfile?.display_name ?? 'You';
  const partnerName = partnerProfile?.display_name ?? 'Partner';

  async function onRequestDone() {
    await Promise.all([refreshRequests(), refresh()]);
  }

  return (
    <Screen
      headerLeft={<BondLogo size={24} />}
      right={
        <View style={styles.headerRight}>
          <AvatarStack />
          <HeaderActions gearBadge={incomingRequests.length > 0} />
        </View>
      }
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      <Text style={styles.greeting}>{greeting()}</Text>
      <Text style={styles.title}>Today, together</Text>
      {refreshFailed ? (
        <Text style={styles.refreshError}>Couldn&apos;t refresh everything. Check your connection and pull again.</Text>
      ) : null}

      <View style={styles.inner}>
        {/* First thing on Home: what the partner is using (their phone's last report). */}
        <CurrentlyUsingCard userId={userId} hasPartner={!!partnerId} partnerName={partnerName} partner={partnerApp} />
        {/* Pending approvals that need MY decision */}
        {incomingRequests.length > 0 ? (
          <View style={styles.requests}>
            {incomingRequests.map((req) => (
              <ApprovalRequestCard
                key={req.id}
                request={req}
                direction="incoming"
                otherName={partnerName}
                onDone={onRequestDone}
              />
            ))}
          </View>
        ) : null}

        {/* Requests I sent that are waiting on my partner */}
        {outgoingRequests.length > 0 ? (
          <View style={styles.requests}>
            {outgoingRequests.map((req) => (
              <ApprovalRequestCard
                key={req.id}
                request={req}
                direction="outgoing"
                otherName={partnerName}
                onDone={onRequestDone}
              />
            ))}
          </View>
        ) : null}

        <View style={styles.cards}>
          <NavCard
            icon="location-outline"
            title="Location"
            subtitle="See where you both are"
            accent={colors.blue}
            accentBg={colors.blueSoft}
            onPress={() => router.push('/location')}
          />
        </View>

        {/* Today's screen time for both; a tap opens the detailed statistics. */}
        <ScreenTimeSummaryCard hasPartner={!!partnerId} partnerName={partnerName} mine={myUsage} partner={partnerUsage} />

        <SectionHeader title="Battery" />
        <Card>
          <View style={styles.batteryRow}>
            <Text style={styles.batteryName}>You</Text>
            <View style={styles.batteryRight}>
              {myBattery.charging ? (
                <Ionicons name="flash" size={14} color={colors.success} style={{ marginRight: 4 }} />
              ) : null}
              {myBattery.level > 0 && myBattery.charging ? <Text style={styles.batteryCharging}>Charging</Text> : null}
              <Text style={styles.batteryValue}>{myBattery.level > 0 ? `${myBattery.level}%` : 'Unavailable'}</Text>
            </View>
          </View>
          <View style={[styles.batteryRow, styles.batteryDivider]}>
            <Text style={styles.batteryName}>{partnerName}</Text>
            <View style={styles.batteryRight}>
              {partnerBattery && partnerBattery.level != null && partnerBattery.level > 0 ? (
                <>
                  {/* An older reading is never shown as if it were live: a small
                      amber clock and a dimmed value mark it as possibly not current. */}
                  {partnerBatteryStale ? (
                    <Ionicons
                      name="time-outline"
                      size={15}
                      color={colors.warning}
                      accessible
                      accessibilityLabel="Not current"
                    />
                  ) : null}
                  {partnerBattery.is_charging ? (
                    <>
                      <Ionicons name="flash" size={14} color={colors.success} />
                      <Text style={styles.batteryCharging}>Charging</Text>
                    </>
                  ) : null}
                  <Text
                    style={[styles.batteryValue, partnerBatteryStale && styles.batteryStale]}
                    accessibilityLabel={`${partnerBattery.level} percent${partnerBatteryStale ? ', not current' : ''}`}
                  >
                    {partnerBattery.level}%
                  </Text>
                </>
              ) : partnerBattery ? (
                <Text style={styles.batteryMuted}>Unavailable</Text>
              ) : partnerBatterySharing ? (
                // Sharing is on but their phone hasn't sent a reading yet.
                <Text style={styles.batteryMuted}>Waiting for update</Text>
              ) : (
                <Text style={styles.batteryMuted}>Not shared</Text>
              )}
            </View>
          </View>
          {/* When the partner's reading was taken, so an old value is never read as live. */}
          {partnerBattery?.updated_at ? (
            <Text style={[styles.batteryUpdated, partnerBatteryStale && { color: colors.warning }]}>
              Updated {timeAgo(partnerBattery.updated_at)}
              {partnerBatteryStale ? ' · not current' : ''}
            </Text>
          ) : null}
        </Card>


        <SectionHeader
          title="Recent activity"
          right={
            <Text style={styles.seeAll} onPress={() => router.push('/activity')}>
              See all
            </Text>
          }
        />
        <Card>
          {logs.length === 0 ? (
            <Text style={styles.empty}>Nothing yet. Activity between you two will show up here.</Text>
          ) : (
            logs.map((log, i) => {
              const v = activityVisual(log.kind);
              return (
                <View key={log.id} style={[styles.activityRow, i < logs.length - 1 && styles.divider]}>
                  <Ionicons
                    name={v.icon as React.ComponentProps<typeof Ionicons>['name']}
                    size={18}
                    color={colors.primary}
                    style={styles.activityIcon}
                  />
                  <Text style={styles.activityText} numberOfLines={2}>
                    {activityMessage(log, { myName, partnerName, myUserId: userId })}
                  </Text>
                  <Text style={styles.activityTime}>{timeAgo(log.created_at)}</Text>
                </View>
              );
            })
          )}
        </Card>

        <View style={{ height: spacing.xl }} />
      </View>
    </Screen>
  );
}

const styles = themedStyles(() => ({
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  greeting: { ...font.body, color: colors.subtext },
  title: { ...font.title, color: colors.text, marginTop: 2 },
  refreshError: { ...font.small, color: colors.danger, marginTop: spacing.sm },
  inner: {},
  batteryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  batteryDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  batteryName: { ...font.body, fontWeight: '600', color: colors.text },
  batteryRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  batteryValue: { ...font.body, fontWeight: '700', color: colors.text },
  batteryCharging: { ...font.small, fontWeight: '600', color: colors.success },
  batteryStale: { color: colors.subtext },
  batteryMuted: { ...font.small, color: colors.muted },
  batteryUpdated: { ...font.tiny, color: colors.muted, textAlign: 'right', marginTop: 2 },
  requests: { marginTop: spacing.lg, gap: spacing.md },
  cards: { marginTop: spacing.lg, gap: spacing.md },
  seeAll: { ...font.small, fontWeight: '700', color: colors.primary },
  empty: { ...font.small, color: colors.muted, lineHeight: 19 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  activityIcon: { marginRight: spacing.sm, width: 22, textAlign: 'center' },
  activityText: { ...font.small, color: colors.text, flex: 1, lineHeight: 18 },
  activityTime: { ...font.tiny, color: colors.muted, marginLeft: spacing.sm },
}));
