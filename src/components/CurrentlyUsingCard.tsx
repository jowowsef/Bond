import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { AppIcon } from '@/components/AppUsageRow';
import { Card } from '@/components/Card';
import { useAppIcons } from '@/hooks/useAppIcons';
import { useCurrentAppSharing } from '@/hooks/useCurrentAppSharing';
import { CURRENT_APP_FRESH_MS, type CurrentAppRow, type CurrentAppSetting } from '@/lib/currentApp';
import { timeAgo } from '@/lib/format';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * HOME "Right now": what my PARTNER is using (their phone's latest check), for my partner only (their own row;
 * never mine, never a previous partner's).
 *
 *   [icon] TikTok                 Currently Using
 *          Last detected 2 min ago
 *
 * The icon is the app's real launcher icon when that app is also installed on
 * this phone (otherwise a neutral placeholder). The time is when the
 * partner's phone detected it; older than 20 minutes, it says so instead of
 * implying the app is still open. My own sharing appears only as one small
 * line when it needs Android's Usage access. No history, no Online/Offline.
 */
export function CurrentlyUsingCard({
  userId,
  hasPartner,
  partnerName,
  partner,
  partnerTint,
}: {
  userId: string | null;
  hasPartner: boolean;
  partnerName: string;
  /** From usePartnerCurrentApp (loaded by Home, so pull to refresh and polling reload it). */
  partner: { setting: CurrentAppSetting | null; row: CurrentAppRow | null; now: number };
  /** The partner's avatar color, for the small badge on the app icon. */
  partnerTint?: string;
}) {
  useThemeVersion();
  const mine = useCurrentAppSharing(userId, partnerName);
  const { online } = useCouple();
  const pkg = partner.row?.package_name ?? null;
  const icons = useAppIcons(pkg ? [pkg] : []);

  let title: string;
  let detail: string;
  let stale = false;
  let showIcon = false;
  const s = partner.setting;
  if (!hasPartner) {
    title = 'No partner connected';
    detail = '';
  } else if (!s) {
    title = 'Loading…';
    detail = '';
  } else if (s.kind === 'unavailable') {
    title = 'Not available yet';
    detail = '';
  } else if (s.kind === 'error') {
    title = "Couldn't check";
    detail = 'Pull down to try again';
  } else if (s.kind === 'off') {
    title = 'Not shared';
    detail = `${partnerName} has this off`;
  } else if (!partner.row) {
    title = 'Nothing detected yet';
    detail = '';
  } else {
    const age = partner.now - new Date(partner.row.checked_at).getTime();
    // Offline, the saved app may be old even if its check was recent: never "is using" then.
    stale = age > CURRENT_APP_FRESH_MS || !online;
    const ago = timeAgo(partner.row.checked_at, partner.now);
    if (partner.row.app_name) {
      title = partner.row.app_name;
      showIcon = true;
      detail = stale ? `Last detected ${ago} · not current` : `Last detected ${ago}`;
    } else {
      title = 'No app open';
      detail = stale ? ago : '';
    }
  }
  const muted = !showIcon || stale;

  const live = showIcon && !stale;
  const ago = partner.row ? timeAgo(partner.row.checked_at, partner.now) : '';

  return (
    <>
      <View style={styles.header}>
        <Text style={styles.headerTitle} accessibilityRole="header">
          Right now
        </Text>
        {live ? (
          <View style={styles.livePill}>
            <View style={styles.liveDot} />
            <Text style={styles.liveText}>Live</Text>
          </View>
        ) : null}
      </View>
      <Card style={styles.card}>
        <View style={styles.row}>
          <View style={styles.iconWrap}>
            {showIcon ? (
              <View style={stale ? styles.faded : undefined}>
                <AppIcon uri={pkg ? icons[pkg] : null} size={40} />
              </View>
            ) : (
              <View style={styles.placeholder}>
                <Ionicons name="phone-portrait-outline" size={18} color={colors.subtext} />
              </View>
            )}
            {hasPartner ? (
              <View style={[styles.badge, { backgroundColor: partnerTint ?? colors.partner }]}>
                <Text style={styles.badgeText}>{(partnerName.trim()[0] ?? '?').toUpperCase()}</Text>
              </View>
            ) : null}
          </View>
          <View style={styles.text}>
            {showIcon ? <Text style={styles.label}>{stale ? `${partnerName} last used` : `${partnerName} is using`}</Text> : null}
            <Text style={[styles.app, muted && styles.muted]} numberOfLines={1}>
              {title}
            </Text>
            {!showIcon && detail ? (
              <Text style={[styles.detail, stale && { color: colors.warning }]} numberOfLines={1}>
                {detail}
              </Text>
            ) : null}
          </View>
          {/* Still in that app (a recent check): no time, the section says Live.
              Only an old check shows when it was, so it's never read as current. */}
          {showIcon && stale ? (
            <View style={[styles.timePill, styles.timePillStale]}>
              <Text style={[styles.timeText, { color: colors.warning }]}>{ago}</Text>
            </View>
          ) : null}
        </View>
        {mine.status === 'needs-access' ? (
          <Pressable onPress={mine.openAccessSettings} hitSlop={6} accessibilityRole="button" style={styles.mine}>
            <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
            <Text style={styles.mineText}>Yours needs Usage access · Fix</Text>
          </Pressable>
        ) : null}
      </Card>
    </>
  );
}

const styles = themedStyles(() => ({
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.xl, marginBottom: spacing.sm },
  headerTitle: { ...font.h3, color: colors.text },
  livePill: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: colors.success },
  liveText: { ...font.small, fontWeight: '700', color: colors.success },
  card: { paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  iconWrap: { width: 44, height: 44, justifyContent: 'center' },
  faded: { opacity: 0.5 },
  placeholder: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: colors.pinkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { ...font.tiny, fontSize: 9, letterSpacing: 0, color: colors.text, fontWeight: '800' },
  text: { flex: 1 },
  label: { ...font.small, color: colors.subtext },
  app: { ...font.h3, fontSize: 17, color: colors.text, marginTop: 1 },
  muted: { color: colors.subtext, fontWeight: '600', fontSize: 15 },
  detail: { ...font.tiny, color: colors.muted, marginTop: 2, letterSpacing: 0 },
  timePill: { paddingHorizontal: spacing.sm, paddingVertical: 4, borderRadius: 999, backgroundColor: colors.track },
  timePillStale: { backgroundColor: colors.warningSoft },
  timeText: { ...font.tiny, color: colors.subtext, letterSpacing: 0 },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  mineText: { ...font.tiny, color: colors.warning, letterSpacing: 0 },
}));
