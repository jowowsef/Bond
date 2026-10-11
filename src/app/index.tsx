import { Redirect } from '@/components/Redirect';
import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { BondLogo } from '@/components/BondLogo';
import { Button } from '@/components/Button';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * The entry screen. It shows nothing of its own — it just looks at the
 * current phase and redirects:
 *   loading  → logo + spinner (restoring the saved session + couple)
 *   offline  → logo + "Unable to connect" + Try again
 *   unpaired, signed in   → /pair     (Mutual Pairing)
 *   unpaired, no account  → /welcome  (Continue with Google / email)
 *   waiting  → /show-code      (shows the code + "waiting for partner")
 *   paired, new pairing → Sharing setup -> Name -> Avatar color -> Home
 *   paired   → /(tabs)         (main app)
 *
 * Every other screen that finds itself in the wrong place sends the user
 * back HERE (never to a guessed screen), so this is the one place that
 * decides, and the steps can never run in the wrong order or loop.
 *
 * Because the phase comes from a saved session, a returning couple lands
 * straight in the main app without pairing again.
 */
export default function Index() {
  useThemeVersion();
  const { phase, profileStep, refresh, session, pairingSetup, unpairState } = useCouple();
  const [retrying, setRetrying] = useState(false);

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <BondLogo size={72} layout="column" />
        <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
      </View>
    );
  }

  if (phase === 'offline') {
    return (
      <View style={styles.center}>
        <BondLogo size={72} layout="column" />
        <Text style={styles.message}>Unable to connect. Check your internet connection and try again.</Text>
        <Button
          label="Try again"
          icon="refresh"
          loading={retrying}
          onPress={async () => {
            setRetrying(true);
            await refresh();
            setRetrying(false);
          }}
          style={styles.retry}
        />
      </View>
    );
  }

  if (phase === 'paired') {
    // Paired but the profile or setup step isn't known yet → wait (no flash of
    // the wrong screen).
    if (profileStep === null || pairingSetup === 'unknown') {
      return (
        <View style={styles.center}>
          <BondLogo size={72} layout="column" />
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        </View>
      );
    }
    // A NEW pairing: Sharing setup -> Name -> Avatar color, resumed at the
    // saved step (survives leaving Bond, Android Settings and restarts).
    if (pairingSetup === 'sharing') return <Redirect href="/sharing-setup" />;
    if (pairingSetup === 'name') return <Redirect href="/name-setup" />;
    if (pairingSetup === 'color') return <Redirect href="/color-setup" />;
    // Existing pairing whose profile was never finished (older accounts).
    if (profileStep === 'name') return <Redirect href="/name-setup" />;
    if (profileStep === 'color') return <Redirect href="/color-setup" />;
    return <Redirect href="/(tabs)" />;
  }
  if (phase === 'waiting') return <Redirect href="/show-code" />;
  // Just unpaired (confirmed by the server): the confirmation screen first,
  // until the person taps Continue (also after a restart).
  if (session && unpairState !== 'none') return <Redirect href="/unpaired" />;
  // Unpaired: signed in (any kind of account) -> Mutual Pairing; no account -> Welcome.
  if (session) return <Redirect href="/pair" />;
  return <Redirect href="/welcome" />;
}

const styles = themedStyles(() => ({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  message: { ...font.body, color: colors.subtext, textAlign: 'center', marginTop: spacing.xl },
  retry: { marginTop: spacing.xl, alignSelf: 'stretch' },
}));
