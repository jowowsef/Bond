import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, AppState, Platform, Pressable, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BondLogo } from '@/components/BondLogo';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Redirect } from '@/components/Redirect';
import { useCurrentAppSharing } from '@/hooks/useCurrentAppSharing';
import { useLocationSharingSwitch } from '@/hooks/useLocationSharingSwitch';
import { getBackgroundPermission, requestBackgroundPermission, type BackgroundPermission } from '@/lib/backgroundLocation';
import { isBatteryOptimizedForBond, openBatteryOptimizationSettings } from '@/lib/backgroundJobs';
import { requestLiveMode, requestUnrestrictedBattery, useLiveStatus } from '@/lib/liveMode';
import { enableBatterySharing } from '@/lib/battery';
import { confirmSharing } from '@/lib/consent';
import { readSharingStep, saveSharingStep, SHARING_STEPS, type SharingStep } from '@/lib/pairingSetup';
import { getUsageSupport, hasUsageAccess } from '@/lib/screenTime';
import {
  getLocationState,
  getNotificationState,
  openAppSettings,
  requestNotifications,
  type PermissionState,
} from '@/lib/setupPermissions';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { requestUsageAccess } from '@/lib/usageAccessFlow';
import { useCouple } from '@/state/couple';

/**
 * SHARING SETUP after a new pairing:
 *   Overview (what Bond can use, with a check for what is already done) ->
 *   Notifications -> Location -> Background -> Screen Time -> Currently Using,
 *   then the start screen continues with Name -> Avatar color.
 *
 * Each step screen does ONE thing at a time: its main button is always the
 * next thing still missing (an Android permission, or turning sharing on), and
 * becomes "Next" when the step is complete. "Not now" moves on and leaves it
 * off; everything can be changed later in Settings.
 *
 * Two separate things, never mixed:
 *  - Android permissions (Bond explains first; Android's own dialog or
 *    Settings page decides). Granting one never turns on any sharing.
 *  - Bond sharing with the partner: everything starts OFF for a new pairing
 *    and is only turned on by the person, after Bond's confirmation.
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

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * Tecno, Infinix and itel (HiOS / XOS) close apps in the background with their
 * own settings, even when Android's battery use is "Unrestricted". Bond can't
 * read or change those, so it only explains where they are.
 */
const PHONE_BRAND = String(((Platform.constants ?? {}) as { Brand?: string; Manufacturer?: string }).Brand ?? '').toLowerCase();
const KEEPS_CLOSING_APPS = ['tecno', 'infinix', 'itel'].includes(PHONE_BRAND);
type Tone = 'blue' | 'pink';
type FeatureStep = Exclude<SharingStep, 'overview'>;
const FEATURE_STEPS = SHARING_STEPS.filter((s): s is FeatureStep => s !== 'overview');

