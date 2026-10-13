import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useRef } from 'react';
import { AppState, RefreshControl, Text, View } from 'react-native';
import { ApprovalRequestCard } from '@/components/ApprovalRequestCard';
import { BondLogo } from '@/components/BondLogo';
import { Card } from '@/components/Card';
import { CoupleAvatars } from '@/components/CoupleAvatars';
import { CurrentlyUsingCard } from '@/components/CurrentlyUsingCard';
import { HeaderActions } from '@/components/HeaderActions';
import { Screen } from '@/components/Screen';
import { ScreenTimeSummaryCard } from '@/components/ScreenTimeSummaryCard';
import { SectionHeader } from '@/components/SectionHeader';
import { useMyBattery, usePartnerBattery } from '@/hooks/useBattery';
import { useCoupleLocations } from '@/hooks/useCoupleLocations';
import { activityMessage, activityVisual, useActivityFeed } from '@/hooks/useActivityFeed';
import { usePartnerCurrentApp } from '@/hooks/useCurrentApp';
import { useMyUsage } from '@/hooks/useMyUsage';
import { usePartnerUsage } from '@/hooks/usePartnerUsage';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { tintForProfile } from '@/lib/avatar';
import { syncBatteryIfSharing } from '@/lib/battery';
import { syncCurrentAppIfSharing } from '@/lib/currentApp';
import { distanceMeters } from '@/lib/location';
import { dayKey, greeting, timeAgo } from '@/lib/format';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
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
  const {
    userId,
    myProfile,
    partnerProfile,
    partnerId,
    myAvatarUrl,
    partnerAvatarUrl,
    incomingRequests,
    outgoingRequests,
    refresh,
    refreshRequests,
  } = useCouple();
  const places = useCoupleLocations();
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
      headerLeft={
        <View>
          <Text style={styles.greeting}>
            {greeting()}, {myName === 'Me' ? 'you' : myName}
          </Text>
          <BondLogo size={20} />
        </View>
      }
      right={<HeaderActions gearBadge={incomingRequests.length > 0} />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      {refreshFailed ? (
        <Text style={styles.refreshError}>Couldn&apos;t refresh everything. Check your connection and pull again.</Text>
      ) : null}

      <View style={styles.inner}>
        {/* The two of you: where you are and your battery (only what each shares). */}
        <Card style={styles.couple}>
          <CoupleAvatars
            me={{ name: myName, url: myAvatarUrl, tint: tintForProfile(myProfile) }}
            partner={partnerId ? { name: partnerName, url: partnerAvatarUrl, tint: tintForProfile(partnerProfile) } : null}
            size={64}
          />
          <View style={styles.people}>
            <Person
              name="You"
              place={places.me.sharing ? places.me.place : null}
              battery={myBattery.level > 0 ? `${myBattery.level}%${myBattery.charging ? ' · charging' : ''}` : null}
            />
            <Person
              name={partnerName}
              place={places.partner.sharing ? places.partner.place : null}
              battery={
                partnerBattery && partnerBattery.level != null && partnerBattery.level > 0
                  ? `${partnerBattery.level}%${partnerBattery.is_charging ? ' · charging' : ''}${partnerBatteryStale ? ' · old' : ''}`
                  : partnerBatterySharing
                    ? 'Battery: waiting'
                    : 'Battery not shared'
              }
            />
          </View>
          <View style={styles.coupleFooter}>
            <View style={styles.footerLeft}>
              <Ionicons name="location-outline" size={14} color={colors.subtext} />
              <Text style={styles.footerText} onPress={() => router.push('/location')}>
                {distanceText(places.me.loc, places.partner.loc) ??
                  (places.partner.sharing ? places.partner.statusLabel : 'Location not shared')}
              </Text>
            </View>
            {partnerBattery?.updated_at ? (
              <Text style={[styles.footerText, partnerBatteryStale && { color: colors.warning }]}>
                Updated {timeAgo(partnerBattery.updated_at)}
              </Text>
            ) : null}
          </View>
        </Card>

        {/* What the partner is using (their phone's latest check). */}
        <CurrentlyUsingCard
          userId={userId}
          hasPartner={!!partnerId}
          partnerName={partnerName}
          partner={partnerApp}
          partnerTint={tintForProfile(partnerProfile)}
        />
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

        {/* Today's screen time for both; a tap opens the detailed statistics. */}
        <ScreenTimeSummaryCard hasPartner={!!partnerId} partnerName={partnerName} mine={myUsage} partner={partnerUsage} />

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

/** "1.2 km apart" when both locations are known (null otherwise). */
function distanceText(
  a: { latitude: number; longitude: number } | null,
  b: { latitude: number; longitude: number } | null,
): string | null {
  if (!a || !b) return null;
  const m = distanceMeters(a.latitude, a.longitude, b.latitude, b.longitude);
  if (m < 100) return 'Together';
  return m < 1000 ? `${Math.round(m / 10) * 10} m apart` : `${(m / 1000).toFixed(m < 10_000 ? 1 : 0)} km apart`;
}

function Person({ name, place, battery }: { name: string; place: string | null; battery: string | null }) {
  useThemeVersion();
  return (
    <View style={styles.person}>
      <Text style={styles.personName} numberOfLines={1}>
        {name}
      </Text>
      {place ? (
        <Text style={styles.personSub} numberOfLines={1}>
          {place}
        </Text>
      ) : null}
      {battery ? (
        <Text style={styles.personSub} numberOfLines={1}>
          {battery}
        </Text>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  couple: { marginTop: spacing.md, paddingVertical: spacing.lg },
  people: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
  person: { width: '42%', alignItems: 'center' },
  personName: { ...font.h3, color: colors.text },
  personSub: { ...font.tiny, color: colors.subtext, marginTop: 2, letterSpacing: 0, textAlign: 'center' },
  coupleFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  footerLeft: { flexDirection: 'row', alignItems: 'center', gap: 4, flexShrink: 1 },
  footerText: { ...font.small, color: colors.subtext },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  greeting: { ...font.small, color: colors.subtext, marginBottom: 2 },
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
