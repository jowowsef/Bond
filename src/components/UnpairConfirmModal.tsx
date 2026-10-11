import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Modal, ScrollView, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * Confirmation for unpairing, used on BOTH sides:
 *  - mode "request": I ask to unpair (nothing changes until my partner approves).
 *  - mode "approve": my partner asked; approving disconnects us right away.
 *    On success the modal closes at once: the app then shows its own
 *    "You're no longer paired" screen once the server confirms the couple
 *    ended, so there is exactly one confirmation.
 *
 * `onConfirm` does the real work and returns { ok, message }. The modal shows
 * loading, blocks double taps, keeps errors visible, and only reports success
 * when the server call actually succeeded.
 */
export function UnpairConfirmModal({
  visible,
  mode,
  partnerName,
  onCancel,
  onConfirm,
  onFinished,
}: {
  visible: boolean;
  mode: 'request' | 'approve';
  partnerName: string;
  onCancel: () => void;
  onConfirm: () => Promise<{ ok: boolean; message?: string }>;
  /** Called after the success message is dismissed. */
  onFinished: () => void;
}) {
  useThemeVersion();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const busyRef = useRef(false);

  useEffect(() => {
    if (visible) {
      setError(null);
      setDone(false);
    }
  }, [visible]);

  async function confirm() {
    if (busyRef.current) return; // no duplicate requests
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const r = await onConfirm();
      if (r.ok) {
        if (mode === 'approve') onFinished();
        else setDone(true);
      }
      else setError(r.message ?? 'Something went wrong. Nothing was changed.');
    } catch {
      setError('Something went wrong. Nothing was changed.');
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  const title = done
    ? mode === 'request'
      ? 'Request sent'
      : 'You are no longer paired'
    : mode === 'request'
      ? 'Ask to unpair?'
      : `Approve unpairing from ${partnerName}?`;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={busy ? () => {} : done ? onFinished : onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet} accessibilityViewIsModal>
          <View style={styles.icon}>
            <Ionicons name={done ? 'checkmark-circle-outline' : 'unlink-outline'} size={24} color={done ? colors.success : colors.danger} />
          </View>
          <Text style={styles.title}>{title}</Text>

          <ScrollView style={styles.scroll} contentContainerStyle={{ gap: spacing.sm }}>
            {done ? (
              <Text style={styles.body}>
                {mode === 'request'
                  ? `${partnerName} needs to approve before you're disconnected. You can withdraw the request from Home while it's waiting.`
                  : 'Bond will now go back to the start screen. You can pair again any time with a new code.'}
              </Text>
            ) : (
              <>
                <Text style={styles.body}>
                  {mode === 'request'
                    ? `Unpairing affects both of you, so ${partnerName} has to approve it. Nothing changes until they do.`
                    : `${partnerName} asked to unpair. If you approve, you are both disconnected right away.`}
                </Text>
                <Text style={styles.listTitle}>What happens when you're unpaired</Text>
                <Bullet text="You stop seeing each other's location, battery, screen time and current app." />
                <Bullet text="Your shared activity history and any open requests are removed." />
                <Bullet text="Each of you keeps your own account, profile, photo and settings. Account protection stays as it is." />
                <Bullet text="Nothing on either phone is wiped, and you can pair again later with a new code." />
              </>
            )}
          </ScrollView>

          {error ? (
            <Text style={styles.error} accessibilityLiveRegion="polite">
              {error}
            </Text>
          ) : null}

          {done ? (
            <Button label="OK" onPress={onFinished} style={styles.full} />
          ) : (
            <View style={styles.actions}>
              <Button label="Cancel" variant="secondary" onPress={onCancel} disabled={busy} style={styles.action} />
              <Button
                label={mode === 'request' ? 'Send request' : 'Confirm'}
                variant="danger"
                onPress={confirm}
                disabled={busy}
                style={styles.action}
              />
            </View>
          )}
          {busy ? (
            <View style={styles.busyRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.busyText}>{mode === 'request' ? 'Sending request…' : 'Unpairing…'}</Text>
            </View>
          ) : null}
        </View>
      </View>
    </Modal>
  );
}

function Bullet({ text }: { text: string }) {
  useThemeVersion();
  return (
    <View style={styles.bullet}>
      <View style={styles.dot} />
      <Text style={styles.bulletText}>{text}</Text>
    </View>
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
  sheet: {
    width: '100%',
    maxWidth: 440,
    maxHeight: '90%',
    backgroundColor: colors.card,
    borderRadius: radius.xl,
    padding: spacing.xl,
  },
  icon: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.dangerSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { ...font.h2, color: colors.text, marginBottom: spacing.sm },
  scroll: { flexGrow: 0 },
  body: { ...font.body, color: colors.subtext, lineHeight: 21 },
  listTitle: { ...font.small, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  bullet: { flexDirection: 'row', gap: spacing.sm, alignItems: 'flex-start' },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.muted, marginTop: 7 },
  bulletText: { ...font.small, color: colors.subtext, lineHeight: 19, flex: 1 },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md, lineHeight: 18 },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },
  action: { flex: 1 },
  full: { marginTop: spacing.lg },
  busyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm, marginTop: spacing.md },
  busyText: { ...font.small, color: colors.subtext },
}));

