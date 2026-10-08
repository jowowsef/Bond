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
    },
  },
);

// Only refresh the login token while the app is open (saves battery).
AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh();
  else supabase.auth.stopAutoRefresh();
});

/** Turns a Supabase / Postgres error into a friendly sentence. */
export function errorMessage(error: unknown): string {
  if (!error) return 'Something went wrong.';
  if (typeof error === 'string') return error;
  const e = error as { message?: string };
  const msg = e.message ?? 'Something went wrong.';
  if (msg.includes('Network request failed') || msg.includes('Failed to fetch')) {
    return 'No internet connection. Please try again when you are online.';
  }
  return msg;
}
