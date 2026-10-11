import React from 'react';
import { ActivityIndicator, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { colors, fontFamily, radius, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * A full-width sign-in button (Welcome screen). The icon sits at the far
 * left; the label is centered on the WHOLE button. Equal padding on both
 * sides keeps room for the icon, so they can't overlap on narrow screens.
 */
export const AUTH_BUTTON_ICON = 22;
/** Text / icon color for the always-white "light" button (readable in both themes). */
export const AUTH_LIGHT_FG = '#1F2A44';

export function AuthButton({
  label,
  icon,
  onPress,
  variant = 'primary',
  loading = false,
  disabled = false,
  style,
  accessibilityLabel,
  accessibilityHint,
}: {
  label: string;
  /** Rendered at the left edge, about AUTH_BUTTON_ICON points square. */
  icon: React.ReactNode;
  onPress?: () => void;
  /** primary = brand blue; outline = card color (follows the theme); light = always white. */
  variant?: 'primary' | 'outline' | 'light';
  loading?: boolean;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityHint?: string;
}) {
  useThemeVersion();
  const fg = variant === 'primary' ? colors.onPrimary : variant === 'light' ? AUTH_LIGHT_FG : colors.text;
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityHint={accessibilityHint}
      accessibilityState={{ disabled: disabled || loading, busy: loading }}
      style={({ pressed }) => [
        styles.base,
        styles[variant],
        { opacity: disabled ? 0.5 : 1, transform: [{ scale: pressed ? 0.98 : 1 }] },
        style,
      ]}
    >
      <View style={styles.icon} pointerEvents="none">
        {icon}
      </View>
      {loading ? (
        <ActivityIndicator color={fg} />
      ) : (
        <Text style={[styles.text, { color: fg }]} numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85}>
          {label}
        </Text>
      )}
    </Pressable>
  );
}

const SIDE = 20; // icon inset from the left edge
const RESERVED = SIDE + AUTH_BUTTON_ICON + 12; // space kept free on BOTH sides for centered text

const styles = themedStyles(() => ({
  base: {
    height: 54,
    borderRadius: radius.md,
    alignSelf: 'stretch',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: RESERVED,
  },
  primary: { backgroundColor: colors.primary },
  outline: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  light: { backgroundColor: '#FFFFFF', borderWidth: 1, borderColor: '#DADCE0' },
  icon: {
    position: 'absolute',
    left: SIDE,
    top: 0,
    bottom: 0,
    width: AUTH_BUTTON_ICON,
    alignItems: 'center',
    justifyContent: 'center',
  },
  text: { fontFamily, fontSize: 16, fontWeight: '700', letterSpacing: -0.2, textAlign: 'center' },
}));
