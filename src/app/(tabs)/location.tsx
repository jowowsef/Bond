import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect, useRouter } from 'expo-router';
import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, RefreshControl, Switch, Text, View } from 'react-native';
import { Card } from '@/components/Card';
import { HeaderActions } from '@/components/HeaderActions';
import { BackgroundLocationStatus } from '@/components/BackgroundLocationStatus';
import { LocationPersonRow } from '@/components/LocationPersonRow';
import { PartnerMap } from '@/components/PartnerMap';
import { Screen } from '@/components/Screen';
import { useCoupleLocations } from '@/hooks/useCoupleLocations';
import { useLocationSharingSwitch } from '@/hooks/useLocationSharingSwitch';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { timeAgo } from '@/lib/format';
import {
  askToTurnOnLocationServices,
  getLocationAccessInfo,
  type LocationAccessInfo,
  updateLocationNow,
} from '@/lib/location';
import { MAP_BACKGROUND } from '@/lib/mapStyle';
import { openAppSettings } from '@/lib/setupPermissions';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
import { useCouple } from '@/state/couple';

/**
 * LOCATION, map first and consent based.
 *
 * The map preview is the main element; tap it (or a person) to open the
 * fullscreen map. Below it, one compact panel shows each person once, with
 * your sharing switch on your own row. Sharing is each person's own choice:
 * turning it ON or OFF takes effect right away, with no approval needed.
 *
 * "Location details" (collapsed) shows accuracy and timing so a wrong-looking
 * position can be traced to the phone's GPS, the upload, or the map.
 */
