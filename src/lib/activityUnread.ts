import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { supabase, uniqueTopic } from './supabase';

/**
 * "New activity" dot for the bell icon.
 *
 * Kept on this phone only (no database change): we remember when you last
 * opened Activity, and show the dot when your partner (or the system) logged
 * something after that. Your own actions never light it up.
 */

const SEEN_KEY = 'bond.activity.seenAt';

let seenAt: number | null = null; // null until loaded from storage
let latestOtherAt = 0;
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function hasUnread(): boolean {
  return seenAt !== null && latestOtherAt > seenAt;
}

export function useHasUnreadActivity(): boolean {
  return useSyncExternalStore(subscribe, hasUnread, hasUnread);
}

/** Call when the Activity screen is visible. */
export function markActivitySeen(): void {
  const now = Math.max(Date.now(), latestOtherAt);
  seenAt = now;
  emit();
  AsyncStorage.setItem(SEEN_KEY, String(now)).catch(() => {});
}

/** Mounted once (tabs layout): loads the latest partner activity and follows new rows. */
export function useActivityUnreadTracker(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    let active = true;

    const loadLatest = async () => {
      const { data } = await supabase
        .from('activity_logs')
        .select('created_at')
        .or(`actor_id.is.null,actor_id.neq.${userId}`)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!active || !data?.created_at) return;
      latestOtherAt = new Date(data.created_at as string).getTime();
      emit();
    };

    void (async () => {
      if (seenAt === null) {
        let stored: string | null = null;
        try {
          stored = await AsyncStorage.getItem(SEEN_KEY);
        } catch {
          // fall through to "now"
        }
        if (!active) return;
        if (stored) {
          seenAt = Number(stored) || Date.now();
        } else {
          // First time: older history is not "new". Start counting from now.
          markActivitySeen();
        }
      }
      await loadLatest();
    })();

    const channel = supabase
      .channel(uniqueTopic('activity-unread'))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, () => void loadLatest())
      .subscribe();

    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}

/** When Activity was last viewed (ms), or null if not known yet. */
export function getActivitySeenAt(): number | null {
  return seenAt;
}

/** Forget the previous couple's activity marker (after an unpair): the next couple starts fresh. */
export function resetActivityUnread(): void {
  seenAt = null;
  latestOtherAt = 0;
  emit();
  AsyncStorage.removeItem(SEEN_KEY).catch(() => {});
}
