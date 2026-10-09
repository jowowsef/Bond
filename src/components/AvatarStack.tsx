import React from 'react';
import { StyleSheet, View } from 'react-native';
import { ProfileAvatar } from './ProfileAvatar';
import { colors } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * Two overlapping avatars — you and your partner — read from the single
 * profile/avatar source of truth (photo or chosen colour). The
 * background-coloured ring makes the overlap look like a clean cut-out.
 */
export function AvatarStack({ size = 36 }: { size?: number }) {
  const { myProfile, partnerProfile } = useCouple();
  return (
    <View style={styles.row}>
      <ProfileAvatar profile={myProfile} who="me" size={size} ring={colors.background} />
      <View style={{ marginLeft: -size * 0.28 }}>
        <ProfileAvatar profile={partnerProfile} who="partner" size={size} ring={colors.background} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center' },
});
