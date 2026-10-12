import { Ionicons } from '@expo/vector-icons';
import { Redirect } from '@/components/Redirect';
import React, { useEffect, useState } from 'react';
import { Alert, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { AVATAR_CHOICES, type AvatarColor } from '@/lib/avatar';
import { errorMessage, supabase } from '@/lib/supabase';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * NEW PAIRING, STEP 3 (the last one): "Choose your color".
 *
 * Saves the chosen colour to profiles.avatar_color (the user's own choice,
 * never derived from pairing order, name, or device). Then the start screen
 * continues to Home. Also shown for an older pairing without a color.
 */
export default function ColorSetup() {
  useThemeVersion();
  const { phase, userId, myProfile, profileStep, refresh, pairingSetup, advancePairingSetup } = useCouple();
  const [selected, setSelected] = useState<AvatarColor | null>(
    myProfile?.avatar_color === 'blue' || myProfile?.avatar_color === 'pink' ? myProfile.avatar_color : null,
  );
  const [busy, setBusy] = useState(false);
  // The avatar letter comes from the name just chosen in the name step. Read
  // it from the server too, so a profile that wasn't refreshed yet (still the
  // default "Me") can't show the wrong letter.
  const [fresh, setFresh] = useState<string | null>(null);
  const name = fresh ?? myProfile?.display_name ?? null;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void supabase
      .from('profiles')
      .select('display_name')
      .eq('id', userId)
      .maybeSingle()
      .then(({ data }) => {
        const latest = (data as { display_name?: string } | null)?.display_name?.trim();
        if (!cancelled && latest) setFresh(latest);
      });
    return () => {
      cancelled = true;
    };
  }, [userId]);

  // This screen belongs to the color step only (see name-setup.tsx).
  const isMyStep = pairingSetup === 'color' || (pairingSetup === 'done' && profileStep === 'color');
  if (phase !== 'loading' && pairingSetup !== 'unknown' && !isMyStep) return <Redirect href="/" />;

  async function onContinue() {
    if (!selected || !userId) return;
    setBusy(true);
    const { error } = await supabase.from('profiles').update({ avatar_color: selected }).eq('id', userId);
    if (error) {
      setBusy(false);
      Alert.alert('Could not save', errorMessage(error));
      return;
    }
    await refresh();
    // New pairing: setup is complete; the start screen continues to Home.
    if (pairingSetup === 'color') await advancePairingSetup('color');
    setBusy(false);
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
                <Avatar name={name} size={88} tint={choice.color} />
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

const styles = themedStyles(() => ({
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
}));
