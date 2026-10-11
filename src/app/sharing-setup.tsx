import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Redirect } from '@/components/Redirect';
import { useCurrentAppSharing } from '@/hooks/useCurrentAppSharing';
import { useLocationSharingSwitch } from '@/hooks/useLocationSharingSwitch';
import { getBackgroundPermission, requestBackgroundPermission, type BackgroundPermission } from '@/lib/backgroundLocation';
import { isBatteryOptimizedForBond, openBatteryOptimizationSettings } from '@/lib/backgroundJobs';
import { enableBatterySharing } from '@/lib/battery';
import { confirmSharing } from '@/lib/consent';
import { readSharingStep, saveSharingStep, SHARING_STEPS, type SharingStep } from '@/lib/pairingSetup';
import { getUsageSupport, hasUsageAccess } from '@/lib/screenTime';
import {
  getLocationState,
  getNotificationState,
  openAppSettings,
  requestLocationForeground,
  requestNotifications,
  type PermissionState,
} from '@/lib/setupPermissions';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { requestUsageAccess } from '@/lib/usageAccessFlow';
import { useCouple } from '@/state/couple';

/**
 * SHARING SETUP after a new pairing, ONE screen at a time:
 *   Notifications -> Location -> Battery & background -> Screen Time ->
 *   Currently Using, then the start screen continues with Name -> Avatar color.
 *
 * Two separate things on every screen, never mixed:
 *  - Android permissions (Bond explains first; Android's own dialog or
 *    Settings page decides). Granting one never turns on any sharing.
 *  - Bond sharing with the partner: everything starts OFF for a new pairing
 *    and is only turned on by the person, after Bond's confirmation.
 * "Not now" moves on and leaves it off; it can be set later in Settings.
 * The current screen is saved for this pairing, so leaving Bond, a trip to
 * Android Settings or a restart resumes here; coming back re-reads what
 * Android actually allows.
 */

type Snapshot = {
  notifications: PermissionState;
  locationFg: PermissionState;
  locationBg: BackgroundPermission | null;
  batteryOptimized: boolean | null;
  usageAccess: boolean;
  shareLocation: boolean;
  shareBattery: boolean;
  shareScreenTime: boolean;
};

const EMPTY: Snapshot = {
  notifications: 'undetermined',
  locationFg: 'undetermined',
  locationBg: null,
  batteryOptimized: null,
  usageAccess: false,
  shareLocation: false,
  shareBattery: false,
  shareScreenTime: false,
};

