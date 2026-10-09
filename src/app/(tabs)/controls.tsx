import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { GearButton } from '@/components/GearButton';
import { Screen } from '@/components/Screen';
import { colors, font, radius, spacing } from '@/lib/theme';

/**
 * CONTROLS — honest status for now.
 *
 * Device protection (website filtering, app limits) needs the native Bond
 * module that isn't in this build yet. Rather than show fake on/off switches,
 * we explain how it will work: always mutual and consent-based.
 */
export default function Controls() {
  return (
    <Screen title="Controls" subtitle="Help each other build better habits" right={<GearButton />}>
      <Card style={styles.hero}>
        <View style={styles.heroIcon}>
          <Ionicons name="shield-checkmark-outline" size={26} color={colors.primary} />
        </View>
        <Text style={styles.heroTitle}>No active protection yet</Text>
        <Text style={styles.heroBody}>
          Website and app protection arrive in a later update. When they do, every control will work the same mutual
          way requests already do here.
        </Text>
      </Card>

      <View style={styles.steps}>
        <Step icon="hand-left-outline" title="You request" body="Ask to turn a protection on for your partner's phone — or your own." />
        <Step icon="checkmark-circle-outline" title="They approve" body="The other person must accept before anything changes on their device." />
        <Step icon="lock-open-outline" title="Either can turn it off" body="Nobody gets locked out of their own phone. Controls can always be removed." />
      </View>

      <View style={styles.infoBox}>
        <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
        <Text style={styles.infoText}>
          Bond will never grant Android permissions on the other phone for you. Each person sets up their own device.
        </Text>
      </View>
    </Screen>
  );
}

function Step({ icon, title, body }: { icon: React.ComponentProps<typeof Ionicons>['name']; title: string; body: string }) {
  return (
    <Card style={styles.step}>
      <View style={styles.stepIcon}>
        <Ionicons name={icon} size={18} color={colors.primary} />
      </View>
      <View style={{ flex: 1 }}>
        <Text style={styles.stepTitle}>{title}</Text>
        <Text style={styles.stepBody}>{body}</Text>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  hero: { alignItems: 'center', paddingVertical: spacing.xl },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  heroTitle: { ...font.h2, color: colors.text },
  heroBody: { ...font.small, color: colors.subtext, textAlign: 'center', marginTop: spacing.sm, lineHeight: 19 },
  steps: { marginTop: spacing.lg, gap: spacing.md },
  step: { flexDirection: 'row', alignItems: 'center' },
  stepIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  stepTitle: { ...font.h3, color: colors.text },
  stepBody: { ...font.small, color: colors.subtext, marginTop: 2, lineHeight: 18 },
  infoBox: {
    flexDirection: 'row',
    gap: spacing.sm,
    backgroundColor: colors.primarySoft,
    borderRadius: radius.lg,
    padding: spacing.lg,
    marginTop: spacing.xl,
  },
  infoText: { ...font.small, color: colors.subtext, flex: 1, lineHeight: 19 },
});
