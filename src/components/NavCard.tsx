import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from './Card';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/**
 * A tappable row card: icon chip, title + subtitle, optional right text, and
 * a chevron. Used for the section shortcuts on Home and elsewhere so every
 * navigable card looks the same.
 */
export function NavCard({
  icon,
  title,
  subtitle,
  right,
  accent = colors.primary,
  accentBg = colors.primarySoft,
  onPress,
}: {
  icon: IconName;
  title: string;
  subtitle?: string;
  right?: string;
  accent?: string;
  accentBg?: string;
  onPress?: () => void;
}) {
  useThemeVersion();
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1 })}>
      <Card style={styles.card}>
        <View style={[styles.iconWrap, { backgroundColor: accentBg }]}>
          <Ionicons name={icon} size={20} color={accent} />
        </View>
        <View style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        </View>
        {right ? <Text style={styles.right}>{right}</Text> : null}
        <Ionicons name="chevron-forward" size={18} color={colors.muted} style={{ marginLeft: spacing.xs }} />
      </Card>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  card: { flexDirection: 'row', alignItems: 'center' },
  iconWrap: {
    width: 40,
    height: 40,
    borderRadius: radius.md,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  text: { flex: 1 },
  title: { ...font.h3, color: colors.text },
  subtitle: { ...font.small, color: colors.subtext, marginTop: 2 },
  right: { ...font.small, fontWeight: '700', color: colors.text },
}));
