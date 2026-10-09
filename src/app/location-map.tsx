import { Ionicons } from '@expo/vector-icons';
import { useLocalSearchParams, useRouter } from 'expo-router';
import React, { useRef, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LocationPersonRow } from '@/components/LocationPersonRow';
import { PartnerMap, type PartnerMapHandle } from '@/components/PartnerMap';
import { useCoupleLocations } from '@/hooks/useCoupleLocations';
import { colors, font, radius, spacing } from '@/lib/theme';

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
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { focus } = useLocalSearchParams<{ focus?: string }>();
  const { me, partner, markers, loading } = useCoupleLocations();
  const mapRef = useRef<PartnerMapHandle>(null);
  const [panelHeight, setPanelHeight] = useState(0);

  const hasMarkers = markers.length > 0;

  return (
    <View style={styles.screen}>
      {/* Map (or a clean empty/loading state). Rendered once the bottom panel
          is measured, so the first framing keeps pins clear of the panel. */}
      <View style={StyleSheet.absoluteFill}>
        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : !hasMarkers ? (
          <View style={[styles.center, { paddingBottom: panelHeight }]}>
            <Ionicons name="map-outline" size={40} color={colors.primary} />
            <Text style={styles.emptyText}>No locations to show yet.</Text>
          </View>
        ) : panelHeight > 0 ? (
          <PartnerMap
            ref={mapRef}
            mode="full"
            markers={markers}
            initialFocusId={focus}
            insets={{ top: insets.top + 48, bottom: panelHeight }}
            attributionPosition={{ top: insets.top + 14, right: 14 }}
          />
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.md },
  emptyText: { ...font.body, color: colors.subtext, textAlign: 'center' },
  roundBtn: {
    position: 'absolute',
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(255,255,255,0.96)',
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
});
