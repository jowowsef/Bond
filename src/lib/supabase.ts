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
