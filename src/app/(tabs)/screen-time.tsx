import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, RefreshControl, Text, View } from 'react-native';
import { AppIcon } from '@/components/AppUsageRow';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { HeaderActions } from '@/components/HeaderActions';
import { Screen } from '@/components/Screen';
import { useAppIcons } from '@/hooks/useAppIcons';
import { useMyUsage } from '@/hooks/useMyUsage';
import { PARTNER_STALE_MS, usePartnerUsage } from '@/hooks/usePartnerUsage';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { dailyAverage, useWeekUsage } from '@/hooks/useWeekUsage';
import { dayKey, formatDuration, timeAgo, shownName } from '@/lib/format';
import { getLastScreenTimeSync, syncScreenTime } from '@/lib/screenTime';
import { requestUsageAccess } from '@/lib/usageAccessFlow';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/** The top apps list shows this many; Statistics shows all of today's apps. */
const TOP_APPS = 4;
const WEEKDAY = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

/**
 * SCREEN TIME tab.
 *  - Day / Week switch.
 *  - Day: today's total for each of you. Week: each of you's daily average
 *    over the last 7 days, and a bar chart (you and your partner per day).
 *  - Top apps today, for your partner or you.
 *  - Statistics (all apps, details) for each of you.
 * Yours comes from this phone (Android Usage access); your partner's is what
 * their phone uploaded, only while they share screen time.
 */
