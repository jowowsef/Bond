import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import React, { useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { AVATAR_CHOICES, type AvatarColor } from '@/lib/avatar';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * POST-PAIRING STEP 2 — "Choose your color".
 *
 * Saves the chosen colour to profiles.avatar_color (the user's own choice —
 * never derived from pairing order, name, or device). Then continues to the
 * "You're all set!" screen.
 */
export default function ColorSetup() {
  const router = useRouter();
  const { phase, userId, myProfile, profileStep, refresh } = useCouple();
  const [selected, setSelected] = useState<AvatarColor | null>(
    myProfile?.avatar_color === 'blue' || myProfile?.avatar_color === 'pink' ? myProfile.avatar_color : null,
  );
  const [busy, setBusy] = useState(false);

  if (phase !== 'paired' && phase !== 'loading') return <Redirect href="/" />;
  if (profileStep === 'name') return <Redirect href="/name-setup" />;

  async function onContinue() {
    if (!selected || !userId) return;
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ avatar_color: selected }).eq('id', userId);
    if (error) {
      setBusy(false);
      Alert.alert('Could not save', error.message);
      return;
    }
    await refresh();
    setBusy(false);
    router.replace('/all-set');
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.title}>Choose your color</Text>
        <Text style={styles.subtitle}>Pick the color you&apos;d like to use for your avatar.</Text>

        <View style={styles.choices}>
          {AVATAR_CHOICES.map((choice) => {
            const isSel = selected === choice.key;
            return (
              <Pressable
                key={choice.key}
                onPress={() => setSelected(choice.key)}
                style={[styles.choice, isSel && styles.choiceSelected]}
              >
                <Avatar name={myProfile?.display_name} size={88} tint={choice.color} />
                <Text style={styles.choiceLabel}>{choice.label}</Text>
                {isSel ? (
                  <View style={styles.check}>
                    <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
                  </View>
                ) : null}
              </Pressable>
            );
          })}
        </View>
      </View>
      <View style={styles.footer}>
        <Button label="Continue" onPress={onContinue} loading={busy} disabled={!selected} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.xl, justifyContent: 'center' },
  title: { ...font.title, color: colors.text, textAlign: 'center' },
  subtitle: { ...font.body, color: colors.subtext, marginTop: spacing.sm, marginBottom: spacing.xxl, textAlign: 'center' },
  choices: { flexDirection: 'row', justifyContent: 'center', gap: spacing.lg },
  choice: {
    flex: 1,
    maxWidth: 160,
    alignItems: 'center',
    paddingVertical: spacing.xl,
    borderRadius: radius.lg,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  choiceSelected: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
  choiceLabel: { ...font.h3, color: colors.text, marginTop: spacing.md },
  check: { position: 'absolute', top: spacing.sm, right: spacing.sm },
  footer: { padding: spacing.xl, paddingTop: 0 },
});
