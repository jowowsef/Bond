import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials } from '@/lib/format';
import { colors, fontFamily } from '@/lib/theme';

/**
 * A round profile picture. If there's no image URL we show the person's
 * initials instead. Pass `tint` to colour the circle (e.g. sky blue for
 * you, blush pink for your partner); without it we use the soft primary.
 */
export function Avatar({
  name,
  url,
  size = 56,
  ring,
  tint,
}: {
  name?: string | null;
  url?: string | null;
  size?: number;
  ring?: string;
  tint?: string;
}) {
  const ringStyle = ring ? { borderWidth: 2, borderColor: ring } : null;
  const base = { width: size, height: size, borderRadius: size / 2 };

  if (url) {
    return <Image source={{ uri: url }} style={[base, ringStyle]} />;
  }
  return (
    <View style={[base, styles.fallback, { backgroundColor: tint ?? colors.primarySoft }, ringStyle]}>
      <Text
        style={{
          fontFamily,
          fontWeight: '700',
          fontSize: size * 0.38,
          color: tint ? colors.text : colors.primary,
        }}
      >
        {initials(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center' },
});
