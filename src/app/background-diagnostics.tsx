import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, Platform, ScrollView, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import BondUsage from '../../modules/bond-usage';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { isBatteryOptimizedForBond } from '@/lib/backgroundJobs';
import { liveLastChangeAt, readLiveStatus } from '@/lib/liveMode';
import { serviceModes } from '@/lib/currentAppServiceControl';
import { getUsageSupport, hasUsageAccess } from '@/lib/screenTime';
import { getNotificationState } from '@/lib/setupPermissions';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * BACKGROUND DIAGNOSTICS (for testing on a real phone; Settings > About Bond >
 * Background diagnostics). "Copy log" / "Share log" let a tester send the
 * log (with the phone model and Android's restrictions) by chat. Nothing is
 * sent unless the person shares it.
 *
 * Shows this phone's own log of the background service, kept ON THE PHONE
 * only (never uploaded): what Android reported as the open app, what was
 * uploaded or not and why, battery readings, and why the service stopped.
 * "detected: com.zhiliaoapp.musically" without a matching "app ...: sent"
 * line means detection works and the upload failed; no "detected" line
 * after switching apps means Android didn't report the switch.
 */
type Snapshot = {
  restrictions: [string, string][];
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
  const live = readLiveStatus();
  const lastLive = liveLastChangeAt();
  const liveRows: [string, string][] = [
    ['Live app detection (Accessibility)', live === 'on' ? 'ON (live app switches)' : live === 'closed' ? 'on, but CLOSED by the phone' : live === 'off' ? 'off (usage log fallback)' : 'not in this build'],
    ['Live: last app switch', lastLive > 0 ? new Date(lastLive).toLocaleTimeString() : 'none yet'],
  ];
  let restrictions: [string, string][] = [];
  try {
    const r = BondUsage?.getBackgroundRestrictions?.();
    if (r) {
      restrictions = [
        ['Background use (Android)', r.backgroundRestricted === null ? 'unknown' : r.backgroundRestricted ? 'RESTRICTED' : 'allowed'],
        ['Data Saver', r.dataSaver === 'enabled' ? 'ON (blocks background data)' : r.dataSaver === 'whitelisted' ? 'on, Bond allowed' : r.dataSaver ?? 'unknown'],
        ['Standby bucket', r.standbyBucket === null ? 'unknown' : String(r.standbyBucket)],
      ];
    }
  } catch {
    // older build
  }
  return {
    restrictions: [...liveRows, ...restrictions],
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

  const [copied, setCopied] = useState(false);
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
        ...snap.restrictions,
      ]
    : [];

  /** The whole report as plain text, for a tester to send by chat. */
  const report = () => {
    const c = (Platform.constants ?? {}) as { Brand?: string; Manufacturer?: string; Model?: string; Release?: string };
    const head = [
      'Bond background diagnostics',
      `Bond ${Constants.expoConfig?.version ?? '?'} · ${c.Brand ?? c.Manufacturer ?? '?'} ${c.Model ?? '?'} · Android ${c.Release ?? Platform.Version}`,
      ...rows.map(([k, v]) => `${k}: ${v}`),
      '',
    ];
    return [...head, ...(snap?.lines.length ? snap.lines : ['(empty log)'])].join('\n');
  };
  const copy = async () => {
    await Clipboard.setStringAsync(report()).catch(() => false);
    setCopied(true);
  };
  const share = () => void Share.share({ message: report() }).catch(() => undefined);

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <BackHeader title="Background diagnostics" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Stored only on this phone, never uploaded. Newest lines are at the bottom. To send it, tap Copy log or Share log; it includes app names this phone detected.
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
        <View style={styles.buttons}>
          <Button label={copied ? 'Copied' : 'Copy log'} icon={copied ? 'checkmark' : 'copy-outline'} small onPress={() => void copy()} disabled={!snap} />
          <Button label="Share log" icon="share-outline" variant="secondary" small onPress={share} disabled={!snap} />
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
