import type { AuthError } from '@supabase/supabase-js';
import * as Linking from 'expo-linking';
import { supabase } from './supabase';

/**
 * EMAIL SIGN IN, NEW EMAIL ACCOUNTS + PASSWORD RESET, for a phone that has
 * no Bond account yet (the "Continue with email" screen).
 *
 * Returning users sign in to their existing account (same user id, so their
 * couple and data come back). Linking an email to the account that is ALREADY
 * on this phone is a different flow (Settings > Account, accountProtection.ts)
 * and never goes through here.
 *
 * Safety rules, enforced here and not just in the screens:
 * - Signing in is only allowed when this phone has NO Bond session at all
 *   (a fresh install / new phone). If any account is signed in, we refuse,
 *   so an existing account (anonymous or not, paired or not) is never
 *   replaced or left behind. We never sign anyone out.
 * - Sign in uses signInWithPassword only: a wrong password simply fails, it
 *   never creates an account or a couple.
 * - Create account (signUp) is a separate, explicit action, with the same
 *   "no account on this phone" guard. The new account's name starts as "Me",
 *   so Bond still asks for a name during setup.
 * - A password-reset link is only applied if this phone is signed out or
 *   already signed in to that SAME account.
 */

/** Where the reset email sends people: this app's registered "bond" scheme. */
export const RESET_REDIRECT_URL = Linking.createURL('reset-password', { scheme: 'bond' });

export type Result<T = void> = { ok: true; value: T } | { ok: false; message: string };

const BLOCKED_MESSAGE =
  'This phone is already signed in to a Bond account, so Bond will not switch accounts here. Nothing was changed.';

function friendly(error: AuthError | { code?: string; message?: string } | null | undefined): string {
  const e = (error ?? {}) as { code?: string; message?: string };
  const code = e.code ?? '';
  const msg = (e.message ?? '').toLowerCase();
  if (msg.includes('network request failed') || msg.includes('failed to fetch')) {
    return 'No internet connection. Check your connection and try again.';
  }
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return 'Email or password is incorrect.';
  }
  if (code === 'email_not_confirmed') {
    return 'This email has not been confirmed yet. Open the confirmation email from Bond, tap its link, then sign in again.';
  }
  if (code === 'over_request_rate_limit' || code === 'over_email_send_rate_limit') {
    return 'Too many attempts. Wait a few minutes, then try again.';
  }
  if (code === 'user_banned') return 'This account cannot sign in right now.';
  if (code === 'email_address_invalid') return 'Enter a valid email address.';
  if (code === 'signup_disabled' || code === 'email_provider_disabled') {
    return 'Creating accounts with email is turned off for Bond right now.';
  }
  if (code === 'email_address_not_authorized') {
    return "Bond's email service can't send to this address yet. Try another email, or try again later.";
  }
  if (code === 'weak_password') return `Please choose a stronger password. ${e.message ?? ''}`.trim();
  if (code === 'same_password') return 'That is already your password. Choose a different one, or go back and sign in.';
  if (code === 'otp_expired' || msg.includes('expired')) {
    return 'This reset link has expired or was already used. Request a new one.';
  }
  return e.message || 'Something went wrong. Please try again.';
}

/** Is this phone free to sign in (no session of any kind)? */
export async function signInAllowed(): Promise<Result> {
  const { data } = await supabase.auth.getSession();
  if (!data.session) return { ok: true, value: undefined };
  const extra = data.session.user.is_anonymous
    ? ' To be able to recover this account later, protect it in Settings > Account.'
    : '';
  return { ok: false, message: BLOCKED_MESSAGE + extra };
}

/** Sign in to an existing protected account. Never creates an account. */
export async function signInWithEmail(email: string, password: string): Promise<Result<string>> {
  // Re-check right before the call: supabase-js would otherwise REPLACE any
  // session that appeared since the screen opened.
  const allowed = await signInAllowed();
  if (!allowed.ok) return allowed;

  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.trim().toLowerCase(),
    password,
  });
  if (error || !data.user) return { ok: false, message: friendly(error) };
  return { ok: true, value: data.user.id };
}

