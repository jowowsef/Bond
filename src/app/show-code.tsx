import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Redirect } from '@/components/Redirect';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { GearButton } from '@/components/GearButton';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { createCouple, displayCode, inviteExpired, inviteExpiresText, refreshInviteCode } from '@/lib/pairing';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
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
 *
 * A code works for 24 hours. "New code" replaces it any time (the old one
 * stops working); once it has expired, only the new-code action is offered.
 */
export default function ShowCode() {
  useThemeVersion();
  const { phase, couple, refresh } = useCouple();
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const startedRef = useRef(false);
  const [renewing, setRenewing] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  // Keep "Expires in …" and the expired state current while the screen is open.
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  async function newCode() {
    setError(null);
    setRenewing(true);
    const result = await refreshInviteCode();
    setRenewing(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setNow(Date.now());
    await refresh();
  }

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

  // Partner joined: the start screen begins this pairing's setup
  // (Sharing setup -> Name -> Avatar color -> Home).
  if (phase === 'paired') return <Redirect href="/" />;

  const expired = inviteExpired(couple, now);
  const expiresText = inviteExpiresText(couple, now);

  async function onCopy() {
    if (!couple || expired) return;
    await Clipboard.setStringAsync(displayCode(couple.invite_code));
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  return (
    <SafeAreaView style={styles.screen}>
      <BackHeader title="Your Pairing Code" right={<GearButton />} />
      <View style={styles.body}>
        {error ? (
          <View style={styles.centerBlock}>
            <Ionicons name="alert-circle-outline" size={40} color={colors.danger} />
            <Text style={styles.errorText}>{error}</Text>
            <Button label="Try again" onPress={couple ? newCode : generate} style={{ marginTop: spacing.lg }} />
          </View>
        ) : !couple || generating ? (
          <View style={styles.centerBlock}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.waitText}>Generating your code…</Text>
          </View>
        ) : (
          <>
            {/* Status first, compact: this code is live and Bond is waiting. */}
            {expired ? (
              <View style={[styles.waitPill, styles.expiredPill]} accessibilityLiveRegion="polite">
                <Ionicons name="time-outline" size={16} color={colors.warning} />
                <Text style={[styles.waitPillText, styles.expiredPillText]}>This code has expired</Text>
              </View>
            ) : (
              <View style={styles.waitPill} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={colors.primary} />
                <Text style={styles.waitPillText}>Waiting for your partner to enter this code</Text>
              </View>
            )}
            <Text style={styles.lead}>
              {expired ? 'Make a new code and share it with your partner.' : 'Share this code with your partner.'}
            </Text>

            <Card style={styles.codeCard}>
              <Text style={styles.codeLabel}>PAIRING CODE</Text>
              <Text style={[styles.code, expired && styles.codeExpired]}>{displayCode(couple.invite_code)}</Text>
              {expiresText ? <Text style={styles.expires}>{expiresText}</Text> : null}
              {expired ? (
                <Button
                  label="New Code"
                  icon="refresh-outline"
                  onPress={newCode}
                  loading={renewing}
                  style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
                />
              ) : (
                <>
                  <Button
                    label={copied ? 'Copied' : 'Copy Code'}
                    icon={copied ? 'checkmark' : 'copy-outline'}
                    variant="secondary"
                    onPress={onCopy}
                    style={{ marginTop: spacing.lg, alignSelf: 'stretch' }}
                  />
                  <Button
                    label="New Code"
                    icon="refresh-outline"
                    variant="ghost"
                    small
                    onPress={newCode}
                    loading={renewing}
                    style={{ marginTop: spacing.sm, alignSelf: 'center' }}
                  />
                </>
              )}
            </Card>
            <Text style={styles.note}>A code works for 24 hours. A new code replaces the old one.</Text>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.xl, paddingTop: spacing.md },
  centerBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  lead: { ...font.body, color: colors.subtext, marginBottom: spacing.xl, textAlign: 'center' },
  codeCard: { alignItems: 'center', paddingVertical: spacing.xl },
  codeLabel: { ...font.tiny, color: colors.muted, letterSpacing: 2 },
  code: { ...font.hero, fontSize: 38, color: colors.primary, marginTop: spacing.sm, letterSpacing: 2 },
  waitPill: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.xs + 2,
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    marginBottom: spacing.lg,
  },
  waitPillText: { ...font.small, fontWeight: '600', color: colors.primary },
  waitText: { ...font.body, color: colors.subtext, marginTop: spacing.sm },
  expiredPill: { backgroundColor: colors.warningSoft },
  expiredPillText: { color: colors.warning },
  codeExpired: { color: colors.muted, textDecorationLine: 'line-through' },
  expires: { ...font.small, color: colors.subtext, marginTop: spacing.xs },
  note: { ...font.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg },
  errorText: { ...font.body, color: colors.danger, textAlign: 'center', marginTop: spacing.md },
}));
