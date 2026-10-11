import { Ionicons } from '@expo/vector-icons';
import { Redirect } from '@/components/Redirect';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { updateDisplayName } from '@/lib/pairing';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * NEW PAIRING, STEP 2 (after Sharing setup): "What should we call you?"
 *
 * Saves the name to profiles.display_name, then the start screen continues to
 * the avatar color step. Shown again on reopen until the name is saved.
 * Also shown for an older pairing whose name was never chosen.
 */
export default function NameSetup() {
  useThemeVersion();
  const { phase, userId, myProfile, profileStep, refresh, session, pairingSetup, advancePairingSetup } = useCouple();

  // A Google account suggests its first name; the person can change it.
  const meta = (session?.user.user_metadata ?? {}) as { given_name?: string; full_name?: string; name?: string };
  const suggested = (meta.given_name ?? meta.full_name ?? meta.name ?? '').trim().slice(0, 30);
  // An automatic name copied from the email address is not offered as "yours".
  const autoName = session?.user.email ? session.user.email.split('@')[0] : null;
  const current = myProfile?.display_name?.trim() ?? '';
  const existing = current && current !== 'Me' && current !== autoName ? current : suggested || current.replace(/^Me$/, '');
  const [name, setName] = useState(existing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This screen belongs to the name step only: a new pairing at 'name', or an
  // older pairing whose name was never chosen. Anywhere else, the start screen
  // decides (it also moves on here once the name is saved).
  const isMyStep = pairingSetup === 'name' || (pairingSetup === 'done' && profileStep === 'name');
  if (phase !== 'loading' && pairingSetup !== 'unknown' && !isMyStep) return <Redirect href="/" />;

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
    // Remember that THIS person chose the name (also when it equals the email
    // name), so the name step is not shown again. Best effort: the name itself is saved.
    await supabase.auth.updateUser({ data: { bond_name_confirmed: true } }).catch(() => undefined);
    await refresh();
    // New pairing: the name step is finished (saved on this phone, so a
    // restart resumes at the color step). The screen then moves on by itself.
    if (pairingSetup === 'name') await advancePairingSetup('name');
    setBusy(false);
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

const styles = themedStyles(() => ({
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
}));
