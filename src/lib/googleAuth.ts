import { supabase } from './supabase';

/**
 * GOOGLE SIGN-IN (native Android account picker, react-native-nitro-google-signin,
 * which uses Google's Credential Manager).
 *
 * Safety rules:
 * - NO account on this phone  -> signInWithIdToken: signs in to the Bond
 *   account that already uses this Google account (same user id, couple and
 *   data), or creates a new one.
 * - An account IS on this phone -> never sign in (that would replace it).
 *   Instead linkIdentity adds Google to the SAME account (same user id and
 *   couple). If this Google account already belongs to another Bond account,
 *   Supabase refuses and nothing changes.
 * - Supabase's nonce check stays on: a fresh random nonce is made for every
 *   attempt; Google receives its SHA-256 hash (put inside the ID token) and
 *   Supabase receives the raw value, hashes it and compares.
 * - The native modules are loaded lazily, so an older Bond build without them
 *   shows "needs the latest version" instead of crashing.
 *
 * Config: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID = the Google Cloud "Web" OAuth
 * client ID (public, not a secret). The Android OAuth client (package name +
 * SHA-1) must exist in the same Google Cloud project, and Supabase's Google
 * provider must list these client IDs.
 */

const WEB_CLIENT_ID = (process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID ?? '').trim();

export type GoogleSupport = 'ready' | 'not-configured' | 'needs-update';

/** Testing logs (visible in `adb logcat` as ReactNativeJS). Never tokens or keys. */
function log(step: string, detail?: string | null) {
  console.warn(`[Bond][google] ${step}${detail ? `: ${detail}` : ''}`);
}

type GoogleModule = typeof import('react-native-nitro-google-signin');
type CryptoModule = typeof import('expo-crypto');

let cached: { google: GoogleModule; crypto: CryptoModule } | null | undefined;

function loadNative(): { google: GoogleModule; crypto: CryptoModule } | null {
  if (cached !== undefined) return cached;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const google = require('react-native-nitro-google-signin') as GoogleModule;
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const crypto = require('expo-crypto') as CryptoModule;
    cached = { google, crypto };
  } catch (e) {
    cached = null; // this installed build has no native Google / crypto module yet
    log('native module not available', (e as Error)?.message);
  }
  return cached;
}

/** Can the Google button actually work in this build? */
export function getGoogleSupport(): GoogleSupport {
  if (!/\.apps\.googleusercontent\.com$/.test(WEB_CLIENT_ID)) return 'not-configured';
  return loadNative() ? 'ready' : 'needs-update';
}

export type GoogleResult =
  | { ok: true; mode: 'signed-in' | 'linked'; userId: string }
  | { ok: false; cancelled?: true; message: string };

function friendly(error: { code?: string; message?: string } | null | undefined): string {
  const code = error?.code ?? '';
  const msg = (error?.message ?? '').toLowerCase();
  if (msg.includes('network request failed') || msg.includes('failed to fetch')) {
    return 'No internet connection. Nothing was changed. Try again when you are online.';
  }
  if (code === 'identity_already_exists' || msg.includes('already linked') || msg.includes('already exists')) {
    return 'This Google account already belongs to another Bond account. Nothing was changed.';
  }
  if (code === 'manual_linking_disabled') {
    return 'Adding Google to this account is turned off for Bond right now. Nothing was changed.';
  }
  if (code === 'provider_disabled' || msg.includes('provider is not enabled') || msg.includes('unsupported provider')) {
    return "Google sign-in isn't turned on for Bond yet. Nothing was changed.";
  }
  if (msg.includes('nonce')) return 'Google sign-in could not be verified. Please try again.';
  return 'Google sign-in did not work. Nothing was changed. Please try again.';
}

/** Show Google's account picker and return a verified ID token + the raw nonce. */
async function pickGoogleAccount(): Promise<
  { ok: true; idToken: string; rawNonce: string; name: string | null } | { ok: false; cancelled?: true; message: string }
