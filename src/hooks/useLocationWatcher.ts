import * as Location from 'expo-location';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { reportWatchError, resetLocationPipeline, submitFix } from '@/lib/location';
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
 * Accuracy: High (uses GPS) because it only runs while the app is open AND
 * sharing is on, which keeps the battery cost bounded. Every reading goes
 * through submitFix(), which validates it, ignores clearly worse or stale
 * readings, and shares at most one write at a time (newest wins), so writes
 * stay limited to real movement or a 2 minute heartbeat.
 */

/** How often Android may deliver a reading. 15 s keeps a moving person from
 *  lagging far behind; Supabase writes are still limited by submitFix(). */
const WATCH_INTERVAL_MS = 15_000;

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
    let starting = false;
    let cancelled = false;

    // The pipeline enforces validity, ordering, accuracy and write limits. A
    // late callback after sharing stops is still safe: RLS blocks the write.
    const handle = (loc: Location.LocationObject) => {
      if (!cancelled) submitFix(userId, loc, false);
    };

    const start = async () => {
      if (cancelled || subscription || starting) return;
      starting = true;
      try {
        const perm = await Location.getForegroundPermissionsAsync();
        if (!perm.granted) {
          reportWatchError('Location permission is not granted.');
          return;
        }
        if (!(await Location.hasServicesEnabledAsync())) {
          reportWatchError('Phone location is turned off.');
          return;
        }
        // distanceInterval 0: with a distance filter Android sends nothing
        // while you stand still, which made an open phone look stale.
        const sub = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            timeInterval: WATCH_INTERVAL_MS,
            distanceInterval: 0,
            mayShowUserSettingsDialog: false,
          },
          handle,
        );
        if (cancelled) {
          sub.remove();
          return;
        }
        subscription = sub;
        reportWatchError(null);
      } catch (e) {
        reportWatchError((e as Error)?.message ?? 'Could not start location updates.');
      } finally {
        starting = false;
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
      // Sharing turned off (or user changed): forget readings so nothing old
      // is reused or shown as "my location".
      resetLocationPipeline();
    };
  }, [userId, sharing]);
}
