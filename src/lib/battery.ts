import * as Battery from 'expo-battery';
import { supabase } from './supabase';

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
  await supabase.from('battery_status').upsert({
    user_id: userId,
    level: local.level,
    is_charging: local.charging,
    updated_at: new Date().toISOString(),
  });
}

export async function enableBatterySharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('privacy_settings').update({ share_battery: true }).eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  try {
    await syncBattery(userId);
  } catch {
    // first sync can be retried later
  }
  return { ok: true };
}

export async function disableBatterySharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('privacy_settings').update({ share_battery: false }).eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  // Remove the stored value so the partner doesn't keep seeing an old reading.
  await supabase.from('battery_status').delete().eq('user_id', userId);
  return { ok: true };
}
