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

/**
 * HOME (top): compact "Currently Using" for my PARTNER only (their own row;
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
}: {
  userId: string | null;
  hasPartner: boolean;
  partnerName: string;
  /** From usePartnerCurrentApp (loaded by Home, so pull to refresh and polling reload it). */
  partner: { setting: CurrentAppSetting | null; row: CurrentAppRow | null; now: number };
}) {
  useThemeVersion();
  const mine = useCurrentAppSharing(userId, partnerName);
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
    detail = 'Needs a server update';
  } else if (s.kind === 'error') {
    title = "Couldn't check";
    detail = 'Pull down to try again';
  } else if (s.kind === 'off') {
    title = 'Not shared';
    detail = `${partnerName} has this off`;
  } else if (!partner.row) {
    title = 'Nothing detected yet';
    detail = `Waiting for ${partnerName}'s phone`;
  } else {
    const age = partner.now - new Date(partner.row.checked_at).getTime();
    stale = age > CURRENT_APP_FRESH_MS;
    const ago = timeAgo(partner.row.checked_at, partner.now);
    if (partner.row.app_name) {
      title = partner.row.app_name;
      showIcon = true;
      detail = stale ? `Last detected ${ago} · not current` : `Last detected ${ago}`;
    } else {
      title = 'No app open';
      detail = stale ? `Last update ${ago} · not current` : `Screen off or home screen · ${ago}`;
    }
  }
  const muted = !showIcon || stale;

  return (
    <Card style={styles.card}>
      <View style={styles.row}>
        {showIcon ? (
          <View style={stale ? styles.faded : undefined}>
            <AppIcon uri={pkg ? icons[pkg] : null} size={32} />
          </View>
        ) : (
          <View style={styles.placeholder}>
            <Ionicons name="phone-portrait-outline" size={16} color={colors.subtext} />
          </View>
        )}
        <View style={styles.text}>
          <Text style={[styles.app, muted && styles.muted]} numberOfLines={1}>
            {title}
          </Text>
          {detail ? (
            <Text style={[styles.detail, stale && { color: colors.warning }]} numberOfLines={1}>
              {detail}
            </Text>
          ) : null}
        </View>
        <Text style={styles.label} numberOfLines={1}>
          {partnerName} · Currently Using
        </Text>
      </View>
      {mine.status === 'needs-access' ? (
        <Pressable onPress={mine.openAccessSettings} hitSlop={6} accessibilityRole="button" style={styles.mine}>
          <Ionicons name="alert-circle-outline" size={14} color={colors.warning} />
          <Text style={styles.mineText}>Yours needs Usage access · Fix</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

const styles = themedStyles(() => ({
  card: { marginTop: spacing.lg, paddingVertical: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  faded: { opacity: 0.5 },
  placeholder: {
    width: 32,
    height: 32,
    borderRadius: 9,
    backgroundColor: colors.track,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { flex: 1 },
  app: { ...font.body, fontWeight: '700', color: colors.text },
  muted: { color: colors.subtext, fontWeight: '600' },
  detail: { ...font.tiny, color: colors.muted, marginTop: 2, letterSpacing: 0 },
  label: { ...font.tiny, color: colors.muted, maxWidth: 130, letterSpacing: 0 },
  mine: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm },
  mineText: { ...font.tiny, color: colors.warning, letterSpacing: 0 },
}));
