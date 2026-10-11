import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Image, Text, View } from 'react-native';
import { formatDuration } from '@/lib/format';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * An app's real launcher icon (from useAppIcons), or a neutral placeholder
 * when this phone has no icon for it. Never a made-up or shared icon.
 */
export function AppIcon({ uri, size = 32 }: { uri: string | null | undefined; size?: number }) {
  useThemeVersion();
  const box = { width: size, height: size, borderRadius: size * 0.28 };
  if (uri) return <Image source={{ uri }} style={box} resizeMode="contain" accessibilityIgnoresInvertColors />;
  return (
    <View style={[box, styles.placeholder]}>
      <Ionicons name="apps-outline" size={size * 0.5} color={colors.subtext} />
    </View>
  );
}

/**
 * One app in a usage list: icon, name, optional detail line, duration.
 * `share` (0..1) draws a thin bar under the name, relative to the top app.
 */
export function AppUsageRow({
  name,
  iconUri,
  ms,
  detail,
  share,
  barColor = colors.me,
  last,
}: {
  name: string;
  iconUri: string | null | undefined;
  ms: number;
  detail?: string;
  share?: number;
  barColor?: string;
  last?: boolean;
}) {
  useThemeVersion();
  return (
    <View style={[styles.row, !last && styles.divider]}>
      <AppIcon uri={iconUri} />
      <View style={styles.middle}>
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {detail ? (
          <Text style={styles.detail} numberOfLines={1}>
            {detail}
          </Text>
        ) : null}
        {share != null ? (
          <View style={styles.track}>
            <View style={[styles.fill, { width: `${Math.max(2, Math.min(1, share) * 100)}%`, backgroundColor: barColor }]} />
          </View>
        ) : null}
      </View>
      <Text style={styles.time}>{formatDuration(ms)}</Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  placeholder: { backgroundColor: colors.track, alignItems: 'center', justifyContent: 'center' },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.sm + 2, gap: spacing.md },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.border },
  middle: { flex: 1, minWidth: 0 },
  name: { ...font.body, fontWeight: '600', color: colors.text },
  detail: { ...font.small, color: colors.muted, marginTop: 1 },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: colors.track, marginTop: 6, overflow: 'hidden' },
  fill: { height: 4, borderRadius: radius.pill },
  time: { ...font.small, fontWeight: '700', color: colors.subtext, minWidth: 48, textAlign: 'right' },
}));
