import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { deleteMyAccount } from '@/lib/accountDeletion';
import { hasGoogleSignIn, hasPassword } from '@/lib/accountProtection';
import { reauthenticateWithGoogle } from '@/lib/googleAuth';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

const CONFIRM_WORD = 'DELETE';

/** A Google re-check counts for this long (then it is asked again). */
const GOOGLE_RECHECK_MS = 5 * 60 * 1000;

/**
 * Permanent account deletion. The person must type DELETE; the button stays
 * disabled until then, double taps are ignored, and errors keep the account.
 * Accounts that sign in only with Google (no Bond password) must also confirm
 * with Google right before (reauthenticateWithGoogle); they are never asked
 * for a password they never created. Email/password accounts are unchanged.
 */
export function DeleteAccountModal({
  visible,
  userId,
  partnerName,
  paired,
  onClose,
}: {
  visible: boolean;
  userId: string;
  partnerName: string;
  paired: boolean;
  onClose: () => void;
}) {
  useThemeVersion();
  const router = useRouter();
  const { resetSession, session } = useCouple();
  const googleOnly = hasGoogleSignIn(session?.user) && !hasPassword(session?.user);
  const [googleOkAt, setGoogleOkAt] = useState<number | null>(null);
  const [checking, setChecking] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setTyped('');
      setError(null);
      setGoogleOkAt(null);
    }
  }, [visible]);

  // Shown as confirmed once checked; its 5-minute limit is enforced when Delete is pressed.
  const googleConfirmed = !googleOnly || googleOkAt !== null;

  async function confirmWithGoogle() {
    if (checking || busy) return;
    setChecking(true);
    setError(null);
    const r = await reauthenticateWithGoogle(userId);
    setChecking(false);
    if (r.ok) setGoogleOkAt(Date.now());
    else if (!r.cancelled) setError(r.message);
  }

  async function confirm() {
    if (busyRef.current || typed.trim().toUpperCase() !== CONFIRM_WORD) return;
    if (googleOnly && (googleOkAt === null || Date.now() - googleOkAt >= GOOGLE_RECHECK_MS)) {
      setGoogleOkAt(null);
      setError(googleOkAt === null ? 'Confirm with Google first.' : 'Please confirm with Google again.');
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const r = await deleteMyAccount(userId);
    if (!r.ok) {
      // Account kept (or only the photo removed): stay here and say exactly what happened.
      busyRef.current = false;
      setBusy(false);
      setError(r.message);
      return;
    }
    // Only after the server confirmed: forget this account in memory too, close
    // every screen (Settings sits on top of Home) and start again at Welcome.
    await resetSession();
    onClose();
    if (router.canDismiss()) router.dismissAll();
    router.replace('/welcome');
  }

  const ready = typed.trim().toUpperCase() === CONFIRM_WORD && googleConfirmed;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => {} : onClose}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <Text style={styles.title}>Delete your Bond account?</Text>
          <ScrollView style={{ flexGrow: 0 }} contentContainerStyle={{ gap: spacing.sm }}>
            <Text style={styles.body}>This can&apos;t be undone. Bond will permanently delete:</Text>
            <Text style={styles.bullet}>• your profile, name and photo</Text>
            <Text style={styles.bullet}>• your location, battery, screen time and current app data</Text>
            <Text style={styles.bullet}>• your privacy settings, alerts and sign-in details</Text>
            {paired ? (
              <Text style={styles.bullet}>
                • your couple with {partnerName}: you&apos;ll be unpaired, and your shared activity and open requests
                are removed. {partnerName} keeps their own account.
              </Text>
            ) : null}
            <Text style={styles.body}>
              Settings on this phone (like Usage access) stay in Android until you change them there.
            </Text>
            <Text style={styles.label}>Type {CONFIRM_WORD} to confirm</Text>
            <TextInput
              value={typed}
              onChangeText={setTyped}
              autoCapitalize="characters"
              autoCorrect={false}
              editable={!busy}
              placeholder={CONFIRM_WORD}
              placeholderTextColor={colors.muted}
              style={styles.input}
              accessibilityLabel={`Type ${CONFIRM_WORD} to confirm`}
            />
            {googleOnly ? (
              <>
                <Text style={styles.label}>Confirm with Google</Text>
                <Text style={styles.bullet}>
                  {googleConfirmed
                    ? 'Confirmed with Google.'
                    : 'For your security, choose the Google account you use for Bond. No password is needed.'}
                </Text>
                {googleConfirmed ? null : (
                  <Button
                    label="Confirm with Google"
                    variant="secondary"
                    small
                    onPress={confirmWithGoogle}
                    loading={checking}
                    disabled={busy}
                  />
                )}
              </>
            ) : null}
          </ScrollView>
          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}
          <View style={styles.actions}>
            <Button label="Cancel" variant="secondary" onPress={onClose} disabled={busy} style={styles.action} />
            <Button label="Delete" variant="danger" onPress={confirm} disabled={!ready || busy} style={styles.action} />
          </View>
          {busy ? (
            <View style={styles.busy}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.busyText}>Deleting…</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

const styles = themedStyles(() => ({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 20, 30, 0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: { width: '100%', maxWidth: 440, maxHeight: '90%', backgroundColor: colors.card, borderRadius: radius.xl, padding: spacing.xl },
  title: { ...font.h2, color: colors.text, marginBottom: spacing.md },
  body: { ...font.body, color: colors.subtext, lineHeight: 21 },
  bullet: { ...font.small, color: colors.subtext, lineHeight: 19 },
  label: { ...font.small, fontWeight: '700', color: colors.text, marginTop: spacing.md },
  input: {
    ...font.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 46,
    backgroundColor: colors.background,
  },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: { flex: 1 },
  busy: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
  busyText: { ...font.small, color: colors.subtext },
}));
