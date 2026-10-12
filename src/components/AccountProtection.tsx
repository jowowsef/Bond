import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, Pressable, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import {
  confirmEmailCode,
  getProtectionStatus,
  isValidEmail,
  linkEmail,
  MIN_PASSWORD_LENGTH,
  recheckEmail,
  resendConfirmation,
  sendReauthCode,
  setAccountPassword,
  type ProtectionStatus,
} from '@/lib/accountProtection';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

type Step = 'loading' | 'load-error' | 'form' | 'pending' | 'needs-password' | 'reauth' | 'protected' | 'google';
const RESEND_COOLDOWN_S = 60;

/**
 * Settings card: protect this phone's anonymous account with an email and
 * password. The account (and so the couple and all data) stays the same; see
 * lib/accountProtection.ts. The password only lives in this component's
 * memory until it is sent to Supabase, and is cleared right after.
 */
export function AccountProtection({ userId }: { userId: string }) {
  useThemeVersion();
  const [step, setStep] = useState<Step>('loading');
  const [linkedEmail, setLinkedEmail] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [showCode, setShowCode] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [cooldown, setCooldown] = useState(0);

  const mounted = useRef(true);
  const passwordRef = useRef('');
  passwordRef.current = password;
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const finish = useCallback((status: ProtectionStatus & { kind: 'protected' }, justNow: boolean) => {
    setLinkedEmail(status.email);
    setPassword('');
    setCode('');
    setStep('protected');
    setInfo(justNow ? 'Your account is protected.' : null);
  }, []);

  /** Step 3 (and the reauthentication retry). Reports success only after Supabase confirms. */
  const savePassword = useCallback(
    async (nonce?: string) => {
      const pw = passwordRef.current;
      if (pw.length < MIN_PASSWORD_LENGTH) {
        setStep('needs-password');
        setError(`Use at least ${MIN_PASSWORD_LENGTH} characters.`);
        return;
      }
      const r = await setAccountPassword(userId, pw, nonce);
      if (!mounted.current) return;
      if (r.ok && r.value.kind === 'protected') {
        finish(r.value, true);
        return;
      }
      if (!r.ok && 'needsReauth' in r) {
        const sent = await sendReauthCode();
        if (!mounted.current) return;
        setCode('');
        setStep('reauth');
        setError(sent.ok ? null : sent.message);
        setInfo(sent.ok ? r.message : null);
        return;
      }
      setError(r.ok ? 'Supabase did not confirm the change. Please try again.' : r.message);
    },
    [userId, finish],
  );

  /** Move to the screen that matches what Supabase reports. */
  const apply = useCallback(
    async (status: ProtectionStatus, fromAction: boolean) => {
      if (status.kind === 'protected') return finish(status, fromAction);
      if (status.kind === 'google') {
        // Google already protects this account: never ask for a password.
        setLinkedEmail(status.email);
        setStep('google');
        return;
      }
      if (status.kind === 'pending') {
        setLinkedEmail(status.email);
        setStep('pending');
        return;
      }
      if (status.kind === 'needs-password') {
        setLinkedEmail(status.email);
        // Password typed earlier in this visit: finish without asking again.
        if (passwordRef.current.length >= MIN_PASSWORD_LENGTH) return savePassword();
        setStep('needs-password');
        return;
      }
      setStep('form');
    },
    [finish, savePassword],
  );

  const load = useCallback(async () => {
    const r = await getProtectionStatus(userId);
    if (!mounted.current) return;
    if (!r.ok) {
      setStep((s) => (s === 'loading' ? 'load-error' : s));
      setError(r.message);
      return;
    }
    setError(null);
    await apply(r.value, false);
  }, [userId, apply]);

  useEffect(() => {
    void load();
  }, [load]);

  // Back from the email app after tapping the link: the link confirms the
  // email on Supabase's server, so re-read the account. Check once right
  // away and once more a few seconds later in case the browser was slow.
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    let retry: ReturnType<typeof setTimeout> | null = null;
    const check = () => {
      if (stepRef.current !== 'pending') return;
      void recheckEmail(userId).then((r) => {
        if (r.ok && r.value.kind !== 'pending' && mounted.current && stepRef.current === 'pending') {
          void apply(r.value, true);
        }
      });
    };
    const sub = AppState.addEventListener('change', (s) => {
      if (s !== 'active') return;
      check();
      if (retry) clearTimeout(retry);
      retry = setTimeout(check, 4000);
    });
    return () => {
      sub.remove();
      if (retry) clearTimeout(retry);
    };
  }, [userId, apply]);

  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    setError(null);
    setInfo(null);
    try {
      await work();
    } catch {
      if (mounted.current) setError('Something went wrong. Your account was not changed.');
    } finally {
      if (mounted.current) setBusy(false);
    }
  }

  const onProtect = () =>
    run(async () => {
      if (!isValidEmail(email)) return setError('Enter a valid email address.');
      if (password.length < MIN_PASSWORD_LENGTH) return setError(`Use at least ${MIN_PASSWORD_LENGTH} characters for the password.`);
      const r = await linkEmail(userId, email);
      if (!mounted.current) return;
      if (!r.ok) return setError(r.message);
      if (r.value.kind === 'pending') setCooldown(RESEND_COOLDOWN_S);
      await apply(r.value, true);
    });

  const onConfirmCode = () =>
    run(async () => {
      if (!/^\d{6,10}$/.test(code.trim())) return setError('Enter the code from the email (numbers only).');
      const r = await confirmEmailCode(userId, linkedEmail, code);
      if (!mounted.current) return;
      if (!r.ok) return setError(r.message);
      setCode('');
      await apply(r.value, true);
    });

  const onCheckLink = () =>
    run(async () => {
      const r = await recheckEmail(userId);
      if (!mounted.current) return;
      if (!r.ok) return setError(r.message);
      if (r.value.kind === 'pending') return setError('Not confirmed yet. Tap the link in the newest email from Bond, then come back here.');
      await apply(r.value, true);
    });

  const onResend = () =>
    run(async () => {
      const r = await resendConfirmation(linkedEmail);
      if (!mounted.current) return;
      if (!r.ok) return setError(r.message);
      setCooldown(RESEND_COOLDOWN_S);
      setInfo(`Sent again to ${linkedEmail}.`);
    });

  const onSavePassword = () => run(() => savePassword());
  const onConfirmReauth = () =>
    run(async () => {
      if (!/^\d{6,10}$/.test(code.trim())) return setError('Enter the code from the email (numbers only).');
      await savePassword(code);
    });

  const passwordField = (
    <>
      <Text style={styles.label}>Password</Text>
      <View style={styles.passwordRow}>
        <TextInput
          value={password}
          onChangeText={setPassword}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          placeholderTextColor={colors.muted}
          secureTextEntry={!showPassword}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete="new-password"
          textContentType="newPassword"
          style={[styles.input, styles.passwordInput]}
          editable={!busy}
        />
        <Pressable
          onPress={() => setShowPassword((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={showPassword ? 'Hide password' : 'Show password'}
          style={styles.eye}
        >
          <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.subtext} />
        </Pressable>
      </View>
    </>
  );

  const codeField = (placeholder: string) => (
    <TextInput
      value={code}
      onChangeText={(t) => setCode(t.replace(/[^0-9]/g, ''))}
      placeholder={placeholder}
      placeholderTextColor={colors.muted}
      keyboardType="number-pad"
      autoComplete="one-time-code"
      textContentType="oneTimeCode"
      maxLength={10}
      style={styles.input}
      editable={!busy}
    />
  );

  const badge =
    step === 'protected' || step === 'google' ? (
      <StatusBadge label="Protected" tone="success" dot />
    ) : step === 'loading' || step === 'load-error' ? null : step === 'pending' ? (
      <StatusBadge label="Check your email" tone="warning" />
    ) : (
      <StatusBadge label="Not protected" tone="warning" />
    );

  return (
    <Card>
      <View style={styles.header}>
        <Ionicons name="shield-checkmark-outline" size={18} color={colors.primary} style={{ marginRight: spacing.sm }} />
        <Text style={styles.title}>Account protection</Text>
        {badge}
      </View>

      {step === 'loading' ? <Text style={styles.body}>Checking…</Text> : null}

      {step === 'load-error' ? (
        <>
          <Text style={styles.body}>Couldn&apos;t check your account. {error}</Text>
          <Button label="Try again" small variant="secondary" onPress={() => void load()} style={styles.button} />
        </>
      ) : null}

      {step === 'form' ? (
        <>
          <Text style={styles.body}>
            Right now this account lives only on this phone. Add an email and password so you can get it back, with your
            couple and all your data, on a new or reinstalled phone.
          </Text>
          <Text style={styles.label}>Email</Text>
          <TextInput
            value={email}
            onChangeText={setEmail}
            placeholder="you@example.com"
            placeholderTextColor={colors.muted}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            autoComplete="email"
            textContentType="emailAddress"
            style={styles.input}
            editable={!busy}
          />
          {passwordField}
          <Button label="Protect account" onPress={onProtect} loading={busy} style={styles.button} />
        </>
      ) : null}

      {step === 'pending' ? (
        <>
          <Text style={styles.body}>
            We sent a confirmation email to <Text style={styles.strong}>{linkedEmail}</Text>. Open it and tap the
            confirmation link, then come back to Bond. Bond checks automatically when you return.
          </Text>
          <Text style={styles.hint}>
            After you tap the link, your browser may show an error or a blank page. That is expected: the confirmation
            still worked.
          </Text>
          {passwordRef.current.length < MIN_PASSWORD_LENGTH ? (
            <Text style={styles.hint}>You&apos;ll choose your password right after confirming.</Text>
          ) : null}
          <Button label="I tapped the link" onPress={onCheckLink} loading={busy} style={styles.button} />
          <View style={styles.linkRow}>
            <Button
              label={cooldown > 0 ? `Send again (${cooldown}s)` : 'Send again'}
              small
              variant="ghost"
              onPress={onResend}
              disabled={busy || cooldown > 0}
            />
          </View>

          {/* Only if the email shows a code (custom email templates). */}
          {showCode ? (
            <>
              {codeField('Code from the email')}
              <Button label="Confirm code" small variant="secondary" onPress={onConfirmCode} disabled={busy} style={styles.button} />
            </>
          ) : (
            <Pressable onPress={() => setShowCode(true)} disabled={busy} hitSlop={8}>
              <Text style={styles.textLink}>My email has a code instead</Text>
            </Pressable>
          )}
          <Pressable onPress={() => { setStep('form'); setError(null); setInfo(null); }} disabled={busy} hitSlop={8}>
            <Text style={styles.textLink}>Use a different email</Text>
          </Pressable>
        </>
      ) : null}

      {step === 'needs-password' ? (
        <>
          <Text style={styles.body}>
            <Text style={styles.strong}>{linkedEmail}</Text> is confirmed. Add a password to finish protecting your
            account.
          </Text>
          {passwordField}
          <Button label="Save password" onPress={onSavePassword} loading={busy} style={styles.button} />
        </>
      ) : null}

      {step === 'reauth' ? (
        <>
          <Text style={styles.body}>
            For your security, Supabase sent a code to <Text style={styles.strong}>{linkedEmail}</Text>. Enter it to
            save your password.
          </Text>
          {codeField('Security code')}
          <Button label="Save password" onPress={onConfirmReauth} loading={busy} style={styles.button} />
        </>
      ) : null}

      {step === 'protected' ? (
        <>
          <Text style={styles.body}>
            Linked email: <Text style={styles.strong}>{linkedEmail}</Text>
          </Text>
          <Text style={styles.hint}>
            This email and password belong to this same account, so your couple and data stay connected to it. On a new
            or reinstalled phone, choose &quot;Continue with email&quot; on Bond&apos;s welcome screen and sign in.
          </Text>
        </>
      ) : null}

      {step === 'google' ? (
        <>
          <Text style={styles.body}>
            Signed in with Google: <Text style={styles.strong}>{linkedEmail}</Text>
          </Text>
          <Text style={styles.hint}>
            Your Google account protects this Bond account, so no Bond password is needed. On a new or reinstalled
            phone, choose &quot;Continue with Google&quot; on Bond&apos;s welcome screen. For sensitive actions, like deleting
            your account, Bond asks you to confirm with Google again.
          </Text>
        </>
      ) : null}

      {error && step !== 'load-error' ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : null}
      {info ? (
        <Text style={styles.info} accessibilityLiveRegion="polite">
          {info}
        </Text>
      ) : null}
    </Card>
  );
}

const styles = themedStyles(() => ({
  header: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  title: { ...font.h3, color: colors.text, flex: 1 },
  body: { ...font.small, color: colors.subtext, lineHeight: 19 },
  strong: { fontWeight: '700', color: colors.text },
  hint: { ...font.small, color: colors.muted, lineHeight: 18, marginTop: spacing.sm },
  label: { ...font.small, color: colors.muted, marginTop: spacing.md, marginBottom: 6 },
  input: {
    ...font.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    backgroundColor: colors.background,
    marginTop: spacing.xs,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, paddingRight: 44 },
  eye: { position: 'absolute', right: spacing.md, top: 0, bottom: 0, justifyContent: 'center', marginTop: spacing.xs },
  button: { marginTop: spacing.lg },
  linkRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.md },
  textLink: { ...font.small, fontWeight: '600', color: colors.primary, marginTop: spacing.md },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md, lineHeight: 18 },
  info: { ...font.small, color: colors.success, marginTop: spacing.md, lineHeight: 18 },
}));
