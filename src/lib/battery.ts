import * as Battery from 'expo-battery';
import { serviceModes, updateServiceModes } from './currentAppServiceControl';
import { errorMessage, supabase } from './supabase';

/**
 * BATTERY STATUS (real, via expo-battery)
 *
 * Reading the battery level and charging state needs NO special Android
 * permission. We only sync it to the partner when the user has turned battery
 * sharing on (privacy_settings.share_battery), and the row is readable by the
 * partner only while sharing is on (existing RLS).
 *
 * Android may suspend background work, so updates are frequent while Bond is
 * open and best-effort otherwise. We always show a "last updated" time and say
 * when data is stale instead of inventing a fresh-looking number.
 */

export type LocalBattery = { level: number; charging: boolean };

/** Treat CHARGING and FULL (plugged in) as "charging" for display. */
export function isChargingState(state: Battery.BatteryState): boolean {
  return state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
}

/** Read this phone's current battery (level 0..100). */
export async function getLocalBattery(): Promise<LocalBattery> {
  const power = await Battery.getPowerStateAsync();
  return {
    level: Math.round((power.batteryLevel ?? 0) * 100),
    charging: isChargingState(power.batteryState),
  };
}

/** Write my current battery so my partner can see it (call only when sharing). */
export async function syncBattery(userId: string): Promise<void> {
  const local = await getLocalBattery();
  if (local.level <= 0) return; // unknown/unavailable: don't write a fake value
  const { error } = await supabase.from('battery_status').upsert({
    user_id: userId,
    level: local.level,
    is_charging: local.charging,
    updated_at: new Date().toISOString(),
  });
  if (error) throw error;
}

export async function enableBatterySharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('privacy_settings').update({ share_battery: true }).eq('user_id', userId);
  if (error) return { ok: false, message: errorMessage(error) };
  try {
    await syncBattery(userId);
  } catch {
    // first sync can be retried later
  }
  return { ok: true };
}

export async function disableBatterySharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('privacy_settings').update({ share_battery: false }).eq('user_id', userId);
  if (error) return { ok: false, message: errorMessage(error) };
  // Stop the battery part of the background service at once (app checks for
  // Currently Using, if on, keep running).
  const m = serviceModes();
  if (m.running && m.battery) await updateServiceModes({ apps: m.apps, battery: false, screenTime: m.screenTime });
  // Remove the stored value so the partner doesn't keep seeing an old reading.
  await supabase.from('battery_status').delete().eq('user_id', userId);
  return { ok: true };
}

/**
 * Send my battery now, but only if battery sharing is on. Used by pull to
 * refresh and by the background job (which runs without any screen open).
 */
export async function syncBatteryIfSharing(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from('privacy_settings').select('share_battery').eq('user_id', userId).maybeSingle();
  if (error) throw error;
  if (!data?.share_battery) return false;
  await syncBattery(userId);
  return true;
}

/**
 * Upload a reading the background service already took (it reacts to
 * Android's battery broadcasts), only if battery sharing is on. The
 * "Updated" time the partner sees is set here, when the reading actually
 * reaches the server, never before.
 */
export async function uploadBatteryReading(
  userId: string,
  level: number,
  charging: boolean,
): Promise<'uploaded' | 'not-sharing' | 'failed'> {
  if (!(level > 0 && level <= 100)) return 'failed';
  const { data, error } = await supabase.from('privacy_settings').select('share_battery').eq('user_id', userId).maybeSingle();
  if (error) return 'failed';
  if (!data?.share_battery) return 'not-sharing';
  const up = await supabase.from('battery_status').upsert({
    user_id: userId,
    level: Math.round(level),
    is_charging: charging,
    updated_at: new Date().toISOString(),
  });
  return up.error ? 'failed' : 'uploaded';
}
