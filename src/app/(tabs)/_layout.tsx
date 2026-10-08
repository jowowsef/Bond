import { Ionicons } from '@expo/vector-icons';
import { Redirect, Tabs } from 'expo-router';
import React from 'react';
import { Platform } from 'react-native';
import { usePresenceHeartbeat } from '@/hooks/usePresence';
import { colors } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * The five main tabs, shown only once two partners are connected.
 * If the couple isn't complete (e.g. the session was cleared), we bounce
 * back to the entry screen which re-routes to onboarding.
 */
export default function TabsLayout() {
  const { phase, userId } = useCouple();

  // Keep my "last active" fresh while I'm in the main app and it's open.
  // (The hook does nothing when userId is null, so it's safe to call here.)
  usePresenceHeartbeat(userId);

  // Guard: never show the main app unless we're fully paired.
  if (phase !== 'paired') return <Redirect href="/" />;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: {
          backgroundColor: colors.card,
          borderTopColor: colors.border,
          height: Platform.OS === 'android' ? 64 : 84,
          paddingBottom: Platform.OS === 'android' ? 10 : 28,
          paddingTop: 8,
        },
        tabBarLabelStyle: { fontSize: 11, fontWeight: '600' },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: 'Home', tabBarIcon: ({ color, size }) => <Ionicons name="heart" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="activity"
        options={{ title: 'Activity', tabBarIcon: ({ color, size }) => <Ionicons name="pulse" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="location"
        options={{ title: 'Location', tabBarIcon: ({ color, size }) => <Ionicons name="location" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="controls"
        options={{ title: 'Controls', tabBarIcon: ({ color, size }) => <Ionicons name="shield-checkmark" size={size} color={color} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: 'Settings', tabBarIcon: ({ color, size }) => <Ionicons name="settings-sharp" size={size} color={color} /> }}
      />
    </Tabs>
  );
}
