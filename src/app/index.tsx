import { Redirect } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { BondLogo } from '@/components/BondLogo';
import { Button } from '@/components/Button';
import { colors, font, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * The entry screen. It shows nothing of its own — it just looks at the
 * current phase and redirects:
 *   loading  → logo + spinner (restoring the saved session + couple)
 *   offline  → logo + "Unable to connect" + Try again
 *   unpaired → /welcome        (onboarding)
 *   waiting  → /show-code      (shows the code + "waiting for partner")
 *   paired   → /(tabs)         (main app)
 *
 * Because the phase comes from a saved session, a returning couple lands
 * straight in the main app without pairing again.
 */
export default function Index() {
  const { phase, profileStep, refresh } = useCouple();
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
    // Paired but the profile isn't loaded yet → wait (no flash of onboarding).
    if (profileStep === null) {
      return (
        <View style={styles.center}>
          <BondLogo size={72} layout="column" />
          <ActivityIndicator color={colors.primary} style={{ marginTop: 24 }} />
        </View>
      );
    }
    // Resume the correct profile-setup step (survives close/reopen/reinstall).
    if (profileStep === 'name') return <Redirect href="/name-setup" />;
    if (profileStep === 'color') return <Redirect href="/color-setup" />;
    return <Redirect href="/(tabs)" />;
  }
  if (phase === 'waiting') return <Redirect href="/show-code" />;
  return <Redirect href="/welcome" />;
}

const styles = StyleSheet.create({
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.background,
    padding: spacing.xl,
  },
  message: { ...font.body, color: colors.subtext, textAlign: 'center', marginTop: spacing.xl },
  retry: { marginTop: spacing.xl, alignSelf: 'stretch' },
});
