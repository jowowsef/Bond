import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { ProfileAvatar } from '@/components/ProfileAvatar';
import { colors, font, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * POST-PAIRING STEP 3 — "You're all set!"
 *
 * A short confirmation showing the chosen avatar + name, then into Home. On
 * reopen (profile already complete) index routes straight to Home, so this
 * screen is only seen once right after setup.
 */
export default function AllSet() {
  const router = useRouter();
  const { phase, myProfile } = useCouple();

  if (phase !== 'paired' && phase !== 'loading') return <Redirect href="/" />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <ProfileAvatar profile={myProfile} who="me" size={120} />
        <Text style={styles.name}>{myProfile?.display_name ?? 'You'}</Text>
        <Text style={styles.title}>You&apos;re all set!</Text>
        <Text style={styles.subtitle}>Your profile is ready.</Text>
      </View>
      <View style={styles.footer}>
        <Button label="Continue" onPress={() => router.replace('/optional-setup')} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.xl, alignItems: 'center', justifyContent: 'center' },
  name: { ...font.h2, color: colors.text, marginTop: spacing.lg },
  title: { ...font.title, color: colors.text, marginTop: spacing.xl },
  subtitle: { ...font.body, color: colors.subtext, marginTop: spacing.sm },
  footer: { padding: spacing.xl, paddingTop: 0 },
});
