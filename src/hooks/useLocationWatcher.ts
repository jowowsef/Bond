import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { uploadLocation } from '@/lib/location';
import { supabase, uniqueTopic } from '@/lib/supabase';

/**
 * ONE foreground location watcher for the whole app.
 *
 * It runs only while ALL of these are true: the app is in the foreground, the
 * user id is known, and the user's own location sharing is on. It stops the
 * moment any of those change (app backgrounded, sharing turned off). It is
 * mounted once in the tabs layout, so no screen (including Home) starts a
 * second watcher.
 *
 * To avoid excessive Supabase writes we only upload when the position moved a
 * meaningful distance or enough time has passed. Android's OS permission is
 * checked first and nothing is uploaded if it is not granted.
 */

const MIN_UPLOAD_GAP_MS = 2 * 60 * 1000; // at least 2 min between writes when still
const MIN_UPLOAD_MOVE_M = 25; // or whenever we moved at least 25 m

function metersBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function useLocationWatcher(userId: string | null): void {
  const [sharing, setSharing] = useState(false);

  // Follow the user's own share_location setting (and changes to it).
  useEffect(() => {
    if (!userId) {
      setSharing(false);
      return;
    }
    let active = true;
    const read = async () => {
      const { data } = await supabase
        .from('privacy_settings')
        .select('share_location')
        .eq('user_id', userId)
        .maybeSingle();
      if (active) setSharing(!!data?.share_location);
    };
    void read();
    const channel = supabase
      .channel(uniqueTopic(`loc-privacy-${userId}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'privacy_settings', filter: `user_id=eq.${userId}` },
        () => void read(),
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !sharing) return;

    let subscription: Location.LocationSubscription | null = null;
    let cancelled = false;
    let lastUploadAt = 0;
    let lastLat: number | null = null;
    let lastLng: number | null = null;

    const handle = (loc: Location.LocationObject) => {
      const { latitude, longitude } = loc.coords;
      const now = Date.now();
      const moved =
        lastLat === null || lastLng === null ? Infinity : metersBetween(lastLat, lastLng, latitude, longitude);
      if (moved < MIN_UPLOAD_MOVE_M && now - lastUploadAt < MIN_UPLOAD_GAP_MS) return;
      lastUploadAt = now;
      lastLat = latitude;
      lastLng = longitude;
      // uploadLocation re-checks the session; RLS blocks the write if sharing
      // is off, so a stale callback can never leak a position.
      uploadLocation(loc, false).catch(() => undefined);
    };

    const start = async () => {
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted || cancelled || subscription) return;
        // distanceInterval 0: Android sends no updates while standing still
        // when a distance filter is set, which made an open, stationary phone
        // look stale. Writes stay limited by the 2 min / 25 m throttle above.
        const sub = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.Balanced, timeInterval: 30_000, distanceInterval: 0 },
          handle,
        );
        if (cancelled) {
          sub.remove();
          return;
        }
        subscription = sub;
      } catch {
        // GPS off or transient error: the next foreground will retry.
      }
    };

    const stop = () => {
      subscription?.remove();
      subscription = null;
    };

    if (AppState.currentState === 'active') void start();
    const appSub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void start();
      else stop();
    });

    return () => {
      cancelled = true;
      appSub.remove();
      stop();
    };
  }, [userId, sharing]);
}
