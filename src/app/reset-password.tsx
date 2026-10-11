import * as Linking from 'expo-linking';
import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { PasswordField } from '@/components/AuthFields';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { MIN_PASSWORD_LENGTH } from '@/lib/accountProtection';
import { completePasswordReset, parseRecoveryUrl, startPasswordRecovery, type RecoveryLink } from '@/lib/emailLogin';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * RESET PASSWORD: opened by the link in the reset email
 * (bond://reset-password?code=..., PKCE). The one-time code is exchanged once,
 * on the phone that asked for the email (it holds the matching secret), then
 * the user picks a new password. Refuses on a phone where an account is
 * already signed in (see lib/emailLogin.ts). The link itself is never logged
 * or stored.
 */
export default function ResetPassword() {
  useThemeVersion();
  const router = useRouter();
  const url = Linking.useURL();
  const { refresh } = useCouple();
  const [link, setLink] = useState<RecoveryLink>({ kind: 'none' });
  const [checked, setChecked] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [ready, setReady] = useState(false); // code exchanged: ask for the new password
  const busyRef = useRef(false);
  const exchangedRef = useRef<string | null>(null);

  useEffect(() => {
    // useURL starts as null and then reports the link that opened Bond.
    const parsed = parseRecoveryUrl(url);
    if (parsed.kind === 'legacy') {
      setLink({ kind: 'error', message: 'This reset link is from an older version of Bond. Request a new one from Sign in > Forgot password.' });
    } else if (parsed.kind === 'code') {
      // A one-time code: exchange it once (the same link can be reported again).
      if (exchangedRef.current !== parsed.code) {
        exchangedRef.current = parsed.code;
        setLink(parsed);
        void startPasswordRecovery(parsed).then((r) => {
          if (r.ok) setReady(true);
          else setLink({ kind: 'error', message: r.message });
        });
      }
    } else if (parsed.kind !== 'none') {
      setLink(parsed);
    }
    const t = setTimeout(() => setChecked(true), url ? 0 : 1500);
    return () => clearTimeout(t);
  }, [url]);

  async function onSave() {
    if (busyRef.current || !ready) return;
    setError(null);
    if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await completePasswordReset(password);
      if (!r.ok) {
        setError(r.message);
        return;
      }
      setPassword('');
      setDone(true);
      await refresh(); // load this account's couple and profile
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <BackHeader title="New password" onBack={() => router.replace('/')} />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {done ? (
          <Card style={{ gap: spacing.md }}>
            <Text style={styles.title}>Password updated</Text>
            <Text style={styles.body}>You&apos;re signed in to your Bond account on this phone.</Text>
            <Button label="Continue" onPress={() => router.replace('/')} />
          </Card>
        ) : link.kind === 'code' && ready ? (
          <>
            <Text style={styles.body}>Choose a new password for your Bond account.</Text>
            <PasswordField
              label="New password"
              isNew
              value={password}
              onChangeText={setPassword}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              editable={!busy}
              returnKeyType="done"
              onSubmitEditing={onSave}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Save new password" onPress={onSave} loading={busy} style={styles.button} />
          </>
        ) : link.kind === 'error' ? (
          <Card style={{ gap: spacing.md }}>
            <Text style={styles.body}>{link.message}</Text>
            <Button label="Back to start" variant="secondary" small onPress={() => router.replace('/')} style={{ alignSelf: 'flex-start' }} />
          </Card>
        ) : (
          <Card style={{ gap: spacing.md }}>
            <Text style={styles.body}>
              {link.kind === 'code'
                ? 'Opening your reset link…'
                : checked
                ? 'This page needs the link from a Bond password-reset email. Request a new one from Sign in > Forgot password.'
                : 'Opening your reset link…'}
            </Text>
            {checked && link.kind !== 'code' ? (
              <Button label="Back to start" variant="secondary" small onPress={() => router.replace('/')} style={{ alignSelf: 'flex-start' }} />
            ) : null}
          </Card>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl },
  title: { ...font.h3, color: colors.text },
  body: { ...font.body, color: colors.subtext, lineHeight: 21 },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md, lineHeight: 18 },
  button: { marginTop: spacing.xl },
}));
