import type { AuthError, User } from '@supabase/supabase-js';
import { supabase } from './supabase';

/**
 * ACCOUNT PROTECTION (Phase 1: email + password on the EXISTING account)
 *
 * Every Bond phone starts with an anonymous Supabase account. Protecting it
 * adds an email and password to that SAME account, so its user id, couple
 * and all data stay exactly as they are. This follows Supabase's documented
 * way to convert an anonymous user:
 *   1. updateUser({ email })          -> Supabase emails a confirmation
 *   2. verify the email (code or link) -> email is now part of this account
 *   3. updateUser({ password })        -> a password login now exists
 * We never call signUp / signInWithPassword here (those would create or
 * switch to a different account), never sign out, and never touch pairing.
 *
 * Supabase does not tell apps whether a password is set, so after step 3 we
 * record `bond_password_set` in the user's own auth metadata (not a database
 * table) purely so the screen knows the setup is complete.
 */

export type ProtectionStatus =
  /** Anonymous, nothing linked yet. */
  | { kind: 'unprotected' }
  /** Email entered, waiting for the user to confirm it. */
  | { kind: 'pending'; email: string }
  /** Email confirmed on this account; a password still needs to be added. */
  | { kind: 'needs-password'; email: string }
  /** Email confirmed and password set. */
  | { kind: 'protected'; email: string };

export type Result<T = void> = { ok: true; value: T } | { ok: false; message: string; code?: string };

const PASSWORD_FLAG = 'bond_password_set';

function statusFromUser(user: User): ProtectionStatus {
  const confirmed = !!user.email && !!user.email_confirmed_at;
  if (confirmed && user.user_metadata?.[PASSWORD_FLAG] === true) return { kind: 'protected', email: user.email! };
  if (confirmed) return { kind: 'needs-password', email: user.email! };
  if (user.new_email) return { kind: 'pending', email: user.new_email };
  return { kind: 'unprotected' };
}

/** Plain-language messages for the errors this flow can hit. */
function friendly(error: AuthError | Error | null | undefined): string {
  const e = (error ?? {}) as { code?: string; message?: string };
  const code = e.code ?? '';
  const msg = (e.message ?? '').toLowerCase();
  if (msg.includes('network request failed') || msg.includes('failed to fetch')) {
    return 'No internet connection. Your account was not changed. Try again when you are online.';
  }
  if (
    code === 'email_exists' ||
    code === 'user_already_exists' ||
    code === 'identity_already_exists' ||
    msg.includes('already been registered') ||
    msg.includes('already exists')
  ) {
    return 'This email is already used by another account. Use a different email. Your current account was not changed.';
  }
  if (code === 'email_address_invalid' || msg.includes('invalid format') || msg.includes('is invalid')) {
    return 'Enter a valid email address.';
  }
  if (code === 'manual_linking_disabled') {
    return 'Account protection is not turned on for Bond yet. (Supabase setting: "Allow manual linking".)';
  }
  if (code === 'email_provider_disabled' || code === 'provider_disabled') {
    return 'Email accounts are turned off for Bond right now. (Supabase setting: Email provider.)';
  }
  if (code === 'over_email_send_rate_limit' || code === 'over_request_rate_limit') {
    return 'Too many emails were sent. Wait a few minutes, then try again.';
  }
  if (code === 'email_address_not_authorized') {
    return "Bond's email service can't send to this address yet. (Supabase needs a custom email provider.)";
  }
  if (code === 'weak_password') {
    return `Please choose a stronger password. ${e.message ?? ''}`.trim();
  }
  if (code === 'otp_expired' || msg.includes('token has expired or is invalid')) {
    return 'That code is wrong or has expired. Check the newest email from Bond, or send a new code.';
  }
  return e.message || 'Something went wrong. Your account was not changed.';
}

/** Read the account fresh from Supabase (not from the cached session). */
async function freshUser(): Promise<Result<User>> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return { ok: false, message: friendly(error), code: error?.code };
  return { ok: true, value: data.user };
}

/** Guard: every step must still be on the account the user started with. */
function sameAccount(user: User, expectedUserId: string): Result<User> {
  if (user.id !== expectedUserId) {
    return { ok: false, message: 'The signed-in account changed unexpectedly, so nothing was saved. Please restart Bond.' };
  }
  return { ok: true, value: user };
}

export async function getProtectionStatus(expectedUserId: string): Promise<Result<ProtectionStatus>> {
  const user = await freshUser();
  if (!user.ok) return user;
  const same = sameAccount(user.value, expectedUserId);
  if (!same.ok) return same;
  return { ok: true, value: statusFromUser(user.value) };
}

/**
 * Step 1: add the email to THIS account. Supabase then emails a confirmation
 * (a link, plus a code if the email template includes one). If the project
 * does not require confirmation, the email is confirmed immediately.
 */