export default function LocationScreen() {
  useThemeVersion();
  const router = useRouter();
  const { userId, partnerProfile, refresh } = useCouple();
  const partnerName = partnerProfile?.display_name ?? 'Partner';

  const { me, partner, markers, loading, error, reload, diagnostics } = useCoupleLocations();
  const [access, setAccess] = useState<LocationAccessInfo | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  // Mount the map the first time there is something to show, then keep it.
  const [mapMounted, setMapMounted] = useState(false);
  useEffect(() => {
    if (markers.length > 0) setMapMounted(true);
  }, [markers.length]);

  const readAccess = useCallback(() => {
    getLocationAccessInfo()
      .then(setAccess)
      .catch(() => undefined);
  }, []);

  // Re-check what Android allows on focus and when returning from Settings.
  useFocusEffect(
    useCallback(() => {
      readAccess();
    }, [readAccess]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') readAccess();
    });
    return () => sub.remove();
  }, [readAccess]);

  // Pull to refresh: re-read both locations and what Android allows, and if
  // I share my location, take one fresh GPS reading. GPS can be slow, so the
  // spinner stops after 10 s; the reading is still sent when it arrives.
  const { refreshing, onRefresh } = usePullToRefresh(async () => {
    readAccess();
    const fresh =
      me.sharing
        ? Promise.race([updateLocationNow(), new Promise<void>((r) => setTimeout(r, 10_000))]).catch(() => undefined)
        : Promise.resolve();
    await Promise.all([reload(), fresh]);
    await reload(); // pick up the new reading if it was already uploaded
  });

  const canOpenMap = !loading && markers.length > 0;

  function openMap(focus?: 'me' | 'partner') {
    if (!canOpenMap) return;
    router.push(focus ? { pathname: '/location-map', params: { focus } } : '/location-map');
  }

  // Own switch only, no partner approval. Same logic as Settings > Privacy.
  const sharingSwitch = useLocationSharingSwitch({
    userId,
    partnerName,
    onChanged: async () => {
      readAccess();
      await Promise.all([reload(), refresh()]);
    },
  });

  // My row: the switch shows on/off, so the text describes what it means.
  const mySub = !me.sharing ? 'Your location is private' : undefined;

  // At most one problem is shown, the most important first.
  let warning: { text: string; onPress?: () => void } | null = null;
  if (me.sharing && access) {
    if (access.permission !== 'granted') {
      warning = {
        text: "Location permission is off, so your location can't update. Tap to open Settings.",
        onPress: openAppSettings,
      };
    } else if (!access.servicesOn) {
      warning = {
        text: "Your phone's location is turned off. Tap to turn it on.",
        onPress: () => {
          void askToTurnOnLocationServices().then(readAccess);
        },
      };
    } else if (access.precise === false) {
      warning = {
        text: 'Bond only has approximate location, so your position can be off by a few kilometers. Tap to allow precise location.',
        onPress: openAppSettings,
      };
    } else if (diagnostics.watchError) {
      warning = { text: `Location updates paused: ${diagnostics.watchError}` };
    }
  }

  return (
    <Screen
      title="Location"
      right={<HeaderActions />}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
      }
    >
      <View style={styles.mapCard}>
        {renderMap()}
        {renderOverlay()}
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
              value={sharingSwitch.pending ?? me.sharing}
              onValueChange={sharingSwitch.request}
              disabled={sharingSwitch.busy}
              trackColor={{ true: colors.primary, false: colors.border }}
              thumbColor="#fff"
            />
          }
        />
        <BackgroundLocationStatus
          sharing={me.sharing}
          partnerName={partnerName}
          quietWithoutPermission
          style={{ borderTopWidth: 1, borderTopColor: colors.border, marginTop: spacing.sm }}
        />
        {warning ? (
          <Text style={styles.warn} onPress={warning.onPress}>
            {warning.text}
          </Text>
        ) : null}
      </Card>

      <Pressable
        style={styles.detailsToggle}
        onPress={() => setShowDetails((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: showDetails }}
      >
        <Text style={styles.detailsToggleText}>Location details</Text>
        <Ionicons name={showDetails ? 'chevron-up' : 'chevron-down'} size={16} color={colors.muted} />
      </Pressable>
      {showDetails ? renderDetails() : null}

      <Text style={styles.note}>
        You can turn sharing on or off anytime. {partnerName} sees the change in Activity. Android permissions stay in your control.
      </Text>
    </Screen>
  );

  /**
   * The map itself. Once it has been shown it STAYS mounted for as long as
   * this screen is, even if locations briefly disappear (loading, a reset, a
   * partner pausing). Tearing a MapLibre view down and rebuilding it on every
   * data change is what let camera events reach a destroyed map.
   */
  function renderMap() {
    return mapMounted ? <PartnerMap markers={markers} mode="preview" /> : null;
  }

  /** Loading / error / empty states, drawn ON TOP of the map instead of replacing it. */
  function renderOverlay() {
    if (markers.length > 0) return null;
    let content: React.ReactNode;
    if (loading) {
      content = <ActivityIndicator color={colors.me} />;
    } else if (error) {
      content = (
        <>
          <Ionicons name="cloud-offline-outline" size={30} color={colors.me} />
          <Text style={styles.centerText}>Couldn&apos;t load locations.</Text>
          <Text style={styles.retry} onPress={() => void reload()}>
            Try again
          </Text>
        </>
      );
    } else {
      let message = 'Turn on location sharing to see each other here.';
      if (me.sharing && !partner.sharing) message = `${partnerName} isn't sharing their location right now.`;
      else if (!me.sharing && partner.sharing) message = `${partnerName} is sharing. Waiting for their first location.`;
      else if (me.sharing && partner.sharing) message = 'Waiting for the first location update.';
      content = (
        <>
          <Ionicons name="map-outline" size={30} color={colors.me} />
          <Text style={styles.centerText}>{message}</Text>
        </>
      );
    }
    return <View style={styles.overlay}>{content}</View>;
  }

  function renderDetails() {
    const fix = diagnostics.lastFix;
    const ago = (ms: number | null | undefined) => (ms ? timeAgo(new Date(ms).toISOString()) : null);
    const permissionLabel = !access
      ? 'Checking...'
      : access.permission !== 'granted'
        ? 'Not allowed'
        : access.precise === false
          ? 'Allowed (approximate only)'
          : 'Allowed';
    // Three separate things, never mixed up:
    //  1. Android permission on THIS phone (only this phone's owner can change it)
    //  2. My sharing switch in Bond
    //  3. Whether my partner can actually see me right now (needs both, plus a reading)
    const visibleToPartner = !me.sharing
      ? 'No, sharing is off'
      : access && access.permission !== 'granted'
        ? 'No, permission is off on this phone'
        : access && !access.servicesOn
          ? 'No, phone location is off'
          : me.loc
            ? 'Yes'
            : 'Not yet, waiting for a location';

    return (
      <Card style={styles.details}>
        <Text style={styles.detailsHeading}>Your phone</Text>
        <DetailRow label="Android permission" value={permissionLabel} />
        <DetailRow label="Phone location" value={!access ? 'Checking...' : access.servicesOn ? 'On' : 'Off'} />
        <DetailRow label="Your sharing" value={me.sharing ? 'On' : 'Off'} />
        <DetailRow label={`${partnerName} can see you`} value={visibleToPartner} />
        <DetailRow
          label="Last update"
          value={fix ? ago(fix.timestamp) ?? 'Unknown' : me.sharing ? 'Waiting' : 'Sharing off'}
        />
        {access && access.permission !== 'granted' ? (
          <Text style={styles.detailAction} onPress={openAppSettings} accessibilityRole="button">
            Open this phone&apos;s app settings
          </Text>
        ) : null}
        {__DEV__ && fix ? (
          <DetailRow label="Coordinates (dev only)" value={`${fix.lat.toFixed(6)}, ${fix.lng.toFixed(6)}`} />
        ) : null}
        {__DEV__ && diagnostics.lastRejected ? (
          <DetailRow
            label="Last ignored (dev only)"
            value={`${diagnostics.lastRejected.reason}, ${ago(diagnostics.lastRejected.at)}`}
          />
        ) : null}

        <Text style={[styles.detailsHeading, { marginTop: spacing.md }]}>{partnerName}</Text>
        <DetailRow label="Their sharing" value={partner.sharing ? 'On' : 'Off'} />
        <DetailRow
          label="Last update"
          value={partner.loc ? timeAgo(partner.loc.updated_at) : partner.sharing ? 'Waiting' : 'Sharing off'}
        />
      </Card>
    );
  }
}

