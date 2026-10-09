import { supabase } from './supabase';

/**
 * PROFILE PHOTOS
 *
 * Stored in the existing PRIVATE "avatars" storage bucket at
 * "<user_id>/avatar-<timestamp>.jpg". The profiles.avatar_path column holds
 * the path; the image itself is never public. Reads go through short-lived
 * signed URLs, and the bucket's RLS only lets a user read their own and their
 * partner's folder — so photos stay private to the paired couple.
 */

const BUCKET = 'avatars';

// Minimal base64 → bytes decoder (no extra dependency). The image picker
// gives us base64; Supabase storage uploads a Uint8Array.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
function base64ToBytes(base64: string): Uint8Array {
  const clean = base64.replace(/[^A-Za-z0-9+/]/g, '');
  const lookup = new Uint8Array(256);
  for (let i = 0; i < B64.length; i++) lookup[B64.charCodeAt(i)] = i;
  const len = clean.length;
  const pad = clean.endsWith('==') ? 2 : clean.endsWith('=') ? 1 : 0;
  const byteLength = Math.floor((len * 3) / 4) - pad;
  const bytes = new Uint8Array(byteLength);
  let p = 0;
  for (let i = 0; i < len; i += 4) {
    const a = lookup[clean.charCodeAt(i)];
    const b = lookup[clean.charCodeAt(i + 1)];
    const c = lookup[clean.charCodeAt(i + 2)];
    const d = lookup[clean.charCodeAt(i + 3)];
    const chunk = (a << 18) | (b << 12) | (c << 6) | d;
    if (p < byteLength) bytes[p++] = (chunk >> 16) & 0xff;
    if (p < byteLength) bytes[p++] = (chunk >> 8) & 0xff;
    if (p < byteLength) bytes[p++] = chunk & 0xff;
  }
  return bytes;
}

export type PhotoResult = { ok: true; path: string } | { ok: false; message: string };

/** Upload a new avatar photo and point the profile at it. Returns the new path. */
export async function uploadAvatarPhoto(userId: string, base64: string): Promise<PhotoResult> {
  try {
    const bytes = base64ToBytes(base64);
    const path = `${userId}/avatar-${Date.now()}.jpg`;
    const { error: upErr } = await supabase.storage
      .from(BUCKET)
      .upload(path, bytes, { contentType: 'image/jpeg', upsert: true });
    if (upErr) return { ok: false, message: upErr.message };

    // Remember the previous file so we can clean it up after switching.
    const { data: prev } = await supabase.from('profiles').select('avatar_path').eq('id', userId).maybeSingle();
    const oldPath = (prev?.avatar_path as string | null) ?? null;

    const { error: updErr } = await supabase.from('profiles').update({ avatar_path: path }).eq('id', userId);
    if (updErr) return { ok: false, message: updErr.message };

    if (oldPath && oldPath !== path) {
      await supabase.storage.from(BUCKET).remove([oldPath]).catch(() => undefined);
    }
    return { ok: true, path };
  } catch (e) {
    return { ok: false, message: (e as Error).message ?? 'Could not upload the photo.' };
  }
}

/** Remove the photo (keeps the chosen avatar colour). */
export async function removeAvatarPhoto(userId: string, currentPath: string | null): Promise<PhotoResult> {
  try {
    const { error } = await supabase.from('profiles').update({ avatar_path: null }).eq('id', userId);
    if (error) return { ok: false, message: error.message };
    if (currentPath) await supabase.storage.from(BUCKET).remove([currentPath]).catch(() => undefined);
    return { ok: true, path: '' };
  } catch (e) {
    return { ok: false, message: (e as Error).message ?? 'Could not remove the photo.' };
  }
}

/** Signed URLs for a set of avatar paths (private bucket). Keyed by path. */
export async function signedAvatarUrls(paths: string[]): Promise<Record<string, string>> {
  const unique = Array.from(new Set(paths.filter(Boolean)));
  if (unique.length === 0) return {};
  const { data } = await supabase.storage.from(BUCKET).createSignedUrls(unique, 60 * 60 * 24);
  const out: Record<string, string> = {};
  for (const item of data ?? []) {
    if (item.path && item.signedUrl) out[item.path] = item.signedUrl;
  }
  return out;
}
