import { useLocalSearchParams } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ScrollView, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AuthField } from '@/components/AuthFields';
import { BackHeader } from '@/components/BackHeader';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { isValidEmail } from '@/lib/accountProtection';
import { requestPasswordReset } from '@/lib/emailLogin';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * FORGOT PASSWORD: Supabase emails a reset link that opens Bond on this
 * phone. The message is the same whether or not the email has an account.
 */
export default function ForgotPassword() {
  useThemeVersion();
  const params = useLocalSearchParams<{ email?: string }>();
  const [email, setEmail] = useState(params.email ?? '');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  async function onSend() {
    if (busyRef.current) return;
    setError(null);
    if (!isValidEmail(email)) return setError('Enter a valid email address.');
    busyRef.current = true;
    setBusy(true);
    try {
      const r = await requestPasswordReset(email);
      if (!r.ok) setError(r.message);
      else setSent(true);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top', 'bottom']}>
      <BackHeader title="Reset password" />
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {sent ? (
          <Card style={{ gap: spacing.sm }}>
            <Text style={styles.title}>Check your email</Text>
            <Text style={styles.body}>
              If a Bond account uses {email.trim()}, we sent it a link to choose a new password. Open the email on this
              phone and tap the link. It opens Bond.
            </Text>
            <Text style={styles.hint}>Nothing arrived after a few minutes? Check spam, then try again.</Text>
            <Button label="Send again" variant="secondary" small onPress={() => setSent(false)} style={{ alignSelf: 'flex-start' }} />
          </Card>
        ) : (
          <>
            <Text style={styles.body}>
              Enter the email you added to your Bond account. We&apos;ll send a link to choose a new password.
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
              returnKeyType="send"
              onSubmitEditing={onSend}
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Button label="Send reset link" onPress={onSend} loading={busy} style={styles.button} />
          </>
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
  hint: { ...font.small, color: colors.muted, lineHeight: 18 },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md, lineHeight: 18 },
  button: { marginTop: spacing.xl },
}));
