import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthField, PasswordField } from '@/components/AuthFields';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { isValidEmail, MIN_PASSWORD_LENGTH } from '@/lib/accountProtection';
import { signInAllowed, signInWithEmail, signUpWithEmail } from '@/lib/emailLogin';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

type Mode = 'signup' | 'signin';

/**
 * CONTINUE WITH EMAIL (only on a phone with no Bond account).
 *
 * Opens on Sign up (email, password, confirm password): a new account,
 * confirmed by an emailed link when Supabase requires it.
 * "Already have an account? Sign in" switches to signing in to an existing
 * account (same user id, so its couple and data come back), with Forgot
 * password (the existing reset-link flow).
 * If an account is already on this phone the screen explains and changes
 * nothing (see lib/emailLogin.ts). Adding an email to the account that is
 * already here is Settings > Account, not this screen.
 */
export default function ContinueWithEmail() {
  useThemeVersion();
  const router = useRouter();
  const { session, refresh } = useCouple();
  const [mode, setMode] = useState<Mode>('signup');
  const [blocked, setBlocked] = useState<string | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checkEmail, setCheckEmail] = useState<string | null>(null); // address a confirmation link went to
  const busyRef = useRef(false);
  const signedInRef = useRef(false); // after success, our own new session is expected

  // Check on open (and whenever the session changes) that this phone is free.
  useEffect(() => {
    let active = true;
    // Ignore the session that OUR sign-in creates (during and after it).
    if (signedInRef.current || busyRef.current) return;
    void signInAllowed().then((r) => {
      if (active && !signedInRef.current && !busyRef.current) setBlocked(r.ok ? null : r.message);
    });
    return () => {
      active = false;
    };
  }, [session]);

  function switchMode(next: Mode) {
    if (busyRef.current) return;
    setMode(next);
    setError(null);
    setCheckEmail(null);
    setPassword('');
    setConfirm('');
  }

  async function finishSignedIn() {
    signedInRef.current = true;
    setPassword('');
    setConfirm('');
    // Load this account's couple and profile, then let the start screen route
    // (Mutual Pairing, or Home for an already paired account).
    await refresh();
    router.replace('/');
  }

  async function onSubmit() {
    if (busyRef.current) return; // ignore double taps
    setError(null);
    if (!email.trim()) return setError('Enter your email address.');
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    if (!password) return setError('Enter your password.');
    if (mode === 'signup') {
      if (password.length < MIN_PASSWORD_LENGTH) {
        return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for your password.`);
      }
      if (!confirm) return setError('Confirm your password.');
      if (confirm !== password) return setError('The passwords do not match.');
    }
    busyRef.current = true;
    setBusy(true);
    try {
      if (mode === 'signin') {
        const r = await signInWithEmail(email, password);
        if (!r.ok) return setError(r.message);
        await finishSignedIn();
        return;
      }
      const r = await signUpWithEmail(email, password);
      if (!r.ok) return setError(r.message);
      if (r.value.kind === 'signed-in') {
        await finishSignedIn();
        return;
      }
      setPassword('');
      setConfirm('');
      setCheckEmail(email.trim().toLowerCase());
    } catch {
      setError('Something went wrong. Please try again.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <BackHeader title={mode === 'signup' ? 'Sign up' : 'Sign in'} />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {blocked ? (
            <Card style={styles.card}>
              <Text style={styles.cardText}>{blocked}</Text>
              <Button label="Go back" variant="secondary" small onPress={() => router.back()} style={styles.cardBtn} />
            </Card>
          ) : checkEmail ? (
            <Card style={styles.card}>
              <Text style={styles.cardTitle}>Check your email</Text>
              <Text style={styles.cardText}>
                If <Text style={styles.strong}>{checkEmail}</Text> can be used for a new account, we sent it a confirmation
                link. Tap the link, then come back here and sign in.
              </Text>
              <Text style={styles.cardNote}>
                Already have a Bond account with this email? Sign in instead. Nothing new was created.
              </Text>
              <Button label="Sign in" small onPress={() => switchMode('signin')} style={styles.cardBtn} />
            </Card>
          ) : (
            <>
              <Text style={styles.intro}>
                {mode === 'signup'
                  ? 'Create your Bond account with your email address.'
                  : "Sign in to your Bond account. You'll get the same account back, with your couple and data."}
              </Text>

              <AuthField
                label="Email"
                value={email}
                onChangeText={setEmail}
                placeholder="you@example.com"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
                textContentType="emailAddress"
                editable={!busy}
              />
              <PasswordField
                value={password}
                onChangeText={setPassword}
                isNew={mode === 'signup'}
                placeholder={mode === 'signup' ? `At least ${MIN_PASSWORD_LENGTH} characters` : 'Your password'}
                editable={!busy}
                returnKeyType={mode === 'signup' ? 'next' : 'go'}
                onSubmitEditing={mode === 'signup' ? undefined : onSubmit}
              />
              {mode === 'signup' ? (
                <PasswordField
                  label="Confirm password"
                  value={confirm}
                  onChangeText={setConfirm}
                  isNew
                  placeholder="Type your password again"
                  editable={!busy}
                  returnKeyType="go"
                  onSubmitEditing={onSubmit}
                />
              ) : null}
              {error ? (
                <Text style={styles.error} accessibilityLiveRegion="polite">
                  {error}
                </Text>
              ) : null}
              <Button
                label={mode === 'signup' ? 'Create account' : 'Sign in'}
                onPress={onSubmit}
                loading={busy}
                style={styles.button}
              />
              {mode === 'signin' ? (
                <Pressable
                  onPress={() => router.push({ pathname: '/forgot-password', params: { email } })}
                  disabled={busy}
                  hitSlop={8}
                  style={styles.linkWrap}
                >
                  <Text style={styles.link}>Forgot password?</Text>
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => switchMode(mode === 'signup' ? 'signin' : 'signup')}
                disabled={busy}
                hitSlop={8}
                accessibilityRole="button"
                style={styles.linkWrap}
              >
                <Text style={styles.switchText}>
                  {mode === 'signup' ? 'Already have an account? ' : 'New to Bond? '}
                  <Text style={styles.link}>{mode === 'signup' ? 'Sign in' : 'Sign up'}</Text>
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg, paddingTop: 0, paddingBottom: spacing.xxl },
  intro: { ...font.body, color: colors.subtext, lineHeight: 21 },
  card: { marginTop: spacing.lg, gap: spacing.md },
  cardTitle: { ...font.h3, color: colors.text },
  cardText: { ...font.body, color: colors.text, lineHeight: 21 },
  cardNote: { ...font.small, color: colors.muted, lineHeight: 18 },
  strong: { fontWeight: '700' },
  cardBtn: { alignSelf: 'flex-start' },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md, lineHeight: 18 },
  button: { marginTop: spacing.xl },
  linkWrap: { alignSelf: 'center', marginTop: spacing.lg, minHeight: 32, justifyContent: 'center' },
  link: { ...font.small, fontWeight: '700', color: colors.primary },
  switchText: { ...font.small, color: colors.subtext, textAlign: 'center' },
}));
