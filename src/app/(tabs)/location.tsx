import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { StyleSheet, Switch, Text, View } from 'react-native';
import { InfoCard } from '@/components/InfoCard';
import { Screen } from '@/components/Screen';
import { StatusBadge } from '@/components/StatusBadge';
import { MOCK_ME, MOCK_PARTNER } from '@/lib/placeholders';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * LOCATION — UI only for this phase.
 *
 * The sharing switch updates local UI state so you can see how it feels, but
 * it does NOT request permissions or send any location yet. A map placeholder
 * stands in for the real map that arrives with the location phase.
 */
export default function Location() {
  const { myProfile, partnerProfile } = useCouple();
  const myName = myProfile?.display_name ?? 'You';
  const partnerName = partnerProfile?.display_name ?? 'Partner';
  const [sharing, setSharing] = useState(MOCK_ME.locationSharing);

  return (
    <Screen title="Location" subtitle="Share where you are, together">
      <View style={styles.mapPlaceholder}>
        <Ionicons name="map-outline" size={40} color={colors.primary} />
        <Text style={styles.mapText}>Map coming soon</Text>
        <Text style={styles.mapSub}>An open-source map will show both pins here.</Text>
      </View>

      <InfoCard icon="navigate" title="My Location" accent={colors.blue} accentBg={colors.blueSoft}>
        <View style={styles.switchRow}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>Location sharing</Text>
            <Text style={styles.rowSub}>{sharing ? 'Your partner can see your location.' : 'Your location is private.'}</Text>
          </View>
          <Switch
            value={sharing}
            onValueChange={setSharing}
            trackColor={{ true: colors.primary, false: colors.border }}
            thumbColor="#fff"
          />
        </View>
        <Row label="Last updated" value={sharing ? 'Just now (example)' : '—'} />
      </InfoCard>

      <View style={{ height: spacing.md }} />

      <InfoCard icon="person" title={partnerName} accent={colors.primary} accentBg={colors.primarySoft}>
        <Row
          label="Location"
          value={MOCK_PARTNER.locationPlace}
          badge={<StatusBadge label={MOCK_PARTNER.locationSharing ? 'Shared' : 'Off'} tone={MOCK_PARTNER.locationSharing ? 'blue' : 'neutral'} />}
        />
        <Row label="Last updated" value={MOCK_PARTNER.locationAgo} last />
      </InfoCard>

      <Text style={styles.note}>
        Nothing is tracked yet. Real, permission-based location sharing comes in a later update.
      </Text>
    </Screen>
  );
}

function Row({ label, value, badge, last }: { label: string; value: string; badge?: React.ReactNode; last?: boolean }) {
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <Text style={styles.rowLabel}>{label}</Text>
      <View style={styles.rowRight}>
        {badge}
        <Text style={styles.rowValue}>{value}</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  mapPlaceholder: {
    height: 200,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.lg,
  },
  mapText: { ...font.h3, color: colors.primary, marginTop: spacing.sm },
  mapSub: { ...font.small, color: colors.subtext, marginTop: 2 },
  switchRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm },
  rowTitle: { ...font.h3, fontWeight: '600', color: colors.text },
  rowSub: { ...font.small, color: colors.muted, marginTop: 2, paddingRight: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.sm + 2 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  rowLabel: { ...font.body, color: colors.subtext },
  rowRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowValue: { ...font.h3, fontWeight: '600', color: colors.text },
  note: { ...font.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
});
