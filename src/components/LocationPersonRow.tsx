import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { ProfileAvatar } from './ProfileAvatar';
import type { LocationStatusKind, PersonLocation } from '@/hooks/useCoupleLocations';
import { colors, font, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * One person's line in a location panel: avatar, name, and a single status
 * line (for example "Live · Diliman" or "Last updated 25 min ago"). The status
 * is shown once here, never repeated as a separate On/Off label.
 */
const DOT: Record<LocationStatusKind, string> = {
  live: colors.success,
  recent: colors.me,
  stale: colors.warning,
  waiting: colors.muted,
  off: colors.border,
};

export function LocationPersonRow({
  who,
  person,
  sub,
  right,
  onPress,
}: {
  who: 'me' | 'partner';
  person: PersonLocation;
  /** Replaces the status line (e.g. "Your location is private"). */
  sub?: string;
  right?: React.ReactNode;
  onPress?: () => void;
}) {
  const { myProfile, partnerProfile } = useCouple();
  const profile = who === 'me' ? myProfile : partnerProfile;
  const name = who === 'me' ? 'You' : profile?.display_name ?? 'Partner';

  const status = sub ?? (person.place && person.status !== 'off' && person.status !== 'waiting'
    ? `${person.statusLabel} · ${person.place}`
    : person.statusLabel);

  const body = (
    <View style={styles.row}>
      <ProfileAvatar profile={profile} who={who} size={40} />
      <View style={styles.text}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        <View style={styles.statusRow}>
          {sub ? null : <View style={[styles.dot, { backgroundColor: DOT[person.status] }]} />}
          <Text style={[styles.status, person.status === 'live' && !sub ? styles.statusLive : null]} numberOfLines={1}>
            {status}
          </Text>
        </View>
      </View>
      {right}
    </View>
  );

  if (!onPress) return body;
  return (
    <Pressable onPress={onPress} style={({ pressed }) => (pressed ? styles.pressed : null)}>
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, gap: spacing.md },
  text: { flex: 1, minWidth: 0 },
  name: { ...font.h3, color: colors.text },
  statusRow: { flexDirection: 'row', alignItems: 'center', marginTop: 2 },
  dot: { width: 7, height: 7, borderRadius: 4, marginRight: 6 },
  status: { ...font.small, color: colors.subtext, flexShrink: 1 },
  statusLive: { color: colors.success, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
