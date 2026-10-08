import { Ionicons } from '@expo/vector-icons';
import { Redirect } from 'expo-router';
import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { colors, font, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * The entry screen. It shows nothing of its own — it just looks at the
 * current phase and redirects:
 *   loading  → spinner
 *   unpaired → /welcome        (onboarding)
 *   waiting  → /show-code      (shows the code + "waiting for partner")
 *   paired   → /(tabs)         (main app)
 *
 * Because the phase comes from a saved session, a returning couple lands
 * straight in the main app without pairing again.
 */
export default function Index() {
  const { phase } = useCouple();

  if (phase === 'loading') {
    return (
      <View style={styles.center}>
        <Ionicons name="heart" size={40} color={colors.primary} />
        <Text style={styles.logo}>Bond</Text>
        <ActivityIndicator color={colors.primary} style={{ marginTop: 16 }} />
      </View>
    );
  }

  if (phase === 'paired') return <Redirect href="/(tabs)" />;
  if (phase === 'waiting') return <Redirect href="/show-code" />;
  return <Redirect href="/welcome" />;
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  logo: { ...font.hero, color: colors.text, marginTop: spacing.md },
});
