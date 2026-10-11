import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useState } from 'react';
import { ActivityIndicator, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Redirect } from '@/components/Redirect';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * "You're no longer paired": shown on BOTH phones once each phone has
 * confirmed with the server that the couple ended, and has cleared its
 * previous pairing data (see lib/unpairReset.ts). It is shown once: Continue
 * forgets the notice and goes to Mutual Pairing (generate or enter a code).
 * If clearing couldn't finish (for example offline), it says so and offers
 * Try again instead of claiming success.
 */
export default function Unpaired() {
  useThemeVersion();
  const router = useRouter();
  const { phase, unpairState, unpairError, retryUnpairReset, acknowledgeUnpair } = useCouple();
  const [leaving, setLeaving] = useState(false);

  // Nothing to confirm (already acknowledged, or paired): the start screen decides.
  if (!leaving && (unpairState === 'none' || phase === 'paired')) return <Redirect href="/" />;

  async function onContinue() {
    setLeaving(true);
    await acknowledgeUnpair();
    router.replace('/');
  }

  const failed = unpairState === 'failed';
  const working = unpairState === 'resetting';

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.body}>
        <View style={[styles.badge, failed && styles.badgeWarn]}>
          <Ionicons name={failed ? 'alert-circle-outline' : 'unlink-outline'} size={40} color={failed ? colors.warning : colors.primary} />
        </View>
        <Text style={styles.title}>You&apos;re no longer paired</Text>
        {working ? (
          <>
            <Text style={styles.message}>Clearing your previous pairing information…</Text>
            <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
          </>
        ) : failed ? (
          <Text style={styles.message}>
            You and your partner are no longer connected. {unpairError ?? 'Please try again.'}
          </Text>
        ) : (
          <Text style={styles.message}>
            You and your partner are no longer connected. Your previous pairing information and shared partner data
            have been cleared.
          </Text>
        )}
      </View>
      <View style={styles.footer}>
        {failed ? (
          <Button label="Try again" icon="refresh" onPress={retryUnpairReset} />
        ) : (
          <Button label="Continue" onPress={() => void onContinue()} disabled={working} loading={leaving} />
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: spacing.xl },
  badge: {
    width: 84,
    height: 84,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xl,
  },
  badgeWarn: { backgroundColor: colors.warningSoft },
  title: { ...font.title, color: colors.text, textAlign: 'center' },
  message: { ...font.body, color: colors.subtext, textAlign: 'center', marginTop: spacing.md, lineHeight: 22 },
  footer: { padding: spacing.lg },
}));
