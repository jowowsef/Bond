import { Ionicons } from '@expo/vector-icons';
import { Redirect, useRouter } from 'expo-router';
import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { BackHeader } from '@/components/BackHeader';
import { Card } from '@/components/Card';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * MUTUAL PAIRING
 *
 * The one screen that offers the two equal choices. Neither option makes a
 * partner an owner or controller — one person simply shows a code and the
 * other enters it to form the mutual connection.
 */
export default function Pair() {
  const router = useRouter();
  const { phase } = useCouple();

  // Safety net: if this user turns out to be paired, go to the main app.
  if (phase === 'paired') return <Redirect href="/(tabs)" />;

  return (
    <SafeAreaView style={styles.screen}>
      <BackHeader />
      <View style={styles.body}>
        <Text style={styles.title}>Mutual Pairing</Text>
        <Text style={styles.subtitle}>Connect your Bond with your partner.</Text>

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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  body: { flex: 1, padding: spacing.xl, paddingTop: spacing.sm },
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
});
