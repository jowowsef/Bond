import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { Redirect } from '@/components/Redirect';
import { StatusBadge, type BadgeTone } from '@/components/StatusBadge';
import { useCurrentAppSharing } from '@/hooks/useCurrentAppSharing';
import { useLocationSharingSwitch } from '@/hooks/useLocationSharingSwitch';
import { getBackgroundPermission } from '@/lib/backgroundLocation';
import { backgroundJobsAvailable, isBatteryOptimizedForBond, openBatteryOptimizationSettings } from '@/lib/backgroundJobs';
import { reconcileBackgroundService } from '@/lib/backgroundService';
import { enableBatterySharing } from '@/lib/battery';
import { askConfirm, confirmSharing } from '@/lib/consent';
import { offerBackgroundLocation } from '@/lib/locationPermissionFlow';
import { getUsageSupport, hasUsageAccess } from '@/lib/screenTime';
import { requestUsageAccess } from '@/lib/usageAccessFlow';
import { getNotificationState, openAppSettings, requestNotifications } from '@/lib/setupPermissions';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * DEVICE PERMISSIONS (Settings > Permissions > Device permissions).
 *
 * A new pairing's setup is the step-by-step screen in sharing-setup.tsx;
 * opened any other way than from Settings, this screen hands over to the
 * start screen. Each item shows its
 * REAL state, read from Android and Supabase, and is re-checked when you come
 * back from Android Settings; coming back never leaves this screen (only
 * "Continue" does, and the step is saved on the phone, so a restart resumes
 * here). Nothing here is required, opening an item never marks it enabled,
 * and every kind of sharing is only turned on after a Cancel / Confirm step.
 */
type ItemState = 'enabled' | 'not_set_up' | 'permission_required' | 'limited' | 'unavailable' | 'coming_later';

const BADGE: Record<ItemState, { label: string; tone: BadgeTone }> = {
  enabled: { label: 'Enabled', tone: 'success' },
  not_set_up: { label: 'Not set up', tone: 'neutral' },
  permission_required: { label: 'Permission required', tone: 'warning' },
  limited: { label: 'Limited by Android', tone: 'warning' },
  unavailable: { label: 'Unavailable on this build', tone: 'neutral' },
  coming_later: { label: 'Coming later', tone: 'neutral' },
};

