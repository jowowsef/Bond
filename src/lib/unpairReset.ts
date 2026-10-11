import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { resetActivityUnread } from './activityUnread';
import { removeLegacyBackgroundConsent, stopBackgroundLocation } from './backgroundLocation';
import { resetCurrentAppUploads } from './currentApp';
import { stopCurrentAppService } from './currentAppServiceControl';
import { resetLocationPipeline } from './location';
import { noteNotPaired } from './pairingSetup';
import { isMissingSchema } from './schemaErrors';
import { supabase } from './supabase';

/**
 * FRESH START AFTER AN UNPAIR (each phone does this for its OWN account)
 *
 * Runs only after the server confirmed this account is no longer in a couple
 * (a successful read that returns no couple, never a failed request). It is
 * remembered on the phone first, so if Bond is closed or offline halfway, it
 * continues on the next start, and the "You're no longer paired" screen shows
 * exactly once, until the person taps Continue.
 *
 * What is reset (only this account's own data, never the partner's):
 *  - sharing: all five switches off, the stored location, battery and current
 *    app rows deleted (0007/0008 already do this on the server; repeated here
 *    so it also holds where those migrations aren't applied yet), and the
 *    screen-time summaries this phone uploaded for the old partner (they only
 *    exist for sharing; this phone's own statistics are read from Android, so
 *    nothing is lost, and a future partner can't see days from before),
 *  - partner preferences: calendar reminders back to their default (on),
 *  - profile customization: display name back to the default "Me", avatar
 *    color cleared, profile photo removed (row and file), so the next pairing
 *    asks for them again,
 *  - this phone: background location stopped, cached couple snapshot,
 *    activity marker, last place name and screen-time sync marker removed,
 *    pairing setup marked "not paired" (the next pairing starts at Sharing
 *    setup with fresh consent), and notifications about the old partner
 *    (low battery, calendar reminders) removed from the notification shade.
 *
 * Kept: the account itself, its sign-in (email / Google / password), its id,
 * Android permissions and phone settings (never changed by Bond), the app theme, and everything not tied to the old pairing. Nothing here
 * deletes an account or creates a new one.
 *
 * The partner's own data on the server is not touched here; once the couple
 * is gone, the database no longer lets either person read the other's data.
 * The partner's screens and caches are cleared on the partner's phone.
 */

type UnpairRecord = { coupleId: string; resetDone: boolean; at: string };

const keyFor = (userId: string) => `bond:unpaired:${userId}`;

/** Local keys that hold data about the previous couple (see the list above). */
const LOCAL_KEYS = (userId: string) => [
  `bond:couple-snapshot:${userId}`,
  'bond.activity.seenAt',
  'bond:lastGeocode',
  'bond.screenTime.lastSync',
];

export async function readUnpairRecord(userId: string): Promise<UnpairRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw ? (JSON.parse(raw) as UnpairRecord) : null;
  } catch {
    return null;
  }
}

/** The server just confirmed the couple ended: remember it (once per couple). */
export async function noteUnpaired(userId: string, coupleId: string): Promise<void> {
  const existing = await readUnpairRecord(userId);
  if (existing && existing.coupleId === coupleId) return;
  await AsyncStorage.setItem(keyFor(userId), JSON.stringify({ coupleId, resetDone: false, at: new Date().toISOString() }));
}

/** The person tapped Continue (or a new couple exists): forget the notice. */
export async function clearUnpairRecord(userId: string): Promise<void> {
  try {
    await AsyncStorage.removeItem(keyFor(userId));
  } catch {
    // best effort
  }
}

/** Remove shown notifications about the old partner (low battery, calendar reminders). */
async function dismissOldPartnerNotifications(): Promise<void> {
  try {
    const shown = await Notifications.getPresentedNotificationsAsync();
    for (const n of shown) {
      const kind = (n.request.content.data as { kind?: unknown } | undefined)?.kind;
      if (kind === 'battery_low' || kind === 'calendar_reminder') {
        await Notifications.dismissNotificationAsync(n.request.identifier).catch(() => undefined);
      }
    }
    // Bond schedules no future notifications today; cancel any, just in case.
    await Notifications.cancelAllScheduledNotificationsAsync();
  } catch {
    // best effort
  }
}

