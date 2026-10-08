import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Alert, StyleSheet, Text, View } from 'react-native';
import { Button } from '@/components/Button';
import { InfoCard } from '@/components/InfoCard';
import { Screen } from '@/components/Screen';
import { StatusBadge } from '@/components/StatusBadge';
import { MOCK_ME, MOCK_PARTNER } from '@/lib/placeholders';
import { colors, font, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * CONTROLS — UI only for this phase.
 *
 * Shows what's "active" on each phone (placeholder) and the request/manage
 * buttons. Buttons currently show a short "coming soon" note instead of
 * enforcing anything. No blocking, VPN, or accessibility is implemented yet.
 */
export default function Controls() {
  const { myProfile, partnerProfile } = useCouple();
  const myName = myProfile?.display_name ?? 'You';
  const partnerName = partnerProfile?.display_name ?? 'Partner';

  const soon = (what: string) =>
    Alert.alert('Coming soon', `${what} will be available once device protection is added in a later update.`);

  return (
    <Screen title="Controls" subtitle="Help each other build better habits">
      <InfoCard icon="phone-portrait" title={`${myName} · My phone`} accent={colors.primary} accentBg={colors.primarySoft}>
        <ControlRow label="Website Protection" on={MOCK_ME.protectionOn} />
        <ControlRow label="App Restrictions" on={false} last />
        <Button
          label="Manage my protection"
          variant="secondary"
          icon="options-outline"
          small
          onPress={() => soon('Managing your own protection')}
          style={{ marginTop: spacing.md }}
        />
      </InfoCard>

      <View style={{ height: spacing.md }} />

      <InfoCard icon="people" title={`${partnerName} · Partner's phone`} accent={colors.blue} accentBg={colors.blueSoft}>
        <ControlRow label="Website Protection" on={MOCK_PARTNER.protectionOn} />
        <ControlRow label="App Restrictions" on={false} last />
        <Button
          label="Request Protection"
          icon="shield-outline"
          small
          onPress={() => soon('Requesting protection on your partner’s phone')}
          style={{ marginTop: spacing.md }}
        />
      </InfoCard>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
        <Text style={styles.infoText}>
          Every control is mutual and consent-based: you can only <Text style={styles.bold}>request</Text> protection on
          your partner's phone — they must accept it, and either of you can turn it off anytime.
        </Text>
      </View>
    </Screen>
  );
}

function ControlRow({ label, on, last }: { label: string; on: boolean; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text style={styles.label}>{label}</Text>
      <StatusBadge label={on ? 'ON' : 'OFF'} tone={on ? 'success' : 'neutral'} dot />
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm + 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  label: { ...font.body, color: colors.subtext },
  infoBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: 16,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  infoText: { ...font.small, color: colors.subtext, flex: 1, lineHeight: 19 },
  bold: { fontWeight: '800', color: colors.primary },
});
