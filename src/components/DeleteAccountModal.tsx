import { useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, TextInput, View } from 'react-native';
import { Button } from '@/components/Button';
import { deleteMyAccount } from '@/lib/accountDeletion';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

const CONFIRM_WORD = 'DELETE';

/**
 * Permanent account deletion. The person must type DELETE; the button stays
 * disabled until then, double taps are ignored, and errors keep the account.
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
  const { resetSession } = useCouple();
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setTyped('');
      setError(null);
    }
  }, [visible]);

  async function confirm() {
    if (busyRef.current || typed.trim().toUpperCase() !== CONFIRM_WORD) return;
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

  const ready = typed.trim().toUpperCase() === CONFIRM_WORD;

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
              Settings on this phone (like Usage access or Web Protection) stay in Android until you change them there.
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
