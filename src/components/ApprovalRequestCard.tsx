import { Ionicons } from '@expo/vector-icons';
import React, { useRef, useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { UnpairConfirmModal } from './UnpairConfirmModal';
import { approvalDescription, approvalTitle, cancelApproval, respondToApproval } from '@/lib/requests';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import type { ApprovalRequest } from '@/lib/types';

/**
 * One pending approval request.
 *   - direction "incoming": I am the target → Approve / Decline.
 *   - direction "outgoing": I sent it → shows "waiting" + Withdraw.
 * After acting it calls onDone() so the parent can refresh.
 */
export function ApprovalRequestCard({
  request,
  direction,
  otherName,
  onDone,
}: {
  request: ApprovalRequest;
  direction: 'incoming' | 'outgoing';
  otherName: string;
  onDone: () => void;
}) {
  useThemeVersion();
  const [busy, setBusy] = useState(false);
  const [confirmUnpair, setConfirmUnpair] = useState(false);
  const busyRef = useRef(false);

  async function respond(accept: boolean) {
    if (busyRef.current) return; // no duplicate answers
    // Approving an unpair disconnects both people: always confirm first.
    if (accept && request.action === 'unpair') {
      setConfirmUnpair(true);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const result = await respondToApproval(request.id, accept);
    busyRef.current = false;
    setBusy(false);
    if (!result.ok) {
      Alert.alert('Could not respond', result.message ?? 'Please try again.');
      return;
    }
    onDone();
  }

  async function withdraw() {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    const result = await cancelApproval(request.id);
    busyRef.current = false;
    setBusy(false);
    if (!result.ok) {
      Alert.alert('Could not withdraw', result.message ?? 'Please try again.');
      return;
    }
    onDone();
  }

  const danger = request.action === 'unpair';

  return (
    <Card style={styles.card}>
      <View style={styles.header}>
        <View style={[styles.iconWrap, { backgroundColor: danger ? colors.dangerSoft : colors.primarySoft }]}>
          <Ionicons
            name={danger ? 'unlink-outline' : 'location-outline'}
            size={18}
            color={danger ? colors.danger : colors.primary}
          />
        </View>
        <Text style={styles.title}>{approvalTitle(request.action)}</Text>
      </View>

      <Text style={styles.body}>
        {direction === 'incoming'
          ? approvalDescription(request.action, otherName)
          : `Waiting for ${otherName} to approve.`}
      </Text>

      {direction === 'incoming' ? (
        <View style={styles.actions}>
          <Button label="Decline" variant="secondary" small onPress={() => respond(false)} disabled={busy} style={styles.action} />
          <Button
            label="Approve"
            variant={danger ? 'danger' : 'primary'}
            small
            onPress={() => respond(true)}
            loading={busy}
            style={styles.action}
          />
        </View>
      ) : (
        <View style={styles.actions}>
          <Button label="Withdraw" variant="ghost" small onPress={withdraw} loading={busy} />
        </View>
      )}

      {danger && direction === 'incoming' ? (
        <UnpairConfirmModal
          visible={confirmUnpair}
          mode="approve"
          partnerName={otherName}
          onCancel={() => setConfirmUnpair(false)}
          onConfirm={async () => {
            const result = await respondToApproval(request.id, true);
            if (result.ok) return { ok: true };
            // Maybe it already went through (for example a retry after a lost
            // answer): re-read, and if the couple is gone the app shows the
            // unpaired screen. The error stays visible otherwise.
            onDone();
            return { ok: false, message: result.message };
          }}
          onFinished={() => {
            setConfirmUnpair(false);
            // Reloads the couple state: this phone is now unpaired, and the app's
            // unpair handler (UnpairWatcher) moves to Mutual Pairing. No
            // navigation here, so nothing competes with it.
            onDone();
          }}
        />
      ) : null}
    </Card>
  );
}

const styles = themedStyles(() => ({
  card: { gap: spacing.sm },
  header: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: {
    width: 32,
    height: 32,
    borderRadius: radius.sm,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  title: { ...font.h3, color: colors.text, flex: 1 },
  body: { ...font.small, color: colors.subtext, lineHeight: 19 },
  actions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm, marginTop: spacing.xs },
  action: { minWidth: 104 },
}));