export default function ScreenTimeTab() {
  useThemeVersion();
  const router = useRouter();
  const { userId, partnerId, partnerProfile } = useCouple();
  const partnerName = shownName(partnerProfile?.display_name, 'Your partner');

  const { state: mine, reload: reloadMine } = useMyUsage();
  const partner = usePartnerUsage(partnerId, dayKey());
  const week = useWeekUsage(partnerId);
  const [mode, setMode] = useState<'day' | 'week'>('week');
  const [whose, setWhose] = useState<'partner' | 'me'>('partner');
  const [mySharing, setMySharing] = useState<boolean | null>(null);
  const [lastSent, setLastSent] = useState<string | null>(null);

  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // My sharing status + upload (checks Usage access and the Privacy switch itself).
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

  const loadPartner = partner.reload;
  const reloadWeek = week.reload;
  const loadAll = useCallback(async () => {
    const results = await Promise.allSettled([reloadMine(), syncMine(), loadPartner(), reloadWeek()]);
    if (results.some((r) => r.status === 'rejected')) throw new Error('refresh failed');
  }, [reloadMine, syncMine, loadPartner, reloadWeek]);
  const { refreshing, onRefresh, failed } = usePullToRefresh(loadAll);

  useFocusEffect(
    useCallback(() => {
      void Promise.allSettled([syncMine(), loadPartner(), reloadWeek()]);
    }, [syncMine, loadPartner, reloadWeek]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void Promise.allSettled([syncMine(), loadPartner()]);
    });
    return () => sub.remove();
  }, [syncMine, loadPartner]);

  // ---- summary values ----
  const myToday = mine.kind === 'ready' ? mine.usage.totalMs : null;
  const partnerToday = partner.sharing === false ? null : partner.total ? partner.total.total_ms : partner.loading ? null : 0;
  const myAvg = dailyAverage(week.mine);
  const partnerAvg = dailyAverage(week.partner);
  const partnerStale = !!partner.total && partner.now - new Date(partner.total.updated_at).getTime() > PARTNER_STALE_MS;

  const mySummary = mode === 'day' ? myToday : myAvg;
  const partnerSummary = mode === 'day' ? partnerToday : partnerAvg;
  const label = mode === 'day' ? 'today' : 'daily avg';

  // ---- top apps (today) ----
  const myApps = mine.kind === 'ready' ? mine.usage.apps.slice(0, TOP_APPS).map((a) => ({ pkg: a.packageName, name: a.appName, ms: a.foregroundMs })) : [];
  const partnerApps =
    partner.sharing === false ? [] : partner.apps.slice(0, TOP_APPS).map((a) => ({ pkg: a.package_name, name: a.app_name, ms: a.foreground_ms }));
  const apps = whose === 'partner' ? partnerApps : myApps;
  const icons = useAppIcons(apps.map((a) => a.pkg));
  const topMs = apps[0]?.ms ?? 0;

  // ---- week chart ----
  const maxDay = Math.max(1, ...(week.mine ?? []), ...(week.partner ?? []));

  return (
    <Screen
      title="Screen time"
      right={<HeaderActions />}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />}
    >
      {failed ? <Text style={styles.refreshError}>Couldn&apos;t refresh everything. Check your connection and pull again.</Text> : null}

      <View style={styles.toggleRow}>
        <Segmented
          value={mode}
          options={[
            ['day', 'Day'],
            ['week', 'Week'],
          ]}
          onChange={(v) => setMode(v as 'day' | 'week')}
        />
      </View>

      {mine.kind === 'no-access' ? (
        <Card style={styles.setupCard}>
          <Text style={styles.setupTitle}>Turn on Usage access</Text>
          <Text style={styles.setupBody}>
            Android only lets Bond read your screen time after you turn on &quot;Usage access&quot; for Bond. Bond only reads which apps were open and
            for how long, never what you do inside them.
          </Text>
          <Button
            label="Turn on Usage access"
            small
            onPress={() => void requestUsageAccess('Screen Time reads which apps were open and for how long, never what you do inside them.')}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ) : null}

      <View style={styles.summaryRow}>
        <SummaryCard who="You" label={label} value={mySummary} accent={colors.me} empty={mine.kind === 'no-access' ? 'Usage access off' : 'Loading…'} />
        <SummaryCard
          who={partnerName}
          label={label}
          value={partnerSummary}
          accent={colors.partner}
          empty={partner.sharing === false ? 'Not shared' : 'Loading…'}
          warn={mode === 'day' && partnerStale}
        />
      </View>

      {mode === 'week' ? (
        <Card style={styles.chartCard}>
          <View style={styles.chartHead}>
            <Text style={styles.chartTitle}>This week</Text>
            <Text style={styles.chartRange}>{rangeLabel(week.days)}</Text>
          </View>
          <View style={styles.chart}>
            {week.days.map((d, i) => {
              const me = week.mine?.[i] ?? 0;
              const them = week.partner?.[i] ?? 0;
              const isToday = i === 6;
              return (
                <View key={d} style={styles.chartCol} accessibilityLabel={`${d}: you ${formatDuration(me)}, ${partnerName} ${formatDuration(them)}`}>
                  <View style={styles.bars}>
                    <View style={[styles.bar, { height: `${Math.max(2, (me / maxDay) * 100)}%`, backgroundColor: colors.me, opacity: week.mine ? 1 : 0 }]} />
                    <View style={[styles.bar, { height: `${Math.max(2, (them / maxDay) * 100)}%`, backgroundColor: colors.partner, opacity: week.partner ? 1 : 0 }]} />
                  </View>
                  <Text style={[styles.dayLabel, isToday && styles.dayLabelToday]}>{WEEKDAY[new Date(`${d}T12:00:00`).getDay()]}</Text>
                </View>
              );
            })}
          </View>
          <View style={styles.legend}>
            <Legend color={colors.me} label="You" />
            <Legend color={colors.partner} label={week.partner ? partnerName : `${partnerName} (not shared)`} />
          </View>
        </Card>
      ) : null}

      <View style={styles.topHead}>
        <Text style={styles.topTitle}>Top apps today</Text>
        <Segmented
          small
          value={whose}
          options={[
            ['partner', partnerName],
            ['me', 'You'],
          ]}
          onChange={(v) => setWhose(v as 'partner' | 'me')}
        />
      </View>
      <Card style={{ paddingVertical: spacing.xs }}>
        {apps.length === 0 ? (
          <Text style={styles.muted}>
            {whose === 'partner'
              ? partner.sharing === false
                ? `${partnerName} isn't sharing screen time right now.`
                : `Nothing from ${partnerName} yet today.`
              : mine.kind === 'ready'
                ? 'No app use recorded yet today.'
                : 'Your screen time shows here once Usage access is on.'}
          </Text>
        ) : (
          apps.map((a, i) => (
            <View key={a.pkg} style={[styles.appRow, i > 0 && styles.appDivider]}>
              <AppIcon uri={icons[a.pkg]} size={32} />
              <View style={{ flex: 1 }}>
                <View style={styles.appTop}>
                  <Text style={styles.appName} numberOfLines={1}>
                    {a.name}
                  </Text>
                  <Text style={styles.appTime}>{formatDuration(a.ms)}</Text>
                </View>
                <View style={styles.track}>
                  <View
                    style={[
                      styles.fill,
                      { width: `${topMs > 0 ? Math.max(4, (a.ms / topMs) * 100) : 0}%`, backgroundColor: whose === 'partner' ? colors.partner : colors.me },
                    ]}
                  />
                </View>
              </View>
            </View>
          ))
        )}
      </Card>
      {whose === 'partner' && partner.total ? (
        <Text style={[styles.synced, partnerStale && { color: colors.warning }]}>
          {partnerName}&apos;s phone last synced {timeAgo(partner.total.updated_at, partner.now)}
          {partnerStale ? ' · not current' : ''}
        </Text>
      ) : whose === 'me' && mySharing !== null ? (
        <Text style={styles.synced}>
          {mySharing === false ? `Not shared with ${partnerName}` : lastSent ? `Shared with ${partnerName}` : `Shared with ${partnerName}`}
        </Text>
      ) : null}

      <View style={styles.statsRow}>
        <Button
          label="Your statistics"
          icon="stats-chart-outline"
          variant="secondary"
          small
          onPress={() => router.push('/screen-time-stats')}
          style={{ flex: 1 }}
        />
        <Button
          label={`${partnerName}'s statistics`}
          icon="stats-chart-outline"
          variant="secondary"
          small
          disabled={partner.sharing === false || !partner.total}
          onPress={() => router.push({ pathname: '/screen-time-stats', params: { who: 'partner' } })}
          style={{ flex: 1 }}
        />
      </View>
    </Screen>
  );
}

