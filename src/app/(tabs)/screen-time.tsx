import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, RefreshControl, Text, View } from 'react-native';
import { AppUsageRow } from '@/components/AppUsageRow';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { HeaderActions } from '@/components/HeaderActions';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { useAppIcons } from '@/hooks/useAppIcons';
import { useMyUsage, type MyUsageState } from '@/hooks/useMyUsage';
import { PARTNER_STALE_MS, usePartnerUsage } from '@/hooks/usePartnerUsage';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { dayKey, formatDuration, formatTime, timeAgo } from '@/lib/format';
import { getLastScreenTimeSync, syncScreenTime } from '@/lib/screenTime';
import { requestUsageAccess } from '@/lib/usageAccessFlow';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/** Each main list shows the top 3; Statistics shows all of today's apps. */
const TOP_APPS = 3;

/**
 * SCREEN TIME tab: TODAY only (real data only, no earlier days).
 *
 *  1-3. You: today's total and top 3 apps, read straight from this phone
 *       (Android Usage access), then Statistics (all of today's apps).
 *  4-6. Partner: today's total (with when it was last synced), the top 3
 *       apps, then their Statistics. This is what their phone last uploaded
 *       for today.
 */
export default function ScreenTimeTab() {
  useThemeVersion();
  const router = useRouter();
  const { userId, partnerId, partnerProfile } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Your partner';

  const { state: mine, reload: reloadMine } = useMyUsage();
  const [mySharing, setMySharing] = useState<boolean | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  // Partner: the shared loader (also used by Home and Statistics).
  const partner = usePartnerUsage(partnerId, dayKey());
  const { sharing: partnerSharing, total: partnerTotal, loading: partnerLoading, error: partnerError, now } = partner;
  const partnerApps = partner.apps.slice(0, TOP_APPS);
  const loadPartner = partner.reload;

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- my sharing status + upload (checks Usage access and the Privacy switch itself) ----
  const syncMine = useCallback(async () => {
    if (!userId) return;
    const [privacy, result, last] = await Promise.all([
      supabase.from('privacy_settings').select('share_screen_time').eq('user_id', userId).maybeSingle(),
      syncScreenTime(userId),
      getLastScreenTimeSync(),
    ]);
    if (!mounted.current) return;
    setMySharing(privacy.data ? !!privacy.data.share_screen_time : null);
    if (result.status === 'synced') setLastSent(result.at);
    else if (last) setLastSent(last.at);
  }, [userId]);

  const loadAll = useCallback(async () => {
    const results = await Promise.allSettled([reloadMine(), syncMine(), loadPartner()]);
    if (results.some((r) => r.status === 'rejected')) throw new Error('refresh failed');
  }, [reloadMine, syncMine, loadPartner]);

  const { refreshing, onRefresh, failed } = usePullToRefresh(loadAll);

  // useMyUsage re-reads this phone on its own; these keep sharing + partner fresh.
  useFocusEffect(
    useCallback(() => {
      void Promise.allSettled([syncMine(), loadPartner()]);
    }, [syncMine, loadPartner]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void Promise.allSettled([syncMine(), loadPartner()]);
    });
    return () => sub.remove();
  }, [syncMine, loadPartner]);

  const partnerIcons = useAppIcons(partnerApps.map((a) => a.package_name));
  const partnerUpdatedMs = partnerTotal ? new Date(partnerTotal.updated_at).getTime() : 0;
  const partnerStale = !!partnerTotal && now - partnerUpdatedMs > PARTNER_STALE_MS;
  const partnerTop = partnerApps[0]?.foreground_ms ?? 0;

  return (
    <Screen
      title="Screen Time"
      right={<HeaderActions />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      {failed ? <Text style={styles.refreshError}>Couldn&apos;t refresh everything. Check your connection and pull again.</Text> : null}

      <SectionHeader title="You · Today" />
      <MineCard
        state={mine}
        sharing={mySharing}
        lastSent={lastSent}
        partnerName={partnerName}
        onStatistics={() => router.push('/screen-time-stats')}
      />

      <SectionHeader title={`${partnerName} · Today`} />
      {partnerLoading ? (
        <Card>
          <Text style={styles.muted}>Loading…</Text>
        </Card>
      ) : partnerError && !partnerTotal ? (
        <Card>
          <Text style={styles.muted}>Couldn&apos;t load {partnerName}&apos;s screen time. Pull down to try again.</Text>
        </Card>
      ) : partnerSharing === false ? (
        <Card>
          <Text style={styles.muted}>{partnerName} isn&apos;t sharing screen time right now.</Text>
        </Card>
      ) : partnerTotal ? (
        <Card>
          <Text style={styles.owner}>{partnerName}&apos;s phone · Today</Text>
          <Text style={styles.totalValue}>{formatDuration(partnerTotal.total_ms)}</Text>
          <Text style={[styles.updated, partnerStale && { color: colors.warning }]}>
            Last synced {timeAgo(partnerTotal.updated_at, now)}
            {partnerStale ? ' · not current' : ''}
          </Text>
          {partnerStale ? (
            <Text style={styles.note}>
              Android decides when {partnerName}&apos;s phone can send updates in the background. It updates right away
              when they open Bond.
            </Text>
          ) : null}
          {partnerApps.length > 0 ? (
            <View style={styles.appList}>
              <Text style={styles.listLabel}>Most used</Text>
              {partnerApps.map((a, i) => (
                <AppUsageRow
                  key={a.package_name}
                  name={a.app_name}
                  iconUri={partnerIcons[a.package_name]}
                  ms={a.foreground_ms}
                  share={partnerTop > 0 ? a.foreground_ms / partnerTop : undefined}
                  barColor={colors.partner}
                  last={i === partnerApps.length - 1}
                />
              ))}
            </View>
          ) : null}
          <Button
            label={`${partnerName}'s statistics`}
            icon="stats-chart-outline"
            variant="secondary"
            small
            onPress={() => router.push({ pathname: '/screen-time-stats', params: { who: 'partner' } })}
            style={styles.statsButton}
          />
        </Card>
      ) : (
        <Card>
          <Text style={styles.muted}>
            No screen time from {partnerName} yet today. It appears once their phone has Usage access turned on and
            sends today&apos;s first update. Earlier days are not shown here.
          </Text>
        </Card>
      )}
    </Screen>
  );
}

