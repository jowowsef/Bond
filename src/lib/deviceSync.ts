import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Battery from 'expo-battery';
import Constants from 'expo-constants';
import BondNative, { type ControlsConfig } from '@modules/bond-native';
import { addDays, dayKey, startOfDay } from './format';
import { isBackgroundLocationRunning, updateLocationNow } from './location';
import { maybeBatteryAlert, maybeProtectionAlert, notifyNewActivity } from './notifications';
import { getPermissionReport, safe } from './permissions';
import { supabase } from './supabase';
import type { ActiveControl } from './types';

/**
 * DEVICE SYNC — the "heartbeat" of this phone.
 *
 * Runs when the app opens, every few minutes while it's open, and about
 * every 15 minutes in the background. Each run:
 *   1. uploads battery level
 *   2. uploads today's + yesterday's real screen time (if Usage access is on)
 *   3. uploads the list of installed apps (twice a day)
 *   4. downloads the controls I APPROVED and applies them on this phone
 *   5. uploads which permissions/protections are actually working
 *   6. (app open only) updates "last active" and my location if I share it
 *   7. shows notifications for new partner events
 *
 * Every step is independent: if one fails (e.g. no internet), the others
 * still run, and the next run tries again.
 */

const INSTALLED_APPS_KEY = 'bond:installedAppsSyncedAt';
let running: Promise<void> | null = null;

export function runDeviceSync(options: { foreground: boolean }): Promise<void> {
  if (!running) {
    running = doSync(options.foreground).finally(() => {
      running = null;
    });
  }
  return running;
}

async function step(name: string, fn: () => Promise<unknown>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    console.warn(`[sync] ${name} failed:`, e instanceof Error ? e.message : e);
  }
}

async function doSync(foreground: boolean): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;

  if (foreground) await step('presence', () => touchPresence(userId));
  await step('battery', () => syncBattery(userId));
  await step('screen time', () => syncScreenTime(userId));
  await step('installed apps', () => syncInstalledApps(userId, foreground));
  await step('controls', () => applyMyControls(userId));
  await step('permissions', () => syncPermissions(userId));
  if (foreground) await step('location', () => syncForegroundLocation(userId));
  await step('notifications', () => notifyNewActivity(userId));
  await step('battery alert', () => maybeBatteryAlert(userId));
}

export async function touchPresence(userId: string): Promise<void> {
  await supabase.from('presence').upsert({ user_id: userId, last_seen: new Date().toISOString() });
}

async function syncBattery(userId: string): Promise<void> {
  const [level, state] = await Promise.all([Battery.getBatteryLevelAsync(), Battery.getBatteryStateAsync()]);
  if (level < 0) return; // unknown (e.g. emulator)
  await supabase.from('battery_status').upsert({
    user_id: userId,
    level: Math.round(level * 100),
    is_charging: state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL,
    updated_at: new Date().toISOString(),
  });
}

/** Upload real numbers from Android. If Usage access is off, we upload nothing (never fake numbers). */
export async function syncScreenTime(userId: string): Promise<void> {
  if (!safe(() => BondNative.hasUsageAccess(), false)) return;
  const today = startOfDay();
  const days = [addDays(today, -1), today];
  for (const start of days) {
    const end = addDays(start, 1);
    const usage = await BondNative.getUsage(start.getTime(), end.getTime());
    const day = dayKey(start);
    const now = new Date().toISOString();
    await supabase.from('screen_time_daily').upsert({
      user_id: userId,
      day,
      total_ms: Math.round(usage.totalMs),
      launches: usage.launches,
      updated_at: now,
    });
    if (usage.apps.length > 0) {
      await supabase.from('app_usage_daily').upsert(
        usage.apps.slice(0, 60).map((a) => ({
          user_id: userId,
          day,
          package_name: a.packageName,
          app_name: a.appName,
          foreground_ms: Math.round(a.foregroundMs),
          launches: a.launches,
          updated_at: now,
        })),
      );
    }
  }
}

