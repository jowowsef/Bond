import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import { dayKey, formatDuration } from '@/lib/format';
import { USAGE_ACCESS_AVAILABLE } from '@/lib/setupPermissions';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing } from '@/lib/theme';
import type { AppUsageDay, ScreenTimeDay } from '@/lib/types';
import { useCouple } from '@/state/couple';

/**
 * SCREEN TIME (detail) — honest.
 *
 * Reading real app usage needs Android's "Usage Access", which depends on the
 * native Bond module that isn't in this build yet. So for your own phone we
 * show an honest "not set up" state with how it will work — never invented
 * numbers. Your partner's section shows whatever real data Supabase has
 * (currently none), with a clear empty state.
 */
export default function ScreenTime() {
  const { partnerId, partnerProfile } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Your partner';

  const [partnerTotal, setPartnerTotal] = useState<ScreenTimeDay | null>(null);
  const [partnerApps, setPartnerApps] = useState<AppUsageDay[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    (async () => {
      if (!partnerId) {
        setLoading(false);
        return;
      }
      const today = dayKey();
      const [totalRes, appsRes] = await Promise.all([
        supabase.from('screen_time_daily').select('*').eq('user_id', partnerId).eq('day', today).maybeSingle(),
        supabase
          .from('app_usage_daily')
          .select('*')
          .eq('user_id', partnerId)
          .eq('day', today)
          .order('foreground_ms', { ascending: false })
          .limit(8),
      ]);
      if (!active) return;
      setPartnerTotal((totalRes.data as ScreenTimeDay) ?? null);
      setPartnerApps((appsRes.data as AppUsageDay[]) ?? []);
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [partnerId]);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <BackHeader title="Screen time" />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <SectionHeader title="You" />
        {USAGE_ACCESS_AVAILABLE ? (
          <Card>
            <Text style={styles.empty}>No usage recorded yet today.</Text>
          </Card>
        ) : (
          <Card style={styles.setupCard}>
            <View style={styles.setupIcon}>
              <Ionicons name="time-outline" size={22} color={colors.primary} />
            </View>
            <Text style={styles.setupTitle}>Screen Time isn't set up</Text>
            <Text style={styles.setupBody}>
              Seeing your own app usage needs Android&apos;s Usage Access permission. That part of Bond arrives in a
              later update — until then we won&apos;t show any made-up numbers here.
            </Text>
          </Card>
        )}

        <SectionHeader title={partnerName} />
        {loading ? (
          <Card>
            <Text style={styles.empty}>Loading…</Text>
          </Card>
        ) : partnerTotal ? (
          <Card>
            <View style={styles.totalRow}>
              <Text style={styles.totalLabel}>Today</Text>
              <Text style={styles.totalValue}>{formatDuration(partnerTotal.total_ms)}</Text>
            </View>
            {partnerApps.length > 0 ? (
              <View style={styles.appList}>
                {partnerApps.map((app, i) => (
                  <View key={app.package_name} style={[styles.appRow, i < partnerApps.length - 1 && styles.divider]}>
                    <View style={styles.appIcon}>
                      <Ionicons name="apps-outline" size={16} color={colors.subtext} />
                    </View>
                    <Text style={styles.appName} numberOfLines={1}>
                      {app.app_name}
                    </Text>
                    <Text style={styles.appTime}>{formatDuration(app.foreground_ms)}</Text>
                  </View>
                ))}
              </View>
            ) : null}
          </Card>
        ) : (
          <Card>
            <Text style={styles.empty}>
              {partnerName} hasn&apos;t shared any screen-time data yet. It will appear here once their phone records it
              (also needs the later update).
            </Text>
          </Card>
        )}

        <View style={{ height: spacing.xl }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 0 },
  empty: { ...font.small, color: colors.muted, lineHeight: 19 },
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
  totalRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: spacing.sm },
  totalLabel: { ...font.small, color: colors.subtext },
  totalValue: { ...font.number, fontSize: 28, color: colors.text },
  appList: { marginTop: spacing.sm },
  appRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  appIcon: {
    width: 28,
    height: 28,
    borderRadius: radius.sm,
    backgroundColor: colors.track,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  appName: { ...font.body, color: colors.text, flex: 1 },
  appTime: { ...font.small, fontWeight: '700', color: colors.subtext },
});