function rangeLabel(days: string[]): string {
  if (days.length === 0) return '';
  const a = new Date(`${days[0]}T12:00:00`);
  const b = new Date(`${days[days.length - 1]}T12:00:00`);
  const month = (d: Date) => d.toLocaleDateString(undefined, { month: 'short' });
  return a.getMonth() === b.getMonth() ? `${month(a)} ${a.getDate()} – ${b.getDate()}` : `${month(a)} ${a.getDate()} – ${month(b)} ${b.getDate()}`;
}

function SummaryCard({
  who,
  label,
  value,
  accent,
  empty,
  warn,
}: {
  who: string;
  label: string;
  value: number | null;
  accent: string;
  empty: string;
  warn?: boolean;
}) {
  useThemeVersion();
  return (
    <Card style={styles.summary}>
      <View style={styles.summaryHead}>
        <View style={[styles.dot, { backgroundColor: accent }]} />
        <Text style={styles.summaryLabel} numberOfLines={1}>
          {who} · {label}
        </Text>
      </View>
      {value != null ? (
        <Text style={[styles.summaryValue, warn && { color: colors.warning }]}>{formatDuration(value)}</Text>
      ) : (
        <Text style={styles.summaryEmpty}>{empty}</Text>
      )}
    </Card>
  );
}

function Legend({ color, label }: { color: string; label: string }) {
  useThemeVersion();
  return (
    <View style={styles.legendItem}>
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text style={styles.legendText}>{label}</Text>
    </View>
  );
}

