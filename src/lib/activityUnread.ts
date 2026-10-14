import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useSyncExternalStore } from 'react';
import { supabase, uniqueTopic } from './supabase';

/**
 * Unread count for the bell (Notifications).
 *
 * Kept on this phone only (no database change): we remember when you last
 * opened Notifications, and count what your partner (or the system) logged
 * after that. Your own actions never count.
 */

const SEEN_KEY = 'bond.activity.seenAt';

let seenAt: number | null = null; // null until loaded from storage
let latestOtherAt = 0;
/** How many partner / system entries are newer than seenAt. */
let unreadCount = 0;
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

function getUnreadCount(): number {
  return hasUnread() ? Math.max(unreadCount, 1) : 0;
}

export function useHasUnreadActivity(): boolean {
  return useSyncExternalStore(subscribe, hasUnread, hasUnread);
}

/** How many new notifications (0 = none). */
export function useUnreadActivityCount(): number {
  return useSyncExternalStore(subscribe, getUnreadCount, getUnreadCount);
}

/** A notification Bond just showed on this phone (also counted on the bell). */
export function noteLocalNotification(at: number): void {
  if (seenAt === null || at <= seenAt) return;
  latestOtherAt = Math.max(latestOtherAt, at);
  unreadCount += 1;
  emit();
}

/** Call when the Activity screen is visible. */
export function markActivitySeen(): void {
  const now = Math.max(Date.now(), latestOtherAt);
  seenAt = now;
  unreadCount = 0;
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
      if (seenAt !== null && latestOtherAt > seenAt) {
        const { count } = await supabase
          .from('activity_logs')
          .select('id', { count: 'exact', head: true })
          .or(`actor_id.is.null,actor_id.neq.${userId}`)
          .gt('created_at', new Date(seenAt).toISOString());
        if (!active) return;
        unreadCount = count ?? 1;
      } else {
        unreadCount = 0;
      }
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
  unreadCount = 0;
  emit();
  AsyncStorage.removeItem(SEEN_KEY).catch(() => {});
}
