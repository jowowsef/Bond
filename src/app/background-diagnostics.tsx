import React, { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BondUsage from '../../modules/bond-usage';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { isBatteryOptimizedForBond } from '@/lib/backgroundJobs';
import { serviceModes } from '@/lib/currentAppServiceControl';
import { getUsageSupport, hasUsageAccess } from '@/lib/screenTime';
import { getNotificationState } from '@/lib/setupPermissions';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * BACKGROUND DIAGNOSTICS (for testing on a real phone; hidden: tap Version in
 * Settings 7 times, or the row shown in development builds).
 *
 * Shows this phone's own log of the background service, kept ON THE PHONE
 * only (never uploaded): what Android reported as the open app, what was
 * uploaded or not and why, battery readings, and why the service stopped.
 * "detected: com.zhiliaoapp.musically" without a matching "app ...: sent"
 * line means detection works and the upload failed; no "detected" line
 * after switching apps means Android didn't report the switch.
 */
type Snapshot = {
  modes: { running: boolean; apps: boolean; battery: boolean; screenTime: boolean };
  usage: string;
  batteryOptimized: boolean | null;
  notifications: string;
  lines: string[];
};

async function read(): Promise<Snapshot> {
  let lines: string[] = [];
  try {
    lines = BondUsage?.getBackgroundDiagnostics?.() ?? ['(this build has no diagnostics)'];
  } catch {
    lines = ['(could not read the log)'];
  }
  return {
    modes: serviceModes(),
    usage: getUsageSupport() !== 'ready' ? 'not supported' : hasUsageAccess() ? 'allowed' : 'NOT allowed',
    batteryOptimized: await isBatteryOptimizedForBond(),
    notifications: await getNotificationState().catch(() => 'unknown'),
    lines,
  };
}

export default function BackgroundDiagnostics() {
  useThemeVersion();
  const [snap, setSnap] = useState<Snapshot | null>(null);

  const refresh = useCallback(() => {
    void read().then(setSnap);
  }, []);

  useEffect(() => {
    refresh();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  const clear = () => {
    try {
      BondUsage?.clearBackgroundDiagnostics?.();
    } catch {
      // older build
    }
    refresh();
  };

  const m = snap?.modes;
  const rows: [string, string][] = snap
    ? [
        ['Service', m!.running ? 'running' : 'stopped'],
        ['App checks (Currently Using)', m!.apps ? 'on' : 'off'],
        ['Battery updates', m!.battery ? 'on' : 'off'],
        ['Screen time updates', m!.screenTime ? 'on' : 'off'],
        ['Usage access', snap.usage],
        ['Battery optimization', snap.batteryOptimized === null ? 'unknown' : snap.batteryOptimized ? 'ON (Android may pause Bond)' : 'off (unrestricted)'],
        ['Notifications', snap.notifications],
      ]
    : [];

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <BackHeader title="Background diagnostics" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Stored only on this phone, never uploaded. Newest lines are at the bottom.
        </Text>
        <Card>
          {rows.map(([k, v]) => (
            <View key={k} style={styles.row}>
              <Text style={styles.key}>{k}</Text>
              <Text style={styles.value}>{v}</Text>
            </View>
          ))}
        </Card>
        <View style={styles.buttons}>
          <Button label="Refresh" icon="refresh-outline" variant="secondary" small onPress={refresh} />
          <Button label="Clear log" icon="trash-outline" variant="ghost" small onPress={clear} />
        </View>
        <View style={styles.log}>
          {(snap?.lines.length ? snap.lines : ['(empty)']).map((l, i) => (
            <Text key={i} style={styles.line} selectable>
              {l}
            </Text>
          ))}
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl * 2, gap: spacing.md },
  intro: { ...font.small, color: colors.subtext },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: spacing.xs },
  key: { ...font.small, color: colors.text, flexShrink: 1 },
  value: { ...font.small, color: colors.subtext, textAlign: 'right', flexShrink: 1 },
  buttons: { flexDirection: 'row', gap: spacing.sm },
  log: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  line: { fontFamily: 'monospace', fontSize: 11, color: colors.text },
}));
