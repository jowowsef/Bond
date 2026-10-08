import { timeAgo } from './format';
import { supabase } from './supabase';

/**
 * ONLINE / LAST ACTIVE
 *
 * We never store a permanent "online = true" flag (it goes stale). Instead
 * each phone writes a timestamp (last_seen) every ~30s while the app is open,
 * and we decide "online" by how recent that timestamp is.
 *
 * All the tunable numbers live here so they are easy to change in one place.
 */

/** Seen within this window counts as "Online". */
export const ONLINE_THRESHOLD_MS = 60_000; // 60 seconds
/** How often to refresh our own last_seen while the app is active. */
export const HEARTBEAT_INTERVAL_MS = 30_000; // 30 seconds

export type PresenceState = 'online' | 'last_active' | 'unavailable';

export type PresenceStatus = {
  state: PresenceState;
  label: string;
  lastSeen: string | null;
};

/** Write "I am active right now" for the current user. */
export async function sendHeartbeat(userId: string): Promise<void> {
  await supabase.from('presence').upsert({ user_id: userId, last_seen: new Date().toISOString() });
}

/**
 * Read a user's last_seen. `ok: false` means the request failed (e.g. no
 * internet) — the caller can still show the last value it already had.
 */
export async function fetchLastSeen(userId: string): Promise<{ lastSeen: string | null; ok: boolean }> {
  const { data, error } = await supabase.from('presence').select('last_seen').eq('user_id', userId).maybeSingle();
  if (error) return { lastSeen: null, ok: false };
  return { lastSeen: (data?.last_seen as string | undefined) ?? null, ok: true };
}

export function isOnline(lastSeen: string | null, now: number = Date.now()): boolean {
  if (!lastSeen) return false;
  return now - new Date(lastSeen).getTime() <= ONLINE_THRESHOLD_MS;
}

/**
 * Turn a last_seen timestamp into a status for the UI.
 *   - online        → "Online"
 *   - last_active   → "Last active 5 min ago"
 *   - unavailable   → "Status unavailable" (never active, hidden, or unknown)
 *
 * We only say "unavailable" when we genuinely have nothing to show — never a
 * fake "Offline".
 */
export function presenceStatus(lastSeen: string | null, ok: boolean, now: number = Date.now()): PresenceStatus {
  if (!lastSeen) {
    return { state: 'unavailable', label: ok ? 'Status unavailable' : 'Status unavailable', lastSeen: null };
  }
  if (isOnline(lastSeen, now)) {
    return { state: 'online', label: 'Online', lastSeen };
  }
  return { state: 'last_active', label: `Last active ${timeAgo(lastSeen, now)}`, lastSeen };
}
