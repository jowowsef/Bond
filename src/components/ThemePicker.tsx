import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import {
  colors,
  font,
  getThemePreference,
  radius,
  setThemePreference,
  spacing,
  themeChoiceAvailable,
  themedStyles,
  type ThemePreference,
  useThemeVersion,
} from '@/lib/theme';

const OPTIONS: { key: ThemePreference; label: string; icon: React.ComponentProps<typeof Ionicons>['name'] }[] = [
  { key: 'system', label: 'System', icon: 'phone-portrait-outline' },
  { key: 'light', label: 'Light', icon: 'sunny-outline' },
  { key: 'dark', label: 'Dark', icon: 'moon-outline' },
];

/**
 * Light / Dark / System default. The choice is saved on this phone and
 * applied immediately to every screen, without reloading Bond.
 */
export function ThemePicker() {
  useThemeVersion();
  const [error, setError] = useState<string | null>(null);
  const current = getThemePreference();

  function choose(pref: ThemePreference) {
    if (pref === current) return;
    setError(null);
    try {
      if (!setThemePreference(pref)) setError('Theme choice needs the latest version of Bond on this phone.');
    } catch {
      setError('Could not change the theme. Please try again.');
    }
  }

  return (
    <Card>
      <View style={styles.row} accessibilityRole="radiogroup">
        {OPTIONS.map((o) => {
          const selected = current === o.key;
          return (
            <Pressable
              key={o.key}
              onPress={() => choose(o.key)}
              disabled={!themeChoiceAvailable}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled: !themeChoiceAvailable }}
              accessibilityLabel={o.key === 'system' ? 'System default' : o.label}
              style={[styles.option, selected && styles.optionSelected, !themeChoiceAvailable && styles.disabled]}
            >
              <Ionicons name={o.icon} size={20} color={selected ? colors.primary : colors.subtext} />
              <Text style={[styles.label, selected && styles.labelSelected]}>{o.label}</Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.hint}>
        {themeChoiceAvailable
          ? "System follows your phone's light or dark setting. Your choice is saved on this phone."
          : 'Bond follows your phone\'s light or dark setting. Choosing a theme needs the newest version of Bond.'}
      </Text>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

const styles = themedStyles(() => ({
  row: { flexDirection: 'row', gap: spacing.sm },
  option: {
    flex: 1,
    minHeight: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  optionSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  disabled: { opacity: 0.5 },
  label: { ...font.small, fontWeight: '600', color: colors.subtext },
  labelSelected: { color: colors.primary, fontWeight: '700' },
  hint: { ...font.small, color: colors.muted, lineHeight: 18, marginTop: spacing.md },
  error: { ...font.small, color: colors.danger, marginTop: spacing.sm },
}));