function MineCard({
  state,
  sharing,
  lastSent,
  partnerName,
  onStatistics,
}: {
  state: MyUsageState;
  sharing: boolean | null;
  lastSent: string | null;
  partnerName: string;
  onStatistics: () => void;
}) {
  useThemeVersion();
  const apps = state.kind === 'ready' ? state.usage.apps.slice(0, TOP_APPS) : [];
  const icons = useAppIcons(apps.map((a) => a.packageName));

  if (state.kind === 'loading') {
    return (
      <Card>
        <Text style={styles.muted}>Loading your screen time…</Text>
      </Card>
    );
  }
  if (state.kind === 'needs-update' || state.kind === 'unsupported') {
    return (
      <SetupCard
        icon="download-outline"
        title="Needs the latest Bond"
        body={
          state.kind === 'unsupported'
            ? 'Screen Time works on Android only.'
            : 'This copy of Bond was installed before Screen Time support was added. Install the newest version of Bond on this phone to use it.'
        }
      />
    );
  }
  if (state.kind === 'no-access') {
    return (
      <SetupCard
        icon="time-outline"
        title="Turn on Usage access"
        body={`Android only lets Bond read screen time after you turn on "Usage access" for Bond in Settings. Bond only reads which apps were open and for how long. It can't see what you do inside them.`}
        action={{
          label: 'Turn on Usage access',
          onPress: () => void requestUsageAccess('Screen Time reads which apps were open and for how long, never what you do inside them.'),
        }}
      />
    );
  }
  if (state.kind === 'error') {
    return (
      <Card>
        <Text style={styles.muted}>Couldn&apos;t read this phone&apos;s usage. Pull down to try again.</Text>
      </Card>
    );
  }

  const { usage } = state;
  const top = usage.apps[0]?.foregroundMs ?? 0;
  return (
    <Card>
      <Text style={styles.owner}>Your phone · Today</Text>
      <Text style={styles.totalValue}>{formatDuration(usage.totalMs)}</Text>
      <Text style={styles.updated}>
        {sharing === false
          ? `Not shared with ${partnerName}. You can change this in Settings, Privacy.`
          : lastSent
            ? `Shared with ${partnerName}, last sent ${formatTime(lastSent)}`
            : `Shared with ${partnerName}`}
      </Text>


      {apps.length === 0 ? (
        <Text style={[styles.muted, { marginTop: spacing.md }]}>No app use recorded yet today.</Text>
      ) : (
        <View style={styles.appList}>
          <Text style={styles.listLabel}>Most used</Text>
          {apps.map((a, i) => (
            <AppUsageRow
              key={a.packageName}
              name={a.appName}
              iconUri={icons[a.packageName]}
              ms={a.foregroundMs}
              share={top > 0 ? a.foregroundMs / top : undefined}
              last={i === apps.length - 1}
            />
          ))}
        </View>
      )}
      <Button label="Your statistics" icon="stats-chart-outline" variant="secondary" small onPress={onStatistics} style={styles.statsButton} />
    </Card>
  );
}

function SetupCard({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  body: string;
  action?: { label: string; onPress: () => void };
}) {
  useThemeVersion();
  return (
    <Card style={styles.setupCard}>
      <View style={styles.setupIcon}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={styles.setupTitle}>{title}</Text>
      <Text style={styles.setupBody}>{body}</Text>
      {action ? <Button label={action.label} onPress={action.onPress} small style={{ marginTop: spacing.md }} /> : null}
    </Card>
  );
}

const styles = themedStyles(() => ({
  muted: { ...font.small, color: colors.muted, lineHeight: 19 },
  refreshError: { ...font.small, color: colors.danger, marginBottom: spacing.md },
  setupCard: { alignItems: 'center', paddingVertical: spacing.xl },
  setupIcon: {
    width: 48,
    height: 48,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  setupTitle: { ...font.h3, color: colors.text, marginBottom: spacing.xs },
  setupBody: { ...font.small, color: colors.subtext, textAlign: 'center', lineHeight: 19 },
  owner: { ...font.small, fontWeight: '600', color: colors.subtext },
  totalValue: { ...font.number, fontSize: 28, color: colors.text, marginTop: 2 },
  updated: { ...font.small, color: colors.muted, marginTop: spacing.xs },
  note: { ...font.small, color: colors.subtext, lineHeight: 18, marginTop: spacing.xs },
  chart: { marginTop: spacing.lg },
  appList: { marginTop: spacing.lg },
  listLabel: { ...font.tiny, color: colors.muted, textTransform: 'uppercase', marginBottom: spacing.xs },
  statsButton: { marginTop: spacing.lg, alignSelf: 'stretch' },
}));
