import React from 'react';
import { Image, Text, View } from 'react-native';
import { colors, fontFamily, themedStyles, useThemeVersion } from '@/lib/theme';

// The split-heart mark (transparent background), generated from
// assets/bond-icon.png so the app logo and the launcher icon match.
const MARK = require('../../assets/bond-mark.png');
const MARK_RATIO = 676 / 590; // width / height of bond-mark.png

/**
 * The Bond logo: the split heart + the "bond" wordmark.
 *   layout="row"    → small header logo (heart left, word right)
 *   layout="column" → big centered logo for Welcome / loading
 * `size` is the height of the heart in points.
 */
export function BondLogo({
  size = 26,
  layout = 'row',
  showWordmark = true,
}: {
  size?: number;
  layout?: 'row' | 'column';
  showWordmark?: boolean;
}) {
  useThemeVersion();
  const isRow = layout === 'row';
  const wordSize = isRow ? Math.round(size * 0.92) : Math.round(size * 0.46);

  return (
    <View style={isRow ? styles.row : styles.column} accessibilityRole="image" accessibilityLabel="Bond">
      <Image source={MARK} style={{ height: size, width: size * MARK_RATIO }} resizeMode="contain" />
      {showWordmark ? (
        <Text
          style={[
            styles.word,
            { fontSize: wordSize, letterSpacing: -wordSize * 0.03 },
            isRow ? { marginLeft: size * 0.3 } : { marginTop: size * 0.18 },
          ]}
        >
          bond
        </Text>
      ) : null}
    </View>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', alignItems: 'center' },
  column: { alignItems: 'center' },
  word: { fontFamily, fontWeight: '800', color: colors.text },
}));