function Segmented({
  value,
  options,
  onChange,
  small,
}: {
  value: string;
  options: [string, string][];
  onChange: (v: string) => void;
  small?: boolean;
}) {
  useThemeVersion();
  return (
    <View style={styles.segment}>
      {options.map(([key, text]) => {
        const on = value === key;
        return (
          <Pressable
            key={key}
            onPress={() => onChange(key)}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            style={[styles.segmentItem, small && styles.segmentItemSmall, on && styles.segmentOn]}
          >
            <Text style={[styles.segmentText, on && styles.segmentTextOn]} numberOfLines={1}>
              {text}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = themedStyles(() => ({
  refreshError: { ...font.small, color: colors.danger, marginBottom: spacing.md },
  toggleRow: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: spacing.md },
  segment: { flexDirection: 'row', backgroundColor: colors.track, borderRadius: radius.pill, padding: 3 },
  segmentItem: { paddingHorizontal: spacing.lg, paddingVertical: 6, borderRadius: radius.pill, maxWidth: 140 },
  segmentItemSmall: { paddingHorizontal: spacing.md, paddingVertical: 4 },
  segmentOn: { backgroundColor: colors.card },
  segmentText: { ...font.small, fontWeight: '600', color: colors.subtext },
  segmentTextOn: { color: colors.text, fontWeight: '700' },
  setupCard: { marginBottom: spacing.md },
  setupTitle: { ...font.h3, color: colors.text },
  setupBody: { ...font.small, color: colors.subtext, marginTop: spacing.xs, lineHeight: 19 },
  summaryRow: { flexDirection: 'row', gap: spacing.md },
  summary: { flex: 1, paddingVertical: spacing.md },
  summaryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  summaryLabel: { ...font.tiny, color: colors.subtext, letterSpacing: 0, flexShrink: 1 },
  summaryValue: { ...font.h2, fontSize: 22, color: colors.text, marginTop: spacing.xs },
  summaryEmpty: { ...font.small, color: colors.muted, marginTop: spacing.xs },
  dot: { width: 8, height: 8, borderRadius: 4 },
  chartCard: { marginTop: spacing.md },
  chartHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  chartTitle: { ...font.small, fontWeight: '700', color: colors.text },
  chartRange: { ...font.tiny, color: colors.muted, letterSpacing: 0 },
  chart: { flexDirection: 'row', height: 140, marginTop: spacing.md, alignItems: 'flex-end' },
  chartCol: { flex: 1, alignItems: 'center', height: '100%' },
  bars: { flex: 1, flexDirection: 'row', alignItems: 'flex-end', gap: 3, width: '100%', justifyContent: 'center' },
  bar: { width: 9, borderTopLeftRadius: 4, borderTopRightRadius: 4 },
  dayLabel: { ...font.tiny, color: colors.muted, marginTop: 4, letterSpacing: 0 },
  dayLabelToday: { color: colors.text, fontWeight: '800' },
  legend: { flexDirection: 'row', gap: spacing.lg, marginTop: spacing.md, justifyContent: 'center' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendText: { ...font.tiny, color: colors.subtext, letterSpacing: 0 },
  topHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: spacing.xl, marginBottom: spacing.sm },
  topTitle: { ...font.h3, color: colors.text },
  muted: { ...font.small, color: colors.muted, lineHeight: 19, paddingVertical: spacing.md },
  appRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  appDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  appTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  appName: { ...font.body, fontWeight: '600', color: colors.text, flex: 1, marginRight: spacing.sm },
  appTime: { ...font.small, color: colors.subtext },
  track: { height: 5, borderRadius: 3, backgroundColor: colors.track, marginTop: 6, overflow: 'hidden' },
  fill: { height: 5, borderRadius: 3 },
  synced: { ...font.tiny, color: colors.muted, marginTop: spacing.sm, letterSpacing: 0, textAlign: 'center' },
  statsRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg, marginBottom: spacing.md },
}));
