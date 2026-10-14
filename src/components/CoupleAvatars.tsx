import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, Text, View } from 'react-native';
import { Avatar } from '@/components/Avatar';
import { colors, font, themedStyles, useThemeVersion } from '@/lib/theme';

const MARK = require('../../assets/bond-mark.png');

type Person = {
  name?: string | null;
  url?: string | null;
  tint?: string;
  /** Shown under the circle (for example "You" and a battery line). */
  label?: string;
  sub?: string | null;
};

/**
 * The two of you, side by side.
 *  - variant "apart": two circles joined by a dotted line, with Bond's heart
 *    in the middle (Home). Each person's label sits centered under their own
 *    circle. `partner` null = an empty dashed circle (waiting for the partner
 *    to join); with `animated`, it gently pulses and the dots move.
 *  - variant "together": the two circles overlapping, with the heart below
 *    (just paired).
 * A name of "Me" (not chosen yet) shows a person icon instead of "M".
 * Animations stop when the phone's "Reduce motion" setting is on.
 */
export function CoupleAvatars({
  me,
  partner,
  variant = 'apart',
  size = 72,
  animated = false,
}: {
  me: Person;
  partner: Person | null;
  variant?: 'apart' | 'together';
  size?: number;
  animated?: boolean;
}) {
  useThemeVersion();
  const heart = Math.round(size * 0.42);
  const t = useLoop(animated);

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

  // Waiting animation: my circle "breathes", the dots light up in turn, and
  // the empty circle pulses with a soft ring.
  const breathe = t ? t.interpolate({ inputRange: [0, 0.5, 1], outputRange: [1, 1.04, 1] }) : 1;
  const ringScale = t ? t.interpolate({ inputRange: [0, 1], outputRange: [1, 1.35] }) : 1;
  const ringOpacity = t ? t.interpolate({ inputRange: [0, 0.7, 1], outputRange: [0.5, 0.1, 0] }) : 0;

  return (
    <View style={styles.apart} accessibilityElementsHidden importantForAccessibility="no-hide-descendants">
      <View style={[styles.column, { width: size + 40 }]}>
        <Animated.View style={{ transform: [{ scale: breathe }] }}>
          <Circle person={me} size={size} tint={me.tint ?? colors.me} />
        </Animated.View>
        <Labels person={me} />
      </View>

      <View style={[styles.link, { height: size + 6 }]}>
        <View style={styles.dots}>
          {[0, 1, 2].map((i) => (
            <Animated.View
              key={i}
              style={[
                styles.dot,
                { backgroundColor: i === 2 ? colors.partner : colors.me },
                t
                  ? {
                      opacity: t.interpolate({
                        inputRange: [0, (i + 0.5) / 4, (i + 1.5) / 4, 1],
                        outputRange: [0.3, 1, 0.3, 0.3],
                        extrapolate: 'clamp',
                      }),
                    }
                  : null,
              ]}
            />
          ))}
        </View>
        {partner ? (
          <View style={[styles.heartSmall, { width: heart * 0.8, height: heart * 0.8, borderRadius: heart * 0.4 }]}>
            <Image source={MARK} style={{ width: heart * 0.46, height: heart * 0.4 }} resizeMode="contain" />
          </View>
        ) : null}
      </View>

      <View style={[styles.column, { width: size + 40 }]}>
        {partner ? (
          <Circle person={partner} size={size} tint={partner.tint ?? colors.partner} />
        ) : (
          <View style={{ width: size + 6, height: size + 6, alignItems: 'center', justifyContent: 'center' }}>
            {t ? (
              <Animated.View
                style={[
                  styles.pulse,
                  { width: size, height: size, borderRadius: size / 2, opacity: ringOpacity, transform: [{ scale: ringScale }] },
                ]}
              />
            ) : null}
            <View style={[styles.empty, { width: size, height: size, borderRadius: size / 2 }]}>
              <Ionicons name="person-outline" size={size * 0.34} color={colors.pink} />
            </View>
          </View>
        )}
        {partner ? <Labels person={partner} /> : null}
      </View>
    </View>
  );
}

function Labels({ person }: { person: Person }) {
  useThemeVersion();
  if (!person.label && !person.sub) return null;
  return (
    <>
      {person.label ? (
        <Text style={styles.label} numberOfLines={1}>
          {person.label}
        </Text>
      ) : null}
      {person.sub ? (
        <Text style={styles.sub} numberOfLines={1}>
          {person.sub}
        </Text>
      ) : null}
    </>
  );
}

/** A 0→1 loop (about 2 s) while `on`, or null (no animation / Reduce motion). */
function useLoop(on: boolean): Animated.Value | null {
  const [value] = React.useState(() => new Animated.Value(0));
  const [reduce, setReduce] = React.useState(false);
  useEffect(() => {
    let alive = true;
    void AccessibilityInfo.isReduceMotionEnabled().then((r) => alive && setReduce(r));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduce);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);
  const running = on && !reduce;
  useEffect(() => {
    if (!running) return;
    const loop = Animated.loop(
      Animated.timing(value, { toValue: 1, duration: 2000, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
    );
    loop.start();
    return () => {
      loop.stop();
      value.setValue(0);
    };
  }, [running, value]);
  return running ? value : null;
}

function Circle({ person, size, tint }: { person: Person; size: number; tint: string }) {
  useThemeVersion();
  return (
    <View style={[styles.ring, { width: size + 6, height: size + 6, borderRadius: (size + 6) / 2 }]}>
      <Avatar name={person.name} url={person.url} size={size} tint={tint} />
    </View>
  );
}

const styles = themedStyles(() => ({
  apart: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  column: { alignItems: 'center' },
  together: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
  ring: { backgroundColor: colors.card, alignItems: 'center', justifyContent: 'center' },
  link: { width: 44, alignItems: 'center', justifyContent: 'center' },
  dots: { flexDirection: 'row', gap: 4 },
  dot: { width: 5, height: 5, borderRadius: 3 },
  label: { ...font.h3, fontSize: 15, color: colors.text, marginTop: 6, textAlign: 'center' },
  sub: { ...font.tiny, color: colors.subtext, marginTop: 1, letterSpacing: 0, textAlign: 'center' },
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
  pulse: { position: 'absolute', backgroundColor: colors.pink },
  empty: {
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: colors.pink,
    backgroundColor: colors.pinkSoft,
    alignItems: 'center',
    justifyContent: 'center',
  },
}));
