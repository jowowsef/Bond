import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { ApprovalRequestCard } from '@/components/ApprovalRequestCard';
import { AvatarStack } from '@/components/AvatarStack';
import { BondLogo } from '@/components/BondLogo';
import { Card } from '@/components/Card';
import { GearButton } from '@/components/GearButton';
import { NavCard } from '@/components/NavCard';
import { PresenceIndicator } from '@/components/PresenceIndicator';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { useMyBattery, usePartnerBattery } from '@/hooks/useBattery';
import { activityMessage, activityVisual, useActivityFeed } from '@/hooks/useActivityFeed';
import { usePartnerPresence } from '@/hooks/usePresence';
import { greeting, timeAgo } from '@/lib/format';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * HOME — a calm overview for two partners.
 *
 * Real: names, avatars, partner presence, pending approval requests, and the
 * recent activity feed. The section cards are shortcuts into each area; they
 * show honest status and never invented numbers.
 */
export default function Home() {
  const router = useRouter();
  const { myProfile, partnerProfile, partnerId, incomingRequests, outgoingRequests, refresh, refreshRequests } =
    useCouple();
  const partnerStatus = usePartnerPresence(partnerId);
  const { logs } = useActivityFeed(3);
  const myBattery = useMyBattery();
  const { battery: partnerBattery, stale: partnerBatteryStale } = usePartnerBattery(partnerId);

  const myName = myProfile?.display_name ?? 'You';
  const partnerName = partnerProfile?.display_name ?? 'Partner';
  const presenceLabel =
    partnerStatus.state === 'online' ? `${partnerName} is online` : `${partnerName} · ${partnerStatus.label}`;

  async function onRequestDone() {
    await Promise.all([refreshRequests(), refresh()]);
  }

  return (
    <Screen
      headerLeft={<BondLogo size={24} />}
      right={
        <View style={styles.headerRight}>
          <AvatarStack />
          <GearButton badge={incomingRequests.length > 0} />
        </View>
      }
    >
      <Text style={styles.greeting}>{greeting()}</Text>
      <Text style={styles.title}>Today, together</Text>
      <View style={styles.presence}>
        <PresenceIndicator state={partnerStatus.state} label={presenceLabel} />
      </View>

      <View style={styles.inner}>
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
            icon="time-outline"
            title="Screen time"
            subtitle="Set up Usage Access to see app usage"
            accent={colors.me}
            accentBg={colors.meSoft}
            onPress={() => router.push('/screen-time')}
          />
          <NavCard
            icon="location-outline"
            title="Location"
            subtitle="See where you both are"
            accent={colors.blue}
            accentBg={colors.blueSoft}
            onPress={() => router.push('/location')}
          />
          <NavCard
            icon="shield-checkmark-outline"
            title="Protection"
            subtitle="No active protection yet"
            accent={colors.primary}
            accentBg={colors.primarySoft}
            onPress={() => router.push('/controls')}
          />
        </View>

        <SectionHeader title="Battery" />
        <Card>
          <View style={styles.batteryRow}>
            <Text style={styles.batteryName}>You</Text>
            <View style={styles.batteryRight}>
              {myBattery.charging ? (
                <Ionicons name="flash" size={14} color={colors.success} style={{ marginRight: 4 }} />
              ) : null}
              <Text style={styles.batteryValue}>{myBattery.level > 0 ? `${myBattery.level}%` : 'Unavailable'}</Text>
            </View>
          </View>
          <View style={[styles.batteryRow, styles.batteryDivider]}>
            <Text style={styles.batteryName}>{partnerName}</Text>
            <View style={styles.batteryRight}>
              {partnerBattery ? (
                <>
                  {partnerBattery.is_charging ? (
                    <Ionicons name="flash" size={14} color={colors.success} style={{ marginRight: 4 }} />
                  ) : null}
                  <Text style={styles.batteryValue}>{partnerBattery.level}%</Text>
                  {partnerBatteryStale ? <StatusBadge label="May be stale" tone="warning" /> : null}
                  <Text style={styles.batteryTime}>{timeAgo(partnerBattery.updated_at)}</Text>
                </>
              ) : (
                <Text style={styles.batteryMuted}>Not shared</Text>
              )}
            </View>
          </View>
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
                    {activityMessage(log, { myName, partnerName })}
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

const styles = StyleSheet.create({
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  greeting: { ...font.body, color: colors.subtext },
  title: { ...font.title, color: colors.text, marginTop: 2 },
  presence: { marginTop: spacing.sm },
  inner: {},
  batteryRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm },
  batteryDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  batteryName: { ...font.body, fontWeight: '600', color: colors.text },
  batteryRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  batteryValue: { ...font.body, fontWeight: '700', color: colors.text },
  batteryTime: { ...font.tiny, color: colors.muted },
  batteryMuted: { ...font.small, color: colors.muted },
  requests: { marginTop: spacing.lg, gap: spacing.md },
  cards: { marginTop: spacing.lg, gap: spacing.md },
  seeAll: { ...font.small, fontWeight: '700', color: colors.primary },
  empty: { ...font.small, color: colors.muted, lineHeight: 19 },
  activityRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  activityIcon: { marginRight: spacing.sm, width: 22, textAlign: 'center' },
  activityText: { ...font.small, color: colors.text, flex: 1, lineHeight: 18 },
  activityTime: { ...font.tiny, color: colors.muted, marginLeft: spacing.sm },
});
