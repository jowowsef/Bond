import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { supabase } from './supabase';
import type { ActivityLog } from './types';

/**
 * NOTIFICATIONS (free, no push server needed)
 *
 * Every important event (new request, accepted, declined, protection on/off,
 * location sharing changed, partner joined/left) is written to the
 * activity_logs table by the database. The app checks for NEW events by your
 * partner — instantly via Realtime while the app is open, and every ~15
 * minutes in the background — and shows a phone notification for each one.
 *
 * Limitation: when the app is fully closed, notifications can be delayed by
 * up to ~15 minutes (Android decides exactly when background work runs).
 * Instant push while closed would need Firebase Cloud Messaging (also free,
 * but extra setup) — see docs/SETUP.md.
 */

const LAST_LOG_KEY = 'bond:lastNotifiedLogAt';
const BATTERY_ALERT_KEY = 'bond:batteryAlertFor';
const PROTECTION_ALERT_KEY = 'bond:protectionAlert';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: false,
    shouldSetBadge: false,
  }),
});

export async function setupNotificationChannel(): Promise<void> {
  await Notifications.setNotificationChannelAsync('default', {
    name: 'Bond updates',
    importance: Notifications.AndroidImportance.HIGH,
    lightColor: '#8C7CF0',
  });
}

export async function requestNotificationPermission(): Promise<boolean> {
  await setupNotificationChannel();
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return true;
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted;
}

const TITLES: Record<string, string> = {
  request_created: 'New request 💌',
  request_approved: 'Request accepted ✅',
  request_declined: 'Request declined',
  request_cancelled: 'Request withdrawn',
  control_enabled: 'Protection enabled 🛡️',
  control_revoked: 'Protection turned off',
  location_on: 'Location sharing on 📍',
  location_off: 'Location sharing off',
  partner_joined: 'You are connected ❤️',
  partner_left: 'Partner disconnected',
};

export async function notify(title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
  try {
    await Notifications.scheduleNotificationAsync({ content: { title, body, data }, trigger: null });
  } catch {
    // notifications not permitted — nothing to do
  }
}

/**
 * Show notifications for partner events we haven't notified about yet.
 * The first time it runs it just remembers "now" (no flood of old events).
 */
export async function notifyNewActivity(myUserId: string): Promise<void> {
  const last = await AsyncStorage.getItem(LAST_LOG_KEY);
  if (!last) {
    await AsyncStorage.setItem(LAST_LOG_KEY, new Date().toISOString());
    return;
  }
  const { data, error } = await supabase
    .from('activity_logs')
    .select('*')
    .gt('created_at', last)
    .order('created_at', { ascending: true })
    .limit(20);
  if (error || !data || data.length === 0) return;
  const logs = data as ActivityLog[];
  for (const log of logs) {
    if (log.actor_id === myUserId) continue; // don't notify about my own actions
    await notify(TITLES[log.kind] ?? 'Bond', log.message, { kind: log.kind, logId: log.id });
  }
  await AsyncStorage.setItem(LAST_LOG_KEY, logs[logs.length - 1].created_at);
}

/** Mark everything up to now as seen (used when the Activity screen is opened). */
export async function markActivitySeen(isoTime: string): Promise<void> {
  const last = await AsyncStorage.getItem(LAST_LOG_KEY);
  if (!last || last < isoTime) await AsyncStorage.setItem(LAST_LOG_KEY, isoTime);
}

/** Optional low-battery alert about the partner (only if I turned it on). */
export async function maybeBatteryAlert(myUserId: string): Promise<void> {
  const { data: privacy } = await supabase
    .from('privacy_settings')
    .select('battery_alerts')
    .eq('user_id', myUserId)
    .maybeSingle();
  if (!privacy?.battery_alerts) return;
  const { data: partnerId } = await supabase.rpc('my_partner_id');
  if (!partnerId) return;
  const { data: battery } = await supabase.from('battery_status').select('*').eq('user_id', partnerId).maybeSingle();
  const { data: profile } = await supabase.from('profiles').select('display_name').eq('id', partnerId).maybeSingle();
  if (!battery || battery.level == null) return;
  const sentFor = await AsyncStorage.getItem(BATTERY_ALERT_KEY);
  if (battery.level > 20 || battery.is_charging) {
    if (sentFor) await AsyncStorage.removeItem(BATTERY_ALERT_KEY);
    return;
  }
  const ageMin = (Date.now() - new Date(battery.updated_at).getTime()) / 60_000;
  if (battery.level <= 15 && ageMin < 60 && !sentFor) {
    await notify('Low battery 🔋', `${profile?.display_name ?? 'Your partner'}'s battery is at ${battery.level}%.`);
    await AsyncStorage.setItem(BATTERY_ALERT_KEY, battery.updated_at);
  }
}

/**
 * If I approved website controls but the protection is not running
 * (e.g. VPN switched off in Settings), remind me once.
 */
export async function maybeProtectionAlert(needsVpn: boolean, running: boolean, hasPermission: boolean): Promise<void> {
  const problem = needsVpn && !running;
  const flag = await AsyncStorage.getItem(PROTECTION_ALERT_KEY);
  if (!problem) {
    if (flag) await AsyncStorage.removeItem(PROTECTION_ALERT_KEY);
    return;
  }
  if (flag) return;
  await notify(
    'Website protection is paused',
    hasPermission
      ? 'Open Bond to turn website protection back on.'
      : 'Bond needs the VPN permission to apply the website protection you accepted. Open Bond → Device setup.',
  );
  await AsyncStorage.setItem(PROTECTION_ALERT_KEY, '1');
}
