import { Ionicons } from '@expo/vector-icons';
import {
  Camera,
  GeoJSONSource,
  Layer,
  Map,
  Marker,
  type CameraRef,
  type CameraStop,
} from '@maplibre/maplibre-react-native';
import React, { forwardRef, memo, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import * as Location from 'expo-location';
import { ActivityIndicator, Text, View } from 'react-native';
import { Avatar } from './Avatar';
import { distanceMeters } from '@/lib/location';
import { MAP_BACKGROUND, useDarkMapStyle } from '@/lib/mapStyle';
import { colors, fontFamily, themedStyles, useThemeVersion } from '@/lib/theme';

/**
 * Bond's couple map (MapLibre v11 + OpenFreeMap "liberty", recolored dark).
 *
 * Map data is from OpenStreetMap contributors via OpenMapTiles. MapLibre's
 * attribution control stays on and a small visible credit is shown as well.
 *
 * Two modes:
 *  - mode="preview": still snapshot (no gestures). The camera jumps (no
 *    animation) to the new framing whenever positions change.
 *  - mode="full": pan, pinch-zoom, double-tap zoom. The camera frames the
 *    markers once on open, then stays where the user puts it. Use the ref
 *    (fitAll / focus) to re-frame.
 *
 * LIFECYCLE (why the camera code is careful): MapLibre's Android view builds a
 * "view state" on every camera move/idle event, which calls latLngForPixel.
 * If the map is destroyed while a camera transition is still running, the
 * next event reaches a destroyed map and logs "latLngForPixel after the
 * MapView was destroyed". So:
 *  - the preview never animates its camera (instant jumps have no transition
 *    left running when the view goes away),
 *  - the parent keeps the preview mounted instead of remounting it on every
 *    data change,
 *  - stopCamera() cancels a running transition (fitAll, focus, a fling)
 *    before a screen closes,
 *  - every camera call checks the map is still mounted and swallows errors
 *    from a map that is already gone.
 *
 * Honesty rules for what is drawn: markers sit on the exact received
 * coordinate; a soft halo shows the reported accuracy; small moves are eased,
 * big jumps are shown as jumps; live = green dot, stale = faded with a clock.
 */

export type Freshness = 'live' | 'recent' | 'stale';

export type MapMarker = {
  id: string;
  lat: number;
  lng: number;
  color: string;
  name?: string | null;
  photoUrl?: string | null;
  /** Reported accuracy radius in meters, when known. */
  accuracyM?: number | null;
  freshness: Freshness;
  /** Circle color behind the initials (the person's chosen avatar color), like ProfileAvatar. */
  tint?: string;
};

export type PartnerMapHandle = {
  /** Re-frame so every marker is visible. */
  fitAll: () => void;
  /** Center on one marker by id. */
  focus: (id: string) => void;
  /**
   * Cancel any running camera transition by jumping to where the camera is
   * right now. Call before the screen showing this map closes. Returns true
   * if a transition was running.
   */
  stopCamera: () => boolean;
};

type Edges = { top: number; bottom: number; left: number; right: number };

type Framing =
  | { kind: 'bounds'; bounds: [number, number, number, number]; padding: Edges }
  | { kind: 'center'; center: [number, number]; zoom: number };

type CameraProps = React.ComponentProps<typeof Camera>;

/** Halos smaller than this are hidden under the pin anyway. */
const MIN_HALO_M = 20;
/** Cap the drawn halo; the real number is still shown in the details. */
const MAX_HALO_M = 3000;
/** Moves longer than this are shown as a jump, never animated. */
const MAX_ANIMATED_MOVE_M = 400;
const MOVE_ANIMATION_MS = 600;
/** User-requested camera moves (recenter, tap-to-focus). */
const CAMERA_MOVE_MS = 700;

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

/** A circle polygon of `radiusM` meters around a point (for the accuracy halo). */
function circlePolygon(lng: number, lat: number, radiusM: number, steps = 48): [number, number][] {
  const dLat = radiusM / 111320;
  const dLng = radiusM / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  const ring: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = (2 * Math.PI * i) / steps;
    ring.push([lng + dLng * Math.cos(t), lat + dLat * Math.sin(t)]);
  }
  return ring;
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
    /**
     * Full mode only: turn the map with the phone's compass (like a paper map
     * held in your hand). Off = north up; two-finger rotation still works.
     */
    followHeading?: boolean;
  }
