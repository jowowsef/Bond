import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useNavigation, useRouter } from 'expo-router';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocationPersonRow } from '@/components/LocationPersonRow';
import { PartnerMap, type PartnerMapHandle } from '@/components/PartnerMap';
import { useCoupleLocations } from '@/hooks/useCoupleLocations';
import { MAP_BACKGROUND } from '@/lib/mapStyle';
import { colors, font, radius, spacing, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * Fullscreen couple map.
 *
 * Reads the same shared live data as the Location tab (one subscription, no
 * extra location watcher). The map frames both people once when it opens and
 * then stays where you pan it; new positions move the pins without moving the
 * camera. The recenter button frames everyone again, and tapping a person in
 * the bottom panel centers on them.
 */
export default function LocationMap() {
  useThemeVersion();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { me, partner, markers, loading } = useCoupleLocations();
  const mapRef = useRef<PartnerMapHandle>(null);
  const [panelHeight, setPanelHeight] = useState(0);
  // Turn the map with the phone's compass (off = north up; two fingers still rotate).
  const [followHeading, setFollowHeading] = useState(false);
  const navigation = useNavigation();
  const closingRef = useRef(false);

  const hasMarkers = markers.length > 0;

  // Mount the map once there is something to frame and the bottom panel is
  // measured (so the first framing keeps pins clear of it), then keep it.
  const [mapMounted, setMapMounted] = useState(false);
  useEffect(() => {
    if (hasMarkers && panelHeight > 0) setMapMounted(true);
  }, [hasMarkers, panelHeight]);

  // Before this screen is removed (close button OR Android back), stop any
  // camera transition still running (recenter, focus, a fling). Otherwise
  // MapLibre can deliver a camera event to the destroyed map, which logs
  // "latLngForPixel after the MapView was destroyed". If a transition was
  // running, we cancel it, wait two frames for MapLibre to settle, then close.
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (closingRef.current) return; // second pass: let it close
      const wasMoving = mapRef.current?.stopCamera() ?? false;
      if (!wasMoving) return;
      e.preventDefault();
      closingRef.current = true;
      requestAnimationFrame(() => requestAnimationFrame(() => navigation.dispatch(e.data.action)));
    });
    return unsubscribe;
  }, [navigation]);

  return (
    <View style={styles.screen}>
      {/* Map (or a clean empty/loading state). Rendered once the bottom panel
          is measured, so the first framing keeps pins clear of the panel. */}
      <View style={[StyleSheet.absoluteFill, styles.mapArea]}>
        {/* Once mounted, the map stays mounted while this screen is open,
            even if locations briefly disappear (see PartnerMap lifecycle). */}
        {mapMounted ? (
          <PartnerMap
            ref={mapRef}
            mode="full"
            markers={markers}
            initialFocusId={focus}
            insets={{ top: insets.top + 48, bottom: panelHeight }}
            attributionPosition={{ top: insets.top + 14, right: 14 }}
            followHeading={followHeading}
          />
        ) : null}
        {!hasMarkers ? (
          <View style={[StyleSheet.absoluteFill, styles.mapArea, styles.center, { paddingBottom: panelHeight }]}>
            {loading ? (
              <ActivityIndicator color={colors.me} />
            ) : (
              <>
                <Ionicons name="map-outline" size={40} color={colors.me} />
                <Text style={styles.emptyText}>No locations to show yet.</Text>
              </>
            )}
          </View>
        ) : null}
      </View>

      {/* Close, kept inside the top safe area. */}
      <Pressable
        onPress={() => router.back()}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel="Close map"
        style={({ pressed }) => [styles.roundBtn, { top: insets.top + spacing.sm, left: spacing.lg }, pressed && styles.pressed]}
      >
        <Ionicons name="close" size={22} color={colors.text} />
      </Pressable>

      {/* Rotate with phone (compass). Sits above the recenter button. */}
      {hasMarkers && panelHeight > 0 ? (
        <Pressable
          onPress={() => setFollowHeading((v) => !v)}
          hitSlop={8}
          accessibilityRole="switch"
          accessibilityState={{ checked: followHeading }}
          accessibilityLabel="Rotate map with phone"
          style={({ pressed }) => [
            styles.roundBtn,
            { bottom: panelHeight + spacing.md + 44 + spacing.sm, right: spacing.lg },
            followHeading && { backgroundColor: colors.primarySoft, borderColor: colors.primary },
            pressed && styles.pressed,
          ]}
        >
          <Ionicons name={followHeading ? 'compass' : 'compass-outline'} size={22} color={followHeading ? colors.primary : colors.text} />
        </Pressable>
      ) : null}

      {/* Recenter: frame everyone again. Sits just above the bottom panel. */}
      {hasMarkers && panelHeight > 0 ? (
        <Pressable
          onPress={() => mapRef.current?.fitAll()}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel="Show everyone"
          style={({ pressed }) => [styles.roundBtn, { bottom: panelHeight + spacing.md, right: spacing.lg }, pressed && styles.pressed]}
        >
          <Ionicons name="locate-outline" size={21} color={colors.text} />
        </Pressable>
      ) : null}

      {/* Compact bottom panel, clear of the Android navigation bar. */}
      <View
        style={[styles.panel, { paddingBottom: insets.bottom + spacing.md }]}
        onLayout={(e) => setPanelHeight(Math.round(e.nativeEvent.layout.height))}
      >
        <LocationPersonRow
          who="partner"
          person={partner}
          onPress={partner.loc ? () => mapRef.current?.focus('partner') : undefined}
        />
        <View style={styles.divider} />
        <LocationPersonRow
          who="me"
          person={me}
          sub={me.sharing ? undefined : 'Your location is private'}
          onPress={me.loc ? () => mapRef.current?.focus('me') : undefined}
        />
      </View>
    </View>
  );
}

const styles = themedStyles(() => ({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyText: { ...font.body, color: '#B9B9B9', textAlign: 'center' },
  mapArea: { backgroundColor: MAP_BACKGROUND },
  roundBtn: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F2A44',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pressed: { opacity: 0.7 },
  panel: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colors.card,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    shadowColor: '#1F2A44',
    shadowOpacity: 0.08,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: -2 },
    elevation: 8,
  },
  divider: { height: 1, backgroundColor: colors.border },
}));
