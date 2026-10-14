import 'react-native-url-polyfill/auto';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';
import { AppState } from 'react-native';

/**
 * The ONE Supabase client used everywhere in the app.
 *
 * - The URL and key come from the ".env.local" file (see .env.example).
 * - Your login session is saved on the phone (AsyncStorage) so you stay
 *   logged in. Passwords are never stored — Supabase only keeps a token.
 *   Android backups of the app's data are turned off (app.json allowBackup),
 *   so the session never leaves the phone that way.
 * - Email links (password reset) use PKCE: the link only carries a one-time
 *   code, which works only together with a secret kept on the phone that
 *   asked for it. Another app that catches the bond:// link can't use it.
 */
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

export const isSupabaseConfigured = supabaseUrl.startsWith('https://') && supabaseAnonKey.length > 20;

export const supabase = createClient(
  isSupabaseConfigured ? supabaseUrl : 'https://not-configured.supabase.co',
  isSupabaseConfigured ? supabaseAnonKey : 'not-configured',
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  },
);

/**
 * The session Supabase saved on this phone (the same one it signs requests
 * with), read straight from storage. Used ONLY when Supabase can't load it
 * because it is offline with an expired access token: then Bond still knows
 * who is signed in on this phone and can show that account's saved data. It
 * never makes a request as that user (Supabase refreshes the token itself
 * once online), and it is null after signing out.
 */
export async function readStoredSession(): Promise<import('@supabase/supabase-js').Session | null> {
  if (!isSupabaseConfigured) return null;
  try {
    // supabase-js's default storage key for this project.
    const raw = await AsyncStorage.getItem(`sb-${new URL(supabaseUrl).hostname.split('.')[0]}-auth-token`);
    if (!raw) return null;
    const s = JSON.parse(raw) as import('@supabase/supabase-js').Session;
    return s?.user?.id && s.refresh_token ? s : null;
  } catch {
    return null;
  }
}

/**
 * A separate, throw-away Supabase client that keeps its session ONLY in memory
 * (never saved, never refreshed, never shared with the app's client). Used to
 * let Supabase verify a fresh Google sign-in for re-authentication without
 * touching the session the app is using. Sign it out when done.
 */
export function createVerificationClient() {
  const memory = new Map<string, string>();
  return createClient(
    isSupabaseConfigured ? supabaseUrl : 'https://not-configured.supabase.co',
    isSupabaseConfigured ? supabaseAnonKey : 'not-configured',
    {
      auth: {
        storageKey: 'bond-reauth-check',
        storage: {
          getItem: async (k: string) => memory.get(k) ?? null,
          setItem: async (k: string, v: string) => void memory.set(k, v),
          removeItem: async (k: string) => void memory.delete(k),
        },
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    },
  );
}

// Only refresh the login token while the app is open (saves battery).
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

let topicCounter = 0;

/**
 * A fresh Realtime channel name for every subscription.
 *
 * Why: supabase.channel(name) hands back the EXISTING channel when one with
 * the same name is already registered, and removeChannel() is async (it waits
 * for the server before the channel is dropped). Reusing a fixed name can
 * therefore return a channel that is already subscribed, and calling .on()
 * on it throws "cannot add postgres_changes callbacks ... after subscribe()".
 * A unique name per effect run always gives a brand-new, unsubscribed channel.
 * (We only use postgres_changes, so the topic name itself has no meaning.)
 */
export function uniqueTopic(base: string): string {
  topicCounter += 1;
  return `${base}-${topicCounter}`;
}

/** Turns a Supabase / Postgres error into a friendly sentence. */
export function errorMessage(error: unknown): string {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  const e = error as { message?: string };
  const msg = e.message ?? 'Something went wrong.';
  if (msg.includes('Network request failed') || msg.includes('Failed to fetch')) {
    return 'No internet connection. Please try again when you are online.';
  }
  // Database/technical wording (table names, policies, tokens) is never shown.
  if (/violates|relation|column|permission denied|row-level security|jwt|pgrst|syntax|function|constraint|duplicate key/i.test(msg)) {
    return 'Something went wrong. Please try again.';
  }
  return msg;
}
