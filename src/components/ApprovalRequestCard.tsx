import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from './Button';
import { Card } from './Card';
import { approvalDescription, approvalTitle, cancelApproval, respondToApproval } from '@/lib/requests';
import { colors, font, radius, spacing } from '@/lib/theme';
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
  const [busy, setBusy] = useState(false);

  async function respond(accept: boolean) {
    setBusy(true);
    const result = await respondToApproval(request.id, accept);
    setBusy(false);
    if (!result.ok) {
      Alert.alert('Could not respond', result.message);
      return;
    }
    onDone();
  }

  async function withdraw() {
    setBusy(true);
    const result = await cancelApproval(request.id);
    setBusy(false);
    if (!result.ok) {
      Alert.alert('Could not withdraw', result.message);
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
    </Card>
  );
}

const styles = StyleSheet.create({
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
});
