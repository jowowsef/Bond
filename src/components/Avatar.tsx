import React, { useEffect, useState } from 'react';
import { Image, StyleSheet, Text, View } from 'react-native';
import { initials } from '@/lib/format';
import { colors, fontFamily, useThemeVersion } from '@/lib/theme';

/**
 * A round profile picture. The person's initials always sit underneath, and
 * the photo (when there is one) is laid on top. So while the photo is still
 * loading, or if its link has expired or fails, you see the initials instead
 * of an empty circle. Pass `tint` to color the circle (e.g. the person's
 * chosen Blue or Pink); without it we use the soft primary.
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
  useThemeVersion();
  const [failed, setFailed] = useState(false);
  // A new photo link gets a fresh chance to load.
  useEffect(() => {
    setFailed(false);
  }, [url]);

  const ringStyle = ring ? { borderWidth: 2, borderColor: ring } : null;
  const base = { width: size, height: size, borderRadius: size / 2 };

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
      {url && !failed ? (
        <Image
          source={{ uri: url }}
          style={[StyleSheet.absoluteFill, { borderRadius: size / 2 }]}
          onError={() => setFailed(true)}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fallback: { alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
});
