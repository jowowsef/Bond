import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  getBackgroundPermission,
  removeLegacyBackgroundConsent,
  startBackgroundLocation,
  stopBackgroundLocation,
} from '@/lib/backgroundLocation';
import { supabase, uniqueTopic } from '@/lib/supabase';

/**
 * Keeps background location in step with the rules (see
 * lib/backgroundLocation.ts). Mounted once, in the main tabs, with a user id
 * ONLY while the couple is paired and its setup is finished (null otherwise).
 *
 * Re-checked when Bond starts, when it returns to the front (for example back
 * from Android Settings after choosing "Allow all the time"), and when the
 * person's location sharing setting changes:
 *  - location sharing ON + "Allow all the time" -> started (Android shows its
 *    notification),
 *  - anything else -> stopped.
 * Starting needs Bond to be open (an Android rule), so it is never attempted
 * from the background.
 */
export function useBackgroundLocation({ userId, partnerName }: { userId: string | null; partnerName: string }): void {
  // My own location-sharing setting, read from the server (null until known).
  const [sharing, setSharing] = useState<boolean | null>(null);
  const nameRef = useRef(partnerName);
  nameRef.current = partnerName;

  useEffect(() => {
    void removeLegacyBackgroundConsent();
  }, []);

  useEffect(() => {
    setSharing(null);
    if (!userId) return;
    let active = true;
    const read = async () => {
      const { data, error } = await supabase.from('privacy_settings').select('share_location').eq('user_id', userId).maybeSingle();
      if (active && !error) setSharing(!!data?.share_location);
    };
    void read();
    const channel = supabase
      .channel(uniqueTopic(`bg-location-privacy-${userId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'privacy_settings', filter: `user_id=eq.${userId}` }, () => void read())
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  const reconcile = useCallback(async () => {
    if (!userId) {
      // Not paired / setup not finished: the root guard stops it as well.
      await stopBackgroundLocation();
      return;
    }
    if (sharing === null) return; // not known yet: change nothing
    if (!sharing) {
      await stopBackgroundLocation();
      return;
    }
    if (AppState.currentState !== 'active') return; // Android only allows starting from the open app
    if ((await getBackgroundPermission()) === 'granted') await startBackgroundLocation(nameRef.current);
    else await stopBackgroundLocation(); // "While using the app" only: foreground sharing continues
  }, [userId, sharing]);

  useEffect(() => {
    void reconcile();
  }, [reconcile]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reconcile();
    });
    return () => sub.remove();
  }, [reconcile]);
}
