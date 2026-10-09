import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { GearButton } from '@/components/GearButton';
import { LocationPersonRow } from '@/components/LocationPersonRow';
import { PartnerMap } from '@/components/PartnerMap';
import { Screen } from '@/components/Screen';
import { useCoupleLocations } from '@/hooks/useCoupleLocations';
import { enableLocationSharing } from '@/lib/location';
import { requestApproval } from '@/lib/requests';
import { getLocationState, openAppSettings, type PermissionState } from '@/lib/setupPermissions';
import { colors, font, radius, spacing } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * LOCATION, map first and consent based.
 *
 * The map preview is the main element; tap it (or a person) to open the
 * fullscreen map. Below it, one compact panel shows each person once, with
 * your sharing switch on your own row. Turning sharing ON is your own choice;
 * turning it OFF sends a request your partner must approve.
 */
export default function LocationScreen() {
  const router = useRouter();
  const { userId, partnerProfile, outgoingRequests, refresh } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Partner';

  const { me, partner, markers, loading, error, reload } = useCoupleLocations();
  const [permState, setPermState] = useState<PermissionState>('undetermined');
  const [busy, setBusy] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let alive = true;
      getLocationState()
        .then((s) => {
          if (alive) setPermState(s);
        })
        .catch(() => undefined);
      return () => {
        alive = false;
      };
    }, []),
  );

  const offPending = outgoingRequests.some((r) => r.action === 'location_off');
  const canOpenMap = !loading && markers.length > 0;

  function openMap(focus?: 'me' | 'partner') {
    if (!canOpenMap) return;
    router.push(focus ? { pathname: '/location-map', params: { focus } } : '/location-map');
  }

  async function onToggle(next: boolean) {
    if (!userId || busy) return;
    setBusy(true);
    try {
      if (next) {
        const result = await enableLocationSharing(userId);
        if (!result.ok) Alert.alert('Location not enabled', result.message ?? 'Please try again.');
        setPermState(await getLocationState());
        await Promise.all([reload(), refresh()]);
      } else {
        const result = await requestApproval('location_off');
        if (!result.ok) {
          Alert.alert('Could not send request', result.message);
          return;
        }
        Alert.alert('Request sent', `${partnerName} needs to approve turning your location sharing off.`);
      }
    } finally {
      setBusy(false);
    }
  }

  // My row: the switch shows on/off, so the text describes what it means.
  const mySub = offPending
    ? `Waiting for ${partnerName} to approve turning this off`
    : !me.sharing
      ? 'Your location is private'
      : undefined;

  return (
    <Screen title="Location" subtitle="Where you both are" right={<GearButton />}>
      <View style={styles.mapCard}>
        {renderMap()}
        {canOpenMap ? (
          <Pressable
            style={styles.tapLayer}
            onPress={() => openMap()}
            accessibilityRole="button"
            accessibilityLabel="Open full map"
          >
            <View style={styles.expandBtn}>
              <Ionicons name="expand-outline" size={18} color={colors.text} />
            </View>
          </Pressable>
        ) : null}
      </View>

      <Card style={styles.panel}>
        <LocationPersonRow
          who="partner"
          person={partner}
          onPress={partner.loc ? () => openMap('partner') : undefined}
        />
        <View style={styles.divider} />
        <LocationPersonRow
          who="me"
          person={me}
          sub={mySub}
          right={
            <Switch
              value={me.sharing}
              onValueChange={onToggle}
              disabled={offPending || busy}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          }
        />
        {me.sharing && permState !== 'granted' ? (
          <Text style={styles.warn} onPress={openAppSettings}>
            Android location permission is {permState === 'denied' ? 'off' : 'not granted'}, so your location
            can&apos;t update. Tap to open Settings.
          </Text>
        ) : null}
      </Card>

      <Text style={styles.note}>
        Turning sharing off needs {partnerName}&apos;s approval. Android permissions stay in your control.
      </Text>
    </Screen>
  );

  function renderMap() {
    if (loading) {
      return (
        <View style={styles.center}>
          <ActivityIndicator color={colors.primary} />
        </View>
      );
    }
    if (error && markers.length === 0) {
      return (
        <View style={styles.center}>
          <Ionicons name="cloud-offline-outline" size={30} color={colors.muted} />
          <Text style={styles.centerText}>Couldn&apos;t load locations.</Text>
          <Text style={styles.retry} onPress={() => void reload()}>
            Try again
          </Text>
        </View>
      );
    }
    if (markers.length > 0) {
      return <PartnerMap markers={markers} mode="preview" />;
    }
    let message = 'Turn on location sharing to see each other here.';
    if (me.sharing && !partner.sharing) message = `${partnerName} isn't sharing their location right now.`;
    else if (!me.sharing && partner.sharing) message = `${partnerName} is sharing. Waiting for their first location.`;
    else if (me.sharing && partner.sharing) message = 'Waiting for the first location update.';
    return (
      <View style={styles.center}>
        <Ionicons name="map-outline" size={30} color={colors.primary} />
        <Text style={styles.centerText}>{message}</Text>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  mapCard: {
    height: 320,
    borderRadius: radius.lg,
    backgroundColor: colors.primarySoft,
    borderWidth: 1,
    borderColor: colors.border,
    overflow: 'hidden',
  },
  tapLayer: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'flex-end',
    justifyContent: 'flex-start',
  },
  expandBtn: {
    margin: spacing.md,
    width: 38,
    height: 38,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm },
  centerText: { ...font.small, color: colors.subtext, textAlign: 'center', lineHeight: 19 },
  retry: { ...font.small, fontWeight: '700', color: colors.primary, paddingVertical: spacing.xs },
  panel: { marginTop: spacing.lg, paddingVertical: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border },
  warn: { ...font.small, color: colors.warning, marginTop: spacing.xs, marginBottom: spacing.xs, lineHeight: 18 },
  note: { ...font.small, color: colors.muted, textAlign: 'center', marginTop: spacing.lg, lineHeight: 18 },
});