async function syncInstalledApps(userId: string, force: boolean): Promise<void> {
  const last = Number((await AsyncStorage.getItem(INSTALLED_APPS_KEY)) ?? 0);
  if (!force && Date.now() - last < 12 * 60 * 60 * 1000) return;
  const apps = await BondNative.getInstalledApps();
  const protectedPkgs = new Set(safe(() => BondNative.getProtectedPackages(), [] as string[]));
  const rows = apps
    .filter((a) => !protectedPkgs.has(a.packageName))
    .map((a) => ({ user_id: userId, package_name: a.packageName, app_name: a.appName, updated_at: new Date().toISOString() }));
  if (rows.length > 0) {
    const { error } = await supabase.from('installed_apps').upsert(rows);
    if (error) throw error;
  }
  // remove apps that were uninstalled
  const { data: existing } = await supabase.from('installed_apps').select('package_name').eq('user_id', userId);
  const current = new Set(rows.map((r) => r.package_name));
  const removed = (existing ?? []).map((r) => r.package_name as string).filter((p) => !current.has(p));
  if (removed.length > 0) {
    await supabase.from('installed_apps').delete().eq('user_id', userId).in('package_name', removed);
  }
  await AsyncStorage.setItem(INSTALLED_APPS_KEY, String(Date.now()));
}

/**
 * Download the controls that are ACTIVE on my phone (i.e. that I approved,
 * or that I set on myself) and hand them to the native layer.
 * Revoked controls simply disappear from this list, so they get removed.
 */
export async function applyMyControls(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('active_controls')
    .select('*')
    .eq('owner_id', userId)
    .eq('status', 'active');
  if (error) throw error; // offline: keep the last applied rules on the phone

  const controls = (data ?? []) as ActiveControl[];
  const of = (t: ActiveControl['control_type']) => controls.filter((c) => c.control_type === t).map((c) => c.value);

  const { data: partnerId } = await supabase.rpc('my_partner_id');
  let partnerName = 'your partner';
  if (partnerId) {
    const { data: p } = await supabase.from('profiles').select('display_name').eq('id', partnerId).maybeSingle();
    if (p?.display_name) partnerName = p.display_name;
  }

  const appLabels: Record<string, string> = {};
  for (const c of controls) {
    if (c.control_type === 'app_block' || c.control_type === 'app_internet') appLabels[c.value] = c.label;
  }

  const config: ControlsConfig = {
    webCategories: of('web_category'),
    blockedDomains: of('web_domain'),
    allowedDomains: of('web_allow'),
    blockedApps: of('app_block'),
    internetBlockedApps: of('app_internet'),
    appLabels,
    partnerName,
  };
  const status = await BondNative.applyControls(config);
  await maybeProtectionAlert(status.vpnNeeded, status.vpnRunning, status.vpnPermission);
}

export async function syncPermissions(userId: string): Promise<void> {
  const r = await getPermissionReport();
  await supabase.from('device_permissions').upsert({
    user_id: userId,
    notifications: r.notifications,
    location_foreground: r.locationForeground,
    location_background: r.locationBackground,
    usage_access: r.usageAccess,
    vpn_permission: r.vpnPermission,
    website_protection_running: r.vpnRunning,
    accessibility_enabled: r.accessibilityEnabled,
    battery_optimization_ignored: r.batteryOptimizationIgnored,
    device_model: r.deviceModel,
    app_version: Constants.expoConfig?.version ?? null,
    updated_at: new Date().toISOString(),
  });
}

async function syncForegroundLocation(userId: string): Promise<void> {
  const { data } = await supabase.from('privacy_settings').select('share_location').eq('user_id', userId).maybeSingle();
  if (!data?.share_location) return;
  if (await isBackgroundLocationRunning()) return; // background task already handles it
  await updateLocationNow();
}
