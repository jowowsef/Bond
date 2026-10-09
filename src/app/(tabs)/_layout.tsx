import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useBatterySync } from '@/hooks/useBattery';
import { useLocationWatcher } from '@/hooks/useLocationWatcher';
import { usePresenceHeartbeat } from '@/hooks/usePresence';
import { colors, fontFamily } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * The four main tabs, shown only once two partners are connected. Settings
 * lives behind the gear button in each screen's header, not in the tab bar.
 *
 * The tab bar sits comfortably above the bottom edge: its padding follows the
 * device's safe-area inset so it never feels stuck to the screen edge.
 */
export default function TabsLayout() {
  const { phase, userId } = useCouple();
  const insets = useSafeAreaInsets();

  // Keep my "last active" fresh, and sync my battery while sharing is on.
  usePresenceHeartbeat(userId);
  useBatterySync(userId);
  // One foreground location watcher for the whole app (gated by sharing +
  // permission + app active inside the hook). No screen starts a second one.
  useLocationWatcher(userId);

  // Guard: never show the main app unless we're fully paired.
  if (phase !== 'paired') return <Redirect href="/" />;

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
        name="activity"
        options={{ title: 'Activity', tabBarIcon: ({ color, size }) => <Ionicons name="pulse-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="location"
        options={{ title: 'Location', tabBarIcon: ({ color, size }) => <Ionicons name="location-outline" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="controls"
        options={{ title: 'Controls', tabBarIcon: ({ color, size }) => <Ionicons name="shield-outline" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
