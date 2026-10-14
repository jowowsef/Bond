import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { MapMarker } from '@/components/PartnerMap';
import { avatarTint, tintForProfile } from '@/lib/avatar';
import { timeAgo, shownName } from '@/lib/format';
import {
  distanceMeters,
  getLocationDiagnostics,
  subscribeLocationDiagnostics,
  type LocationDiagnostics,
  type Movement,
} from '@/lib/location';
import { supabase, uniqueTopic } from '@/lib/supabase';
import { colors, useThemeVersion } from '@/lib/theme';
import type { LocationRow, PrivacySettings } from '@/lib/types';
import { useCouple } from '@/state/couple';

/**
 * ONE shared, read-only source of both partners' latest locations.
 *
 * The Location tab and the fullscreen map both read from this provider, so
 * there is exactly one Realtime subscription for location data. It only loads
 * and subscribes while at least one location screen is mounted.
 *
 * Where each position comes from:
 *  - Partner: their latest row in Supabase (what they actually shared).
 *  - You: this phone's latest ACCEPTED reading from the location pipeline when
 *    it is newer than your shared row, so your own marker is not stuck behind
 *    the upload throttle. Otherwise your shared row.
 * Rows are matched to people strictly by user_id.
 *
 * It never starts a location watcher (that lives in the tabs layout).
 */

/** Updated within this window counts as "Live". */
export const LIVE_MS = 5 * 60 * 1000;
/** Older than this counts as stale. */
export const STALE_MS = 10 * 60 * 1000;
/** Readings less precise than this are labeled approximate. */
export const APPROX_M = 150;

export type LocationStatusKind = 'off' | 'waiting' | 'live' | 'recent' | 'stale';

export type PersonLocation = {
  sharing: boolean;
  /** The position being displayed (null when off or not received yet). */
  loc: LocationRow | null;
  status: LocationStatusKind;
  /** Short status text, e.g. "Live", "Updated 7 min ago", "Sharing off". */
  statusLabel: string;
  place: string | null;
  /** Reported accuracy radius in meters, when known. */
  accuracyM: number | null;
  /** True when the reading is too imprecise to treat as an exact spot. */
  approximate: boolean;
  /** Only reported while the position is live; null when it can't be told. */
  movement: Movement;
  /** You only: the position is this phone's latest reading (not yet the shared row). */
  fromDevice: boolean;
};

export type CoupleLocations = {
  me: PersonLocation;
  partner: PersonLocation;
  markers: MapMarker[];
  loading: boolean;
  error: boolean;
  reload: () => Promise<void>;
  /** This phone's pipeline state (for the details panel). */
  diagnostics: LocationDiagnostics;
};

type ContextValue = CoupleLocations & { acquire: () => void; release: () => void };

const Ctx = createContext<ContextValue | null>(null);

function describe(
  sharing: boolean,
  loc: LocationRow | null,
  now: number,
  movement: Movement,
  fromDevice: boolean,
): PersonLocation {
  const base = { sharing, accuracyM: null, approximate: false, movement: null, fromDevice: false };
  if (!sharing) return { ...base, loc: null, status: 'off', statusLabel: 'Sharing off', place: null };
  if (!loc) return { ...base, loc: null, status: 'waiting', statusLabel: 'Waiting for location', place: null };

  const accuracyM = loc.accuracy_m ?? null;
  const approximate = accuracyM != null && accuracyM > APPROX_M;
  const age = now - new Date(loc.updated_at).getTime();
  const place = loc.place_name ?? null;
  const common = { sharing, loc, place, accuracyM, approximate, fromDevice };
  if (age <= LIVE_MS) return { ...common, status: 'live', statusLabel: 'Live', movement };
  if (age <= STALE_MS) {
    return { ...common, status: 'recent', statusLabel: `Updated ${timeAgo(loc.updated_at, now)}`, movement: null };
  }
  return { ...common, status: 'stale', statusLabel: `Last updated ${timeAgo(loc.updated_at, now)}`, movement: null };
}

/**
 * Partner movement from two consecutive shared rows. Conservative on purpose:
 * "moving" only when the displacement is larger than both error circles AND
 * implies at least walking pace; "stationary" when the change stays within
 * the error circles. Anything else is unknown.
 */