>(function PartnerMap({ markers, mode = 'full', insets, attributionPosition, initialFocusId, followHeading = false }, ref) {
  useThemeVersion();
  const mapStyle = useDarkMapStyle();
  const cameraRef = useRef<CameraRef>(null);
  const markersRef = useRef(markers);
  markersRef.current = markers;

  // Lifecycle guards and live camera state (refs only; no re-renders).
  const mountedRef = useRef(false);
  const movingRef = useRef(false);
  const viewRef = useRef<{ center: [number, number]; zoom: number } | null>(null);
  /** When we last asked the camera to animate (events reach JS a bit later). */
  const lastCommandAtRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const full = mode === 'full';
  const padding: Edges = {
    top: 70 + (insets?.top ?? 0),
    bottom: 70 + (insets?.bottom ?? 0),
    left: 60 + (insets?.left ?? 0),
    right: 60 + (insets?.right ?? 0),
  };
  const paddingRef = useRef(padding);
  paddingRef.current = padding;

  /** Send a camera stop only to a live map, and never let a failure escape. */
  const runStop = (stop: CameraStop) => {
    const camera = cameraRef.current;
    if (!mountedRef.current || !camera) return;
    try {
      camera.setStop(stop).catch(() => undefined);
    } catch {
      // The native map isn't ready or is already gone; nothing to move.
    }
  };

  // Compass rotation (full map only). Only real changes are applied (3 deg or
  // more, at most ~8 per second) with a short linear ease, so the map turns
  // smoothly without jitter or camera jumps. Markers keep their positions;
  // only the camera's bearing changes. Needs no extra permission
  // (true north when location is allowed, magnetic north otherwise).
  const headingWasOnRef = useRef(false);
  useEffect(() => {
    if (!full) return;
    if (!followHeading) {
      if (headingWasOnRef.current) {
        headingWasOnRef.current = false;
        runStop({ bearing: 0, duration: 300, easing: 'ease' }); // back to north up
      }
      return;
    }
    headingWasOnRef.current = true;
    let cancelled = false;
    let sub: { remove: () => void } | null = null;
    let last = Number.NaN;
    let lastAt = 0;
    Location.watchHeadingAsync((h) => {
      const deg = h.trueHeading >= 0 ? h.trueHeading : h.magHeading;
      if (!Number.isFinite(deg) || deg < 0) return;
      const now = Date.now();
      const delta = Number.isNaN(last) ? 360 : Math.abs(((deg - last + 540) % 360) - 180);
      if (delta < 3 || now - lastAt < 120) return;
      last = deg;
      lastAt = now;
      runStop({ bearing: deg, duration: 150, easing: 'linear' });
    })
      .then((s) => {
        if (cancelled) s.remove();
        else sub = s;
      })
      .catch(() => undefined); // no compass on this phone: the map simply stays north up
    return () => {
      cancelled = true;
      sub?.remove();
    };
    // runStop only reads refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [full, followHeading]);

  useImperativeHandle(ref, () => ({
    fitAll: () => {
      const list = markersRef.current;
      if (list.length === 0) return;
      const f = frame(list, paddingRef.current);
      lastCommandAtRef.current = Date.now();
      runStop(
        f.kind === 'bounds'
          ? { bounds: f.bounds, padding: f.padding, duration: CAMERA_MOVE_MS, easing: 'ease' }
          : { center: f.center, zoom: f.zoom, duration: CAMERA_MOVE_MS, easing: 'ease' },
      );
    },
    focus: (id: string) => {
      const m = markersRef.current.find((x) => x.id === id);
      if (!m) return;
      lastCommandAtRef.current = Date.now();
      runStop({ center: [m.lng, m.lat], zoom: 16, duration: CAMERA_MOVE_MS, easing: 'ease' });
    },
    stopCamera: () => {
      const recentCommand = Date.now() - lastCommandAtRef.current < CAMERA_MOVE_MS + 200;
      if (!movingRef.current && !recentCommand) return false;
      const view = viewRef.current;
      // An instant move (duration 0) cancels the running transition. Jump to
      // where the camera is now; if we don't know yet, re-frame instantly.
      if (view) {
        runStop({ center: view.center, zoom: view.zoom, duration: 0 });
      } else if (markersRef.current.length > 0) {
        const f = frame(markersRef.current, paddingRef.current);
        runStop(
          f.kind === 'bounds'
            ? { bounds: f.bounds, padding: f.padding, duration: 0 }
            : { center: f.center, zoom: f.zoom, duration: 0 },
        );
      }
      movingRef.current = false;
      lastCommandAtRef.current = 0;
      return true;
    },
  }));

  // Accuracy halos (one source, one fill + one outline layer).
  const halos = useMemo<GeoJSON.FeatureCollection<GeoJSON.Polygon, { color: string }>>(
    () => ({
      type: 'FeatureCollection',
      features: markers
        .filter((m) => m.accuracyM != null && m.accuracyM >= MIN_HALO_M)
        .map((m) => ({
          type: 'Feature',
          properties: { color: m.color },
          geometry: {
            type: 'Polygon',
            coordinates: [circlePolygon(m.lng, m.lat, Math.min(m.accuracyM as number, MAX_HALO_M))],
          },
        })),
    }),
    [markers],
  );

  // Camera framing, kept STABLE: it only changes when someone moved roughly
  // 11 m or more (4 decimal places), so GPS jitter doesn't keep moving it.
  // With no markers (e.g. a short data gap) the last framing is kept, so the
  // parent can keep this map mounted instead of remounting it.
  const lastCameraRef = useRef<CameraProps>({});
  const framingKey = markers.map((m) => `${m.id}:${m.lat.toFixed(4)},${m.lng.toFixed(4)}`).join('|');
  const padKey = `${padding.top},${padding.bottom},${padding.left},${padding.right}`;
  const cameraProps = useMemo<CameraProps>(() => {
    const list = markersRef.current;
    if (list.length === 0) return lastCameraRef.current;
    const f = frame(list, paddingRef.current);
    if (full) {
      // Full: frame only once on open; afterwards the user is in control.
      if (lastCameraRef.current.initialViewState) return lastCameraRef.current;
      const focused = initialFocusId ? list.find((m) => m.id === initialFocusId) : undefined;
      const next: CameraProps = {
        initialViewState: focused
          ? { center: [focused.lng, focused.lat], zoom: 16 }
          : f.kind === 'bounds'
            ? { bounds: f.bounds, padding: f.padding }
            : { center: f.center, zoom: f.zoom },
      };
      lastCameraRef.current = next;
      return next;
    }
    // Preview: jump straight to the new framing (duration 0 = no transition).
    const next: CameraProps =
      f.kind === 'bounds'
        ? { bounds: f.bounds, padding: f.padding, duration: 0 }
        : { center: f.center, zoom: f.zoom, duration: 0 };
    lastCameraRef.current = next;
    return next;
  }, [framingKey, padKey, full, initialFocusId]);

  if (!mapStyle) {
    // Style still loading: stay dark so there is no bright flash.
    return (
      <View style={[styles.wrap, styles.center]}>
        <ActivityIndicator color={colors.me} />
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Map
        style={styles.map}
        mapStyle={mapStyle}
        logo={false}
        attribution
        attributionPosition={attributionPosition ?? { bottom: (insets?.bottom ?? 0) + 6, right: 8 }}
        compass={full}
        compassPosition={{ top: 72 + (insets?.top ?? 0), right: 14 }}
        compassHiddenFacingNorth
        dragPan={full}
        touchZoom={full}
        doubleTapZoom={full}
        touchRotate={full}
        touchPitch={false}
        onRegionWillChange={(e) => {
          movingRef.current = true;
          viewRef.current = { center: e.nativeEvent.center, zoom: e.nativeEvent.zoom };
        }}
        onRegionIsChanging={(e) => {
          movingRef.current = true;
          viewRef.current = { center: e.nativeEvent.center, zoom: e.nativeEvent.zoom };
        }}
        onRegionDidChange={(e) => {
          movingRef.current = false;
          viewRef.current = { center: e.nativeEvent.center, zoom: e.nativeEvent.zoom };
        }}
      >
        <Camera ref={cameraRef} {...cameraProps} />
        <GeoJSONSource id="bond-accuracy" data={halos}>
          <Layer id="bond-accuracy-fill" type="fill" paint={{ 'fill-color': ['get', 'color'], 'fill-opacity': 0.13 }} />
          <Layer
            id="bond-accuracy-line"
            type="line"
            paint={{ 'line-color': ['get', 'color'], 'line-opacity': 0.4, 'line-width': 1 }}
          />
        </GeoJSONSource>
        {markers.map((m) => (
          <AnimatedPin key={m.id} marker={m} />
        ))}
      </Map>
      <Text style={[styles.credit, insets?.bottom ? { bottom: insets.bottom + 6 } : null]}>
        {'© OpenMapTiles © OpenStreetMap'}
      </Text>
    </View>
  );
});

/**
 * One marker. Re-renders only when its own data changes. A new position is
 * eased over a short animation; a big jump (or the first position) is shown
 * immediately so a poor reading can't hide behind smooth motion. The
 * animation frame is cancelled on unmount, so nothing touches a removed map.
 */
const AnimatedPin = memo(
  function AnimatedPin({ marker }: { marker: MapMarker }) {
    useThemeVersion();
    const [pos, setPos] = useState<[number, number]>([marker.lng, marker.lat]);
    const posRef = useRef(pos);
    posRef.current = pos;

    useEffect(() => {
      const from = posRef.current;
      const to: [number, number] = [marker.lng, marker.lat];
      if (from[0] === to[0] && from[1] === to[1]) return;
      const jump = distanceMeters(from[1], from[0], to[1], to[0]);
      if (jump > MAX_ANIMATED_MOVE_M) {
        setPos(to);
        return;
      }
      let raf = 0;
      let cancelled = false;
      const start = Date.now();
      const tick = () => {
        if (cancelled) return;
        const t = Math.min(1, (Date.now() - start) / MOVE_ANIMATION_MS);
        const e = 1 - (1 - t) ** 3; // ease-out
        setPos([from[0] + (to[0] - from[0]) * e, from[1] + (to[1] - from[1]) * e]);
        if (t < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
      };
    }, [marker.lng, marker.lat]);

    return (
      <Marker id={marker.id} lngLat={pos} anchor="bottom">
        <MapPin marker={marker} />
      </Marker>
    );
  },
  (a, b) =>
    a.marker.lat === b.marker.lat &&
    a.marker.lng === b.marker.lng &&
    a.marker.color === b.marker.color &&
    a.marker.name === b.marker.name &&
    a.marker.photoUrl === b.marker.photoUrl &&
    a.marker.tint === b.marker.tint &&
    a.marker.freshness === b.marker.freshness,
);

/**
 * Avatar pin: a blue (you) or pink (partner) ring, the person's photo inside
 * (initials on their chosen color while it loads, or when there is no
 * photo), and a small pointer below whose tip is the exact location.
 *
 * Everything sits inside one fixed-size box, so the status badge is never
 * clipped and never covers the face: it sits on the lower-right edge of the
 * ring. Green dot = location is live; gray clock = location is stale.
 */
function MapPin({ marker }: { marker: MapMarker }) {
  useThemeVersion();
  const stale = marker.freshness === 'stale';
  return (
    <View style={[styles.pinBox, stale && styles.pinStale]}>
      <View style={[styles.pinHead, { backgroundColor: marker.color }]}>
        <Avatar
          name={marker.name}
          url={marker.photoUrl}
          size={PHOTO_SIZE}
          tint={marker.tint ?? marker.color}
          ring="#FFFFFF"
        />
      </View>
      <View style={[styles.pinTail, { borderTopColor: marker.color }]} />
      {marker.freshness === 'live' ? <View style={styles.liveDot} /> : null}
      {stale ? (
        <View style={styles.staleBadge}>
          <Ionicons name="time" size={10} color="#FFFFFF" />
        </View>
      ) : null}
    </View>
  );
}

// Pin geometry (points).
const HEAD = 46; // outer colored ring
const PHOTO_SIZE = 40; // photo + white ring, inside the colored ring
const TAIL = 8;
const BOX_W = HEAD + 8; // a little room so badges stay inside the box
const BADGE = 13;
// Lower-right point of the ring (45 degrees), where the badge is centered.
const BADGE_CENTER_X = (BOX_W - HEAD) / 2 + HEAD / 2 + (HEAD / 2) * Math.SQRT1_2;
const BADGE_CENTER_Y = HEAD / 2 + (HEAD / 2) * Math.SQRT1_2;

const styles = themedStyles(() => ({
  wrap: { flex: 1, overflow: 'hidden', backgroundColor: MAP_BACKGROUND },
  center: { alignItems: 'center', justifyContent: 'center' },
  map: { flex: 1 },
  pinBox: { width: BOX_W, height: HEAD + TAIL, alignItems: 'center' },
  pinStale: { opacity: 0.55 },
  pinHead: {
    width: HEAD,
    height: HEAD,
    borderRadius: HEAD / 2,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000000',
    shadowOpacity: 0.45,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 5,
  },
  pinTail: {
    width: 0,
    height: 0,
    marginTop: -1,
    borderLeftWidth: 6,
    borderRightWidth: 6,
    borderTopWidth: TAIL,
    borderLeftColor: 'transparent',
    borderRightColor: 'transparent',
  },
  liveDot: {
    position: 'absolute',
    left: BADGE_CENTER_X - BADGE / 2,
    top: BADGE_CENTER_Y - BADGE / 2,
    width: BADGE,
    height: BADGE,
    borderRadius: BADGE / 2,
    backgroundColor: colors.success,
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  staleBadge: {
    position: 'absolute',
    left: BADGE_CENTER_X - 8,
    top: BADGE_CENTER_Y - 8,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#5A5A5A',
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
    color: '#A0A8B2',
    backgroundColor: 'rgba(0,0,0,0.5)',
    paddingHorizontal: 4,
    borderRadius: 4,
  },
}));
