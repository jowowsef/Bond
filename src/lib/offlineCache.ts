import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * OFFLINE CACHE: the last data Bond loaded from the server, kept privately on
 * this phone (the app's own storage), so Bond can open and show it without
 * internet. Always shown with its own "updated" time; never as live.
 *
 * Every entry belongs to ONE signed-in account (`owner` = my user id) and
 * names the partner it is about, so another account's data can never show:
 * reads are by my id, and signing out / deleting the account clears all of
 * this account's entries (clearOfflineCache).
 */
const PREFIX = 'bond:offline:';

/** Older caches written before this module (kept in the same cleanup). */
const LEGACY_PREFIXES = ['bond:partner-current-app:'];

const keyFor = (owner: string, key: string) => `${PREFIX}${owner}:${key}`;

export type Cached<T> = { value: T; savedAt: number };

export async function readCached<T>(owner: string | null | undefined, key: string): Promise<Cached<T> | null> {
  if (!owner) return null;
  try {
    const raw = await AsyncStorage.getItem(keyFor(owner, key));
    return raw ? (JSON.parse(raw) as Cached<T>) : null;
  } catch {
    return null;
  }
}

export async function writeCached<T>(owner: string | null | undefined, key: string, value: T): Promise<void> {
  if (!owner) return;
  try {
    await AsyncStorage.setItem(keyFor(owner, key), JSON.stringify({ value, savedAt: Date.now() } satisfies Cached<T>));
  } catch {
    // best effort: the app still works online without it
  }
}

/** Remove this account's cached data (all accounts when `owner` is omitted). */
export async function clearOfflineCache(owner?: string | null): Promise<void> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    const drop = keys.filter((k) =>
      owner
        ? k.startsWith(`${PREFIX}${owner}:`) || LEGACY_PREFIXES.some((p) => k.startsWith(`${p}${owner}:`))
        : k.startsWith(PREFIX) || LEGACY_PREFIXES.some((p) => k.startsWith(p)),
    );
    if (drop.length) await AsyncStorage.multiRemove(drop);
  } catch {
    // best effort
  }
}