function movementBetween(prev: LocationRow, next: LocationRow): Movement {
  const dt = (new Date(next.updated_at).getTime() - new Date(prev.updated_at).getTime()) / 1000;
  if (dt < 5 || dt > 600) return null;
  const d = distanceMeters(prev.latitude, prev.longitude, next.latitude, next.longitude);
  const noise = Math.max(30, (prev.accuracy_m ?? 50) + (next.accuracy_m ?? 50));
  if (d > noise && d / dt >= 0.8) return 'moving';
  if (d <= noise) return 'stationary';
  return null;
}

export function CoupleLocationsProvider({ children }: { children: React.ReactNode }) {
  useThemeVersion();
  const { userId, partnerId, myProfile, partnerProfile, myAvatarUrl, partnerAvatarUrl } = useCouple();

  const [consumers, setConsumers] = useState(0);
  const active = consumers > 0;

  const [privacy, setPrivacy] = useState<Record<string, PrivacySettings>>({});
  const [locations, setLocations] = useState<Record<string, LocationRow>>({});
  const [partnerMovement, setPartnerMovement] = useState<Movement>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());

  // This phone's accepted readings (updates live from the watcher).
  const diagnostics = useSyncExternalStore(subscribeLocationDiagnostics, getLocationDiagnostics);

  // Refs so the stable `load` always uses the latest ids, and so late
  // responses from an older request (or after unmount) are ignored.
  const idsRef = useRef<{ userId: string | null; partnerId: string | null }>({ userId, partnerId });
  idsRef.current = { userId, partnerId };
  const seqRef = useRef(0);
  const liveRef = useRef(false);
  const prevPartnerRowRef = useRef<LocationRow | null>(null);

  const acquire = useCallback(() => setConsumers((c) => c + 1), []);
  const release = useCallback(() => setConsumers((c) => Math.max(0, c - 1)), []);

  const load = useCallback(async () => {
    const { userId: uid, partnerId: pid } = idsRef.current;
    if (!uid) return;
    const seq = ++seqRef.current;
    const ids = pid ? [uid, pid] : [uid];
    try {
      const [priv, locs] = await Promise.all([
        supabase.from('privacy_settings').select('*').in('user_id', ids),
        supabase.from('locations').select('*').in('user_id', ids),
      ]);
      if (seq !== seqRef.current || !liveRef.current) return; // a newer load won, or we stopped
      if (priv.error || locs.error) {
        // Keep the last good data on screen; just flag the failure.
        setError(true);
        return;
      }
      const nextPrivacy: Record<string, PrivacySettings> = {};
      for (const row of (priv.data as PrivacySettings[]) ?? []) nextPrivacy[row.user_id] = row;
      const nextLocations: Record<string, LocationRow> = {};
      for (const row of (locs.data as LocationRow[]) ?? []) nextLocations[row.user_id] = row;

      // Partner movement: compare with the previous row we saw for them.
      const partnerRow = pid ? nextLocations[pid] ?? null : null;
      const prev = prevPartnerRowRef.current;
      if (!partnerRow) {
        setPartnerMovement(null);
      } else if (prev && prev.updated_at !== partnerRow.updated_at) {
        setPartnerMovement(movementBetween(prev, partnerRow));
      }
      prevPartnerRowRef.current = partnerRow;

      setPrivacy(nextPrivacy);
      setLocations(nextLocations);
      setError(false);
    } catch {
      if (seq === seqRef.current && liveRef.current) setError(true);
    } finally {
      if (seq === seqRef.current && liveRef.current) setLoading(false);
    }
  }, []);

  // Start fresh whenever the couple changes, so one person's data never shows for another.
  useEffect(() => {
    setPrivacy({});
    setLocations({});
    setPartnerMovement(null);
    prevPartnerRowRef.current = null;
    setLoading(true);
    setError(false);
  }, [userId, partnerId]);

  // The single subscription. Fully configured with .on() BEFORE .subscribe(),
  // and given a unique topic so it can never collide with a channel that is
  // still being removed.
  useEffect(() => {
    if (!active || !userId) return;
    liveRef.current = true;
    void load();
    const channel = supabase
      .channel(uniqueTopic('couple-locations'))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'locations' }, () => void load())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'privacy_settings' }, () => void load())
      .subscribe();
    return () => {
      liveRef.current = false;
      seqRef.current += 1; // invalidate any request still in flight
      void supabase.removeChannel(channel);
    };
  }, [active, userId, partnerId, load]);

  // Local clock so "Live" and "stale" change over time without new data.
  useEffect(() => {
    if (!active) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, [active]);

  const value = useMemo<ContextValue>(() => {
    const meSharing = !!(userId && privacy[userId]?.share_location);
    const partnerSharing = !!(partnerId && privacy[partnerId]?.share_location);

    // You: prefer this phone's latest accepted reading when it is newer than
    // the shared row. Never used when sharing is off.
    const myRow = userId ? locations[userId] ?? null : null;
    const fix = diagnostics.lastFix;
    let myLoc: LocationRow | null = myRow;
    let fromDevice = false;
    if (meSharing && userId && fix && (!myRow || fix.timestamp >= new Date(myRow.updated_at).getTime())) {
      // Keep the area name only if the shared row is close to the live reading.
      const near = !!myRow && distanceMeters(myRow.latitude, myRow.longitude, fix.lat, fix.lng) < 500;
      myLoc = {
        user_id: userId,
        latitude: fix.lat,
        longitude: fix.lng,
        accuracy_m: fix.accuracy,
        place_name: near && myRow ? myRow.place_name : null,
        is_background: false,
        updated_at: new Date(fix.timestamp).toISOString(),
      };
      fromDevice = true;
    }

    const me = describe(meSharing, myLoc, now, fromDevice ? diagnostics.movement : null, fromDevice);
    const partner = describe(
      partnerSharing,
      partnerId ? locations[partnerId] ?? null : null,
      now,
      partnerMovement,
      false,
    );

    // A pin's color is the person's OWN chosen avatar color (from their
    // profile), so both phones show the same color for the same person.
    // Only someone who never picked a color falls back to the old role color.
    const pinColor = (profile: typeof myProfile, fallback: string) =>
      profile?.avatar_color ? avatarTint(profile.avatar_color) : fallback;

    // Only people who are sharing AND have a position get a marker.
    const markers: MapMarker[] = [];
    if (me.loc) {
      markers.push({
        id: 'me',
        lat: me.loc.latitude,
        lng: me.loc.longitude,
        color: pinColor(myProfile, colors.me),
        name: myProfile?.display_name ?? 'You',
        photoUrl: myProfile?.avatar_path ? myAvatarUrl : null,
        tint: tintForProfile(myProfile),
        accuracyM: me.accuracyM,
        freshness: me.status === 'live' ? 'live' : me.status === 'stale' ? 'stale' : 'recent',
      });
    }
    if (partner.loc) {
      markers.push({
        id: 'partner',
        lat: partner.loc.latitude,
        lng: partner.loc.longitude,
        color: pinColor(partnerProfile, colors.partner),
        name: shownName(partnerProfile?.display_name, 'Partner'),
        photoUrl: partnerProfile?.avatar_path ? partnerAvatarUrl : null,
        tint: tintForProfile(partnerProfile),
        accuracyM: partner.accuracyM,
        freshness: partner.status === 'live' ? 'live' : partner.status === 'stale' ? 'stale' : 'recent',
      });
    }

    return { me, partner, markers, loading, error, reload: load, diagnostics, acquire, release };
  }, [
    userId,
    partnerId,
    privacy,
    locations,
    partnerMovement,
    diagnostics,
    now,
    myProfile,
    partnerProfile,
    myAvatarUrl,
    partnerAvatarUrl,
    loading,
    error,
    load,
    acquire,
    release,
  ]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/**
 * Read the shared location data. Mounting a screen that calls this counts as
 * a consumer; the provider subscribes while any consumer is mounted.
 */
export function useCoupleLocations(): CoupleLocations {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useCoupleLocations must be used inside <CoupleLocationsProvider>');
  const { acquire, release } = ctx;
  useEffect(() => {
    acquire();
    return release;
  }, [acquire, release]);
  return ctx;
}
