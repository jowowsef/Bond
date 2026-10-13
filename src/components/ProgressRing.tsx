import React from 'react';
import { View } from 'react-native';
import { colors, useThemeVersion } from '@/lib/theme';

/**
 * A simple ring (no SVG library): the track is a full circle border, and the
 * filled part is drawn with two half circles rotated into place.
 * `progress` is 0..1, filled clockwise from the top.
 */
export function ProgressRing({
  progress,
  size = 44,
  thickness = 5,
  color,
  children,
}: {
  progress: number;
  size?: number;
  thickness?: number;
  color: string;
  children?: React.ReactNode;
}) {
  useThemeVersion();
  const p = Math.max(0, Math.min(1, Number.isFinite(progress) ? progress : 0));
  const half = size / 2;
  const circle = { width: size, height: size, borderRadius: half, borderWidth: thickness };
  // Each half shows up to 180°. Right half first (0..0.5), then the left (0.5..1).
  const rightDeg = Math.min(p, 0.5) * 360;
  const leftDeg = Math.max(p - 0.5, 0) * 360;

  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={[circle, { position: 'absolute', borderColor: colors.track }]} />
      {/* Right half: a clip of the right side, holding a half ring that rotates in. */}
      <View style={{ position: 'absolute', width: half, height: size, left: half, overflow: 'hidden' }}>
        <View
          style={[
            circle,
            {
              position: 'absolute',
              left: -half,
              borderColor: 'transparent',
              borderLeftColor: color,
              borderBottomColor: color,
              transform: [{ rotate: `${rightDeg - 315}deg` }],
              opacity: p > 0 ? 1 : 0,
            },
          ]}
        />
      </View>
      {/* Left half */}
      <View style={{ position: 'absolute', width: half, height: size, left: 0, overflow: 'hidden' }}>
        <View
          style={[
            circle,
            {
              position: 'absolute',
              left: 0,
              borderColor: 'transparent',
              borderRightColor: color,
              borderTopColor: color,
              transform: [{ rotate: `${45 + leftDeg}deg` }],
              opacity: p > 0.5 ? 1 : 0,
            },
          ]}
        />
      </View>
      {children}
    </View>
  );
}
