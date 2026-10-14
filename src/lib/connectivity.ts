import { supabase } from './supabase';

/**
 * Whether Bond can reach the server right now, as seen by the couple state
 * (its last server check). Screens use it for a small "offline" note, and to
 * reload their data the moment the connection comes back.
 */
type Listener = () => void;
const listeners = new Set<Listener>();

/** Call fn each time Bond gets back online after being offline. Returns an unsubscribe. */
export function onReconnect(fn: Listener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Used by the couple state when a server check succeeds again after failing. */
export function notifyReconnected(): void {
  listeners.forEach((l) => {
    try {
      l();
    } catch {
      // a listener's problem never stops the others
    }
  });
}

/**
 * Throws unless requests will really run as the signed-in user. Without a
 * usable session (offline with an old token, or the token not refreshed yet),
 * supabase-js sends requests as nobody, and the database's row level security
 * then returns EMPTY results, which would look like "nothing shared". Loaders
 * call this first, so they keep their last data instead.
 */
export async function assertSignedIn(): Promise<void> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) throw new Error('offline: not signed in right now');
}
