import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Animated, Easing, Image, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { colors, themedStyles, useThemeVersion } from '@/lib/theme';

const MARK = require('../../assets/bond-mark.png');

type Person = { name?: string | null; url?: string | null; tint?: string };

/**
 * The two of you, side by side.
 *  - variant "apart": two circles joined by a dotted line, with Bond's heart
 *    in the middle (Home). `partner` null = an empty dashed circle (waiting
 *    for the partner to join). With `waiting`, the dots travel and the empty
 *    circle gently pulses, so the screen feels alive while you wait.
 *  - variant "together": the two circles overlapping, with the heart below
 *    (just paired).
 * A name of "Me" (not chosen yet) shows a person icon instead of "M".
 */
export function CoupleAvatars({
  me,
  partner,
  variant = 'apart',
  size = 72,
  waiting = false,
}: {
  me: Person;
  partner: Person | null;
  variant?: 'apart' | 'together';
  size?: number;
  /** Only with a null partner: animate the dots and the empty circle. */
  waiting?: boolean;
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

  const animate = waiting && !partner;

  return (
    <View style={styles.apart} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <Circle person={me} size={size} tint={me.tint ?? colors.me} />
      <View style={styles.link}>
        {animate ? <TravellingDots /> : (
          <View style={styles.dots}>
            {[0, 1, 2].map((i) => (
              <View key={i} style={[styles.dot, { backgroundColor: i === 2 ? colors.partner : colors.me }]} />
            ))}
          </View>
        )}
        {partner ? (
          <View style={[styles.heartSmall, { width: heart * 0.8, height: heart * 0.8, borderRadius: heart * 0.4 }]}>
            <Image source={MARK} style={{ width: heart * 0.46, height: heart * 0.4 }} resizeMode="contain" />
          </View>
        ) : null}
      </View>
      {partner ? (
        <Circle person={partner} size={size} tint={partner.tint ?? colors.partner} />
      ) : (
        <PulsingEmpty size={size} animate={animate} />
      )}
    </View>
  );
}

/** Three dots that light up one after another, like "…connecting". */
function TravellingDots() {
  useThemeVersion();
  const [progress] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(progress, { toValue: 3, duration: 1200, easing: Easing.linear, useNativeDriver: true }),
    );
    loop.start();
    return () => loop.stop();
  }, [progress]);
  return (
    <View style={styles.dots}>
      {[0, 1, 2].map((i) => {
        // Each dot peaks as the travelling value passes its index.
        const opacity = progress.interpolate({
          inputRange: [i - 1, i, i + 1, i + 2.99].map((v) => (v + 3) % 3),
          outputRange: [0.3, 1, 0.3, 0.3],
          extrapolate: 'clamp',
        });
        const scale = progress.interpolate({
          inputRange: [i - 1, i, i + 1, i + 2.99].map((v) => (v + 3) % 3),
          outputRange: [1, 1.5, 1, 1],
          extrapolate: 'clamp',
        });
        return (
          <Animated.View
            key={i}
            style={[styles.dot, { backgroundColor: i === 2 ? colors.partner : colors.me, opacity, transform: [{ scale }] }]}
          />
        );
      })}
    </View>
  );
}

/** The empty partner circle, gently breathing while you wait. */
function PulsingEmpty({ size, animate }: { size: number; animate: boolean }) {
  useThemeVersion();
  const [pulse] = useState(() => new Animated.Value(0));
  useEffect(() => {
    if (!animate) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [animate, pulse]);
  const scale = pulse.interpolate({ inputRange: [0, 1], outputRange: [1, 1.08] });
  const opacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1] });
  return (
    <Animated.View
      style={[
        styles.empty,
        { width: size, height: size, borderRadius: size / 2 },
        animate ? { transform: [{ scale }], opacity } : null,
      ]}
    >
      <Ionicons name="person-outline" size={size * 0.34} color={colors.pink} />
    </Animated.View>
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
