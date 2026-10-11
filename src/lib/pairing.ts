import { supabase } from './supabase';
import type { Couple, Profile } from './types';

/**
 * PAIRING HELPERS
 *
 * Pairing needs a signed-in Email or Google account (the Welcome / Sign in
 * screens come first). Bond no longer creates anonymous accounts.
 *
 * Codes (migration 0015): 6 characters, valid for 24 hours, a new one any
 * time ("New code"). Joining is limited to 5 wrong codes per 15 minutes and
 * 20 per day per account; a wrong, expired or already used code all give
 * the same answer.
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
  if (m.includes('already has two')) return "That couple code isn't valid.";
  return raw;
}

/**
 * Pairing needs a signed-in account (never created here). Also saves the
 * display name, if one is given.
 */
export async function ensureSession(displayName = ''): Promise<{ ok: boolean; message?: string }> {
  const name = displayName.trim();
  const { data: existing } = await supabase.auth.getSession();
  if (!existing.session) return { ok: false, message: 'Please sign in first.' };
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
  return input.trim().toUpperCase().replace(/^BOND[-\s]?/, '').replace(/[^A-Z0-9]/g, '');
}

/** Join an existing couple using its code. */
export async function joinCouple(code: string, displayName = ''): Promise<PairResult> {
  const clean = normalizeCode(code);
  if (clean.length < 4) return { ok: false, message: "That couple code isn't valid." };

  const session = await ensureSession(displayName);
  if (!session.ok) return { ok: false, message: session.message ?? 'Could not start a session.' };

  const { data, error } = await supabase.rpc('pair_with_code', { p_code: clean });
  if (error) {
    // Server without 0015 yet: the previous join.
    if (isMissingFunction(error)) {
      const old = await supabase.rpc('join_couple', { p_code: clean });
      if (old.error) return { ok: false, message: friendly(old.error.message) };
      return { ok: true, couple: old.data as Couple };
    }
    return { ok: false, message: friendly(error.message) };
  }
  return pairAnswer(data as PairAnswer);
}

type PairAnswer = {
  status: 'ok' | 'invalid' | 'rate_limited' | 'already_paired';
  couple?: Couple;
  attempts_left?: number;
  retry_after_seconds?: number;
};

/** The server's answer to a pairing attempt, as something to show (exported for tests). */
export function pairAnswer(a: PairAnswer | null): PairResult {
  switch (a?.status) {
    case 'ok':
      if (a.couple) return { ok: true, couple: a.couple };
      break;
    case 'invalid': {
      const left = a.attempts_left;
      if (left === 0) return { ok: false, message: "That couple code isn't valid. Too many tries; wait a few minutes before trying again." };
      const hint = typeof left === 'number' && left <= 2 ? ` ${left} ${left === 1 ? 'try' : 'tries'} left for now.` : '';
      return { ok: false, message: `That couple code isn't valid or has expired. Ask your partner for a new code.${hint}` };
    }
    case 'rate_limited':
      return { ok: false, message: `Too many tries. Try again in ${waitText(a.retry_after_seconds ?? 900)}.` };
    case 'already_paired':
      return { ok: false, message: 'This phone is already connected to a couple.' };
  }
  return { ok: false, message: 'Something went wrong. Please try again.' };
}

function waitText(seconds: number): string {
  const min = Math.max(1, Math.ceil(seconds / 60));
  if (min < 60) return `${min} minute${min === 1 ? '' : 's'}`;
  const h = Math.ceil(min / 60);
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** PostgREST answer for an RPC the server doesn't have (older database). */
function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || /could not find the function/i.test(error.message ?? '');
}

/** A new code for the person waiting (the old one stops working). */
export async function refreshInviteCode(): Promise<PairResult> {
  const { data, error } = await supabase.rpc('refresh_invite_code');
  if (error) {
    if (isMissingFunction(error)) return { ok: false, message: 'New codes need a server update first.' };
    return { ok: false, message: friendly(error.message) };
  }
  return { ok: true, couple: data as Couple };
}

/** Has this code's 24 hours passed? (Unknown expiry = still valid.) */
export function inviteExpired(couple: Pick<Couple, 'invite_expires_at'> | null, now = Date.now()): boolean {
  const at = couple?.invite_expires_at ? new Date(couple.invite_expires_at).getTime() : NaN;
  return Number.isFinite(at) && at <= now;
}

/** "Expires in 23 h" / "Expires in 12 min" (null when unknown or expired). */
export function inviteExpiresText(couple: Pick<Couple, 'invite_expires_at'> | null, now = Date.now()): string | null {
  const at = couple?.invite_expires_at ? new Date(couple.invite_expires_at).getTime() : NaN;
  if (!Number.isFinite(at) || at <= now) return null;
  const min = Math.ceil((at - now) / 60_000);
  return min >= 60 ? `Expires in ${Math.floor(min / 60)} h` : `Expires in ${min} min`;
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
