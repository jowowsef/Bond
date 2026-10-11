import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from './supabase';

/**
 * DELETE MY ACCOUNT
 *
 * Order (each step only runs if the previous one succeeded):
 *   1. Preflight: account_deletion_ready() (read-only, migration 0005). It
 *      confirms the server can actually delete this account. If it is missing
 *      (0005 not applied), says no, or can't be reached: STOP. Nothing changed.
 *   2. List my photo files. If that fails: STOP. Nothing changed. (Deleting
 *      the account without knowing the files would leave photos behind.)
 *   3. Remove my photo files. This must happen while I'm still signed in:
 *      Storage only lets the owner delete them, and that permission is gone
 *      once the account is deleted. If it fails: STOP, account kept.
 *   4. delete_my_account(): the server deletes only the signed-in person. If
 *      it fails, the server rolls back and the account stays; only the photo
 *      (step 3) is gone, and the message says so.
 *   5. Only after the server confirms: forget the session on this phone.
 */
const BUCKET = 'avatars';

export type DeletionResult = { ok: true } | { ok: false; message: string };

function isNetworkError(message: string | undefined): boolean {
  const m = (message ?? '').toLowerCase();
  return m.includes('network') || m.includes('fetch') || m.includes('timed out');
}

function isMissingFunction(error: { code?: string; message?: string }): boolean {
  return error.code === 'PGRST202' || (error.message ?? '').toLowerCase().includes('could not find the function');
}

export async function deleteMyAccount(userId: string): Promise<DeletionResult> {
  // 1. Preflight (read-only).
  const pre = await supabase.rpc('account_deletion_ready');
  if (pre.error) {
    if (isMissingFunction(pre.error)) {
      return { ok: false, message: "Account deletion isn't available yet. Nothing was changed." };
    }
    if (isNetworkError(pre.error.message)) {
      return { ok: false, message: 'No internet connection. Nothing was changed. Try again when you are online.' };
    }
    return { ok: false, message: "Your account can't be deleted right now. Nothing was changed. Please try again later." };
  }
  if (pre.data !== true) {
    return { ok: false, message: "Your account can't be deleted right now. Nothing was changed. Please contact support." };
  }

  // 2. Which photo files exist (in my own folder only).
  const listed = await supabase.storage.from(BUCKET).list(userId, { limit: 100 });
  if (listed.error) {
    return { ok: false, message: "Couldn't reach Bond's servers. Nothing was changed. Please try again." };
  }
  const paths = (listed.data ?? []).filter((f) => !!f.name).map((f) => `${userId}/${f.name}`);

  // 3. Remove them while still signed in.
  let photosRemoved = false;
  if (paths.length > 0) {
    const removed = await supabase.storage.from(BUCKET).remove(paths);
    if (removed.error) {
      return {
        ok: false,
        message: 'Your account was not deleted. Some profile photo files may have been removed. Please try again.',
      };
    }
    photosRemoved = true;
  }

  // 4. The account itself.
  const { error } = await supabase.rpc('delete_my_account');
  if (error) {
    if (photosRemoved) {
      // Point the profile away from the removed file (best effort), so both
      // phones show initials instead of a broken photo.
      await supabase.from('profiles').update({ avatar_path: null }).eq('id', userId);
    }
    const photoNote = photosRemoved ? ' Your profile photo was removed; you can add it again in Settings.' : '';
    if (isNetworkError(error.message)) {
      return { ok: false, message: `No internet connection. Your account was not deleted.${photoNote}` };
    }
    return { ok: false, message: `Your account could not be deleted.${photoNote} Please try again.` };
  }

  // 5. The account no longer exists: forget Bond's local data for it.
  try {
    const keys = await AsyncStorage.getAllKeys();
    await AsyncStorage.multiRemove(keys.filter((k) => k.startsWith('bond')));
  } catch {
    // best effort
  }
  await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
  return { ok: true };
}
