import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Tabs } from 'expo-router';
import { Redirect } from '@/components/Redirect';
import React, { useEffect } from 'react';
import { View } from 'react-native';
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
import { colors, shadow, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';
import { shownName } from '@/lib/format';

type IconName = React.ComponentProps<typeof Ionicons>['name'];
type MciName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

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
  const partnerName = shownName(partnerProfile?.display_name, 'Your partner');
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

  // A floating, rounded bar with icons only (the screen's own title says
  // where you are). It sits in its own space above the device's safe-area
  // inset, so it never covers a screen's content.
  const bottomPad = Math.max(insets.bottom, 12) + 8;
  // icon: an Ionicons name, or { mci } for a MaterialCommunityIcons one
  // (the familiar Android home and screen-time hourglass icons).
  const tabIcon = (name: IconName | { mci: MciName; active?: MciName }, label: string) => {
    const Icon = ({ focused }: { focused: boolean }) => (
      <View
        style={{
          width: 36,
          height: 36,
          borderRadius: 11,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: focused ? colors.primary : 'transparent',
        }}
        accessibilityLabel={label}
      >
        {typeof name === 'string' ? (
          <Ionicons name={name} size={18} color={focused ? colors.onPrimary : colors.muted} />
        ) : (
          <MaterialCommunityIcons
            name={focused ? name.active ?? name.mci : name.mci}
            size={21}
            color={focused ? colors.onPrimary : colors.muted}
          />
        )}
      </View>
    );
    return Icon;
  };

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarShowLabel: false,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopWidth: 0,
          elevation: 0,
          height: 52 + bottomPad + 6,
          paddingTop: 6 + 8,
          paddingBottom: bottomPad + 8,
          paddingHorizontal: 64,
        },
        tabBarBackground: () => (
          <View style={{ flex: 1, backgroundColor: colors.background }}>
            <View
              style={{
                position: 'absolute',
                left: 48,
                right: 48,
                top: 6,
                height: 52,
                borderRadius: 26,
                backgroundColor: colors.card,
                ...shadow,
                elevation: 6,
              }}
            />
          </View>
        ),
        tabBarItemStyle: { height: 36, alignItems: 'center', justifyContent: 'center' },
      }}
    >
      <Tabs.Screen name="index" options={{ title: 'Home', tabBarIcon: tabIcon({ mci: 'home-outline', active: 'home' }, 'Home') }} />
      <Tabs.Screen name="location" options={{ title: 'Location', tabBarIcon: tabIcon('location-outline', 'Location') }} />
      <Tabs.Screen name="screen-time" options={{ title: 'Screen Time', tabBarIcon: tabIcon({ mci: 'timer-sand' }, 'Screen Time') }} />
      <Tabs.Screen name="calendar" options={{ title: 'Calendar', tabBarIcon: tabIcon('calendar-outline', 'Calendar') }} />
    </Tabs>
  );
}