export async function linkEmail(expectedUserId: string, email: string): Promise<Result<ProtectionStatus>> {
  const before = await freshUser();
  if (!before.ok) return before;
  const same = sameAccount(before.value, expectedUserId);
  if (!same.ok) return same;
  const current = statusFromUser(before.value);
  if (current.kind === 'protected' || current.kind === 'needs-password') return { ok: true, value: current };

  const { data, error } = await supabase.auth.updateUser({ email: email.trim().toLowerCase() });
  if (error || !data.user) return { ok: false, message: friendly(error), code: error?.code };
  const after = sameAccount(data.user, expectedUserId);
  if (!after.ok) return after;
  return { ok: true, value: statusFromUser(data.user) };
}

/** Send the confirmation email again. */
export async function resendConfirmation(email: string): Promise<Result> {
  const { error } = await supabase.auth.resend({ type: 'email_change', email: email.trim().toLowerCase() });
  if (error) return { ok: false, message: friendly(error), code: error.code };
  return { ok: true, value: undefined };
}

/** Step 2a: confirm with the code from the email. Same account, new session tokens. */
export async function confirmEmailCode(
  expectedUserId: string,
  email: string,
  code: string,
): Promise<Result<ProtectionStatus>> {
  const { data, error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: code.trim(),
    type: 'email_change',
  });
  if (error) return { ok: false, message: friendly(error), code: error.code };
  const user = data.user ?? (await freshUser().then((r) => (r.ok ? r.value : null)));
  if (!user) return { ok: false, message: 'Could not confirm the email. Please try again.' };
  const same = sameAccount(user, expectedUserId);
  if (!same.ok) return same;
  return { ok: true, value: statusFromUser(user) };
}

/**
 * Step 2b: the user tapped the link in the email instead. That confirms the
 * email on Supabase's side; refresh so this phone sees it.
 */
export async function recheckEmail(expectedUserId: string): Promise<Result<ProtectionStatus>> {
  await supabase.auth.refreshSession().catch(() => undefined); // keeps the same session if it fails
  return getProtectionStatus(expectedUserId);
}

export type PasswordResult = Result<ProtectionStatus> | { ok: false; needsReauth: true; message: string };

/**
 * Step 3: add the password. If the project has "Secure password change" on
 * and this session is older than 24 h, Supabase asks for a code first:
 * call sendReauthCode() and pass that code here as `nonce`.
 */
export async function setAccountPassword(expectedUserId: string, password: string, nonce?: string): Promise<PasswordResult> {
  const before = await freshUser();
  if (!before.ok) return before;
  const same = sameAccount(before.value, expectedUserId);
  if (!same.ok) return same;
  if (!before.value.email || !before.value.email_confirmed_at) {
    return { ok: false, message: 'Confirm your email first, then add the password.' };
  }

  const { data, error } = await supabase.auth.updateUser({
    password,
    nonce: nonce?.trim() || undefined,
    data: { [PASSWORD_FLAG]: true },
  });
  if (error) {
    if (error.code === 'reauthentication_needed' || error.code === 'reauth_nonce_missing') {
      return { ok: false, needsReauth: true, message: 'For your security, enter the code we just emailed you.' };
    }
    if (error.code === 'same_password') {
      // The password is already this value: just record that it is set.
      const flag = await supabase.auth.updateUser({ data: { [PASSWORD_FLAG]: true } });
      if (flag.error || !flag.data.user) return { ok: false, message: friendly(flag.error) };
      return verifyProtected(flag.data.user, expectedUserId);
    }
    return { ok: false, message: friendly(error), code: error.code };
  }
  if (!data.user) return { ok: false, message: 'Could not save the password. Please try again.' };
  return verifyProtected(data.user, expectedUserId);
}

/** Only report success when Supabase itself shows the finished state on the same account. */
async function verifyProtected(user: User, expectedUserId: string): Promise<Result<ProtectionStatus>> {
  const same = sameAccount(user, expectedUserId);
  if (!same.ok) return same;
  const fresh = await freshUser();
  const check = fresh.ok ? fresh.value : user;
  const status = statusFromUser(check);
  if (check.id !== expectedUserId || status.kind !== 'protected') {
    return { ok: false, message: 'Supabase did not confirm the change. Please try again.' };
  }
  return { ok: true, value: status };
}

/** Email a one-time code needed by "Secure password change". */
export async function sendReauthCode(): Promise<Result> {
  const { error } = await supabase.auth.reauthenticate();
  if (error) return { ok: false, message: friendly(error), code: error.code };
  return { ok: true, value: undefined };
}

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export const MIN_PASSWORD_LENGTH = 8;
