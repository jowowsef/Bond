import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { StatusBadge, type BadgeTone } from '@/components/StatusBadge';
import { enableBatterySharing } from '@/lib/battery';
import { enableLocationSharing } from '@/lib/location';
import { getLocationState, getNotificationState, requestNotifications, type PermissionState } from '@/lib/setupPermissions';
import { supabase } from '@/lib/supabase';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * OPTIONAL SETUP (after profile setup, before Home; also reachable from
 * Settings). Each item shows its REAL state. Nothing here is required, and
 * opening an item never marks it enabled on its own.
 */
type ItemState = 'enabled' | 'not_set_up' | 'permission_required' | 'unavailable' | 'coming_later';

const BADGE: Record<ItemState, { label: string; tone: BadgeTone }> = {
  enabled: { label: 'Enabled', tone: 'success' },
  not_set_up: { label: 'Not set up', tone: 'neutral' },
  permission_required: { label: 'Permission required', tone: 'warning' },
  unavailable: { label: 'Unavailable on this build', tone: 'neutral' },
  coming_later: { label: 'Coming later', tone: 'neutral' },
};

export default function OptionalSetup() {
  const router = useRouter();
  const { userId, refresh } = useCouple();

  const [battery, setBattery] = useState<ItemState>('not_set_up');
  const [location, setLocation] = useState<ItemState>('not_set_up');
  const [notifications, setNotifications] = useState<ItemState>('not_set_up');
  const [busy, setBusy] = useState<string | null>(null);

  const refreshStates = useCallback(async () => {
    const notif = await getNotificationState();
    setNotifications(notif === 'granted' ? 'enabled' : notif === 'denied' ? 'permission_required' : 'not_set_up');

    if (userId) {
      const { data } = await supabase
        .from('privacy_settings')
        .select('share_battery, share_location')
        .eq('user_id', userId)
        .maybeSingle();
      setBattery(data?.share_battery ? 'enabled' : 'not_set_up');

      const loc = await getLocationState();
      if (data?.share_location) setLocation(loc === 'granted' ? 'enabled' : 'permission_required');
      else setLocation('not_set_up');
    }
  }, [userId]);

  useEffect(() => {
    void refreshStates();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void refreshStates();
    });
    return () => sub.remove();
  }, [refreshStates]);

  async function onBattery() {
    if (!userId) return;
    setBusy('battery');
    const r = await enableBatterySharing(userId);
    setBusy(null);
    if (!r.ok) Alert.alert('Could not enable', r.message ?? 'Please try again.');
    await refresh();
    await refreshStates();
  }

  async function onLocation() {
    if (!userId) return;
    setBusy('location');
    const r = await enableLocationSharing(userId);
    setBusy(null);
    if (!r.ok) Alert.alert('Location not enabled', r.message ?? 'Please try again.');
    await refresh();
    await refreshStates();
  }

  async function onNotifications() {
    setBusy('notifications');
    await requestNotifications();
    setBusy(null);
    await refreshStates();
  }

  return (
    <SafeAreaView style={styles.screen} edges={['top']}>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.title}>Optional setup</Text>
        <Text style={styles.subtitle}>
          Turn on what you&apos;d like to share. Everything is optional and you can change it later in Settings.
        </Text>

        <Item
          icon="battery-half-outline"
          title="Battery status"
          desc="Let your partner see your battery percentage and charging status."
          state={battery}
          busy={busy === 'battery'}
          onPress={onBattery}
        />
        <Item
          icon="location-outline"
          title="Location sharing"
          desc="Share your location with your partner when you choose to enable it."
          state={location}
          actionLabel="Set up location"
          busy={busy === 'location'}
          onPress={onLocation}
        />
        <Item
          icon="shield-outline"
          title="Website protection"
          desc="Block websites you and your partner choose to restrict. Needs on-device setup that is not in this build yet."
          state="unavailable"
        />
        <Item
          icon="notifications-outline"
          title="Notifications"
          desc="Get updates when your partner sends a request or important activity happens."
          state={notifications}
          actionLabel="Enable notifications"
          busy={busy === 'notifications'}
          onPress={onNotifications}
        />
        <Item
          icon="time-outline"
          title="Screen time"
          desc="See app usage for you and your partner. Arrives with a later update."
          state="coming_later"
        />

        <Button label="Continue to Home" onPress={() => router.replace('/(tabs)')} style={styles.continue} />
        <View style={{ height: spacing.lg }} />
      </ScrollView>
    </SafeAreaView>
  );
}

function Item({
  icon,
  title,
  desc,
  state,
  actionLabel = 'Enable',
  busy,
  onPress,
}: {
  icon: React.ComponentProps<typeof Ionicons>['name'];
  title: string;
  desc: string;
  state: ItemState;
  actionLabel?: string;
  busy?: boolean;
  onPress?: () => void;
}) {
  const canEnable = !!onPress && state !== 'enabled';
  const badge = BADGE[state];
  return (
    <Card style={styles.item}>
      <View style={styles.itemHeader}>
        <View style={styles.itemIcon}>
          <Ionicons name={icon} size={20} color={colors.primary} />
        </View>
        <Text style={styles.itemTitle}>{title}</Text>
        <StatusBadge label={badge.label} tone={badge.tone} dot={state === 'enabled'} />
      </View>
      <Text style={styles.itemDesc}>{desc}</Text>
      {canEnable ? (
        <Button
          label={state === 'permission_required' ? 'Open settings' : actionLabel}
          small
          loading={busy}
          onPress={onPress}
          style={styles.itemButton}
        />
      ) : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.lg },
  title: { ...font.title, color: colors.text, marginTop: spacing.sm },
  subtitle: { ...font.small, color: colors.subtext, marginTop: spacing.sm, marginBottom: spacing.lg, lineHeight: 19 },
  item: { marginBottom: spacing.md, gap: spacing.sm },
  itemHeader: { flexDirection: 'row', alignItems: 'center' },
  itemIcon: {
    width: 36,
    height: 36,
    borderRadius: radius.md,
    backgroundColor: colors.primarySoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.sm,
  },
  itemTitle: { ...font.h3, color: colors.text, flex: 1 },
  itemDesc: { ...font.small, color: colors.subtext, lineHeight: 19 },
  itemButton: { alignSelf: 'flex-start', marginTop: spacing.xs, minWidth: 150 },
  continue: { marginTop: spacing.md },
});
