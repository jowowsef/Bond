import { Ionicons } from '@expo/vector-icons';
import { Redirect } from '@/components/Redirect';
import React, { useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { AVATAR_CHOICES, avatarTint, type AvatarColor } from '@/lib/avatar';
import { updateDisplayName } from '@/lib/pairing';
import { errorMessage, supabase } from '@/lib/supabase';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * NEW PAIRING, LAST STEP (after Sharing setup): "Make it yours".
 *
 * One screen for the name the partner sees and the avatar color, with a live
 * preview. Saves profiles.display_name and profiles.avatar_color (the
 * person's own choice), then finishes both setup steps (name, color) and the
 * start screen continues to Home. Also shown for an older pairing whose name
 * was never chosen (then only the profile is saved).
 *
 * The partner's color is only a suggestion here: if they already chose one,
 * the other color is selected at first, and the note says what they chose.
 */
export default function NameSetup() {
  useThemeVersion();
  const { phase, userId, myProfile, partnerProfile, profileStep, refresh, session, pairingSetup, advancePairingSetup } =
    useCouple();

  // A Google account suggests its first name; the person can change it.
  const meta = (session?.user.user_metadata ?? {}) as { given_name?: string; full_name?: string; name?: string };
  const suggested = (meta.given_name ?? meta.full_name ?? meta.name ?? '').trim().slice(0, 30);
  // An automatic name copied from the email address is not offered as "yours".
  const autoName = session?.user.email ? session.user.email.split('@')[0] : null;
  const current = myProfile?.display_name?.trim() ?? '';
  const existing = current && current !== 'Me' && current !== autoName ? current : suggested || current.replace(/^Me$/, '');
  const [name, setName] = useState(existing);

  const partnerColor: AvatarColor | null =
    partnerProfile?.avatar_color === 'blue' || partnerProfile?.avatar_color === 'pink' ? partnerProfile.avatar_color : null;
  const mine: AvatarColor | null = myProfile?.avatar_color === 'blue' || myProfile?.avatar_color === 'pink' ? myProfile.avatar_color : null;
  const [color, setColor] = useState<AvatarColor | null>(mine ?? (partnerColor ? (partnerColor === 'blue' ? 'pink' : 'blue') : null));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rawPartner = partnerProfile?.display_name?.trim();
  const partnerName = rawPartner && rawPartner !== 'Me' ? rawPartner : 'your partner';
  const PartnerName = partnerName === 'your partner' ? 'Your partner' : partnerName;

  // This screen belongs to the name step: a new pairing at 'name' (or 'color',
  // when an earlier version stopped between the two), or an older pairing
  // whose name was never chosen. Anywhere else, the start screen decides.
  const isMyStep = pairingSetup === 'name' || pairingSetup === 'color' || (pairingSetup === 'done' && profileStep === 'name');
  if (phase !== 'loading' && pairingSetup !== 'unknown' && !isMyStep) return <Redirect href="/" />;

  async function onContinue() {
    const trimmed = name.trim();
    if (trimmed.length < 1 || !userId || !color) return;
    setBusy(true);
    setError(null);
    // Only move on once both have actually saved.
    const saved = await updateDisplayName(userId, trimmed);
    if (!saved.ok) {
      setBusy(false);
      setError(saved.message ?? 'Could not save your name. Please try again.');
      return;
    }
    const { error: colorError } = await supabase.from('profiles').update({ avatar_color: color }).eq('id', userId);
    if (colorError) {
      setBusy(false);
      setError(errorMessage(colorError));
      return;
    }
    // Remember that THIS person chose the name (also when it equals the email
    // name), so the name step is not shown again. Best effort.
    await supabase.auth.updateUser({ data: { bond_name_confirmed: true } }).catch(() => undefined);
    await refresh();
    // New pairing: both steps are done; the start screen then shows Home.
    if (pairingSetup === 'name') await advancePairingSetup('name');
    if (pairingSetup === 'name' || pairingSetup === 'color') await advancePairingSetup('color');
    setBusy(false);
  }

  const canContinue = name.trim().length > 0 && !!color;
  const colorNote = partnerColor
    ? `${PartnerName} chose ${AVATAR_CHOICES.find((c) => c.key === partnerColor)?.label ?? partnerColor}. Pick the other one so you can tell each other apart at a glance.`
    : `Pick the color for your avatar. ${PartnerName} picks their own.`;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          <Text style={styles.title}>Make it yours</Text>
          <Text style={styles.subtitle}>
            This is how {partnerName === 'your partner' ? 'your partner' : partnerName} will see you in Bond.
          </Text>

          <View style={styles.preview}>
            <Avatar name={name.trim() || null} size={128} tint={color ? avatarTint(color) : colors.track} />
            <Ionicons name="sparkles" size={24} color={colors.pink} style={styles.sparkle} />
          </View>

          <Text style={styles.label}>Display name</Text>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Your name"
            placeholderTextColor={colors.muted}
            style={styles.input}
            maxLength={30}
            returnKeyType="done"
            accessibilityLabel="Display name"
          />

          <Text style={[styles.label, { marginTop: spacing.xl }]}>Your color</Text>
          <View style={styles.choices}>
            {AVATAR_CHOICES.map((choice) => {
              const selected = color === choice.key;
              return (
                <Pressable
                  key={choice.key}
                  onPress={() => setColor(choice.key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={choice.label}
                  style={[styles.choice, selected && styles.choiceSelected]}
                >
                  <View style={[styles.swatch, { backgroundColor: choice.color }]} />
                  <Text style={styles.choiceLabel}>{choice.label}</Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.note}>{colorNote}</Text>
          {error ? <Text style={styles.error}>{error}</Text> : null}
        </ScrollView>
        <View style={styles.footer}>
          <Button
            label={error ? 'Try again' : pairingSetup === 'done' ? 'Save' : 'Go to home'}
            onPress={onContinue}
            loading={busy}
            disabled={!canContinue}
          />
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  flex: { flex: 1 },
  body: { padding: spacing.xl, paddingTop: spacing.xxl },
  title: { ...font.title, color: colors.text },
  subtitle: { ...font.body, color: colors.subtext, marginTop: spacing.xs },
  preview: { alignSelf: 'center', marginVertical: spacing.xl },
  sparkle: { position: 'absolute', top: 4, right: -6 },
  label: { ...font.small, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  input: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: spacing.lg,
    paddingVertical: 14,
    fontSize: 17,
    color: colors.text,
  },
  choices: { flexDirection: 'row', gap: spacing.md },
  choice: {
    flex: 1,
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.lg,
    borderRadius: radius.md,
    borderWidth: 2,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  choiceSelected: { borderColor: colors.primary },
  swatch: { width: 32, height: 32, borderRadius: 16 },
  choiceLabel: { ...font.body, fontWeight: '700', color: colors.text },
  note: { ...font.small, color: colors.subtext, marginTop: spacing.sm, lineHeight: 18 },
  error: { ...font.small, color: colors.danger, marginTop: spacing.md },
  footer: { padding: spacing.xl, paddingTop: spacing.sm },
}));