/** How each step looks in the overview list. */
const OVERVIEW: Record<FeatureStep, { icon: IconName; title: string; desc: string; tone: Tone }> = {
  notifications: { icon: 'notifications-outline', title: 'Notifications', desc: 'Alerts and reminders', tone: 'blue' },
  location: { icon: 'location-outline', title: 'Location', desc: 'See each other on the map', tone: 'pink' },
  battery: { icon: 'sync-outline', title: 'Background activity', desc: 'Keep everything up to date', tone: 'blue' },
  screen_time: { icon: 'time-outline', title: 'Screen Time', desc: 'Daily screen time and top apps', tone: 'pink' },
  current_app: { icon: 'phone-portrait-outline', title: 'Currently Using', desc: 'The app open on your phone', tone: 'blue' },
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
    offerBackground: false, // the Location step explains "Allow all the time" itself
  });
  const currentApp = useCurrentAppSharing(userId, partnerName);
  const live = useLiveStatus();

  // Only during a new pairing's sharing step; otherwise the start screen decides.
  if (phase !== 'loading' && pairingSetup !== 'unknown' && pairingSetup !== 'sharing') return <Redirect href="/" />;

  const usageSupported = getUsageSupport() === 'ready';
  const fg = snap.locationFg === 'granted';
  const bg = snap.locationBg === 'granted';
  const currentAppOn = currentApp.switchValue;

  /** Is everything for this step done (shown as a check in the overview)? */
  const done: Record<FeatureStep, boolean> = {
    notifications: snap.notifications === 'granted',
    location: snap.shareLocation && fg && bg,
    battery: snap.shareBattery && snap.batteryOptimized === false,
    screen_time: snap.usageAccess && snap.shareScreenTime,
    current_app: currentAppOn,
  };

  async function go(to: SharingStep | 'finish') {
    if (!userId || !coupleId) return;
    if (to === 'finish') {
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
    setStep(to);
    await saveSharingStep(userId, coupleId, to);
  }

  const index = step ? SHARING_STEPS.indexOf(step) : 0;
  const next = () => void go(index + 1 < SHARING_STEPS.length ? SHARING_STEPS[index + 1] : 'finish');
  const back = () => void go(SHARING_STEPS[Math.max(0, index - 1)]);

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

  // ---------------- Overview ----------------
  if (step === 'overview') {
    const firstOpen = FEATURE_STEPS.find((s) => !done[s]);
    const liveOn = live.status === 'on';
    return (
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.overview} showsVerticalScrollIndicator={false}>
          <BondLogo size={34} showWordmark={false} />
          <Text style={styles.overviewTitle}>Let&apos;s get you two connected</Text>
          <Text style={styles.overviewSub}>Bond needs a few permissions to work. You&apos;re always in control.</Text>
          <ResetWarning failed={resetFailed} onRetry={() => void prepare()} />
          <View style={styles.list}>
            {FEATURE_STEPS.map((s) => {
              const o = OVERVIEW[s];
              return (
                <Pressable
                  key={s}
                  onPress={() => void go(s)}
                  accessibilityRole="button"
                  accessibilityLabel={`${o.title}: ${done[s] ? 'done' : 'not set up'}`}
                  style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.85 }]}
                >
                  <View style={[styles.listIcon, o.tone === 'pink' ? styles.pinkSoft : styles.blueSoft]}>
                    <Ionicons name={o.icon} size={19} color={o.tone === 'pink' ? colors.pink : colors.blue} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.listTitle}>{o.title}</Text>
                    <Text style={styles.listDesc}>{o.desc}</Text>
                  </View>
                  {done[s] ? (
                    <Ionicons name="checkmark-circle" size={26} color={colors.primary} />
                  ) : (
                    <View style={styles.allowPill}>
                      <Text style={styles.allowText}>Allow</Text>
                    </View>
                  )}
                </Pressable>
              );
            })}
            {/* Optional extra for Currently Using (opens that step, part 2). */}
            {live.status !== 'unavailable' ? (
              <Pressable
                onPress={() => void go('current_app')}
                accessibilityRole="button"
                accessibilityLabel={`Live app detection, optional: ${liveOn ? 'on' : 'off'}`}
                style={({ pressed }) => [styles.listRow, pressed && { opacity: 0.85 }]}
              >
                <View style={[styles.listIcon, styles.pinkSoft]}>
                  <Ionicons name="flash-outline" size={19} color={colors.pink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.listTitle}>Live app detection</Text>
                  <Text style={styles.listDesc}>Optional · uses Accessibility</Text>
                </View>
                {liveOn ? (
                  <Ionicons name="checkmark-circle" size={26} color={colors.primary} />
                ) : (
                  <View style={styles.allowPill}>
                    <Text style={styles.allowText}>Optional</Text>
                  </View>
                )}
              </Pressable>
            ) : null}
          </View>
        </ScrollView>
        <View style={styles.bottom}>
          <PrivacyNote text="Shared only between you and your partner" />
          <Button label="Continue" onPress={() => void go(firstOpen ?? 'finish')} loading={finishing} disabled={!resetReady && !firstOpen} />
        </View>
      </SafeAreaView>
    );
  }

  // ---------------- One step at a time ----------------
  let icon: IconName = 'notifications-outline';
  let tone: Tone = 'blue';
  let title = '';
  let body = '';
  let tip: string | null = null;
  let note = `Only ${partnerName} can see this. Turn it off anytime.`;
  /** The next missing thing for this step (null = the step is complete). */
  let action: { label: string; onPress: () => void; loading?: boolean; disabled?: boolean } | null = null;
  const checks: { label: string; ok: boolean | null; hint?: string; link?: { label: string; onPress: () => void } }[] = [];

  if (step === 'notifications') {
    icon = 'notifications-outline';
    title = 'Never miss what matters';
    body = `Get a notification when ${partnerName}'s battery is low, for shared calendar reminders, or if you are unpaired. Nothing else.`;
    note = 'You can turn notifications off anytime.';
    if (snap.notifications !== 'granted') {
      action = {
        label: snap.notifications === 'denied' ? 'Open notification settings' : 'Turn on notifications',
        loading: busy === 'notif',
        onPress: () => void run('notif', requestNotifications),
      };
    }
  } else if (step === 'location') {
    tone = 'pink';
    icon = 'location';
    if (!snap.shareLocation || !fg) {
      title = 'Share where you are';
      body = `See each other on the map, so you both know the other got there safe. Android first asks to allow location while you use Bond.`;
      tip = 'Tip: choose "While using the app" now. Next, Bond helps you turn on "Allow all the time".';
      action = {
        label: 'Share my location',
        disabled: !resetReady,
        loading: locationSwitch.busy,
        onPress: () => locationSwitch.request(true),
      };
    } else if (!bg) {
      title = 'Keep it up to date';
      body =
        `Right now ${partnerName} only sees your location while Bond is open. With "Allow all the time", it stays up to date ` +
        'even when Bond is closed or your screen is locked. Android shows a small notification while it runs.';
      tip = 'Tip: on the next screen, choose "Allow all the time", then come back.';
      action = {
        label: 'Allow all the time',
        loading: busy === 'bg',
        onPress: () =>
          void run('bg', async () => {
            // Android 11+: opens Bond's own location permission page (the
            // closest Android allows). If it won't ask again: App info.
            if (snap.locationBg === 'ask') await requestBackgroundPermission();
            else await openAppSettings();
          }),
      };
    } else {
      title = 'Location is on';
      body = `${partnerName} sees your location, also while Bond is closed.`;
    }
  } else if (step === 'battery') {
    icon = 'sync';
    title = 'Stay in sync, always';
    body = `Let Bond run in the background so your battery, screen time and the app you use stay up to date for ${partnerName}, even when Bond is closed.`;
    const opt = snap.batteryOptimized;
    checks.push({
      label: opt === false ? 'Battery: Bond may always run in the background' : opt === true ? 'Battery: Android may pause Bond' : 'Battery: Android didn’t say',
      ok: opt === null ? null : !opt,
      hint: opt === true ? 'Without this, Android can stop Bond’s updates for minutes or hours while your phone rests.' : undefined,
    });
    checks.push({
      label: 'Background data',
      ok: null,
      hint: 'Bond can’t check this. In App info › Mobile data, make sure background data is allowed.',
      link: { label: 'Open App info', onPress: () => void openAppSettings() },
    });
    if (KEEPS_CLOSING_APPS) {
      checks.push({
        label: 'Tecno, Infinix and itel phones',
        ok: null,
        hint:
          'These phones close apps in the background on their own. In Phone Master › App launch, set Bond to manage ' +
          'manually and turn on Auto-launch, Secondary launch and Run in background. Then lock Bond in Recent apps.',
      });
    }
    checks.push({ label: `Share my battery with ${partnerName}`, ok: snap.shareBattery });
    if (opt === true) {
      tip = 'Android will ask "Let Bond always run in the background?". Tap Allow. You can change it later in App info › Battery.';
      action = {
        label: 'Allow background activity',
        onPress: () => {
          // Android's own Allow / Deny question; if this phone doesn't offer it, its battery list.
          if (!requestUnrestrictedBattery()) void openBatteryOptimizationSettings();
        },
      };
    } else if (!snap.shareBattery) {
      action = {
        label: 'Share my battery',
        disabled: !resetReady,
        loading: busy === 'share-battery',
        onPress: () => void shareBattery(),
      };
    }
  } else if (step === 'screen_time') {
    tone = 'pink';
    icon = 'time';
    title = 'Your screen time, together';
    body =
      'Bond reads which apps you used today and for how long, never what you do inside them. Android asks you to turn on ' +
      '"Usage access" for Bond first.';
    if (!usageSupported) {
      body = 'Screen Time needs the newest version of Bond on this phone.';
    } else if (!snap.usageAccess) {
      action = {
        label: 'Turn on Usage access',
        onPress: () => void requestUsageAccess('Screen Time reads app names and time spent on this phone, never what you do inside apps.'),
      };
    } else if (!snap.shareScreenTime) {
      action = {
        label: 'Share my screen time',
        disabled: !resetReady,
        loading: busy === 'share-screen',
        onPress: () => void shareScreenTime(),
      };
    }
  } else if (step === 'current_app') {
    icon = 'phone-portrait';
    title = 'Currently Using';
    body =
      `${partnerName} sees the name of the app open on your phone, only the latest and never what you do inside it. ` +
      'It checks about every 20 seconds while your screen is on, with a quiet notification.';
    const st = currentApp.status;
    if (st === 'unavailable' || st === 'needs-update' || !usageSupported) {
      body = 'Currently Using needs the newest version of Bond on this phone.';
    } else if (!hasUsageAccess()) {
      action = { label: 'Turn on Usage access', onPress: currentApp.openAccessSettings };
    } else if (!currentAppOn) {
      action = {
        label: 'Share the app I’m using',
        disabled: !resetReady || currentApp.switchDisabled,
        loading: currentApp.busy,
        onPress: () => currentApp.toggle(true),
      };
    } else if (live.status === 'off' || live.status === 'closed') {
      // Part 2 (optional): Live mode, right after Currently Using is on.
      icon = 'flash';
      title = 'Live app detection (optional)';
      body =
        `To show ${partnerName} the app you switch to right away, Bond needs Android’s Accessibility access. Without it, Currently Using still works, but can be minutes late on some phones. ` +
        'Bond only learns which app came to the front, never what is on your screen, what you type, or anything inside apps. This is optional.';
      tip =
        'Android will show a strong warning ("view and control screen" / "perform actions"). That is expected for every app of this kind: Bond only reads the app’s name, never your screen, and never acts for you.';
      note = 'Optional. Turn it off anytime in Accessibility.';
      action = { label: 'Turn on Accessibility', onPress: () => void requestLiveMode(partnerName) };
    } else if (live.status === 'on') {
      checks.push({ label: 'Live app detection: on', ok: true, hint: `${partnerName} sees app switches within a second or two.` });
    }
  }

  const position = FEATURE_STEPS.indexOf(step as FeatureStep);
  const isLast = step === FEATURE_STEPS[FEATURE_STEPS.length - 1];

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Pressable onPress={back} hitSlop={12} accessibilityRole="button" accessibilityLabel="Back" style={styles.backBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.subtext} />
        </Pressable>
        <View style={styles.dots}>
          {FEATURE_STEPS.map((s, i) => (
            <View key={s} style={[styles.dotSmall, i === position && styles.dotActive, i < position && styles.dotDone]} />
          ))}
        </View>
        <Text style={styles.stepLabel}>
          Step {position + 1} of {FEATURE_STEPS.length}
        </Text>
      </View>

      {step ? (
        <ScrollView contentContainerStyle={styles.stepContent} showsVerticalScrollIndicator={false}>
          <ResetWarning failed={resetFailed} onRetry={() => void prepare()} />
          <Illustration icon={icon} tone={tone} />
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
          {tip ? (
            <View style={styles.tip}>
              <Text style={styles.tipText}>{tip}</Text>
            </View>
          ) : null}
          {checks.length ? (
            <View style={styles.checks}>
              {checks.map((c) => (
                <View key={c.label} style={styles.checkRow}>
                  <Ionicons
                    name={c.ok === true ? 'checkmark-circle' : c.ok === false ? 'ellipse-outline' : 'information-circle-outline'}
                    size={18}
                    color={c.ok === true ? colors.success : colors.muted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.checkLabel}>{c.label}</Text>
                    {c.hint ? <Text style={styles.checkHint}>{c.hint}</Text> : null}
                    {c.link ? (
                      <Text style={styles.checkLink} onPress={c.link.onPress} accessibilityRole="link">
                        {c.link.label}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          ) : null}
        </ScrollView>
      ) : (
        <View style={styles.loading}>
          <ActivityIndicator color={colors.primary} />
        </View>
      )}

      <View style={styles.bottom}>
        <PrivacyNote text={note} />
        {action ? (
          <>
            <Button label={action.label} onPress={action.onPress} loading={action.loading} disabled={!step || action.disabled} />
            <Button label="Not now" variant="ghost" disabled={!step || finishing} onPress={next} style={styles.notNow} />
          </>
        ) : (
          <Button label={isLast ? 'Continue' : 'Next'} disabled={!step} loading={finishing} onPress={next} />
        )}
      </View>
    </SafeAreaView>
  );
}

/** The large round picture at the top of each step. */
function Illustration({ icon, tone }: { icon: IconName; tone: Tone }) {
  useThemeVersion();
  const pink = tone === 'pink';
  return (
    <View style={styles.illustration} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.ring, pink ? styles.pinkSoft : styles.blueSoft]}>
        <View style={styles.ringInner}>
          <Ionicons name={icon} size={52} color={pink ? colors.pink : colors.blue} />
        </View>
      </View>
      <Ionicons name="sparkles" size={20} color={colors.pink} style={styles.sparkleTop} />
      <Ionicons name="sparkles" size={13} color={colors.blue} style={styles.sparkleBottom} />
    </View>
  );
}

function PrivacyNote({ text }: { text: string }) {
  useThemeVersion();
  return (
    <View style={styles.privacy}>
      <Ionicons name="lock-closed-outline" size={12} color={colors.muted} />
      <Text style={styles.privacyText}>{text}</Text>
    </View>
  );
}

function ResetWarning({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  useThemeVersion();
  if (!failed) return null;
  return (
    <Card style={styles.warnCard}>
      <Text style={styles.checkHint}>
        Bond couldn&apos;t reach the server to start this pairing with everything off, so nothing can be turned on yet. Check your
        connection.
      </Text>
      <Button label="Try again" small onPress={onRetry} style={{ marginTop: spacing.sm, alignSelf: 'flex-start' }} />
    </Card>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  // Overview
  overview: { padding: spacing.xl, paddingBottom: spacing.lg },
  overviewTitle: { ...font.title, color: colors.text, marginTop: spacing.lg },
  overviewSub: { ...font.body, color: colors.subtext, marginTop: spacing.sm, lineHeight: 21 },
  list: { marginTop: spacing.xl, gap: spacing.sm },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  listIcon: { width: 38, height: 38, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  listTitle: { ...font.h3, fontSize: 15, color: colors.text },
  listDesc: { ...font.small, color: colors.subtext, marginTop: 1 },
  allowPill: { paddingHorizontal: spacing.md, paddingVertical: 6, borderRadius: radius.pill, backgroundColor: colors.primarySoft },
  allowText: { ...font.small, fontWeight: '700', color: colors.primary },
  blueSoft: { backgroundColor: colors.blueSoft },
  pinkSoft: { backgroundColor: colors.pinkSoft },

  // Step header
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.lg, paddingTop: spacing.md, gap: spacing.sm },
  backBtn: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center' },
  dots: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 6 },
  dotSmall: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.track },
  dotDone: { backgroundColor: colors.primary, opacity: 0.45 },
  dotActive: { width: 22, backgroundColor: colors.primary, opacity: 1 },
  stepLabel: { ...font.small, color: colors.primary, fontWeight: '700' },

  // Step body
  stepContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.xl, paddingVertical: spacing.lg },
  illustration: { alignSelf: 'center', width: 190, height: 190, alignItems: 'center', justifyContent: 'center', marginBottom: spacing.xl },
  ring: { width: 176, height: 176, borderRadius: 88, alignItems: 'center', justifyContent: 'center' },
  ringInner: {
    width: 124,
    height: 124,
    borderRadius: 62,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sparkleTop: { position: 'absolute', top: 6, right: 8 },
  sparkleBottom: { position: 'absolute', bottom: 22, left: 6 },
  title: { ...font.title, fontSize: 24, color: colors.text, textAlign: 'center' },
  body: { ...font.body, color: colors.subtext, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
  tip: { marginTop: spacing.lg, borderRadius: radius.md, backgroundColor: colors.pinkSoft, padding: spacing.md },
  tipText: { ...font.small, color: colors.pink, textAlign: 'center', lineHeight: 18 },
  checks: { marginTop: spacing.lg, gap: spacing.md, alignSelf: 'stretch' },
  checkRow: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  checkLabel: { ...font.small, color: colors.text, fontWeight: '600' },
  checkHint: { ...font.small, color: colors.subtext, marginTop: 2, lineHeight: 18 },
  checkLink: { ...font.small, color: colors.primary, fontWeight: '700', marginTop: 4 },
  warnCard: { marginBottom: spacing.lg },

  // Bottom
  bottom: { paddingHorizontal: spacing.xl, paddingBottom: spacing.lg, paddingTop: spacing.sm, gap: spacing.sm },
  privacy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, marginBottom: spacing.xs },
  privacyText: { ...font.tiny, fontWeight: '500', letterSpacing: 0, color: colors.muted },
  notNow: { marginTop: -spacing.xs },
}));
