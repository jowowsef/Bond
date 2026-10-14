import { DarkTheme, DefaultTheme, Stack, ThemeProvider, router } from 'expo-router';
import * as Notifications from 'expo-notifications';
import * as SplashScreen from 'expo-splash-screen';
import * as SystemUI from 'expo-system-ui';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useRef } from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ConfirmHost } from '@/components/ConfirmHost';
import { CoupleLocationsProvider } from '@/hooks/useCoupleLocations';
import { stopBackgroundLocation } from '@/lib/backgroundLocation';
import { stopCurrentAppService } from '@/lib/currentAppServiceControl';
import { claimUnpairAlertsQuietly } from '@/lib/partnerAlerts';
import { supabase } from '@/lib/supabase';
import { colors, isDarkTheme, useThemeVersion } from '@/lib/theme';
import { CoupleProvider, useCouple } from '@/state/couple';

/**
 * Keep the native splash (a Bond heart on the app background) on screen until
 * we know where to send the user. This prevents the gray flash / empty frame
 * that used to appear while the saved session and pairing were still loading.
 */
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Navigation colors (screen backgrounds during transitions, etc.) from Bond's current palette. */
function navigationTheme(dark: boolean) {
  const base = dark ? DarkTheme : DefaultTheme;
  return {
    ...base,
    colors: {
      ...base.colors,
      primary: colors.primary,
      background: colors.background,
      card: colors.card,
      text: colors.text,
      border: colors.border,
      notification: colors.danger,
    },
  };
}

/**
 * Root of the whole app:
 *  - provides safe-area info and the light / dark theme,
 *  - wraps everything in CoupleProvider (session + couple state),
 *  - declares the navigation stack. "index" decides where to send the user.
 */
export default function RootLayout() {
  // Re-render (not remount) when the theme changes. Nothing below is keyed
  // on the theme, so navigation, screens and their data stay as they are.
  const themeVersion = useThemeVersion();
  const dark = isDarkTheme();
  const navTheme = useMemo(() => navigationTheme(dark), [dark, themeVersion]);
  // The window behind every screen (seen during transitions and at startup)
  // takes the theme's background instead of Android's default white.
  useEffect(() => {
    void SystemUI.setBackgroundColorAsync(colors.background).catch(() => undefined);
  }, [dark, themeVersion]);
  return (
    <SafeAreaProvider>
      <ThemeProvider value={navTheme}>
      <CoupleProvider>
        {/* Shared live location data for the Location tab and fullscreen map
            (one subscription, only active while one of them is mounted). */}
        <CoupleLocationsProvider>
          <StatusBar style={dark ? 'light' : 'dark'} />
          <SplashGate>
            <Stack
              screenOptions={{
                headerShown: false,
                contentStyle: { backgroundColor: colors.background },
                // One smooth slide for every pushed screen and back; the screen
                // underneath keeps the theme color (never a white frame).
                animation: 'slide_from_right',
                animationDuration: 260,
                gestureEnabled: true,
              }}
            >
              {/* Startup + onboarding chain: no slide/gray, feels instant. */}
              <Stack.Screen name="index" options={{ animation: 'none' }} />
              <Stack.Screen name="welcome" options={{ animation: 'none' }} />
              <Stack.Screen name="(tabs)" options={{ animation: 'none' }} />
              <Stack.Screen name="name-setup" options={{ animation: 'none', gestureEnabled: false }} />
              <Stack.Screen name="color-setup" options={{ animation: 'none', gestureEnabled: false }} />
              <Stack.Screen name="unpaired" options={{ animation: 'fade', gestureEnabled: false }} />
              <Stack.Screen name="sharing-setup" options={{ animation: 'fade', gestureEnabled: false }} />
              <Stack.Screen name="optional-setup" options={{ animation: 'fade', gestureEnabled: false }} />
              {/* Pushed screens keep their normal slide/card animation. */}
              <Stack.Screen name="pair" options={{ presentation: 'card' }} />
              <Stack.Screen name="show-code" options={{ presentation: 'card' }} />
              <Stack.Screen name="enter-code" options={{ presentation: 'card' }} />
              <Stack.Screen name="settings" options={{ presentation: 'card' }} />
              <Stack.Screen name="calendar-event" options={{ presentation: 'card' }} />
              <Stack.Screen name="calendar-edit" options={{ presentation: 'card' }} />
              <Stack.Screen name="activity" options={{ presentation: 'card' }} />
              <Stack.Screen name="privacy" options={{ presentation: 'card' }} />
              <Stack.Screen name="background-diagnostics" options={{ presentation: 'card' }} />
              <Stack.Screen name="terms" options={{ presentation: 'card' }} />
              <Stack.Screen name="screen-time-stats" options={{ presentation: 'card' }} />
              <Stack.Screen name="sign-in" options={{ presentation: 'card' }} />
              <Stack.Screen name="forgot-password" options={{ presentation: 'card' }} />
              <Stack.Screen name="reset-password" options={{ presentation: 'card', gestureEnabled: false }} />
              <Stack.Screen
                name="location-map"
                options={{ presentation: 'fullScreenModal', animation: 'fade', gestureEnabled: false }}
              />
            </Stack>
          </SplashGate>
          {/* Bond's own confirmation dialog (sharing on/off, permission explanations). */}
          <ConfirmHost />
        </CoupleLocationsProvider>
      </CoupleProvider>
      </ThemeProvider>
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
  useThemeVersion();
  const { phase, profileStep, pairingSetup } = useCouple();
  const ready = phase !== 'loading' && (phase !== 'paired' || (profileStep !== null && pairingSetup !== 'unknown'));

  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);

  return (
    <>
      <UnpairWatcher />
      <NotificationTapHandler />
      <BackgroundLocationGuard />
      {children}
    </>
  );
}

