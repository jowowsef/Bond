import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, Text, TextInput, View, type TextInputProps } from 'react-native';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/** Labeled text input used by the sign-in and password screens. */
export function AuthField({ label, ...input }: { label: string } & TextInputProps) {
  useThemeVersion();
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.muted} {...input} style={[styles.input, input.style]} />
    </View>
  );
}

/** Password input with a show / hide button. */
export function PasswordField({
  label = 'Password',
  isNew = false,
  ...input
}: { label?: string; isNew?: boolean } & TextInputProps) {
  useThemeVersion();
  const [visible, setVisible] = useState(false);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <View style={styles.passwordRow}>
        <TextInput
          placeholderTextColor={colors.muted}
          secureTextEntry={!visible}
          autoCapitalize="none"
          autoCorrect={false}
          autoComplete={isNew ? 'new-password' : 'current-password'}
          textContentType={isNew ? 'newPassword' : 'password'}
          {...input}
          style={[styles.input, styles.passwordInput, input.style]}
        />
        <Pressable
          onPress={() => setVisible((v) => !v)}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel={visible ? 'Hide password' : 'Show password'}
          style={styles.eye}
        >
          <Ionicons name={visible ? 'eye-off-outline' : 'eye-outline'} size={20} color={colors.subtext} />
        </Pressable>
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  field: { marginTop: spacing.md },
  label: { ...font.small, color: colors.muted, marginBottom: 6 },
  input: {
    ...font.body,
    color: colors.text,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    backgroundColor: colors.card,
  },
  passwordRow: { flexDirection: 'row', alignItems: 'center' },
  passwordInput: { flex: 1, paddingRight: 44 },
  eye: { position: 'absolute', right: spacing.md, top: 0, bottom: 0, justifyContent: 'center' },
}));
