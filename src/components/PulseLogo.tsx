import React, { useEffect, useState } from 'react';
import { Animated, Easing } from 'react-native';
import { useThemeVersion } from '@/lib/theme';

const MARK = require('../../assets/bond-mark.png');

/**
 * The Bond heart, gently beating. A calmer loading indicator than a spinner,
 * used while the app restores a session or generates a pairing code.
 */
export function PulseLogo({ size = 56 }: { size?: number }) {
  useThemeVersion();
  const [beat] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(beat, { toValue: 1, duration: 650, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        Animated.timing(beat, { toValue: 0, duration: 650, easing: Easing.in(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [beat]);
  const scale = beat.interpolate({ inputRange: [0, 1], outputRange: [1, 1.18] });
  const opacity = beat.interpolate({ inputRange: [0, 1], outputRange: [0.75, 1] });
  return (
    <Animated.Image
      source={MARK}
      resizeMode="contain"
      accessibilityLabel="Loading"
      style={{ width: size, height: size * (590 / 676), transform: [{ scale }], opacity }}
    />
  );
}
