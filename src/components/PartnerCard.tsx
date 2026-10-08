import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { PresenceIndicator } from './PresenceIndicator';
import type { PresenceStatus } from '@/lib/presence';
import { colors, font } from '@/lib/theme';

/**
 * The little "me + partner" pair shown at the top of Home.
 * Each person is an avatar and name. The partner also shows a live
 * online / last-active status underneath.
 */
export function PartnerPair({
  myName,
  partnerName,
  myAvatar,
  partnerAvatar,
  partnerStatus,
}: {
  myName: string;
  partnerName: string;
  myAvatar?: string | null;
  partnerAvatar?: string | null;
  partnerStatus?: PresenceStatus;
}) {
  return (
    <View style={styles.row}>
      <Person name={myName} subtitle="You" avatar={myAvatar} />
      <View style={styles.heartWrap}>
        <Text style={styles.heart}>+</Text>
      </View>
      <Person name={partnerName} subtitle="Partner" avatar={partnerAvatar} status={partnerStatus} />
    </View>
  );
}

function Person({
  name,
  subtitle,
  avatar,
  status,
}: {
  name: string;
  subtitle: string;
  avatar?: string | null;
  status?: PresenceStatus;
}) {
  return (
    <View style={styles.person}>
      <Avatar name={name} url={avatar} size={72} ring={colors.card} />
      <Text style={styles.name} numberOfLines={1}>
        {name}
      </Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
      <View style={styles.statusSlot}>
        {status ? <PresenceIndicator state={status.state} label={status.label} /> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  person: { alignItems: 'center', flex: 1 },
  heartWrap: { marginHorizontal: 4, marginTop: -28 },
  heart: { fontSize: 24, color: colors.muted, fontWeight: '300' },
  name: { ...font.h3, color: colors.text, marginTop: 10, maxWidth: 130, textAlign: 'center' },
  subtitle: { ...font.small, color: colors.muted },
  statusSlot: { marginTop: 6, minHeight: 18, justifyContent: 'center' },
});
