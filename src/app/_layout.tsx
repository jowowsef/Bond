import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { CoupleLocationsProvider } from '@/hooks/useCoupleLocations';
import { colors } from '@/lib/theme';
import { CoupleProvider, useCouple } from '@/state/couple';

/**
 * Keep the native splash (a Bond heart on the app background) on screen until
 * we know where to send the user. This prevents the gray flash / empty frame
 * that used to appear while the saved session and pairing were still loading.
 */
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/**
 * Root of the whole app:
 *  - provides safe-area info,
 *  - wraps everything in CoupleProvider (session + couple state),
 *  - declares the navigation stack. "index" decides where to send the user.
 */
export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <CoupleProvider>
        {/* Shared live location data for the Location tab and fullscreen map
            (one subscription, only active while one of them is mounted). */}
        <CoupleLocationsProvider>
          <StatusBar style="dark" />
          <SplashGate>
            <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.background } }}>
              {/* Startup + onboarding chain: no slide/gray, feels instant. */}
              <Stack.Screen name="index" options={{ animation: 'none' }} />
              <Stack.Screen name="welcome" options={{ animation: 'none' }} />
              <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
              <Stack.Screen name="name-setup" options={{ animation: 'none', gestureEnabled: false }} />
              <Stack.Screen name="color-setup" options={{ animation: 'none', gestureEnabled: false }} />
              <Stack.Screen name="all-set" options={{ animation: 'none', gestureEnabled: false }} />
              <Stack.Screen name="optional-setup" options={{ animation: 'fade', gestureEnabled: false }} />
              {/* Pushed screens keep their normal slide/card animation. */}
              <Stack.Screen name="pair" options={{ presentation: 'card' }} />
              <Stack.Screen name="show-code" options={{ presentation: 'card' }} />
              <Stack.Screen name="enter-code" options={{ presentation: 'card' }} />
              <Stack.Screen name="setup" options={{ presentation: 'card' }} />
              <Stack.Screen name="settings" options={{ presentation: 'card' }} />
              <Stack.Screen name="screen-time" options={{ presentation: 'card' }} />
              <Stack.Screen
                name="location-map"
                options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
              />
            </Stack>
          </SplashGate>
        </CoupleLocationsProvider>
      </CoupleProvider>
    </SafeAreaProvider>
  );
}

/**
 * Hides the native splash only once the app has enough information to pick the
 * right first screen, so the very first thing the user sees is already the
 * correct screen (Home, onboarding, or the offline/retry state) instead of a
 * gray frame.
 */
function SplashGate({ children }: { children: React.ReactNode }) {
  const { phase, profileStep } = useCouple();
  const ready = phase !== 'loading' && (phase !== 'paired' || profileStep !== null);

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  return <>{children}</>;
}