function DetailRow({ label, value }: { label: string; value: string }) {
  useThemeVersion();
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} numberOfLines={2}>
        {value}
      </Text>
    </View>
  );
}

const styles = themedStyles(() => ({
  mapCard: {
    height: 320,
    borderRadius: radius.lg,
    backgroundColor: MAP_BACKGROUND,
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
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: MAP_BACKGROUND,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.xl,
    gap: spacing.sm,
  },
  centerText: { ...font.small, color: '#B9B9B9', textAlign: 'center', lineHeight: 19 },
  retry: { ...font.small, fontWeight: '700', color: colors.me, paddingVertical: spacing.xs },
  panel: { marginTop: spacing.lg, paddingVertical: spacing.sm },
  divider: { height: 1, backgroundColor: colors.border },
  warn: { ...font.small, color: colors.warning, marginTop: spacing.xs, marginBottom: spacing.xs, lineHeight: 18 },
  detailsToggle: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.md,
    paddingVertical: spacing.sm,
  },
  detailsToggleText: { ...font.small, fontWeight: '600', color: colors.muted },
  details: { paddingVertical: spacing.md },
  detailsHeading: { ...font.tiny, color: colors.muted, textTransform: 'uppercase', marginBottom: spacing.xs },
  detailRow: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.md, paddingVertical: 5 },
  detailLabel: { ...font.small, color: colors.subtext },
  detailValue: { ...font.small, fontWeight: '600', color: colors.text, flexShrink: 1, textAlign: 'right' },
  detailAction: { ...font.small, fontWeight: '700', color: colors.primary, marginTop: spacing.sm },
  note: { ...font.small, color: colors.muted, textAlign: 'center', marginTop: spacing.md, lineHeight: 18 },
}));
