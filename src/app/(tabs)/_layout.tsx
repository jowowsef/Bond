import { Ionicons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Redirect } from '@/components/Redirect';
import React, { useEffect } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBackgroundLocation } from '@/hooks/useBackgroundLocation';
import { useCurrentAppSync } from '@/hooks/useCurrentApp';
import { useScreenTimeSync } from '@/hooks/useScreenTimeSync';
import { useCurrentAppService } from '@/hooks/useCurrentAppService';
import { useBatterySync } from '@/hooks/useBattery';
import { useLocationWatcher } from '@/hooks/useLocationWatcher';
import { usePartnerAlerts } from '@/hooks/usePartnerAlerts';
import { useActivityUnreadTracker } from '@/lib/activityUnread';
import { registerBackgroundJobs } from '@/lib/backgroundJobs';
import { maybeSendDailySummary } from '@/lib/dailySummary';
import { colors, fontFamily, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * The four main tabs, shown only once two partners are connected. Settings
 * lives behind the gear button in each screen's header, not in the tab bar.
 *
 * The tab bar sits comfortably above the bottom edge: its padding follows the
 * device's safe-area inset so it never feels stuck to the screen edge.
 */
export default function TabsLayout() {
  useThemeVersion();
  const { phase, userId, pairingSetup, partnerProfile, session, unpairState } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Your partner';
  const insets = useSafeAreaInsets();
  // Nothing is sent from the main app until this couple is fully paired and
  // its setup is finished (the hooks below get no user id otherwise).
  const ready = phase === 'paired' && pairingSetup === 'done';
  const activeUser = ready ? userId : null;

  // Sync my battery while sharing is on.
  useBatterySync(activeUser);
  // One foreground location watcher for the whole app (gated by sharing +
  // permission + app active inside the hook). No screen starts a second one.
  useLocationWatcher(activeUser);
  // Bell dot for new partner activity (one tracker for all headers).
  useActivityUnreadTracker(activeUser);
  // Location sharing ON + Android "Allow all the time" -> keep sharing while
  // Bond is closed (with Android's notification). Re-checked on every start
  // and return to Bond; stopped as soon as any rule no longer holds.
  useBackgroundLocation({ userId: activeUser, partnerName });
  // Partner low-battery alerts addressed to me (decided by the server).
  usePartnerAlerts(activeUser);
  // "Currently Using" while Bond is open (only if I chose to share it).
  useCurrentAppSync(activeUser);
  // My screen time when Bond comes back or is left, from any screen (it was
  // only sent while the Screen Time tab was open, or by the background job).
  useScreenTimeSync(activeUser);
  // ...and while Bond is closed, through its foreground service (sharing on +
  // Usage access granted; Android shows a notification). No separate switch.
  // While Bond is still loading or offline the state isn't known: leave the
  // service running (undefined) instead of stopping it.
  const serviceUser = phase === 'loading' || phase === 'offline' || pairingSetup === 'unknown' ? undefined : activeUser;
  useCurrentAppService({ userId: serviceUser, partnerName });
  // Ask Android to run the battery and screen time jobs in the background
  // (each job still checks pairing, setup and its own sharing setting).
  useEffect(() => {
    if (activeUser) void registerBackgroundJobs();
  }, [activeUser]);
  // The optional evening summary also when Bond is opened (it shows once a day).
  useEffect(() => {
    if (!activeUser) return;
    void maybeSendDailySummary(activeUser).catch(() => undefined);
  }, [activeUser]);

  // Just unpaired: the app's unpair handler (UnpairWatcher in the root layout)
  // leaves these screens for the confirmation screen. Redirecting here as
  // well would make two navigations compete, so show nothing for that moment.
  if (phase === 'unpaired' && session && unpairState !== 'none') return null;
  // Any other state that isn't "paired with setup done": the start screen decides.
  if (!ready) {
    if (phase === 'loading' || (phase === 'paired' && pairingSetup === 'unknown')) return null;
    return <Redirect href="/" />;
  }

  // Lift the bar off the bottom edge: the device's safe-area inset (gesture
  // bar / nav buttons) plus comfortable breathing room. Applied once here, so
  // all four tabs stay consistent.
  const bottomPad = Math.max(insets.bottom, 12) + 16;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: 56 + bottomPad,
          paddingBottom: bottomPad,
          paddingTop: 10,
        },
        tabBarLabelStyle: { fontFamily, fontSize: 11, fontWeight: '600', marginTop: 2 },
        tabBarItemStyle: { paddingTop: 2 },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="screen-time"
        options={{ title: 'Screen Time', tabBarIcon: ({ color, size }) => <Ionicons name="time-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="location"
        options={{ title: 'Location', tabBarIcon: ({ color, size }) => <Ionicons name="location-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="calendar"
        options={{ title: 'Calendar', tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
