import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Redirect } from '@/components/Redirect';
import React, { useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { AUTH_BUTTON_ICON, AUTH_LIGHT_FG, AuthButton } from '@/components/AuthButton';
import { BondLogo } from '@/components/BondLogo';
import { continueWithGoogle, getGoogleSupport } from '@/lib/googleAuth';
import { isSupabaseConfigured } from '@/lib/supabase';
import { colors, font, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

// Google's official "G" logo (developers.google.com/identity/images/g-logo.png).
const GOOGLE_G = require('../../assets/google-g.png');

/**
 * The first screen, for a phone with NO Bond account: Continue with email
 * (starts sign-up; existing users can switch to sign in there) or Continue
 * with Google. After that, the start screen sends a signed-in person
 * to Mutual Pairing (or Home if their account is already paired).
 * A phone that already has an account never stays here, so nothing on this
 * screen can replace an existing account.
 *
 * Bond is for people aged 18 and over (see the Privacy Policy and Terms):
 * both buttons stay disabled until the person confirms that, and agrees to
 * the Terms of Use and Privacy Policy.
 */
export default function Welcome() {
  useThemeVersion();
  const router = useRouter();
  const { phase, session, refresh } = useCouple();
  const [googleBusy, setGoogleBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const google = getGoogleSupport();
  const [agreed, setAgreed] = useState(false);

  // Safety nets: a paired account goes Home; any other signed-in phone
  // continues to pairing (Google / email here are only for "no account").
  if (phase === 'paired' || (session && !googleBusy)) return <Redirect href="/" />;

  async function onGoogle() {
    if (busyRef.current) return;
    setError(null);
    // Never a silent no-op: say why Google can't run in this build.
    if (google !== 'ready') {
      const why =
        google === 'needs-update'
          ? 'Google sign-in needs the latest version of Bond on this phone.'
          : "Google sign-in isn't set up for this build yet (missing Google Web client ID).";
      console.warn(`[Bond][google] button tapped but unavailable: ${google}`);
      setError(why);
      return;
    }
    busyRef.current = true;
    setGoogleBusy(true);
    try {
      const r = await continueWithGoogle();
      if (!r.ok) {
        if (!r.cancelled) setError(r.message);
        return;
      }
      await refresh(); // load this account's couple + profile
      router.replace('/');
    } finally {
      busyRef.current = false;
      setGoogleBusy(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.hero}>
        <BondLogo size={92} layout="column" />
        <Text style={styles.tagline}>Your private space for two.</Text>
      </View>

      {!isSupabaseConfigured ? (
        <View style={styles.warning}>
          <Text style={styles.warningText}>
            Supabase isn't set up yet. Add your project URL and key to a{' '}
            <Text style={styles.code}>.env.local</Text> file (see{' '}
            <Text style={styles.code}>.env.example</Text>), then restart the app.
          </Text>
        </View>
      ) : null}

      <View style={styles.actions}>
        <AuthButton
          label="Continue with Email"
          variant="light"
          icon={<Ionicons name="mail-outline" size={AUTH_BUTTON_ICON} color={AUTH_LIGHT_FG} />}
          onPress={() => router.push('/sign-in')}
          disabled={!agreed || googleBusy || !isSupabaseConfigured}
        />
        <AuthButton
          label="Continue with Google"
          variant="outline"
          icon={<Image source={GOOGLE_G} style={styles.googleG} resizeMode="contain" accessibilityIgnoresInvertColors />}
          onPress={onGoogle}
          loading={googleBusy}
          disabled={!agreed || !isSupabaseConfigured}
          accessibilityHint={
            google === 'needs-update'
              ? 'Unavailable: needs the latest version of Bond on this phone.'
              : google === 'not-configured'
                ? "Unavailable: Google sign-in isn't set up for this build yet."
                : undefined
          }
          style={styles.second}
        />
        {error ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {error}
          </Text>
        ) : null}
        <View style={styles.agreeRow}>
          <Pressable
            onPress={() => setAgreed((v) => !v)}
            hitSlop={10}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: agreed }}
            accessibilityLabel="I am 18 or older and agree to the Terms of Use and Privacy Policy"
            style={[styles.checkbox, agreed && styles.checkboxOn]}
          >
            {agreed ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
          </Pressable>
          <Text style={styles.agreeText} onPress={() => setAgreed((v) => !v)}>
            I am 18 or older and agree to the{' '}
            <Text style={styles.legalLink} onPress={() => router.push('/terms')} accessibilityRole="link">
              Terms of Use
            </Text>{' '}
            and{' '}
            <Text style={styles.legalLink} onPress={() => router.push('/privacy')} accessibilityRole="link">
              Privacy Policy
            </Text>
            .
          </Text>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: {
    flex: 1,
    backgroundColor: colors.background,
    padding: spacing.xl,
    justifyContent: 'space-between',
  },
  hero: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tagline: { ...font.body, fontSize: 17, color: colors.subtext, marginTop: spacing.md },
  actions: { paddingBottom: spacing.lg },
  second: { marginTop: spacing.md },
  googleG: { width: AUTH_BUTTON_ICON, height: AUTH_BUTTON_ICON },
  error: { ...font.small, color: colors.danger, textAlign: 'center', marginTop: spacing.md, lineHeight: 18 },
  agreeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.lg },
  checkbox: {
    width: 22,
    height: 22,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 1,
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  agreeText: { ...font.small, color: colors.subtext, flex: 1, lineHeight: 19 },
  legalLink: { fontWeight: '700', color: colors.primary, textDecorationLine: 'underline' },
  warning: {
    backgroundColor: colors.warningSoft,
    borderRadius: 16,
    padding: spacing.lg,
    marginBottom: spacing.lg,
  },
  warningText: { ...font.small, color: colors.text, lineHeight: 20 },
  code: { fontWeight: '800', color: colors.text },
}));
