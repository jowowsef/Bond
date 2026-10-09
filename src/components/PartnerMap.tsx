import { Ionicons } from '@expo/vector-icons';
import { Camera, Map, ViewAnnotation, type CameraRef } from '@maplibre/maplibre-react-native';
import React, { forwardRef, useImperativeHandle, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { colors, fontFamily } from '@/lib/theme';

/**
 * Bond's couple map (MapLibre v11 + OpenFreeMap "liberty", no API key).
 *
 * Map data is from OpenStreetMap contributors (ODbL). MapLibre's attribution
 * control stays on and a small visible credit is shown as well.
 *
 * Two modes:
 *  - mode="preview": still snapshot (no gestures). The camera re-frames
 *    automatically whenever positions change.
 *  - mode="full": pan, pinch-zoom, double-tap zoom. The camera frames the
 *    markers once on open, then stays where the user puts it, so live
 *    updates never yank the view. Use the ref (fitAll / focus) to re-frame.
 *
 * Markers: you in Bond blue, your partner in Bond pink, each showing their
 * photo or initial. A stale position is faded with a small clock badge, so an
 * old location never looks live.
 */
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  name?: string | null;
  photoUrl?: string | null;
  stale?: boolean;
};

export type PartnerMapHandle = {
  /** Re-frame so every marker is visible. */
  fitAll: () => void;
  /** Center on one marker by id. */
  focus: (id: string) => void;
};

type Edges = { top: number; bottom: number; left: number; right: number };

type Framing =
  | { kind: 'bounds'; bounds: [number, number, number, number]; padding: Edges }
  | { kind: 'center'; center: [number, number]; zoom: number };

/**
 * How to frame the markers. Two far-apart people: fit both. Two people very
 * close together (or one person): center with a sensible street-level zoom,
 * so we never zoom all the way in on a tiny box.
 */
function frame(markers: MapMarker[], padding: Edges): Framing {
  if (markers.length >= 2) {
    const lats = markers.map((m) => m.lat);
    const lngs = markers.map((m) => m.lng);
    const spread = Math.max(Math.max(...lats) - Math.min(...lats), Math.max(...lngs) - Math.min(...lngs));
    if (spread > 0.002) {
      return {
        kind: 'bounds',
        bounds: [Math.min(...lngs), Math.min(...lats), Math.max(...lngs), Math.max(...lats)],
        padding,
      };
    }
    const lat = (Math.min(...lats) + Math.max(...lats)) / 2;
    const lng = (Math.min(...lngs) + Math.max(...lngs)) / 2;
    return { kind: 'center', center: [lng, lat], zoom: 15 };
  }
  return { kind: 'center', center: [markers[0].lng, markers[0].lat], zoom: 15 };
}

export const PartnerMap = forwardRef<
  PartnerMapHandle,
  {
    markers: MapMarker[];
    mode?: 'preview' | 'full';
    /** Extra space to keep clear (e.g. under a bottom panel), in points. */
    insets?: Partial<Edges>;
    /** Where to put the map's attribution button (defaults to bottom-right). */
    attributionPosition?: React.ComponentProps<typeof Map>['attributionPosition'];
    /** Full mode only: open centered on this marker instead of framing all. */
    initialFocusId?: string;
  }
>(function PartnerMap({ markers, mode = 'full', insets, attributionPosition, initialFocusId }, ref) {
  const cameraRef = useRef<CameraRef>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;

  const full = mode === 'full';
  const padding: Edges = {
    top: 70 + (insets?.top ?? 0),
    bottom: 70 + (insets?.bottom ?? 0),
    left: 60 + (insets?.left ?? 0),
    right: 60 + (insets?.right ?? 0),
  };

  useImperativeHandle(ref, () => ({
    fitAll: () => {
      const list = markersRef.current;
      if (list.length === 0) return;
      const f = frame(list, padding);
      if (f.kind === 'bounds') cameraRef.current?.fitBounds(f.bounds, { padding: f.padding, duration: 600 });
      else cameraRef.current?.easeTo({ center: f.center, zoom: f.zoom, duration: 600 });
    },
    focus: (id: string) => {
      const m = markersRef.current.find((x) => x.id === id);
      if (m) cameraRef.current?.easeTo({ center: [m.lng, m.lat], zoom: 16, duration: 600 });
    },
  }));

  const f = frame(markers, padding);
  const focused = full && initialFocusId ? markers.find((m) => m.id === initialFocusId) : undefined;
  // Preview: controlled camera (follows new positions). Full: frame only once.
  const cameraProps: React.ComponentProps<typeof Camera> = full
    ? {
        initialViewState: focused
          ? { center: [focused.lng, focused.lat], zoom: 16 }
          : f.kind === 'bounds'
            ? { bounds: f.bounds, padding: f.padding }
            : { center: f.center, zoom: f.zoom },
      }
    : f.kind === 'bounds'
      ? { bounds: f.bounds, padding: f.padding, duration: 500 }
      : { center: f.center, zoom: f.zoom, duration: 500 };

  return (
    <View style={styles.wrap}>
      <Map
        style={styles.map}
        mapStyle={STYLE_URL}
        logo={false}
        attribution
        attributionPosition={attributionPosition ?? { bottom: (insets?.bottom ?? 0) + 6, right: 8 }}
        compass={false}
        dragPan={full}
        touchZoom={full}
        doubleTapZoom={full}
        touchRotate={false}
        touchPitch={false}
      >
        <Camera ref={cameraRef} {...cameraProps} />
        {markers.map((m) => (
          <ViewAnnotation key={m.id} id={m.id} lngLat={[m.lng, m.lat]} anchor="bottom">
            <MapPin marker={m} />
          </ViewAnnotation>
        ))}
      </Map>
      <Text style={[styles.credit, insets?.bottom ? { bottom: insets.bottom + 6 } : null]}>
        {'© OpenStreetMap'}
      </Text>
    </View>
  );
});

/** Avatar pin: colored ring, photo or initial inside, small pointer below. */
function MapPin({ marker }: { marker: MapMarker }) {
  return (
    <View style={[styles.pinWrap, marker.stale && styles.pinStale]}>
      <View style={[styles.pinHead, { backgroundColor: marker.color }]}>
        <Avatar name={marker.name} url={marker.photoUrl} size={34} tint={marker.color} ring="#FFFFFF" />
      </View>
      <View style={[styles.pinTail, { borderTopColor: marker.color }]} />
      {marker.stale ? (
        <View style={styles.staleBadge}>
          <Ionicons name="time" size={11} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, overflow: 'hidden' },
  map: { flex: 1 },
  pinWrap: { alignItems: 'center' },
  pinStale: { opacity: 0.6 },
  pinHead: {
    width: 42,
    height: 42,
    borderRadius: 21,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#1F2A44',
    shadowOpacity: 0.2,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  pinTail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: 8,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  staleBadge: {
    position: 'absolute',
    top: -2,
    right: -4,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: colors.subtext,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  credit: {
    position: 'absolute',
    bottom: 6,
    left: 8,
    fontFamily,
    fontSize: 9,
    color: colors.subtext,
    backgroundColor: 'rgba(255,255,255,0.75)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
});
