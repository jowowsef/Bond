import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { joinCouple, normalizeCode, unpair } from '@/lib/pairing';
import { colors, font, fontFamily, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * ENTER THEIR CODE
 *
 * Type the code shown on the partner's device and connect. On success we show
 * a short "You're Connected" state and then continue into the main app.
 *
 * If this device had already generated its own (unused) code, we quietly
 * abandon that empty couple first so joining the partner's code succeeds.
 */
export default function EnterCode() {
  const router = useRouter();
  const { phase, refresh } = useCouple();
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Already connected (and not mid-success-animation) → straight to the app.
  if (phase === 'paired' && !connected) return <Redirect href="/(tabs)" />;

  async function onConnect() {
    setError(null);
    if (!code.trim()) {
      setError('Please enter a pairing code.');
      return;
    }
    if (normalizeCode(code).length < 4) {
      setError("That pairing code isn't valid.");
      return;
    }

    setLoading(true);
    // Abandon our own waiting couple, if any, before joining theirs.
    if (phase === 'waiting') {
      await unpair();
      await refresh();
    }

    const result = await joinCouple(code);
    if (!result.ok) {
      setLoading(false);
      setError(result.message);
      return;
    }

    await refresh();
    setLoading(false);
    setConnected(true);
    setTimeout(() => router.replace('/name-setup'), 1400);
  }

  if (connected) {
    return (
      <SafeAreaView style={[styles.screen, styles.successWrap]}>
        <View style={styles.successBadge}>
          <Ionicons name="checkmark-circle" size={64} color={colors.success} />
        </View>
        <Text style={styles.successTitle}>You're Connected</Text>
        <Text style={styles.successText}>You and your partner are now paired.</Text>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.screen}>
      <BackHeader title="Enter Their Code" />
      <View style={styles.body}>
        <Text style={styles.subtitle}>Enter the pairing code shown on your partner's device.</Text>

        <Text style={styles.inputLabel}>Pairing code</Text>
        <TextInput
          value={code}
          // Show letters uppercase as the user types (handles paste/autofill
          // too). Spaces and lowercase are still cleaned up by normalizeCode
          // on connect, so they never cause an error.
          onChangeText={(text) => setCode(text.toUpperCase())}
          placeholder="K7P4X2"
          placeholderTextColor={colors.muted}
          style={styles.input}
          autoCapitalize="characters"
          autoCorrect={false}
          autoFocus
          maxLength={14}
          returnKeyType="done"
          onSubmitEditing={onConnect}
        />

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button label="Connect" icon="link-outline" onPress={onConnect} loading={loading} style={{ marginTop: spacing.xl }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.xl, paddingTop: spacing.md },
  subtitle: { ...font.body, color: colors.subtext, marginBottom: spacing.xl },
  inputLabel: { ...font.small, color: colors.subtext, marginBottom: spacing.sm, marginLeft: spacing.xs },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontFamily,
    fontSize: 20,
    letterSpacing: 2,
    fontWeight: '700',
    textAlign: 'center',
    color: colors.text,
  },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md, marginLeft: spacing.xs },
  successWrap: { alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  successBadge: {
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  successTitle: { ...font.title, color: colors.text },
  successText: { ...font.body, color: colors.subtext, marginTop: spacing.sm, textAlign: 'center' },
});