export default function SharingSetup() {
  useThemeVersion();
  const { phase, userId, couple, partnerProfile, pairingSetup, advancePairingSetup, ensurePairingReset, refresh } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'your partner';
  const coupleId = couple?.id ?? null;

  const [step, setStep] = useState<SharingStep | null>(null);
  const [snap, setSnap] = useState<Snapshot>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [resetReady, setResetReady] = useState(false);
  const [resetFailed, setResetFailed] = useState(false);
  const [finishing, setFinishing] = useState(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // ---- real state (Android + this account's sharing settings) ----
  const read = useCallback(async () => {
    const [notifications, locationFg, locationBg, batteryOptimized] = await Promise.all([
      getNotificationState().catch(() => 'undetermined' as const),
      getLocationState().catch(() => 'undetermined' as const),
      getBackgroundPermission().catch(() => null),
      isBatteryOptimizedForBond(),
    ]);
    let shares = { shareLocation: false, shareBattery: false, shareScreenTime: false };
    if (userId) {
      const { data } = await supabase
        .from('privacy_settings')
        .select('share_location, share_battery, share_screen_time')
        .eq('user_id', userId)
        .maybeSingle();
      shares = { shareLocation: !!data?.share_location, shareBattery: !!data?.share_battery, shareScreenTime: !!data?.share_screen_time };
    }
    if (!mounted.current) return;
    setSnap({ notifications, locationFg, locationBg, batteryOptimized, usageAccess: hasUsageAccess(), ...shares });
  }, [userId]);

  // Back from Android Settings (or any return to Bond): read again; stay on this screen.
  useEffect(() => {
    void read();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void read();
    });
    return () => sub.remove();
  }, [read]);

  // ---- this pairing: everything off on the server first, then resume the saved screen ----
  const prepare = useCallback(async () => {
    if (!userId || !coupleId) return;
    const ok = await ensurePairingReset();
    if (!mounted.current) return;
    setResetReady(ok);
    setResetFailed(!ok);
    setStep(await readSharingStep(userId, coupleId));
    await read();
  }, [userId, coupleId, ensurePairingReset, read]);

  useEffect(() => {
    if (pairingSetup === 'sharing') void prepare();
  }, [pairingSetup, prepare]);

  const locationSwitch = useLocationSharingSwitch({
    userId,
    partnerName,
    onChanged: () => Promise.all([refresh(), read()]),
    offerBackground: false, // this screen explains "Allow all the time" itself
  });
  const currentApp = useCurrentAppSharing(userId, partnerName);

  // Only during a new pairing's sharing step; otherwise the start screen decides.
  if (phase !== 'loading' && pairingSetup !== 'unknown' && pairingSetup !== 'sharing') return <Redirect href="/" />;

  const index = step ? SHARING_STEPS.indexOf(step) : 0;

  async function go(to: number) {
    if (!userId || !coupleId) return;
    if (to >= SHARING_STEPS.length) {
      if (finishing) return;
      setFinishing(true);
      const ok = await advancePairingSetup('sharing'); // then Name -> Avatar color
      if (mounted.current) setFinishing(false);
      if (!ok) {
        setResetReady(false);
        setResetFailed(true);
        Alert.alert('Not finished yet', "Bond couldn't prepare sharing for this new pairing. Check your connection and try again.");
      }
      return;
    }
    const next = SHARING_STEPS[Math.max(0, to)];
    setStep(next);
    await saveSharingStep(userId, coupleId, next);
  }

  async function run(key: string, work: () => Promise<unknown>) {
    if (busy) return;
    setBusy(key);
    try {
      await work();
    } finally {
      if (mounted.current) setBusy(null);
      await read();
    }
  }

  /** Bond sharing on: explicit consent first (Cancel = stays off). */
  async function shareBattery() {
    if (!userId || !resetReady) return;
    if (!(await confirmSharing('battery', partnerName))) return;
    await run('share-battery', async () => {
      const r = await enableBatterySharing(userId);
      if (!r.ok) Alert.alert('Not turned on', r.message ?? 'Please try again.');
    });
  }
  async function shareScreenTime() {
    if (!userId || !resetReady) return;
    if (!(await confirmSharing('screen_time', partnerName))) return;
    await run('share-screen', async () => {
      const { error } = await supabase.from('privacy_settings').update({ share_screen_time: true }).eq('user_id', userId);
      if (error) Alert.alert('Not turned on', 'Check your connection and try again.');
    });
  }

  // ---------------- the screens ----------------
  let icon: React.ComponentProps<typeof Ionicons>['name'] = 'notifications-outline';
  let title = '';
  let body = '';
  const rows: StatusRow[] = [];
  const actions: React.ReactNode[] = [];

  if (step === 'notifications') {
    icon = 'notifications-outline';
    title = 'Notifications';
    body = `Get a notification when ${partnerName}'s battery is low, for shared calendar reminders, or if you are unpaired. Nothing else.`;
    const n = snap.notifications;
    rows.push({ label: 'Notifications', ok: n === 'granted', text: n === 'granted' ? 'On' : n === 'denied' ? 'Off in Android settings' : 'Not turned on yet' });
    if (n !== 'granted') {
      actions.push(
        <Button
          key="n"
          label={n === 'denied' ? 'Open Notification Settings' : 'Enable Notifications'}
          loading={busy === 'notif'}
          onPress={() => void run('notif', requestNotifications)}
        />,
      );
    }
  } else if (step === 'location') {
    icon = 'location-outline';
    title = 'Location';
    const fg = snap.locationFg === 'granted';
    const bg = snap.locationBg === 'granted';
    if (!fg) {
      body =
        `Bond can show ${partnerName} where you are on the map. First, Android asks whether Bond may use your location ` +
        'while you use the app. This only allows it; sharing stays off until you turn it on below.';
    } else if (!bg) {
      body =
        'To keep your location up to date while Bond is closed or your screen is locked, Android needs "Allow all the time". ' +
        'Android does not offer it in a pop-up: tap Open Location Settings, then choose "Allow all the time", ' +
        'and come back. While it runs in the background Android shows a notification. You can skip this; Bond then shares only while it is open.';
    } else {
      body = `Android allows location all the time. Turn on sharing if you want ${partnerName} to see where you are.`;
    }
    rows.push({ label: 'Location while using Bond', ok: fg, text: fg ? 'Allowed' : snap.locationFg === 'denied' ? 'Denied in Android settings' : 'Not allowed yet' });
    rows.push({ label: 'Allow all the time', ok: fg ? bg : null, text: bg ? 'Allowed' : fg ? 'Not allowed: only while Bond is open' : 'After the first step' });
    rows.push({ label: `Shared with ${partnerName}`, ok: snap.shareLocation, text: snap.shareLocation ? 'On' : 'Off' });
    if (!fg) {
      actions.push(
        <Button
          key="fg"
          label={snap.locationFg === 'denied' ? 'Open App Settings' : 'Enable Location'}
          loading={busy === 'fg'}
          onPress={() => void run('fg', requestLocationForeground)}
        />,
      );
    } else if (!bg) {
      actions.push(
        <Button
          key="bg"
          label="Open Location Settings"
          icon="settings-outline"
          loading={busy === 'bg'}
          onPress={() =>
            void run('bg', async () => {
              // Android 11+: opens Bond's own location permission page (the
              // closest Android allows). If it won't ask again: App info.
              if (snap.locationBg === 'ask') await requestBackgroundPermission();
              else await openAppSettings();
            })
          }
        />,
      );
    }
    if (fg && !snap.shareLocation) {
      actions.push(
        <Button
          key="share-loc"
          label={`Share my location with ${partnerName}`}
          variant={bg ? 'primary' : 'secondary'}
          disabled={!resetReady}
          loading={locationSwitch.busy}
          onPress={() => locationSwitch.request(true)}
        />,
      );
    }
  } else if (step === 'battery') {
    icon = 'battery-half-outline';
    title = 'Battery & background updates';
    body =
      `${partnerName} can see your battery level and get an alert when it is low, if you turn sharing on. ` +
      'To send updates while Bond is closed, Android must not restrict Bond in the background: in Battery, choose "Unrestricted" ' +
      '(or "Don\'t optimize"), and in Mobile data, allow background data. Bond opens those pages; only you can change them.';
    const opt = snap.batteryOptimized;
    rows.push({
      label: 'Battery optimization',
      ok: opt === null ? null : !opt,
      text: opt === null ? "Android didn't say" : opt ? 'On: updates may be delayed for hours' : 'Off for Bond (unrestricted)',
    });
    rows.push({ label: 'Background data', ok: null, text: 'Check in App info > Mobile data (Android does not report it)' });
    rows.push({ label: `Shared with ${partnerName}`, ok: snap.shareBattery, text: snap.shareBattery ? 'On' : 'Off' });
    if (opt !== false) {
      actions.push(
        <Button key="opt" label="Open battery settings" variant="secondary" icon="settings-outline" onPress={() => void openBatteryOptimizationSettings()} />,
      );
    }
    actions.push(<Button key="data" label="Open App info" variant="secondary" icon="cellular-outline" onPress={() => void openAppSettings()} />);
    if (!snap.shareBattery) {
      actions.push(
        <Button
          key="share-bat"
          label={`Share my battery with ${partnerName}`}
          disabled={!resetReady}
          loading={busy === 'share-battery'}
          onPress={() => void shareBattery()}
        />,
      );
    }
  } else if (step === 'screen_time') {
    icon = 'time-outline';
    title = 'Screen Time';
    const supported = getUsageSupport() === 'ready';
    body =
      'Screen Time reads which apps you used today and for how long (never what you do inside them). Android only allows ' +
      'this after you turn on "Usage access" for Bond in Settings. If Android shows "Restricted setting" (common when Bond ' +
      'was installed from a file), Bond explains how to allow it.';
    rows.push({ label: 'Usage access', ok: supported ? snap.usageAccess : null, text: !supported ? 'Not available in this version' : snap.usageAccess ? 'On' : 'Off' });
    rows.push({ label: `Shared with ${partnerName}`, ok: snap.shareScreenTime, text: snap.shareScreenTime ? 'On' : 'Off' });
    if (supported && !snap.usageAccess) {
      actions.push(
        <Button
          key="ua"
          label="Turn on Usage access"
          icon="settings-outline"
          onPress={() => void requestUsageAccess('Screen Time reads app names and time spent on this phone, never what you do inside apps.')}
        />,
      );
    }
    if (!snap.shareScreenTime) {
      actions.push(
        <Button
          key="share-st"
          label={`Share my screen time with ${partnerName}`}
          variant={snap.usageAccess ? 'primary' : 'secondary'}
          disabled={!resetReady}
          loading={busy === 'share-screen'}
          onPress={() => void shareScreenTime()}
        />,
      );
    }
  } else if (step === 'current_app') {
    icon = 'phone-portrait-outline';
    title = 'Currently Using';
    body =
      `${partnerName} can see the name of the app open on your phone and when it was checked (only the latest, never a history, ` +
      'nothing inside apps). It uses the same Usage access, checks about every 20 seconds while your screen is on, and shows a ' +
      'quiet notification while it runs.';
    const st = currentApp.status;
    const on = currentApp.switchValue;
    rows.push({ label: 'Usage access', ok: getUsageSupport() === 'ready' ? hasUsageAccess() : null, text: hasUsageAccess() ? 'On' : 'Off' });
    rows.push({
      label: `Shared with ${partnerName}`,
      ok: on,
      text: on ? 'On' : st === 'needs-access' ? 'Waiting for Usage access' : st === 'unavailable' || st === 'needs-update' ? 'Not available' : 'Off',
    });
    if (st === 'needs-access' || (!hasUsageAccess() && getUsageSupport() === 'ready')) {
      actions.push(<Button key="ua2" label="Turn on Usage access" icon="settings-outline" onPress={currentApp.openAccessSettings} />);
    }
    if (!on && st !== 'needs-access' && st !== 'unavailable' && st !== 'needs-update') {
      actions.push(
        <Button
          key="share-ca"
          label="Share the app I'm using"
          variant={hasUsageAccess() ? 'primary' : 'secondary'}
          disabled={!resetReady || currentApp.switchDisabled}
          loading={currentApp.busy}
          onPress={() => currentApp.toggle(true)}
        />,
      );
    }
  }

  const last = index === SHARING_STEPS.length - 1;

  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.progress} accessibilityLabel={`Step ${index + 1} of ${SHARING_STEPS.length}`}>
          {SHARING_STEPS.map((s, i) => (
            <View key={s} style={[styles.dot, i <= index && styles.dotDone]} />
          ))}
        </View>
        <Text style={styles.stepText}>
          Sharing setup · {index + 1} of {SHARING_STEPS.length}
        </Text>

        {resetFailed ? (
          <Card style={styles.warnCard}>
            <Text style={styles.body}>
              Bond couldn&apos;t reach the server to start this pairing with everything off, so nothing can be turned on yet.
              Check your connection.
            </Text>
            <Button label="Try again" small onPress={() => void prepare()} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />
          </Card>
        ) : null}

        {step ? (
          <>
            <View style={styles.iconWrap}>
              <Ionicons name={icon} size={28} color={colors.primary} />
            </View>
            <Text style={styles.title}>{title}</Text>
            <Text style={styles.body}>{body}</Text>
            <Card style={styles.statusCard}>
              {rows.map((r, i) => (
                <View key={r.label} style={[styles.row, i > 0 && styles.divider]}>
                  <Ionicons
                    name={r.ok === true ? 'checkmark-circle' : r.ok === false ? 'ellipse-outline' : 'remove-circle-outline'}
                    size={18}
                    color={r.ok === true ? colors.success : colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowLabel}>{r.label}</Text>
                    <Text style={styles.rowText}>{r.text}</Text>
                  </View>
                </View>
              ))}
            </Card>
            <View style={styles.actions}>{actions}</View>
          </>
        ) : (
          <Text style={styles.body}>Loading…</Text>
        )}
      </ScrollView>

      <View style={styles.footer}>
        {index > 0 ? (
          <Button label="Back" variant="ghost" onPress={() => void go(index - 1)} style={styles.footerBtn} />
        ) : (
          <View style={styles.footerBtn} />
        )}
        <Button label="Not now" variant="ghost" disabled={!step || finishing} onPress={() => void go(index + 1)} style={styles.footerBtn} />
        <Button
          label={last ? 'Continue' : 'Next'}
          disabled={!step}
          loading={finishing}
          onPress={() => void go(index + 1)}
          style={styles.footerBtn}
        />
      </View>
    </SafeAreaView>
  );
}

type StatusRow = { label: string; ok: boolean | null; text: string };

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingBottom: spacing.xxl },
  progress: { flexDirection: 'row', gap: spacing.xs, marginTop: spacing.sm },
  dot: { flex: 1, height: 4, borderRadius: radius.pill, backgroundColor: colors.track },
  dotDone: { backgroundColor: colors.primary },
  stepText: { ...font.small, color: colors.muted, marginTop: spacing.sm },
  warnCard: { marginTop: spacing.md },
  iconWrap: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: spacing.xl,
  },
  title: { ...font.title, color: colors.text, marginTop: spacing.md },
  body: { ...font.body, color: colors.subtext, marginTop: spacing.sm, lineHeight: 22 },
  statusCard: { marginTop: spacing.lg, paddingVertical: spacing.xs },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md, paddingVertical: spacing.sm },
  divider: { borderTopWidth: 1, borderTopColor: colors.border },
  rowLabel: { ...font.body, fontWeight: '600', color: colors.text },
  rowText: { ...font.small, color: colors.subtext, marginTop: 2 },
  actions: { marginTop: spacing.lg, gap: spacing.sm },
  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    padding: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.background,
  },
  footerBtn: { flex: 1 },
}));