export default function OptionalSetup() {
  useThemeVersion();
  const { from } = useLocalSearchParams<{ from?: string }>();
  const fromSettings = from === 'settings';
  const { phase, userId, refresh, partnerProfile, advancePairingSetup, ensurePairingReset, pairingSetup } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Your partner';

  const [battery, setBattery] = useState<ItemState>('not_set_up');
  const [background, setBackground] = useState<ItemState>('not_set_up');
  const [location, setLocation] = useState<ItemState>('not_set_up');
  const [notifications, setNotifications] = useState<ItemState>('not_set_up');
  const [screenTime, setScreenTime] = useState<ItemState>('not_set_up');
  const [screenShare, setScreenShare] = useState<ItemState>('not_set_up');
  const [finishing, setFinishing] = useState(false);
  // New pairing: sharing must be reset (all off) on the server before anything
  // here can be turned on or setup can be finished. Settings mode: always ready.
  const [resetReady, setResetReady] = useState(fromSettings || pairingSetup !== 'sharing');
  const [resetFailed, setResetFailed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);

  const refreshStates = useCallback(async () => {
    const notif = await getNotificationState();
    setNotifications(notif === 'granted' ? 'enabled' : notif === 'denied' ? 'permission_required' : 'not_set_up');

    // Screen Time: Android's Usage access, read fresh every time.
    const support = getUsageSupport();
    setScreenTime(support !== 'ready' ? 'unavailable' : hasUsageAccess() ? 'enabled' : 'permission_required');


    // Background updates: separate from reading the battery (which needs nothing).
    const [optimized, available] = await Promise.all([isBatteryOptimizedForBond(), backgroundJobsAvailable()]);
    setBackground(!available ? 'limited' : optimized === false ? 'enabled' : optimized === true ? 'limited' : 'not_set_up');

    if (userId) {
      const { data } = await supabase
        .from('privacy_settings')
        .select('share_battery, share_location, share_screen_time')
        .eq('user_id', userId)
        .maybeSingle();
      setBattery(data?.share_battery ? 'enabled' : 'not_set_up');
      setScreenShare(data?.share_screen_time ? 'enabled' : 'not_set_up');

      // Location: sharing on + "Allow all the time" = enabled (also while Bond
      // is closed); "While using the app" only = limited (only while open).
      if (data?.share_location) {
        const perm = await getBackgroundPermission().catch(() => 'no-foreground' as const);
        setLocation(perm === 'granted' ? 'enabled' : perm === 'no-foreground' ? 'permission_required' : 'limited');
      } else setLocation('not_set_up');
    }
  }, [userId]);

  const prepareNewPairing = useCallback(async () => {
    if (fromSettings || pairingSetup !== 'sharing') {
      setResetReady(true);
      return;
    }
    const ok = await ensurePairingReset();
    setResetReady(ok);
    setResetFailed(!ok);
    await refreshStates(); // show the real (reset) state, never the previous pairing's
  }, [fromSettings, pairingSetup, ensurePairingReset, refreshStates]);

  useEffect(() => {
    void prepareNewPairing();
  }, [prepareNewPairing]);

  useEffect(() => {
    void refreshStates();
    // Coming back from Android Settings: re-check what actually changed.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshStates();
    });
    return () => sub.remove();
  }, [refreshStates]);

  async function onBattery() {
    if (!userId || busy || !resetReady) return;
    if (!(await confirmSharing('battery', partnerName))) return; // Cancel: stays off
    setBusy('battery');
    const r = await enableBatterySharing(userId);
    // Battery updates come from the background service (setup is finished here).
    if (r.ok) await reconcileBackgroundService(userId, partnerName).catch(() => null);
    setBusy(null);
    if (!r.ok) Alert.alert('Could not enable', r.message ?? 'Please try again.');
    await refresh();
    await refreshStates();
  }

  // Same flow as the Location tab: confirm first, then Android's permission
  // (or guidance to Settings if it is blocked); sharing only starts once granted.
  // "Currently Using": its own consent + Usage access flow (shared with Home / Settings).
  const currentApp = useCurrentAppSharing(userId, partnerName);
  const currentAppState: ItemState =
    currentApp.switchValue
      ? 'enabled'
      : currentApp.status === 'needs-access'
        ? 'permission_required'
        : currentApp.status === 'unavailable' || currentApp.status === 'needs-update'
          ? 'unavailable'
          : 'not_set_up';

  /** Explain what an Android Settings page is for; open it only after Confirm. */
  async function explainThenOpen(title: string, body: string, open: () => void | Promise<void>) {
    if (await askConfirm(title, body, 'Open settings', 'Cancel')) await open();
  }

  const locationSwitch = useLocationSharingSwitch({
    userId,
    partnerName,
    onChanged: () => Promise.all([refresh(), refreshStates()]),
  });

  /** Screen-time visibility: confirm, then save; the badge only shows "Enabled" once saved. */
  async function onVisibility(kind: 'screen_time') {
    if (!userId || busy || !resetReady) return;
    if (!(await confirmSharing(kind, partnerName))) return; // Cancel: stays off
    setBusy(kind);
    const { error } = await supabase.from('privacy_settings').update({ share_screen_time: true }).eq('user_id', userId);
    // Screen time updates come from the background service (setup is finished here).
    if (!error) await reconcileBackgroundService(userId, partnerName).catch(() => null);
    setBusy(null);
    if (error) Alert.alert('Not saved', 'Could not turn this on. Check your connection and try again.');
    await refreshStates();
  }

  async function onFinish() {
    if (finishing) return;
    setFinishing(true);
    try {
      // This pairing only; a new pairing asks again. Refused until the
      // sharing reset for this new pairing has really happened on the server.
      // On success the saved step becomes 'name' and this screen hands over
      // to the start screen, which shows the name step next.
      const ok = await advancePairingSetup('sharing');
      if (!ok) {
        setResetReady(false);
        setResetFailed(true);
        Alert.alert('Not finished yet', "Bond couldn't prepare sharing for this new pairing. Check your connection and try again.");
      }
    } finally {
      setFinishing(false);
    }
  }

  async function onLocation() {
    if (!resetReady) return;
    if (location === 'limited') {
      // Sharing is on while Bond is open; offer Android's "Allow all the time".
      await offerBackgroundLocation(partnerName);
      await refreshStates();
    } else if (location === 'permission_required') {
      await explainThenOpen(
        'Allow location for Bond',
        'Location sharing is on, but Android location permission for Bond is off, so nothing is shared. ' +
          'Android will open Bond\'s settings: choose Permissions, then Location.',
        openAppSettings,
      );
      await refreshStates();
    } else locationSwitch.request(true);
  }

  async function onNotifications() {
    setBusy('notifications');
    await requestNotifications();
    setBusy(null);
    await refreshStates();
  }

  const content = (
    <>
      <Item
        icon="notifications-outline"
        title="Notifications"
        desc="Get updates when your partner sends a request or important activity happens."
        state={notifications}
        actionLabel="Enable notifications"
        busy={busy === 'notifications'}
        onPress={onNotifications}
      />
      <Item
        icon="battery-half-outline"
        title="Battery status"
        desc="Let your partner see your battery percentage and charging status. Reading the battery needs no Android permission."
        state={battery}
        busy={busy === 'battery'}
        onPress={onBattery}
      />
      <Item
        icon="refresh-outline"
        title="Background updates"
        desc={
          background === 'enabled'
            ? 'Android lets Bond send your battery and screen time while Bond is closed, about every 15 minutes or less often. Android picks the exact times.'
            : 'With Battery optimization on, Android can delay updates for hours while your phone is idle. To allow them, choose "Don\'t optimize" or "Unrestricted" for Bond. Opening Bond always updates right away.'
        }
        state={background}
        actionLabel="Open battery settings"
        onPress={
          background === 'enabled'
            ? undefined
            : () =>
                void explainThenOpen(
                  'Allow background updates',
                  'Android will open its battery optimization list. Find Bond and choose "Don\'t optimize" or ' +
                    '"Unrestricted", then come back. This only lets Android run Bond\'s updates more regularly; ' +
                    'it shares nothing by itself.',
                  openBatteryOptimizationSettings,
                )
        }
      />
      <Item
        icon="time-outline"
        title="Screen time"
        desc={
          screenTime === 'unavailable'
            ? 'See app usage for you and your partner. This copy of Bond is too old for it; install the newest version.'
            : 'See app usage for you and your partner. Android only allows this after you turn on "Usage access" for Bond in Settings. Bond reads app names and time spent, never what you do inside apps.'
        }
        state={screenTime}
        permissionLabel="Open Usage access"
        onPress={
          screenTime === 'unavailable'
            ? undefined
            : () =>
                void requestUsageAccess(
                  'Screen Time reads app names and time spent on this phone, never what you do inside apps, and nothing is shared unless you turn on a visibility option.',
                )
        }
      />
      <Item
        icon="eye-outline"
        title="Screen-time visibility"
        desc={`Let ${partnerName} see your daily screen time and most-used apps. Off until you confirm.`}
        state={screenShare}
        actionLabel="Share screen time"
        busy={busy === 'screen_time'}
        onPress={() => void onVisibility('screen_time')}
      />
      <Item
        icon="location-outline"
        title="Location sharing"
        desc={
          location === 'enabled'
            ? `On. ${partnerName} sees your location, also while Bond is closed (Android shows a notification then). Turn it off anytime in Settings.`
            : location === 'limited'
              ? 'On, but only while Bond is open. Background updates are unavailable until you choose "Allow all the time" for Bond\'s location in Android.'
              : location === 'permission_required'
                ? 'On, but Android location permission for Bond is off, so nothing is shared. Allow it in Settings.'
                : `Let ${partnerName} see where you are. Bond asks you to confirm, then asks Android for location. To share while Bond is closed, Android also needs "Allow all the time"; Bond explains that step.`
        }
        state={location}
        actionLabel={location === 'limited' ? 'Allow all the time' : 'Set up location'}
        busy={locationSwitch.busy || locationSwitch.pending === true}
        onPress={() => void onLocation()}
      />
      <Item
        icon="phone-portrait-outline"
        title="Currently using"
        desc={
          currentAppState === 'unavailable'
            ? 'Let your partner see which app you are using. Not available yet on this server or build.'
            : currentAppState === 'permission_required'
              ? `On, but Android's Usage access is off for Bond, so nothing is shared yet. Turn it on in Android Settings, or turn this off.`
              : currentAppState === 'enabled'
                ? `On. ${partnerName} sees the name of the app open on your phone (only the latest, never a history, nothing inside apps), checked about every 20 seconds while the screen is on, with a notification while it runs. Turn it off here or anytime in Settings.`
                : `Let ${partnerName} see which app you are using, checked about every 20 seconds while your screen is on, with a notification while it runs. Needs Android's Usage access.`
        }
        state={currentAppState}
        actionLabel="Turn on"
        permissionLabel="Open Usage access settings"
        busy={currentApp.busy}
        onPress={currentAppState === 'unavailable' ? undefined : () => {
          if (!resetReady) return;
          if (currentAppState === 'permission_required') currentApp.openAccessSettings();
          else currentApp.toggle(true);
        }}
        secondary={
          currentAppState === 'enabled' || currentAppState === 'permission_required'
            ? { label: 'Turn off', onPress: () => currentApp.toggle(false) }
            : undefined
        }
      />
    </>
  );

  // Sharing setup belongs to the first step of a new pairing only. Anywhere
  // else (the step is done, or not paired anymore) the start screen decides.
  // Coming back from Android Settings changes nothing here.
  if (!fromSettings) return phase === 'loading' ? null : <Redirect href="/" />;

  if (fromSettings) {
    return (
      <SafeAreaView style={styles.screen} edges={['top']}>
        <BackHeader title="Device permissions" />
        <ScrollView contentContainerStyle={[styles.content, { paddingTop: 0 }]} showsVerticalScrollIndicator={false}>
          <Text style={[styles.subtitle, { marginTop: 0 }]}>
            What Android currently allows for Bond. Changes you make in Android Settings show here when you come back.
          </Text>
          {content}
          <View style={{ height: spacing.lg }} />
        </ScrollView>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Sharing setup</Text>
        <Text style={styles.subtitle}>
          Everything starts off for this pairing. Turn on only what you&apos;d like {partnerName} to see; each one asks
          you to confirm first. You can change any of it later in Settings.
        </Text>
        {resetFailed ? (
          <Card style={styles.item}>
            <Text style={styles.itemDesc}>
              Bond couldn&apos;t reach the server to start this pairing with everything off. Nothing is shared until it
              can. Check your connection, then try again.
            </Text>
            <Button label="Try again" small onPress={() => void prepareNewPairing()} style={styles.itemButton} />
          </Card>
        ) : null}
        {content}
        <Button label="Continue" onPress={onFinish} loading={finishing} disabled={!resetReady} style={styles.continue} />
        {/* Same step, nothing turned on: everything not chosen above stays OFF. */}
        <Button label="Skip for now" variant="ghost" onPress={onFinish} disabled={!resetReady || finishing} style={styles.skip} />
        <View style={{ height: spacing.lg }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Item({
  icon,
  title,
  desc,
  state,
  actionLabel = 'Enable',
  permissionLabel = 'Open settings',
  busy,
  onPress,
  secondary,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  desc: string;
  state: ItemState;
  actionLabel?: string;
  /** Button text when Android must be changed in Settings. */
  permissionLabel?: string;
  busy?: boolean;
  onPress?: () => void;
  /** An extra, quieter action (for example "Turn off" for something on by default). */
  secondary?: { label: string; onPress: () => void };
}) {
  useThemeVersion();
  const canEnable = !!onPress && state !== 'enabled';
  const badge = BADGE[state];
  return (
    <Card style={styles.item}>
      <View style={styles.itemHeader}>
        <View style={styles.itemIcon}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <Text style={styles.itemTitle}>{title}</Text>
        <StatusBadge label={badge.label} tone={badge.tone} dot={state === 'enabled'} />
      </View>
      <Text style={styles.itemDesc}>{desc}</Text>
      {canEnable ? (
        <Button
          label={state === 'permission_required' ? permissionLabel : actionLabel}
          small
          loading={busy}
          onPress={onPress}
          style={styles.itemButton}
        />
      ) : null}
      {secondary ? (
        <Button label={secondary.label} small variant="ghost" onPress={secondary.onPress} style={styles.itemButton} />
      ) : null}
    </Card>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  title: { ...font.title, color: colors.text, marginTop: spacing.sm },
  subtitle: { ...font.small, color: colors.subtext, marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 19 },
  item: { marginBottom: spacing.md, gap: spacing.sm },
  itemHeader: { flexDirection: 'row', alignItems: 'center' },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  itemTitle: { ...font.h3, color: colors.text, flex: 1 },
  itemDesc: { ...font.small, color: colors.subtext, lineHeight: 19 },
  itemButton: { alignSelf: 'flex-start', marginTop: spacing.xs, minWidth: 150 },
  continue: { marginTop: spacing.md },
  skip: { marginTop: spacing.xs },
}));
