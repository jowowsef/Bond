import React from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials } from '@/lib/format';
import { colors } from '@/lib/theme';

/**
 * A round profile picture. If there's no image URL we show the person's
 * initials on a soft lavender circle instead.
 */
export function Avatar({
  name,
  url,
  size = 56,
  ring,
}: {
  name?: string | null;
  url?: string | null;
  size?: number;
  ring?: string;
}) {
  const ringStyle = ring ? { borderWidth: 3, borderColor: ring } : null;
  const base = { width: size, height: size, borderRadius: size / 2 };

  if (url) {
    return <Image source={{ uri: url }} style={[base, ringStyle]} />;
  }
  return (
    <View style={[base, styles.fallback, ringStyle]}>
      <Text style={{ color: colors.primary, fontWeight: '800', fontSize: size * 0.38 }}>{initials(name)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: {
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
