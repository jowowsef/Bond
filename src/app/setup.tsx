import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusBadge } from '@/components/StatusBadge';
import { enableLocationSharing } from '@/lib/location';
import {
  getFeatureState,
  requestFeature,
  SETUP_FEATURES,
  USAGE_ACCESS_AVAILABLE,
  type FeatureKey,
  type PermissionState,
} from '@/lib/setupPermissions';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * DEVICE SETUP (shown right after pairing, and reachable from Settings).
 *
 * Walks through the permissions Bond actually uses today. Each one shows its
 * REAL status (we ask Android, we don't pretend), with a button that triggers
 * the system prompt — or opens Android Settings when the OS requires that.
 * Nothing here is required to use Bond; everything is opt-in.
 */
export default function Setup() {
  const router = useRouter();
  const { userId, refresh } = useCouple();
  const [states, setStates] = useState<Record<FeatureKey, PermissionState>>({
    notifications: 'undetermined',
    location: 'undetermined',
  });
  const [busy, setBusy] = useState<FeatureKey | null>(null);

  const refreshStates = useCallback(async () => {
    const entries = await Promise.all(SETUP_FEATURES.map(async (f) => [f.key, await getFeatureState(f.key)] as const));
    setStates(Object.fromEntries(entries) as Record<FeatureKey, PermissionState>);
  }, []);

  useEffect(() => {
    void refreshStates();
    // Re-check when returning from the Android Settings page.
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshStates();
    });
    return () => sub.remove();
  }, [refreshStates]);

  async function onEnable(key: FeatureKey) {
    setBusy(key);
    const result = await requestFeature(key);
    // When location permission is granted here, also start sharing (opt-in).
    if (key === 'location' && result === 'granted' && userId) {
      await enableLocationSharing(userId);
      await refresh();
    }
    await refreshStates();
    setBusy(null);
  }

  function badgeFor(state: PermissionState) {
    if (state === 'granted') return <StatusBadge label="On" tone="success" dot />;
    if (state === 'denied') return <StatusBadge label="Needs Settings" tone="warning" />;
    return <StatusBadge label="Off" tone="neutral" />;
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View style={styles.heroIcon}>
            <Ionicons name="checkmark-circle" size={30} color={colors.success} />
          </View>
          <Text style={styles.title}>You&apos;re connected</Text>
          <Text style={styles.subtitle}>
            Turn on what you&apos;d like to share. Everything is optional, and only your phone can grant these — Bond
            never grants them for you.
          </Text>
        </View>

        {SETUP_FEATURES.map((f) => {
          const state = states[f.key];
          const granted = state === 'granted';
          return (
            <Card key={f.key} style={styles.featureCard}>
              <View style={styles.featureHeader}>
                <View style={styles.featureIcon}>
                  <Ionicons name={f.icon} size={20} color={colors.primary} />
                </View>
                <Text style={styles.featureTitle}>{f.title}</Text>
                {badgeFor(state)}
              </View>
              <Text style={styles.featureDesc}>{f.description}</Text>
              <Text style={styles.featureMeta}>{f.required ? 'Required' : 'Optional'}</Text>
              {!granted ? (
                <Button
                  label={state === 'denied' ? 'Open Settings' : 'Enable'}
                  small
                  loading={busy === f.key}
                  onPress={() => onEnable(f.key)}
                  style={styles.featureButton}
                />
              ) : null}
            </Card>
          );
        })}

        {/* Honest note about features that aren't in this build yet. */}
        {!USAGE_ACCESS_AVAILABLE ? (
          <Card style={styles.laterCard}>
            <View style={styles.featureHeader}>
              <View style={styles.featureIcon}>
                <Ionicons name="time-outline" size={20} color={colors.muted} />
              </View>
              <Text style={styles.featureTitle}>Screen time (Usage Access)</Text>
              <StatusBadge label="Later update" tone="neutral" />
            </View>
            <Text style={styles.featureDesc}>
              Screen-time and app-usage data need Android&apos;s Usage Access, which arrives in a later Bond update.
              We won&apos;t show it as available until it really works.
            </Text>
          </Card>
        ) : null}

        <Button label="Continue to Bond" onPress={() => router.replace('/(tabs)')} style={styles.continue} />
        <Text style={styles.footnote}>You can change all of this later in Settings.</Text>
        <View style={{ height: spacing.lg }} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  hero: { alignItems: 'center', marginBottom: spacing.lg, paddingHorizontal: spacing.sm },
  heroIcon: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.md,
  },
  title: { ...font.title, color: colors.text },
  subtitle: { ...font.small, color: colors.subtext, textAlign: 'center', marginTop: spacing.sm, lineHeight: 19 },
  featureCard: { marginBottom: spacing.md, gap: spacing.sm },
  laterCard: { marginBottom: spacing.md, gap: spacing.sm, backgroundColor: colors.background },
  featureHeader: { flexDirection: 'row', alignItems: 'center' },
  featureIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  featureTitle: { ...font.h3, color: colors.text, flex: 1 },
  featureDesc: { ...font.small, color: colors.subtext, lineHeight: 19 },
  featureMeta: { ...font.tiny, color: colors.muted },
  featureButton: { alignSelf: 'flex-start', marginTop: spacing.xs, minWidth: 140 },
  continue: { marginTop: spacing.sm },
  footnote: { ...font.small, color: colors.muted, textAlign: 'center', marginTop: spacing.md },
});
