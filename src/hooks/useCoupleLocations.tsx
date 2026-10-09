import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { MapMarker } from '@/components/PartnerMap';
import { timeAgo } from '@/lib/format';
import { supabase, uniqueTopic } from '@/lib/supabase';
import { colors } from '@/lib/theme';
import type { LocationRow, PrivacySettings } from '@/lib/types';
import { useCouple } from '@/state/couple';

/**
 * ONE shared, read-only source of both partners' latest shared locations.
 *
 * The Location tab and the fullscreen map both read from this provider, so
 * there is exactly one Realtime subscription for location data, no matter how
 * many location screens are open. The provider only loads and subscribes
 * while at least one location screen is mounted (consumers are counted).
 *
 * It never starts a location watcher. The single foreground watcher lives in
 * the tabs layout (useLocationWatcher).
 */

/** Updated within this window counts as "Live". */
export const LIVE_MS = 5 * 60 * 1000;
/** Older than this counts as stale. */
export const STALE_MS = 10 * 60 * 1000;

export type LocationStatusKind = 'off' | 'waiting' | 'live' | 'recent' | 'stale';

export type PersonLocation = {
  sharing: boolean;
  loc: LocationRow | null;
  status: LocationStatusKind;
  /** Short status text, e.g. "Live", "Updated 7 min ago", "Sharing off". */
  statusLabel: string;
  place: string | null;
};

export type CoupleLocations = {
  me: PersonLocation;
  partner: PersonLocation;
  markers: MapMarker[];
  loading: boolean;
  error: boolean;
  reload: () => Promise<void>;
};

type ContextValue = CoupleLocations & { acquire: () => void; release: () => void };

const Ctx = createContext<ContextValue | null>(null);

function describe(sharing: boolean, loc: LocationRow | null, now: number): PersonLocation {
  if (!sharing) return { sharing, loc: null, status: 'off', statusLabel: 'Sharing off', place: null };
  if (!loc) return { sharing, loc: null, status: 'waiting', statusLabel: 'Waiting for location', place: null };
  const age = now - new Date(loc.updated_at).getTime();
  const place = loc.place_name ?? null;
  if (age <= LIVE_MS) return { sharing, loc, status: 'live', statusLabel: 'Live', place };
  if (age <= STALE_MS) {
    return { sharing, loc, status: 'recent', statusLabel: `Updated ${timeAgo(loc.updated_at, now)}`, place };
  }
  return { sharing, loc, status: 'stale', statusLabel: `Last updated ${timeAgo(loc.updated_at, now)}`, place };
}

export function CoupleLocationsProvider({ children }: { children: React.ReactNode }) {
  const { userId, partnerId, myProfile, partnerProfile, myAvatarUrl, partnerAvatarUrl } = useCouple();

  const [consumers, setConsumers] = useState(0);
  const active = consumers > 0;

  const [privacy, setPrivacy] = useState<Record<string, PrivacySettings>>({});
  const [locations, setLocations] = useState<Record<string, LocationRow>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [now, setNow] = useState(Date.now());

  // Refs so the stable `load` always uses the latest ids, and so late
  // responses from an older request (or after unmount) are ignored.
  const idsRef = useRef<{ userId: string | null; partnerId: string | null }>({ userId, partnerId });
  idsRef.current = { userId, partnerId };
  const seqRef = useRef(0);
  const liveRef = useRef(false);

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
    const me = describe(!!(userId && privacy[userId]?.share_location), userId ? locations[userId] ?? null : null, now);
    const partner = describe(
      !!(partnerId && privacy[partnerId]?.share_location),
      partnerId ? locations[partnerId] ?? null : null,
      now,
    );

    // Only people who are sharing AND have a position get a marker.
    const markers: MapMarker[] = [];
    if (me.loc) {
      markers.push({
        id: 'me',
        lat: me.loc.latitude,
        lng: me.loc.longitude,
        color: colors.me,
        name: myProfile?.display_name ?? 'You',
        photoUrl: myProfile?.avatar_path ? myAvatarUrl : null,
        stale: me.status === 'stale',
      });
    }
    if (partner.loc) {
      markers.push({
        id: 'partner',
        lat: partner.loc.latitude,
        lng: partner.loc.longitude,
        color: colors.partner,
        name: partnerProfile?.display_name ?? 'Partner',
        photoUrl: partnerProfile?.avatar_path ? partnerAvatarUrl : null,
        stale: partner.status === 'stale',
      });
    }

    return { me, partner, markers, loading, error, reload: load, acquire, release };
  }, [
    userId,
    partnerId,
    privacy,
    locations,
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