> {
  const native = loadNative();
  if (!native) return { ok: false, message: 'Google sign-in needs the latest version of Bond on this phone.' };
  const { GoogleOneTapSignIn, isCancelledResponse, isSuccessResponse, isErrorWithCode, statusCodes } = native.google;
  const { CryptoDigestAlgorithm, digestStringAsync, randomUUID } = native.crypto;

  try {
    await GoogleOneTapSignIn.checkPlayServices(true);
    const rawNonce = randomUUID() + randomUUID();
    const hashedNonce = await digestStringAsync(CryptoDigestAlgorithm.SHA256, rawNonce);
    GoogleOneTapSignIn.configure({ webClientId: WEB_CLIENT_ID, nonce: hashedNonce });

    // The full "Sign in with Google" account picker (all Google accounts on the phone).
    const response = await GoogleOneTapSignIn.presentExplicitSignIn();
    if (isCancelledResponse(response)) {
      log('picker cancelled');
      return { ok: false, cancelled: true, message: 'Cancelled.' };
    }
    if (!isSuccessResponse(response) || !response.data.idToken) {
      log('picker returned no ID token', String(response.type));
      return { ok: false, message: 'Google sign-in did not finish. Nothing was changed.' };
    }
    const u = response.data.user as { givenName?: string | null; name?: string | null } | undefined;
    return { ok: true, idToken: response.data.idToken, rawNonce, name: u?.givenName ?? u?.name ?? null };
  } catch (e) {
    log('picker failed', isErrorWithCode(e) ? `${e.code} ${e.message}` : (e as Error)?.message);
    if (isErrorWithCode(e)) {
      if (e.code === statusCodes.SIGN_IN_CANCELLED) return { ok: false, cancelled: true, message: 'Cancelled.' };
      if (e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
        return { ok: false, message: 'Google Play services is missing or out of date on this phone.' };
      }
      if (e.code === statusCodes.DEVELOPER_ERROR) {
        // Usually: this APK's signing SHA-1 isn't on the Android OAuth client, or the Web client ID is wrong.
        return { ok: false, message: "Google sign-in isn't set up correctly for this app yet. Nothing was changed." };
      }
    }
    return { ok: false, message: 'Google sign-in did not work. Nothing was changed. Please try again.' };
  }
}

/**
 * Continue with Google. Signs in only when this phone has no account;
 * otherwise links Google to the account already here.
 */
export async function continueWithGoogle(): Promise<GoogleResult> {
  if (getGoogleSupport() === 'not-configured') {
    return { ok: false, message: "Google sign-in isn't set up for this build yet." };
  }
  const picked = await pickGoogleAccount();
  if (!picked.ok) return picked;

  // Re-read right before acting: never replace an account that is on this phone.
  const { data: current } = await supabase.auth.getSession();
  const credentials = { provider: 'google' as const, token: picked.idToken, nonce: picked.rawNonce };

  if (current.session) {
    const expectedId = current.session.user.id;
    const { error } = await supabase.auth.linkIdentity(credentials);
    if (error) {
      log('supabase linkIdentity failed', `${error.code ?? ''} ${error.message}`);
      return { ok: false, message: friendly(error) };
    }
    const { data: after } = await supabase.auth.getUser();
    if (after.user?.id !== expectedId) {
      return { ok: false, message: 'The signed-in account changed unexpectedly. Please restart Bond.' };
    }
    return { ok: true, mode: 'linked', userId: expectedId };
  }

  const { data, error } = await supabase.auth.signInWithIdToken(credentials);
  if (error || !data.user) {
    log('supabase signInWithIdToken failed', error ? `${error.code ?? ''} ${error.message}` : 'no user');
    return { ok: false, message: friendly(error) };
  }
  log('signed in');
  await startNameStepIfNew(data.user.id, data.user.created_at);
  return { ok: true, mode: 'signed-in', userId: data.user.id };
}

/**
 * A brand-new Google account gets its name from the email address. Reset it
 * to "Me" (only for an account created moments ago and not in a couple) so
 * Bond's normal name step runs after pairing. Never touches existing accounts.
 */
async function startNameStepIfNew(userId: string, createdAt: string | undefined): Promise<void> {
  const ageMs = createdAt ? Date.now() - new Date(createdAt).getTime() : Infinity;
  if (!(ageMs >= 0 && ageMs < 5 * 60 * 1000)) return;
  const { data: member } = await supabase.from('couple_members').select('couple_id').eq('user_id', userId).maybeSingle();
  if (member) return;
  await supabase.from('profiles').update({ display_name: 'Me' }).eq('id', userId);
}
