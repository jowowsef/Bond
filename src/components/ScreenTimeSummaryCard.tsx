import { useRouter } from 'expo-router';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { ProgressRing } from '@/components/ProgressRing';
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

  // Rings compare the two of you: the larger total fills most of its ring.
  const myMs = s.kind === 'ready' ? s.usage.totalMs : 0;
  const partnerMs = partnerValue && partner.total ? partner.total.total_ms : 0;
  const scale = Math.max(myMs, partnerMs, 1) / 0.8;

  return (
    <>
      <SectionHeader
        title="Screen time today"
        right={
          <Text style={styles.seeAll} onPress={() => router.push('/screen-time')} accessibilityRole="link">
            See all
          </Text>
        }
      />
      <View style={styles.tiles}>
        <Tile
          name="You"
          value={myValue}
          sub={mySub}
          progress={myMs / scale}
          accent={colors.me}
          onPress={() => router.push(s.kind === 'ready' ? '/screen-time-stats' : '/screen-time')}
        />
        <Tile
          name={partnerName}
          value={partnerValue}
          sub={partnerSub}
          warn={partnerWarn}
          progress={partnerMs / scale}
          accent={colors.partner}
          onPress={partnerOpenable ? () => router.push({ pathname: '/screen-time-stats', params: { who: 'partner' } }) : undefined}
        />
      </View>
    </>
  );
}

function Tile({
  name,
  value,
  sub,
  warn,
  progress,
  accent,
  onPress,
}: {
  name: string;
  value: string | null;
  sub: string;
  warn?: boolean;
  progress: number;
  accent: string;
  onPress?: () => void;
}) {
  useThemeVersion();
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      accessibilityRole={onPress ? 'button' : undefined}
      accessibilityLabel={`${name} screen time ${value ?? sub}`}
      style={({ pressed }) => [styles.tileWrap, pressed && { opacity: 0.7 }]}
    >
      <Card style={styles.tile}>
        <ProgressRing progress={value ? progress : 0} size={46} thickness={5} color={accent} />
        <View style={styles.tileText}>
          <Text style={styles.name} numberOfLines={1}>
            {name}
          </Text>
          {value ? (
            <Text style={styles.value} numberOfLines={1}>
              {value}
            </Text>
          ) : (
            <Text style={[styles.sub, warn && { color: colors.warning }]} numberOfLines={2}>
              {sub}
            </Text>
          )}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  seeAll: { ...font.small, fontWeight: '700', color: colors.primary },
  tiles: { flexDirection: 'row', gap: spacing.md },
  tileWrap: { flex: 1 },
  tile: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  tileText: { flex: 1 },
  name: { ...font.small, color: colors.subtext },
  sub: { ...font.tiny, color: colors.muted, marginTop: 2, letterSpacing: 0 },
  value: { ...font.h2, fontSize: 18, color: colors.text, marginTop: 1 },
}));
