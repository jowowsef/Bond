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
 * - Password reset uses PKCE (see supabase.ts): the email link carries only
 *   a one-time code, exchanged here with the secret this phone saved when it
 *   asked for the email. The link is only used on a phone with no Bond
 *   session, so an account that is signed in is never replaced. Links that
 *   carry tokens (the older kind) are not used.
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
  if (code === 'otp_expired' || code === 'flow_state_expired' || code === 'flow_state_not_found' || msg.includes('expired')) {
    return 'This reset link has expired or was already used. Request a new one.';
  }
  if (code === 'bad_code_verifier' || msg.includes('code verifier')) {
    return 'Open the newest reset email on the same phone where you asked for it. If it still fails, request a new one.';
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
  /** PKCE: a one-time code, usable only with this phone's saved secret. */
  | { kind: 'code'; code: string }
  /** Supabase sent the person back with an error (expired, used, ...). */
  | { kind: 'error'; message: string }
  /** A link that carries tokens (older, non-PKCE kind): not used. */
  | { kind: 'legacy' }
  | { kind: 'none' };

/** Read what Supabase added to the reset link (query "?" and/or fragment "#"). */
export function parseRecoveryUrl(url: string | null): RecoveryLink {
  if (!url) return { kind: 'none' };
  const params = new Map<string, string>();
  for (const part of [url.split('#')[1], url.split('?')[1]?.split('#')[0]]) {
    if (!part) continue;
    for (const pair of part.split('&')) {
      const [k, v = ''] = pair.split('=');
      try {
        if (k) params.set(decodeURIComponent(k), decodeURIComponent(v.replace(/\+/g, ' ')));
      } catch {
        // malformed piece: ignore it
      }
    }
  }
  if (params.get('error') || params.get('error_code')) {
    return {
      kind: 'error',
      message: friendly({ code: params.get('error_code') ?? undefined, message: params.get('error_description') ?? undefined }),
    };
  }
  if (params.get('access_token') || params.get('refresh_token')) return { kind: 'legacy' };
  const code = params.get('code');
  if (code && /^[A-Za-z0-9-]{8,200}$/.test(code)) return { kind: 'code', code };
  return { kind: 'none' };
}

/**
 * Step 1 of a reset: trade the link's one-time code for a session. Only on a
 * phone with NO Bond session (an account that is signed in is never
 * replaced), and only with the secret saved when this phone asked for the
 * email (another phone or app can't use the code).
 */
export async function startPasswordRecovery(link: RecoveryLink & { kind: 'code' }): Promise<Result> {
  const { data: current } = await supabase.auth.getSession();
  if (current.session) {
    return {
      ok: false,
      message: 'This phone is already signed in to a Bond account, so this reset link was not used here. Nothing was changed.',
    };
  }
  const { data, error } = await supabase.auth.exchangeCodeForSession(link.code);
  if (error || !data.session) return { ok: false, message: friendly(error) };
  return { ok: true, value: undefined };
}

/** Step 2: save the new password for the account the reset link opened. */
export async function completePasswordReset(newPassword: string): Promise<Result> {
  const { data: current } = await supabase.auth.getSession();
  if (!current.session) return { ok: false, message: 'This reset link has expired or was already used. Request a new one.' };
  const { error } = await supabase.auth.updateUser({ password: newPassword, data: { bond_password_set: true } });
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true, value: undefined };
}
