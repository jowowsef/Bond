import { Ionicons } from '@expo/vector-icons';
import { useFocusEffect } from 'expo-router';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  AppState,
  Modal,
  PanResponder,
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  Text,
  TextInput,
  useWindowDimensions,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Avatar } from '@/components/Avatar';
import { Button } from '@/components/Button';
import { Card } from '@/components/Card';
import { SectionHeader } from '@/components/SectionHeader';
import { HeaderActions } from '@/components/HeaderActions';
import { BackgroundLocationStatus } from '@/components/BackgroundLocationStatus';
import { LocationPersonRow } from '@/components/LocationPersonRow';
import { PartnerMap, type PartnerMapHandle } from '@/components/PartnerMap';
import { usePartnerBattery } from '@/hooks/useBattery';
import { useCoupleLocations } from '@/hooks/useCoupleLocations';
import { useLocationSharingSwitch } from '@/hooks/useLocationSharingSwitch';
import { usePullToRefresh } from '@/hooks/usePullToRefresh';
import { timeAgo, shownName } from '@/lib/format';
import { distanceMeters } from '@/lib/location';
import {
  askToTurnOnLocationServices,
  getLocationAccessInfo,
  type LocationAccessInfo,
  updateLocationNow,
} from '@/lib/location';
import { MAP_BACKGROUND } from '@/lib/mapStyle';
import { tintForProfile } from '@/lib/avatar';
import {
  addPlace,
  distanceLabel,
  openDirections,
  PLACE_KINDS,
  placeAt,
  readPlaces,
  removePlace,
  type PlaceKind,
  type SavedPlace,
} from '@/lib/places';
import { openAppSettings } from '@/lib/setupPermissions';
import { colors, font, radius, shadow, spacing, themedStyles, useThemeVersion } from '@/lib/theme';
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
  const { userId, couple, partnerId, partnerProfile, partnerAvatarUrl, refresh } = useCouple();
  const partnerName = shownName(partnerProfile?.display_name, 'Your partner');
  const coupleId = couple?.id ?? null;
  const { battery: partnerBattery } = usePartnerBattery(partnerId);

  // Saved places (this phone only).
  const [places, setPlaces] = useState<SavedPlace[]>([]);
  useEffect(() => {
    if (!userId || !coupleId) return;
    let cancelled = false;
    void readPlaces(userId, coupleId).then((list) => {
      if (!cancelled) setPlaces(list);
    });
    return () => {
      cancelled = true;
    };
  }, [userId, coupleId]);
  const [adding, setAdding] = useState(false);

  // Bottom sheet: collapsed (your partner + directions) or expanded (more).
  const insets = useSafeAreaInsets();
  const { height: screenH } = useWindowDimensions();
  const sheetMax = Math.round(screenH * 0.68);
  const [sheetHeight] = useState(() => new Animated.Value(SHEET_MIN));
  const [expanded, setExpanded] = useState(false);
  const mapRef = useRef<PartnerMapHandle>(null);
  const snapTo = useCallback(
    (open: boolean) => {
      setExpanded(open);
      Animated.spring(sheetHeight, { toValue: open ? sheetMax : SHEET_MIN, useNativeDriver: false, bounciness: 4 }).start();
    },
    [sheetHeight, sheetMax],
  );
  const toggleSheet = () => snapTo(!expanded);
  const pan = useMemo(() => {
    let start = SHEET_MIN;
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) => Math.abs(g.dy) > 6,
      onPanResponderGrant: () => {
        sheetHeight.stopAnimation((v) => {
          start = v;
        });
      },
      onPanResponderMove: (_e, g) => {
        sheetHeight.setValue(Math.max(SHEET_MIN, Math.min(sheetMax, start - g.dy)));
      },
      onPanResponderRelease: (_e, g) => {
        const end = start - g.dy;
        snapTo(g.vy < -0.3 || (g.vy <= 0.3 && end > (SHEET_MIN + sheetMax) / 2));
      },
    });
  }, [sheetHeight, sheetMax, snapTo]);

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
  const myAt = me.loc ? placeAt(me.loc.latitude, me.loc.longitude, places) : null;
  const partnerAt = partner.loc ? placeAt(partner.loc.latitude, partner.loc.longitude, places) : null;
  const partnerWhere = !partner.sharing
    ? 'Location not shared'
    : !partner.loc
      ? 'Waiting for location'
      : partnerAt
        ? `At ${partnerAt.name}`
        : partner.place ?? partner.statusLabel;
  const apart =
    me.loc && partner.loc ? distanceMeters(me.loc.latitude, me.loc.longitude, partner.loc.latitude, partner.loc.longitude) : null;

  function confirmRemove(pl: SavedPlace) {
    if (!userId || !coupleId) return;
    Alert.alert(`Remove ${pl.name}?`, 'It is only removed from this phone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Remove', style: 'destructive', onPress: () => void removePlace(userId, coupleId, pl.id).then(setPlaces) },
    ]);
  }

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
        text: 'Location is approximate. Tap to allow precise location.',
        onPress: openAppSettings,
      };
    } else if (diagnostics.watchError) {
      warning = { text: `Location updates paused: ${diagnostics.watchError}` };
    }
  }

  return (
    <View style={styles.screen}>
      {/* Full-screen map (pan and zoom), with the loading / empty states on top. */}
      <View style={styles.mapFill}>
        {renderMap()}
        {renderOverlay()}
      </View>

      {/* Top: title and the usual header buttons, floating over the map. */}
      <View style={[styles.topBar, { top: insets.top + spacing.sm }]} pointerEvents="box-none">
        <View style={styles.titleChip}>
          <Text style={styles.titleText}>Location</Text>
        </View>
        <View style={styles.actionsChip}>
          <HeaderActions />
        </View>
      </View>

      {/* Recenter: frame both of you again. Sits just above the sheet. */}
      {markers.length > 0 ? (
        <Animated.View style={[styles.recenterWrap, { bottom: Animated.add(sheetHeight, spacing.md) }]}>
          <Pressable
            onPress={() => mapRef.current?.fitAll()}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Show both of you"
            style={({ pressed }) => [styles.roundBtn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="locate-outline" size={20} color={colors.text} />
          </Pressable>
        </Animated.View>
      ) : null}

      {/* Bottom sheet: your partner at a glance; drag up (or tap the handle) for more. */}
      <Animated.View style={[styles.sheet, { height: sheetHeight }]}>
        <View {...pan.panHandlers}>
          <Pressable
            onPress={toggleSheet}
            accessibilityRole="button"
            accessibilityLabel={expanded ? 'Show less' : 'Show more'}
            style={styles.handleArea}
          >
            <View style={styles.handle} />
          </Pressable>
          <Pressable
            onPress={() => (partner.loc ? mapRef.current?.focus('partner') : undefined)}
            style={styles.partnerHead}
            accessibilityRole="button"
            accessibilityLabel={`${partnerName}, ${partnerWhere}`}
          >
            <Avatar name={partnerProfile?.display_name} url={partnerAvatarUrl} size={44} tint={tintForProfile(partnerProfile)} />
            <View style={{ flex: 1 }}>
              <Text style={styles.partnerName} numberOfLines={1}>
                {partnerName}
              </Text>
              <Text style={styles.partnerWhere} numberOfLines={1}>
                {partnerWhere}
                {apart != null ? ` · ${distanceLabel(apart)}` : ''}
              </Text>
            </View>
            {partnerBattery?.level ? (
              <View style={styles.batteryChip}>
                <Ionicons name={partnerBattery.is_charging ? 'battery-charging' : 'battery-half'} size={14} color={colors.success} />
                <Text style={styles.batteryChipText}>{partnerBattery.level}%</Text>
              </View>
            ) : null}
          </Pressable>
        </View>

        <ScrollView
          contentContainerStyle={styles.sheetContent}
          showsVerticalScrollIndicator={false}
          scrollEnabled={expanded}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor={colors.primary} colors={[colors.primary]} />
          }
        >
          <Button
            label={`Directions to ${partnerName}`}
            icon="navigate-outline"
            disabled={!partner.loc}
            onPress={() => partner.loc && void openDirections(partner.loc.latitude, partner.loc.longitude)}
          />
          <View style={styles.tiles}>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>Distance</Text>
              <Text style={styles.tileValue}>{apart != null ? distanceLabel(apart) : '—'}</Text>
            </View>
            <View style={styles.tile}>
              <Text style={styles.tileLabel}>Updated</Text>
              <Text style={styles.tileValue} numberOfLines={1}>
                {partner.loc ? timeAgo(partner.loc.updated_at) : partner.sharing ? 'Waiting' : 'Not shared'}
              </Text>
            </View>
          </View>

          {/* You: your own sharing switch and any problem with it. */}
          <Card style={styles.panel}>
            <LocationPersonRow
              who="me"
              person={me}
              sub={myAt ? `At ${myAt.name}` : mySub}
              onPress={me.loc ? () => mapRef.current?.focus('me') : undefined}
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

          {/* Saved places (this phone only). */}
          <SectionHeader
            title="Places"
            right={
              <Text style={styles.addLink} onPress={() => setAdding(true)} accessibilityRole="button">
                + Add place
              </Text>
            }
          />
          <Card style={{ paddingVertical: places.length ? spacing.xs : spacing.md }}>
            {places.length === 0 ? (
              <Text style={styles.placesEmpty}>
                Save places like Home or School. Only on this phone.
              </Text>
            ) : (
              places.map((pl, i) => {
                const meta = PLACE_KINDS.find((k) => k.kind === pl.kind) ?? PLACE_KINDS[4];
                const here = [
                  me.loc && placeAt(me.loc.latitude, me.loc.longitude, [pl]) ? 'You' : null,
                  partner.loc && placeAt(partner.loc.latitude, partner.loc.longitude, [pl]) ? partnerName : null,
                ].filter(Boolean);
                const from = me.loc ?? null;
                return (
                  <Pressable
                    key={pl.id}
                    onPress={() => void openDirections(pl.lat, pl.lng)}
                    onLongPress={() => confirmRemove(pl)}
                    accessibilityRole="button"
                    accessibilityLabel={`${pl.name}. Tap for directions, hold to remove.`}
                    style={({ pressed }) => [styles.placeRow, i > 0 && styles.placeDivider, pressed && { opacity: 0.7 }]}
                  >
                    <View style={styles.placeIcon}>
                      <Ionicons name={`${meta.icon}-outline` as IconName} size={18} color={colors.primary} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.placeName} numberOfLines={1}>
                        {pl.name}
                      </Text>
                      <Text style={styles.placeSub} numberOfLines={1}>
                        {here.length
                          ? `${here.join(' & ')} ${here.length > 1 ? 'are' : 'is'} here`
                          : from
                            ? distanceLabel(distanceMeters(from.latitude, from.longitude, pl.lat, pl.lng), 'from you')
                            : 'Tap for directions'}
                      </Text>
                    </View>
                    <Ionicons name="navigate-outline" size={18} color={colors.muted} />
                  </Pressable>
                );
              })
            )}
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

        </ScrollView>
      </Animated.View>

      <AddPlaceModal
        visible={adding}
        partnerName={partnerName}
        mine={me.loc ? { lat: me.loc.latitude, lng: me.loc.longitude } : null}
        theirs={partner.loc ? { lat: partner.loc.latitude, lng: partner.loc.longitude } : null}
        onClose={() => setAdding(false)}
        onSave={async (place) => {
          if (!userId || !coupleId) return;
          setPlaces(await addPlace(userId, coupleId, place));
          setAdding(false);
        }}
      />
    </View>
  );

  /**
   * The map itself. Once it has been shown it STAYS mounted for as long as
   * this screen is, even if locations briefly disappear (loading, a reset, a
   * partner pausing). Tearing a MapLibre view down and rebuilding it on every
   * data change is what let camera events reach a destroyed map.
   */
  function renderMap() {
    return mapMounted ? (
      <PartnerMap
        ref={mapRef}
        markers={markers}
        mode="full"
        insets={{ top: insets.top + 64, bottom: SHEET_MIN + 24 }}
        attributionPosition={{ top: insets.top + 64, right: 14 }}
      />
    ) : null;
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

type IconName = React.ComponentProps<typeof Ionicons>['name'];

/** The sheet's collapsed height: handle, your partner and the directions button. */
const SHEET_MIN = 168;

/** Add a saved place from a position Bond already shows (yours or your partner's). */
function AddPlaceModal({
  visible,
  partnerName,
  mine,
  theirs,
  onClose,
  onSave,
}: {
  visible: boolean;
  partnerName: string;
  mine: { lat: number; lng: number } | null;
  theirs: { lat: number; lng: number } | null;
  onClose: () => void;
  onSave: (place: { kind: PlaceKind; name: string; lat: number; lng: number }) => Promise<void>;
}) {
  useThemeVersion();
  const [kind, setKind] = useState<PlaceKind>('home');
  const [name, setName] = useState('Home');
  const [source, setSource] = useState<'mine' | 'theirs'>('mine');
  const [saving, setSaving] = useState(false);
  const point = source === 'mine' ? mine : theirs;

  function pick(k: PlaceKind) {
    setKind(k);
    const label = PLACE_KINDS.find((x) => x.kind === k)?.label ?? '';
    setName(k === 'other' ? '' : label);
  }

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <View style={styles.modalBackdrop}>
        <View style={styles.modalSheet}>
          <Text style={styles.modalTitle}>Add a place</Text>
          <View style={styles.kindRow}>
            {PLACE_KINDS.map((k) => (
              <Pressable
                key={k.kind}
                onPress={() => pick(k.kind)}
                accessibilityRole="radio"
                accessibilityState={{ selected: kind === k.kind }}
                style={[styles.kindChip, kind === k.kind && styles.kindChipOn]}
              >
                <Ionicons name={`${k.icon}-outline` as IconName} size={15} color={kind === k.kind ? '#fff' : colors.primary} />
                <Text style={[styles.kindText, kind === k.kind && { color: '#fff' }]}>{k.label}</Text>
              </Pressable>
            ))}
          </View>
          <TextInput
            value={name}
            onChangeText={setName}
            placeholder="Name (for example Lola's house)"
            placeholderTextColor={colors.muted}
            style={styles.modalInput}
            maxLength={30}
          />
          <Text style={styles.modalLabel}>Where is it?</Text>
          <View style={styles.kindRow}>
            <Pressable
              onPress={() => setSource('mine')}
              disabled={!mine}
              style={[styles.kindChip, source === 'mine' && styles.kindChipOn, !mine && { opacity: 0.4 }]}
            >
              <Text style={[styles.kindText, source === 'mine' && { color: '#fff' }]}>Where I am now</Text>
            </Pressable>
            <Pressable
              onPress={() => setSource('theirs')}
              disabled={!theirs}
              style={[styles.kindChip, source === 'theirs' && styles.kindChipOn, !theirs && { opacity: 0.4 }]}
            >
              <Text style={[styles.kindText, source === 'theirs' && { color: '#fff' }]}>Where {partnerName} is</Text>
            </Pressable>
          </View>
          {!mine && !theirs ? (
            <Text style={styles.placesEmpty}>Turn on location sharing first, so Bond knows where the place is.</Text>
          ) : null}
          <Button
            label="Save place"
            loading={saving}
            disabled={!point || !name.trim()}
            onPress={async () => {
              if (!point) return;
              setSaving(true);
              await onSave({ kind, name: name.trim(), lat: point.lat, lng: point.lng });
              setSaving(false);
              setKind('home');
              setName('Home');
              setSource('mine');
            }}
            style={{ marginTop: spacing.lg }}
          />
          <Button label="Cancel" variant="ghost" onPress={onClose} />
        </View>
      </View>
    </Modal>
  );
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
  screen: { flex: 1, backgroundColor: MAP_BACKGROUND },
  mapFill: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: MAP_BACKGROUND },
  topBar: { position: 'absolute', left: spacing.lg, right: spacing.lg, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  titleChip: { backgroundColor: colors.card, borderRadius: radius.pill, paddingHorizontal: spacing.lg, paddingVertical: spacing.sm, ...shadow, elevation: 4 },
  titleText: { ...font.h3, color: colors.text },
  actionsChip: { backgroundColor: colors.card, borderRadius: radius.pill, padding: 4, ...shadow, elevation: 4 },
  recenterWrap: { position: 'absolute', right: spacing.lg },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    ...shadow,
    elevation: 4,
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.background,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    overflow: 'hidden',
    ...shadow,
    elevation: 10,
  },
  handleArea: { alignItems: 'center', paddingTop: spacing.sm, paddingBottom: spacing.sm },
  handle: { width: 40, height: 5, borderRadius: 3, backgroundColor: colors.border },
  sheetContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xxl, gap: spacing.md },
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
  panel: { paddingVertical: spacing.sm },
  partnerHead: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingHorizontal: spacing.lg, paddingBottom: spacing.md },
  partnerName: { ...font.h3, color: colors.text },
  partnerWhere: { ...font.small, color: colors.subtext, marginTop: 1 },
  batteryChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.sm,
    paddingVertical: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.successSoft,
  },
  batteryChipText: { ...font.small, fontWeight: '700', color: colors.success },
  tiles: { flexDirection: 'row', gap: spacing.sm },
  tile: { flex: 1, backgroundColor: colors.card, borderRadius: radius.md, padding: spacing.md, borderWidth: 1, borderColor: colors.border },
  tileLabel: { ...font.tiny, color: colors.muted, letterSpacing: 0 },
  tileValue: { ...font.h3, color: colors.text, marginTop: 2 },
  addLink: { ...font.small, fontWeight: '700', color: colors.primary },
  placesEmpty: { ...font.small, color: colors.muted, lineHeight: 19 },
  placeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: spacing.md },
  placeDivider: { borderTopWidth: 1, borderTopColor: colors.border },
  placeIcon: { width: 36, height: 36, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: 'center', justifyContent: 'center' },
  placeName: { ...font.body, fontWeight: '700', color: colors.text },
  placeSub: { ...font.small, color: colors.subtext, marginTop: 1 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  modalSheet: {
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    padding: spacing.xl,
    gap: spacing.sm,
  },
  modalTitle: { ...font.h2, color: colors.text, marginBottom: spacing.xs },
  modalLabel: { ...font.small, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  modalInput: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
    marginTop: spacing.sm,
  },
  kindRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  kindChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: spacing.md,
    paddingVertical: 8,
    borderRadius: radius.pill,
    backgroundColor: colors.primarySoft,
  },
  kindChipOn: { backgroundColor: colors.primary },
  kindText: { ...font.small, fontWeight: '700', color: colors.primary },
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