export type SignUpOutcome =
  /** Email confirmation is off in Supabase: the new account is signed in now. */
  | { kind: 'signed-in'; userId: string }
  /** A confirmation link was emailed (also shown when the email already has an
   *  account, so this never reveals who uses Bond). */
  | { kind: 'check-email' };

/** Create a NEW Bond account with email + password (only on a phone with no account). */
export async function signUpWithEmail(email: string, password: string): Promise<Result<SignUpOutcome>> {
  const allowed = await signInAllowed();
  if (!allowed.ok) return allowed;

  const { data, error } = await supabase.auth.signUp({
    email: email.trim().toLowerCase(),
    password,
    // "Me" makes Bond's normal name step run after pairing.
    options: { data: { display_name: 'Me' } },
  });
  if (error) return { ok: false, message: friendly(error) };
  if (data.session && data.user) return { ok: true, value: { kind: 'signed-in', userId: data.user.id } };
  return { ok: true, value: { kind: 'check-email' } };
}

/**
 * Ask Supabase to email a reset link. The answer is the same whether or not
 * the email has an account, so this never reveals who uses Bond.
 */
export async function requestPasswordReset(email: string): Promise<Result> {
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: RESET_REDIRECT_URL,
  });
  if (error) {
    const msg = friendly(error);
    // Only connection / rate problems are shown; anything else stays neutral.
    if (msg.startsWith('No internet') || msg.startsWith('Too many')) return { ok: false, message: msg };
  }
  return { ok: true, value: undefined };
}

export type RecoveryLink =
  | { kind: 'tokens'; accessToken: string; refreshToken: string; userId: string | null }
  | { kind: 'error'; message: string }
  | { kind: 'none' };

/** Read the tokens Supabase adds to the reset link (after "#", sometimes "?"). */
export function parseRecoveryUrl(url: string | null): RecoveryLink {
  if (!url) return { kind: 'none' };
  const params = new Map<string, string>();
  for (const part of [url.split('#')[1], url.split('?')[1]?.split('#')[0]]) {
    if (!part) continue;
    for (const pair of part.split('&')) {
      const [k, v = ''] = pair.split('=');
      if (k) params.set(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, ' ')));
    }
  }
  if (params.get('error') || params.get('error_code')) {
    return {
      kind: 'error',
      message: friendly({ code: params.get('error_code') ?? undefined, message: params.get('error_description') ?? undefined }),
    };
  }
  const accessToken = params.get('access_token');
  const refreshToken = params.get('refresh_token');
  if (!accessToken || !refreshToken || params.get('type') !== 'recovery') return { kind: 'none' };
  return { kind: 'tokens', accessToken, refreshToken, userId: tokenUserId(accessToken) };
}

/** The account id inside a Supabase access token (only used for the safety comparison). */
function tokenUserId(token: string): string | null {
  try {
    const payload = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(globalThis.atob(payload.padEnd(payload.length + ((4 - (payload.length % 4)) % 4), '=')));
    return typeof json.sub === 'string' ? json.sub : null;
  } catch {
    return null;
  }
}

/**
 * Apply the reset link and save the new password. Refuses if a DIFFERENT
 * account is signed in on this phone, so that account is never replaced.
 */
export async function completePasswordReset(link: RecoveryLink & { kind: 'tokens' }, newPassword: string): Promise<Result> {
  const { data: current } = await supabase.auth.getSession();
  const currentId = current.session?.user.id ?? null;
  if (currentId && (!link.userId || currentId !== link.userId)) {
    return {
      ok: false,
      message:
        'A different Bond account is signed in on this phone, so this reset link was not used here. Open the link on the phone where you want to sign in.',
    };
  }

  const set = await supabase.auth.setSession({ access_token: link.accessToken, refresh_token: link.refreshToken });
  if (set.error || !set.data.user) return { ok: false, message: friendly(set.error) };
  if (link.userId && set.data.user.id !== link.userId) {
    return { ok: false, message: 'This reset link did not match its account. Request a new one.' };
  }

  const { error } = await supabase.auth.updateUser({ password: newPassword, data: { bond_password_set: true } });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true, value: undefined };
}
