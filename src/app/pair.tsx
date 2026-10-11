import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { Redirect } from '@/components/Redirect';
import React, { useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { continueWithGoogle, getGoogleSupport } from '@/lib/googleAuth';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * MUTUAL PAIRING
 *
 * The one screen that offers the two equal choices. Neither option makes a
 * partner an owner or controller: one person simply shows a code and the
 * other enters it to form the mutual connection.
 *
 * Signed-in, unpaired people land here (after Continue with Google / email,
 * or with an existing account). For an older anonymous account, "Add Google
 * to this account" LINKS Google to the same account (same user id); it never
 * signs in to a different one.
 */
export default function Pair() {
  useThemeVersion();
  const router = useRouter();
  const { phase, session } = useCouple();
  const [linking, setLinking] = useState(false);
  const [linkMessage, setLinkMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const busyRef = useRef(false);

  // Safety net: if this user turns out to be paired, the start screen decides
  // (setup for a new pairing, otherwise Home).
  if (phase === 'paired') return <Redirect href="/" />;

  const user = session?.user;
  const anonymous = !!user?.is_anonymous;
  const google = getGoogleSupport();

  async function onAddGoogle() {
    if (busyRef.current) return;
    busyRef.current = true;
    setLinking(true);
    setLinkMessage(null);
    try {
      const r = await continueWithGoogle(); // a session exists here, so this links, never switches
      if (r.ok) setLinkMessage({ ok: true, text: 'Google was added to this account. It is the same account as before.' });
      else if (!r.cancelled) setLinkMessage({ ok: false, text: r.message });
    } finally {
      busyRef.current = false;
      setLinking(false);
    }
  }

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <Text style={styles.title}>Mutual Pairing</Text>
        <Text style={styles.subtitle}>Connect your Bond with your partner.</Text>
        {user && !anonymous && user.email ? <Text style={styles.account}>Signed in as {user.email}</Text> : null}

        <View style={styles.options}>
          <PairOption
            icon="qr-code-outline"
            title="Show My Code"
            description="Generate and show your pairing code."
            onPress={() => router.push('/show-code')}
          />
          <PairOption
            icon="enter-outline"
            title="Enter Their Code"
            description="Enter the pairing code from your partner."
            onPress={() => router.push('/enter-code')}
          />
        </View>

        {anonymous && google === 'ready' ? (
          <View style={styles.protect}>
            <Text style={styles.protectText}>
              This account isn&apos;t linked to Google or an email yet, so it lives only on this phone.
            </Text>
            <Button label="Add Google to this account" icon="logo-google" variant="secondary" small onPress={onAddGoogle} loading={linking} />
          </View>
        ) : null}
        {linkMessage ? (
          <Text style={[styles.linkMessage, { color: linkMessage.ok ? colors.success : colors.danger }]} accessibilityLiveRegion="polite">
            {linkMessage.text}
          </Text>
        ) : null}
      </View>
    </SafeAreaView>
  );
}

/** One large, rounded choice card. */
function PairOption({
  icon,
  title,
  description,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  description: string;
  onPress: () => void;
}) {
  useThemeVersion();
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [{ transform: [{ scale: pressed ? 0.98 : 1 }] }]}>
      <Card style={styles.option}>
        <View style={styles.iconWrap}>
          <Ionicons name={icon} size={26} color={colors.primary} />
        </View>
        <View style={styles.optionText}>
          <Text style={styles.optionTitle}>{title}</Text>
          <Text style={styles.optionDesc}>{description}</Text>
        </View>
        <Ionicons name="chevron-forward" size={22} color={colors.muted} />
      </Card>
    </Pressable>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.xl, paddingTop: spacing.xxl },
  account: { ...font.small, color: colors.muted, marginTop: spacing.xs },
  protect: { marginTop: spacing.xl, gap: spacing.sm, alignItems: 'flex-start' },
  protectText: { ...font.small, color: colors.subtext, lineHeight: 19 },
  linkMessage: { ...font.small, marginTop: spacing.md, lineHeight: 18 },
  title: { ...font.title, color: colors.text },
  subtitle: { ...font.body, color: colors.subtext, marginTop: spacing.sm },
  options: { marginTop: spacing.xxl, gap: spacing.lg },
  option: { flexDirection: 'row', alignItems: 'center', paddingVertical: spacing.xl },
  iconWrap: {
    width: 52,
    height: 52,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.lg,
  },
  optionText: { flex: 1 },
  optionTitle: { ...font.h2, color: colors.text },
  optionDesc: { ...font.small, color: colors.subtext, marginTop: 4 },
}));
