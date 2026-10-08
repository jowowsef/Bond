import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { InfoCard } from '@/components/InfoCard';
import { PartnerPair } from '@/components/PartnerCard';
import { PersonStatRow } from '@/components/PersonStatRow';
import { ScreenTimeCard } from '@/components/ScreenTimeCard';
import { Screen } from '@/components/Screen';
import { SectionHeader } from '@/components/SectionHeader';
import { StatusBadge } from '@/components/StatusBadge';
import { usePartnerPresence } from '@/hooks/usePresence';
import { MOCK_ME, MOCK_PARTNER } from '@/lib/placeholders';
import { colors, font, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * HOME — the couple's overview.
 *
 * The two people and their names are REAL (from the couple). The numbers
 * (screen time, battery, location, protection) are PLACEHOLDERS for now and
 * are clearly marked "Example data" — real values arrive in later phases.
 */
export default function Home() {
  const { myProfile, partnerProfile, partnerId } = useCouple();
  const myName = myProfile?.display_name ?? 'You';
  const partnerName = partnerProfile?.display_name ?? 'Partner';
  const partnerStatus = usePartnerPresence(partnerId);

  return (
    <Screen title="Us ❤️" subtitle="Your shared space">
      <Card style={styles.pairCard} tint={colors.card}>
        <PartnerPair myName={myName} partnerName={partnerName} partnerStatus={partnerStatus} />
      </Card>

      <View style={styles.exampleNote}>
        <Text style={styles.exampleText}>Showing example data — live stats come in a later update.</Text>
      </View>

      <SectionHeader title="Screen Time" />
      <ScreenTimeCard
        myLabel={myName}
        partnerLabel={partnerName}
        myText={MOCK_ME.screenTime}
        partnerText={MOCK_PARTNER.screenTime}
        myFraction={MOCK_ME.screenFraction}
      />

      <SectionHeader title="Battery" />
      <InfoCard icon="battery-half" title="Battery" accent={colors.success} accentBg={colors.successSoft}>
        <PersonStatRow
          who={myName}
          value={`${MOCK_ME.battery}%`}
          badge={MOCK_ME.charging ? <StatusBadge label="Charging" tone="success" /> : undefined}
        />
        <PersonStatRow
          who={partnerName}
          value={`${MOCK_PARTNER.battery}%`}
          badge={MOCK_PARTNER.charging ? <StatusBadge label="Charging" tone="success" /> : undefined}
          last
        />
      </InfoCard>

      <SectionHeader title="Location" />
      <InfoCard icon="location" title="Location" accent={colors.blue} accentBg={colors.blueSoft}>
        <PersonStatRow
          who={myName}
          value={MOCK_ME.locationPlace}
          valueColor={MOCK_ME.locationSharing ? colors.text : colors.muted}
          badge={<StatusBadge label={MOCK_ME.locationSharing ? 'ON' : 'OFF'} tone={MOCK_ME.locationSharing ? 'blue' : 'neutral'} />}
        />
        <PersonStatRow
          who={partnerName}
          value={MOCK_PARTNER.locationPlace}
          badge={<StatusBadge label={MOCK_PARTNER.locationSharing ? 'ON' : 'OFF'} tone={MOCK_PARTNER.locationSharing ? 'blue' : 'neutral'} />}
          last
        />
      </InfoCard>

      <SectionHeader title="Protection" />
      <InfoCard icon="shield-checkmark" title="Protection" accent={colors.primary} accentBg={colors.primarySoft}>
        <PersonStatRow
          who={myName}
          value={MOCK_ME.protection}
          valueColor={MOCK_ME.protectionOn ? colors.text : colors.muted}
          badge={<StatusBadge label={MOCK_ME.protectionOn ? 'ON' : 'OFF'} tone={MOCK_ME.protectionOn ? 'primary' : 'neutral'} />}
        />
        <PersonStatRow
          who={partnerName}
          value={MOCK_PARTNER.protectionOn ? 'Adult websites' : 'None'}
          badge={<StatusBadge label={MOCK_PARTNER.protectionOn ? 'ON' : 'OFF'} tone={MOCK_PARTNER.protectionOn ? 'primary' : 'neutral'} />}
          last
        />
      </InfoCard>

      <View style={{ height: spacing.xl }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  pairCard: { paddingVertical: spacing.xl },
  exampleNote: {
    marginTop: spacing.lg,
    backgroundColor: colors.warningSoft,
    borderRadius: 14,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  exampleText: { ...font.small, color: '#8a5a12', textAlign: 'center' },
});
