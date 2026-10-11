import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import type { MyUsageState } from '@/hooks/useMyUsage';
import { PARTNER_STALE_MS, type PartnerUsage } from '@/hooks/usePartnerUsage';
import { formatDuration, timeAgo } from '@/lib/format';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * HOME: today's screen time for both people (real data only). Tapping a row
 * opens that person's Statistics (total, Most used, Recently used).
 * The partner's numbers are what their phone last sent, only while they share
 * screen time, always with the time they were sent.
 */
export function ScreenTimeSummaryCard({
  hasPartner,
  partnerName,
  mine,
  partner,
}: {
  hasPartner: boolean;
  partnerName: string;
  /** From useMyUsage / usePartnerUsage (loaded by Home, so pull to refresh reloads them). */
  mine: { state: MyUsageState };
  partner: PartnerUsage;
}) {
  useThemeVersion();
  const router = useRouter();

  // ----- partner -----
  let partnerValue: string | null = null;
  let partnerSub: string;
  let partnerWarn = false;
  if (!hasPartner) partnerSub = 'No partner connected';
  else if (partner.loading) partnerSub = 'Loading…';
  else if (partner.error && !partner.total) partnerSub = "Couldn't load. Pull down to try again.";
  else if (partner.sharing === false) partnerSub = 'Screen time sharing is off';
  else if (!partner.total) partnerSub = 'Nothing sent yet today';
  else {
    partnerValue = formatDuration(partner.total.total_ms);
    const top = partner.apps[0];
    const stale = partner.now - new Date(partner.total.updated_at).getTime() > PARTNER_STALE_MS;
    partnerWarn = stale;
    partnerSub =
      (top ? `Most used: ${top.app_name} · ` : '') +
      `Last synced ${timeAgo(partner.total.updated_at, partner.now)}${stale ? ' · not current' : ''}`;
  }
  const partnerOpenable = hasPartner && partner.sharing !== false && !!partner.total;

  // ----- me -----
  const s = mine.state;
  const myValue = s.kind === 'ready' ? formatDuration(s.usage.totalMs) : null;
  const mySub =
    s.kind === 'ready'
      ? s.usage.apps[0]
        ? `Most used: ${s.usage.apps[0].appName}`
        : 'No app use yet today'
      : s.kind === 'no-access'
        ? 'Usage access is off on this phone'
        : s.kind === 'needs-update'
          ? 'Needs the newest version of Bond'
          : s.kind === 'unsupported'
            ? 'Android only'
            : s.kind === 'error'
              ? "Couldn't read this phone's usage"
              : 'Loading…';

  return (
    <>
      <SectionHeader title="Screen time today" />
      <Card>
        <PersonRow
          name={partnerName}
          value={partnerValue}
          sub={partnerSub}
          warn={partnerWarn}
          accent={colors.partner}
          onPress={partnerOpenable ? () => router.push({ pathname: '/screen-time-stats', params: { who: 'partner' } }) : undefined}
        />
        <PersonRow
          name="You"
          value={myValue}
          sub={mySub}
          accent={colors.me}
          divider
          onPress={() => router.push(s.kind === 'ready' ? '/screen-time-stats' : '/screen-time')}
        />
      </Card>
    </>
  );
}

function PersonRow({
  name,
  value,
  sub,
  warn,
  accent,
  divider,
  onPress,
}: {
  name: string;
  value: string | null;
  sub: string;
  warn?: boolean;
  accent: string;
  divider?: boolean;
  onPress?: () => void;
}) {
  useThemeVersion();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name} screen time ${value ?? sub}`}
      style={({ pressed }) => [styles.row, divider && styles.divider, pressed && { opacity: 0.6 }]}
    >
      <View style={[styles.dot, { backgroundColor: accent }]} />
      <View style={styles.text}>
        <Text style={styles.name}>{name}</Text>
        <Text style={[styles.sub, warn && { color: colors.warning }]} numberOfLines={2}>
          {sub}
        </Text>
      </View>
      {value ? <Text style={styles.value}>{value}</Text> : null}
      {onPress ? <Ionicons name="chevron-forward" size={18} color={colors.muted} style={{ marginLeft: spacing.xs }} /> : null}
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2 },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: spacing.md },
  text: { flex: 1, marginRight: spacing.sm },
  name: { ...font.body, fontWeight: '600', color: colors.text },
  sub: { ...font.small, color: colors.subtext, marginTop: 2 },
  value: { ...font.body, fontWeight: '700', color: colors.text },
}));
