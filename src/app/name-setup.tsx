import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { updateDisplayName } from '@/lib/pairing';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * POST-PAIRING STEP 1 — "What should we call you?"
 *
 * Saves the name to profiles.display_name, then continues to the colour step
 * (NOT straight to Home). Shown again on reopen if the name isn't set yet.
 */
export default function NameSetup() {
  const router = useRouter();
  const { phase, userId, myProfile, profileStep, refresh } = useCouple();

  const existing = myProfile?.display_name && myProfile.display_name !== 'Me' ? myProfile.display_name : '';
  const [name, setName] = useState(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (phase !== 'paired' && phase !== 'loading') return <Redirect href="/" />;
  // Name already set, move on to whatever step remains.
  if (profileStep === 'color') return <Redirect href="/color-setup" />;
  if (profileStep === 'done') return <Redirect href="/(tabs)" />;

  async function onContinue() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || !userId) return;
    setBusy(true);
    setError(null);
    // Only continue to the colour step once the name has actually saved.
    const result = await updateDisplayName(userId, trimmed);
    if (!result.ok) {
      setBusy(false);
      setError(result.message ?? 'Could not save your name. Please try again.');
      return;
    }
    await refresh();
    setBusy(false);
    router.replace('/color-setup');
  }

  const canContinue = name.trim().length > 0;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <View style={styles.body}>
          <View style={styles.connected}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.connectedText}>You&apos;re connected!</Text>
          </View>
          <Text style={styles.title}>What should we call you?</Text>
          <Text style={styles.subtitle}>This is the name your partner will see.</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Display name"
            placeholderTextColor={colors.muted}
            style={styles.input}
            autoFocus
            maxLength={30}
            returnKeyType="done"
            onSubmitEditing={() => canContinue && onContinue()}
          />
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </View>
        <View style={styles.footer}>
          <Button label={error ? 'Try again' : 'Continue'} onPress={onContinue} loading={busy} disabled={!canContinue} />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { flex: 1, padding: spacing.xl, justifyContent: 'center' },
  connected: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginBottom: spacing.xl },
  connectedText: { ...font.h3, color: colors.success },
  title: { ...font.title, color: colors.text },
  subtitle: { ...font.body, color: colors.subtext, marginTop: spacing.sm, marginBottom: spacing.xl },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 18,
    color: colors.text,
  },
  footer: { padding: spacing.xl, paddingTop: 0 },
});
