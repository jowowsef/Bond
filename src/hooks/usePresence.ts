import { useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  HEARTBEAT_INTERVAL_MS,
  fetchLastSeen,
  presenceStatus,
  sendHeartbeat,
  type PresenceStatus,
} from '@/lib/presence';
import { supabase } from '@/lib/supabase';

/**
 * usePresenceHeartbeat — keeps MY "last active" fresh.
 *
 * While the app is in the foreground it writes last_seen immediately and then
 * every ~30 seconds. When the app goes to the background it stops, so we don't
 * waste writes or battery. Going to the background does NOT mark me offline —
 * my status simply ages into "Last active …" naturally.
 */
export function usePresenceHeartbeat(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;

    let interval: ReturnType<typeof setInterval> | null = null;

    const beat = () => {
      void sendHeartbeat(userId);
    };
    const start = () => {
      beat(); // immediate update on becoming active
      if (!interval) interval = setInterval(beat, HEARTBEAT_INTERVAL_MS);
    };
    const stop = () => {
      if (interval) {
        clearInterval(interval);
        interval = null;
      }
    };

    if (AppState.currentState === 'active') start();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') start();
      else stop();
    });

    return () => {
      stop();
      sub.remove();
    };
  }, [userId]);
}

/**
 * usePartnerPresence — watches the PARTNER's "last active" and returns a
 * ready-to-show status.
 *
 * It fetches once, subscribes to Realtime updates, polls every 20s as a
 * fallback, and ticks a local clock every 15s so "Online" rolls over to
 * "Last active …" on its own as time passes. If the request fails we keep
 * the last value we had instead of showing a fake status.
 */
export function usePartnerPresence(partnerId: string | null): PresenceStatus {
  const [lastSeen, setLastSeen] = useState<string | null>(null);
  const [ok, setOk] = useState<boolean>(true);
  const [now, setNow] = useState<number>(Date.now());
  const hasDataRef = useRef<boolean>(false);

  useEffect(() => {
    if (!partnerId) return;
    let active = true;

    const load = async () => {
      const result = await fetchLastSeen(partnerId);
      if (!active) return;
      setOk(result.ok);
      if (result.lastSeen) {
        setLastSeen(result.lastSeen);
        hasDataRef.current = true;
      }
    };

    void load();
    const poll = setInterval(load, 20_000);

    const channel = supabase
      .channel(`presence-watch-${partnerId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'presence', filter: `user_id=eq.${partnerId}` },
        (payload) => {
          const row = payload.new as { last_seen?: string };
          if (row?.last_seen) {
            setLastSeen(row.last_seen);
            setOk(true);
            hasDataRef.current = true;
          }
        },
      )
      .subscribe();

    return () => {
      active = false;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [partnerId]);

  // Local clock so the label updates even without new data.
  useEffect(() => {
    const ticker = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(ticker);
  }, []);

  if (!partnerId) return { state: 'unavailable', label: 'Status unavailable', lastSeen: null };
  return presenceStatus(lastSeen, ok, now);
}
