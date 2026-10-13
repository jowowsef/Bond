import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { colors, themedStyles, useThemeVersion } from '@/lib/theme';

const MARK = require('../../assets/bond-mark.png');

type Person = { name?: string | null; url?: string | null; tint?: string };

/**
 * The two of you, side by side.
 *  - variant "apart": two circles joined by a dotted line, with Bond's heart
 *    in the middle (Home). `partner` null = an empty dashed circle (waiting
 *    for the partner to join).
 *  - variant "together": the two circles overlapping, with the heart below
 *    (just paired).
 * A name of "Me" (not chosen yet) shows a person icon instead of "M".
 */
export function CoupleAvatars({
  me,
  partner,
  variant = 'apart',
  size = 72,
}: {
  me: Person;
  partner: Person | null;
  variant?: 'apart' | 'together';
  size?: number;
}) {
  useThemeVersion();
  const heart = Math.round(size * 0.42);

  if (variant === 'together') {
    return (
      <View style={[styles.together, { height: size + heart / 2 }]} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
        <Circle person={me} size={size} tint={me.tint ?? colors.me} />
        <View style={{ marginLeft: -size * 0.22 }}>
          <Circle person={partner ?? {}} size={size} tint={partner?.tint ?? colors.partner} />
        </View>
        <View style={[styles.heartBadge, { width: heart, height: heart, borderRadius: heart / 2, bottom: 0, marginLeft: -heart / 2 }]}>
          <Image source={MARK} style={{ width: heart * 0.62, height: heart * 0.55 }} resizeMode="contain" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.apart} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle person={me} size={size} tint={me.tint ?? colors.me} />
      <View style={styles.link}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <View key={i} style={[styles.dot, { backgroundColor: i === 2 ? colors.partner : colors.me }]} />
          ))}
        </View>
        {partner ? (
          <View style={[styles.heartSmall, { width: heart * 0.8, height: heart * 0.8, borderRadius: heart * 0.4 }]}>
            <Image source={MARK} style={{ width: heart * 0.46, height: heart * 0.4 }} resizeMode="contain" />
          </View>
        ) : null}
      </View>
      {partner ? (
        <Circle person={partner} size={size} tint={partner.tint ?? colors.partner} />
      ) : (
        <View style={[styles.empty, { width: size, height: size, borderRadius: size / 2 }]}>
          <Ionicons name="person-outline" size={size * 0.34} color={colors.pink} />
        </View>
      )}
    </View>
  );
}

function Circle({ person, size, tint }: { person: Person; size: number; tint: string }) {
  useThemeVersion();
  const unnamed = !person.name || person.name.trim() === 'Me';
  if (unnamed && !person.url) {
    return (
      <View style={[styles.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
        <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: tint, alignItems: 'center', justifyContent: 'center' }}>
          <Ionicons name="person" size={size * 0.38} color={colors.text} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
      <Avatar name={person.name} url={person.url} size={size} tint={tint} />
    </View>
  );
}

const styles = themedStyles(() => ({
  apart: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  together: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  ring: { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  link: { width: 64, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 5 },
  dot: { width: 6, height: 6, borderRadius: 3 },
  heartSmall: {
    position: 'absolute',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  heartBadge: {
    position: 'absolute',
    alignSelf: 'center',
    left: '50%',
    backgroundColor: colors.card,
    borderWidth: 2,
    borderColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  empty: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.pink,
    backgroundColor: colors.pinkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
