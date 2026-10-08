import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CoupleProvider } from '@/state/couple';

/**
 * Root of the whole app. It:
 *  - provides safe-area info to every screen,
 *  - wraps everything in CoupleProvider (session + couple state),
 *  - declares the navigation stack. The screen at "index" decides where to
 *    send the user (onboarding vs main app).
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CoupleProvider>
        <StatusBar style="dark" />
        <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: '#F7F7FD' } }}>
          <Stack.Screen name="index" />
          <Stack.Screen name="welcome" />
          <Stack.Screen name="pair" options={{ presentation: 'card' }} />
          <Stack.Screen name="show-code" options={{ presentation: 'card' }} />
          <Stack.Screen name="enter-code" options={{ presentation: 'card' }} />
          <Stack.Screen name="(tabs)" />
        </Stack>
      </CoupleProvider>
    </SafeAreaProvider>
  );
}