export type ResetResult = { ok: true } | { ok: false; message: string };

const OFFLINE_MESSAGE =
  "Some of your previous pairing information couldn't be cleared yet. Check your internet connection and try again.";

/**
 * Do the reset for this account. Safe to repeat: every step can run again.
 * Fails (and is retried later) only if a required server step fails.
 */
export async function runUnpairReset(userId: string): Promise<ResetResult> {
  // 1. Nothing keeps sending from this phone.
  await stopBackgroundLocation();
  await stopCurrentAppService();
  resetCurrentAppUploads(); // nothing waiting or running is written for the old couple
  resetLocationPipeline();

  try {
    // 2. Sharing off on the server (own row only).
    const privacy = await supabase
      .from('privacy_settings')
      .update({ share_location: false, share_battery: false, share_screen_time: false, share_activity: false })
      .eq('user_id', userId);
    if (privacy.error) return { ok: false, message: OFFLINE_MESSAGE };
    const extra = await supabase.from('privacy_settings').update({ share_current_app: false }).eq('user_id', userId);
    if (extra.error && !isMissingSchema(extra.error)) return { ok: false, message: OFFLINE_MESSAGE };
    // Calendar reminders: back to the default (the column needs 0012).
    const reminders = await supabase.from('privacy_settings').update({ calendar_reminders: true }).eq('user_id', userId);
    if (reminders.error && !isMissingSchema(reminders.error)) return { ok: false, message: OFFLINE_MESSAGE };
    const deletes = await Promise.all([
      supabase.from('locations').delete().eq('user_id', userId),
      supabase.from('battery_status').delete().eq('user_id', userId),
      supabase.from('current_app').delete().eq('user_id', userId),
      supabase.from('screen_time_daily').delete().eq('user_id', userId),
      supabase.from('app_usage_daily').delete().eq('user_id', userId),
    ]);
    // current_app (index 2) may not exist yet (0008); everything else must succeed.
    if (deletes.some((d, i) => i !== 2 && d.error)) return { ok: false, message: OFFLINE_MESSAGE };

    // 3. Profile back to its defaults (own row only; the account stays).
    const profile = await supabase
      .from('profiles')
      .update({ display_name: 'Me', avatar_color: null, avatar_path: null })
      .eq('id', userId);
    if (profile.error) return { ok: false, message: OFFLINE_MESSAGE };
    // The photo files themselves (best effort: the profile no longer points to them).
    const files = await supabase.storage.from('avatars').list(userId).catch(() => null);
    const paths = (files?.data ?? []).map((f) => `${userId}/${f.name}`);
    if (paths.length) await supabase.storage.from('avatars').remove(paths).catch(() => undefined);
    // The name step is asked again (this flag only skips it for an email name).
    // Also: the next pairing must ask for sharing consent again (consent is not
    // carried over to a new partner), and is no longer a "first pairing".
    await supabase.auth
      .updateUser({
        data: {
          bond_name_confirmed: false,
          bond_current_app_consent_at: null,
          bond_current_app: null,
          bond_current_app_default_at: null,
          bond_previously_paired: true,
        },
      })
      .catch(() => undefined);
  } catch {
    return { ok: false, message: OFFLINE_MESSAGE };
  }

  // 4. This phone's leftovers from the old couple.
  try {
    await AsyncStorage.multiRemove(LOCAL_KEYS(userId));
  } catch {
    // best effort
  }
  await removeLegacyBackgroundConsent();
  await dismissOldPartnerNotifications();
  resetActivityUnread();
  await noteNotPaired(userId); // next pairing: Sharing setup -> Name -> Color -> Home

  const record = await readUnpairRecord(userId);
  if (record) await AsyncStorage.setItem(keyFor(userId), JSON.stringify({ ...record, resetDone: true })).catch(() => undefined);
  return { ok: true };
}
