import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Redirect } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { createCouple, displayCode } from '@/lib/pairing';
import { colors, font, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * SHOW MY CODE
 *
 * On open, this generates a pairing code (by creating the couple record) and
 * displays it. It then waits for the partner to enter the code. When they do,
 * CoupleProvider flips the phase to "paired" and we continue into the app.
 *
 * If the user already generated a code earlier (phase === 'waiting'), we just
 * reuse the existing code instead of creating another couple.
 */
export default function ShowCode() {
  const { phase, couple, refresh } = useCouple();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);

  async function generate() {
    setError(null);
    setGenerating(true);
    const result = await createCouple();
    setGenerating(false);
    if (!result.ok) {
      setError(result.message);
      startedRef.current = false; // allow retry
      return;
    }
    await refresh();
  }

  // Generate once when the screen opens — but ONLY when we know for sure this
  // user has no couple yet. While the saved state is still loading (or we're
  // offline) we wait, so an existing pairing is never replaced by a new code.
  useEffect(() => {
    if (phase !== 'unpaired' || couple) return;
    if (startedRef.current) return;
    startedRef.current = true;
    void generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, couple]);

  // Partner joined → into the app.
  if (phase === 'paired') return <Redirect href="/name-setup" />;

  async function onCopy() {
    if (!couple) return;
    await Clipboard.setStringAsync(displayCode(couple.invite_code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <BackHeader title="Your Pairing Code" />
      <View style={styles.body}>
        {error ? (
          <View style={styles.centerBlock}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" onPress={generate} style={{ marginTop: spacing.lg }} />
          </View>
        ) : !couple || generating ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.waitText}>Generating your code…</Text>
          </View>
        ) : (
          <>
            <Text style={styles.lead}>Share this code with your partner.</Text>

            <Card style={styles.codeCard}>
              <Text style={styles.codeLabel}>PAIRING CODE</Text>
              <Text style={styles.code}>{displayCode(couple.invite_code)}</Text>
              <Button
                label={copied ? 'Copied' : 'Copy Code'}
                icon={copied ? 'checkmark' : 'copy-outline'}
                variant="secondary"
                onPress={onCopy}
                style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
              />
            </Card>

            <View style={styles.waitRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.waitText}>Waiting for your partner…</Text>
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.xl, paddingTop: spacing.md },
  centerBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lead: { ...font.body, color: colors.subtext, marginBottom: spacing.xl, textAlign: 'center' },
  codeCard: { alignItems: 'center', paddingVertical: spacing.xl },
  codeLabel: { ...font.tiny, color: colors.muted, letterSpacing: 2 },
  code: { ...font.hero, fontSize: 38, color: colors.primary, marginTop: spacing.sm, letterSpacing: 2 },
  waitRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginTop: spacing.xl, gap: spacing.sm },
  waitText: { ...font.body, color: colors.subtext, marginTop: spacing.sm },
  errorText: { ...font.body, color: colors.danger, textAlign: 'center', marginTop: spacing.md },
});