/**
 * Background location and the Currently Using service must stop, from
 * anywhere in the app, when:
 *  - the account is confirmed unpaired or waiting for a partner (signed out
 *    and deleted accounts are unpaired too),
 *  - a new pairing's setup is still running (sharing, name or color step).
 * It is started again only by useBackgroundLocation in the main tabs, once
 * every rule holds. Only confirmed states count; 'loading' and 'unknown' do
 * nothing, so a slow start never turns anything off by mistake.
 */
function BackgroundLocationGuard() {
  const { phase, pairingSetup } = useCouple();
  const mustStop =
    phase === 'unpaired' ||
    phase === 'waiting' ||
    (phase === 'paired' && (pairingSetup === 'sharing' || pairingSetup === 'name' || pairingSetup === 'color'));
  useEffect(() => {
    if (mustStop) {
      void stopBackgroundLocation();
      void stopCurrentAppService();
    }
  }, [mustStop]);
  return null;
}

/**
 * When this phone recognises that the couple ended (CoupleProvider sets
 * unpairState only after a successful server read shows no couple, on this
 * phone or the partner's), this is the ONE place that navigates: it leaves
 * every old screen, so nothing keeps showing the previous partner, and opens
 * the "You're no longer paired" screen. No other screen navigates for an
 * unpair, so nothing competes with it.
 */
function UnpairWatcher() {
  const { unpairState, userId } = useCouple();
  const shown = useRef(false);

  useEffect(() => {
    if (unpairState === 'none') {
      shown.current = false;
      return;
    }
    if (shown.current) return; // once per unpair
    shown.current = true;
    void stopBackgroundLocation();
    void stopCurrentAppService();
    // This screen tells the person; no notification about it follows later.
    if (userId) void claimUnpairAlertsQuietly(userId).catch(() => undefined);
    try {
      if (router.canDismiss()) router.dismissAll();
      router.replace('/unpaired');
    } catch (error) {
      console.warn('[Bond] could not open the unpaired screen', error);
    }
  }, [unpairState, userId]);

  return null;
}

async function openReminderEvent(alertId: string): Promise<void> {
  const { data } = await supabase.from('partner_alerts').select('event_id, occurrence_date').eq('id', alertId).maybeSingle();
  const row = data as { event_id?: string | null; occurrence_date?: string | null } | null;
  if (!row?.event_id) return; // event deleted meanwhile: Bond stays on its start screen
  setTimeout(() => {
    try {
      router.push({ pathname: '/calendar-event', params: { id: row.event_id!, date: row.occurrence_date ?? '' } });
    } catch {
      // not ready: the person can open it from the Calendar tab
    }
  }, 300);
}

/**
 * Tapping a Bond notification (low battery, unpaired, calendar reminder) opens Bond at the start
 * screen, which shows the right place: Home while paired, otherwise the
 * pairing / "no longer paired" screens. Also when the tap started Bond.
 */
function NotificationTapHandler() {
  const handled = useRef<string | null>(null);
  useEffect(() => {
    const open = (r: Notifications.NotificationResponse | null) => {
      if (!r) return;
      const id = r.notification.request.identifier;
      const data = (r.notification.request.content.data ?? {}) as { kind?: string; alertId?: string };
      const kind = data.kind;
      if (handled.current === id || (kind !== 'battery_low' && kind !== 'unpaired' && kind !== 'calendar_reminder' && kind !== 'daily_summary')) return;
      handled.current = id;
      try {
        if (router.canDismiss()) router.dismissAll();
        router.replace('/');
        // Battery alerts and the daily summary: straight to Notifications.
        if (kind === 'battery_low' || kind === 'daily_summary') setTimeout(() => router.push('/activity'), 400);
      } catch {
        // navigation not ready yet: Bond opens on its start screen anyway
      }
      // A calendar reminder opens its event (looked up from the alert, which
      // only its recipient can read).
      if (kind === 'calendar_reminder' && data.alertId) {
        void openReminderEvent(data.alertId);
      }
    };
    void Notifications.getLastNotificationResponseAsync().then(open).catch(() => undefined);
    const sub = Notifications.addNotificationResponseReceivedListener(open);
    return () => sub.remove();
  }, []);
  return null;
}
