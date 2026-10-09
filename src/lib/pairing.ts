import { supabase } from './supabase';
import type { Couple, Profile } from './types';

/**
 * PAIRING + SESSION HELPERS
 *
 * The app is "pair-first": there is no visible sign up / sign in. Behind the
 * scenes we use a Supabase ANONYMOUS session so every phone still has a
 * secure identity (needed for Row Level Security), but the person only ever
 * sees "Create Couple" / "Join Couple".
 *
 * NOTE: Anonymous sign-in must be enabled once in the Supabase dashboard:
 *   Authentication → Sign In / Providers → Anonymous Sign-Ins → ON
 */

export type PairResult = { ok: true; couple: Couple } | { ok: false; message: string };

/** Friendly messages for the errors the pairing screens can hit. */
function friendly(raw: string): string {
  const m = raw.toLowerCase();
  if (m.includes('network') || m.includes('fetch')) {
    return 'Unable to connect. Check your internet connection and try again.';
  }
  if (m.includes('already in a couple')) return 'This phone is already connected to a couple.';
  if (m.includes('not found') || m.includes('was not found')) return "That couple code isn't valid.";
  if (m.includes('already has two')) return 'That couple is already full (two people).';
  if (m.includes('anonymous')) {
    return 'Anonymous sign-in is turned off in Supabase. Enable it in Authentication → Providers.';
  }
  return raw;
}

/**
 * Make sure we have a logged-in (anonymous) session, and set the display
 * name. If a session already exists we just update the name.
 */
export async function ensureSession(displayName = ''): Promise<{ ok: boolean; message?: string }> {
  const name = displayName.trim();
  const { data: existing } = await supabase.auth.getSession();

  if (!existing.session) {
    // Only pass a name if we actually have one; otherwise the database
    // trigger fills in a sensible default ("Me"), editable later in Settings.
    const credentials = name ? { options: { data: { display_name: name } } } : undefined;
    const { error } = await supabase.auth.signInAnonymously(credentials);
    if (error) return { ok: false, message: friendly(error.message) };
  }
  // If a name was provided, save it onto the profile row.
  if (name) {
    const { data: who } = await supabase.auth.getUser();
    if (who.user) {
      await supabase.from('profiles').update({ display_name: name }).eq('id', who.user.id);
    }
  }
  return { ok: true };
}

/** Create a brand-new couple and return it (with its invite code). */
export async function createCouple(displayName = ''): Promise<PairResult> {
  const session = await ensureSession(displayName);
  if (!session.ok) return { ok: false, message: session.message ?? 'Could not start a session.' };

  const { data, error } = await supabase.rpc('create_couple');
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true, couple: data as Couple };
}

/** Clean up whatever the partner typed into a usable short code. */
export function normalizeCode(input: string): string {
  // Tolerate the old "BOND-" prefix and any spaces/dashes people might add.
  return input.toUpperCase().replace(/^BOND[-\s]?/, '').replace(/[^A-Z0-9]/g, '');
}

/** Join an existing couple using its code. */
export async function joinCouple(code: string, displayName = ''): Promise<PairResult> {
  const clean = normalizeCode(code);
  if (clean.length < 4) return { ok: false, message: "That couple code isn't valid." };

  const session = await ensureSession(displayName);
  if (!session.ok) return { ok: false, message: session.message ?? 'Could not start a session.' };

  const { data, error } = await supabase.rpc('join_couple', { p_code: clean });
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true, couple: data as Couple };
}

/** Leave the couple (turns off any controls — see leave_couple in the schema). */
export async function unpair(): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.rpc('leave_couple');
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true };
}

/** Show the code the way the UI presents it: a short code like "K7P4X2". */
export function displayCode(code: string | null | undefined): string {
  return code ? code.toUpperCase() : '';
}

/** Update just the display name on my profile. */
export async function updateDisplayName(
  userId: string,
  name: string,
): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('profiles').update({ display_name: name.trim() || 'Me' }).eq('id', userId);
  if (error) return { ok: false, message: friendly(error.message) };
  return { ok: true };
}

/** Fetch one profile row (or null). */
export async function fetchProfile(userId: string): Promise<Profile | null> {
  const { data } = await supabase.from('profiles').select('*').eq('id', userId).maybeSingle();
  return (data as Profile) ?? null;
}
