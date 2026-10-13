import { Ionicons } from '@expo/vector-icons';
import * as Clipboard from 'expo-clipboard';
import { Redirect } from '@/components/Redirect';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, Share, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { GearButton } from '@/components/GearButton';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { CoupleAvatars } from '@/components/CoupleAvatars';
import { tintForProfile } from '@/lib/avatar';
import { getNotificationState, requestNotifications } from '@/lib/setupPermissions';
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
  const { phase, couple, refresh, myProfile, myAvatarUrl } = useCouple();
  // Notifications: offered here so they're ready for alerts and reminders later.
  const [notifOn, setNotifOn] = useState<boolean | null>(null);
  useEffect(() => {
    const read = () => void getNotificationState().then((n) => setNotifOn(n === 'granted')).catch(() => setNotifOn(null));
    read();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') read();
    });
    return () => sub.remove();
  }, []);
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

  async function onShare() {
    if (!couple || expired) return;
    await Share.share({
      message: `Join me on Bond! My code is ${displayCode(couple.invite_code)} (it works for 24 hours).`,
    }).catch(() => undefined);
  }

  async function onNotifications() {
    const r = await requestNotifications();
    setNotifOn(r === 'granted');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <BackHeader title="" right={<GearButton />} />
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
            <View style={styles.center}>
              <CoupleAvatars
                me={{ name: myProfile?.display_name, url: myAvatarUrl, tint: tintForProfile(myProfile) }}
                partner={null}
                size={76}
              />
              <Text style={styles.title} accessibilityLiveRegion="polite">
                {expired ? 'This code has expired' : 'Waiting for your partner…'}
              </Text>
              <Text style={styles.lead}>
                {expired
                  ? 'Make a new code and share it with your partner.'
                  : "Share your code with your partner. Once they enter it, you'll be connected."}
              </Text>
              <Pressable
                onPress={onCopy}
                disabled={expired}
                accessibilityRole="button"
                accessibilityLabel={`Pairing code ${displayCode(couple.invite_code)}. Tap to copy.`}
                style={[styles.codeChip, expired && styles.codeChipExpired]}
              >
                <Text style={[styles.code, expired && styles.codeExpired]}>{displayCode(couple.invite_code)}</Text>
                {!expired ? <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={colors.primary} /> : null}
              </Pressable>
              {expiresText ? <Text style={styles.expires}>{copied ? 'Copied' : expiresText}</Text> : null}
            </View>

            {notifOn === false ? (
              <Card style={styles.notifCard}>
                <View style={styles.notifIcon}>
                  <Ionicons name="notifications" size={18} color={colors.pink} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.notifTitle}>Turn on notifications</Text>
                  <Text style={styles.notifText}>So you don&apos;t miss alerts and reminders from your partner later.</Text>
                </View>
              </Card>
            ) : null}

            <View style={styles.actions}>
              {expired ? (
                <Button label="New code" icon="refresh-outline" onPress={newCode} loading={renewing} />
              ) : notifOn === false ? (
                <>
                  <Button label="Turn on notifications" onPress={() => void onNotifications()} />
                  <Button label="Share code" variant="ghost" onPress={() => void onShare()} />
                </>
              ) : (
                <>
                  <Button label="Share code" icon="share-outline" onPress={() => void onShare()} />
                  <Button label="New code" variant="ghost" onPress={newCode} loading={renewing} />
                </>
              )}
            </View>
          </>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, paddingHorizontal: spacing.xl, paddingBottom: spacing.lg },
  centerBlock: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  title: { ...font.title, fontSize: 24, color: colors.text, textAlign: 'center', marginTop: spacing.xl },
  lead: { ...font.body, color: colors.subtext, textAlign: 'center', marginTop: spacing.sm, lineHeight: 22 },
  codeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  codeChipExpired: { backgroundColor: colors.track },
  code: { ...font.h2, letterSpacing: 4, color: colors.primary },
  codeExpired: { color: colors.muted, textDecorationLine: 'line-through' },
  expires: { ...font.small, color: colors.subtext, marginTop: spacing.sm },
  waitText: { ...font.body, color: colors.subtext, marginTop: spacing.sm },
  notifCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.lg },
  notifIcon: { width: 38, height: 38, borderRadius: radius.md, backgroundColor: colors.pinkSoft, alignItems: 'center', justifyContent: 'center' },
  notifTitle: { ...font.body, fontWeight: '700', color: colors.text },
  notifText: { ...font.small, color: colors.subtext, marginTop: 1 },
  actions: { gap: spacing.xs },
  errorText: { ...font.body, color: colors.danger, textAlign: 'center', marginTop: spacing.md },
}));
