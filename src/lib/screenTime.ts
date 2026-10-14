import AsyncStorage from '@react-native-async-storage/async-storage';
import { Platform } from 'react-native';
import BondUsage, { type UsageResult } from '../../modules/bond-usage';
import { addDays, dayKey, startOfDay } from './format';
import { isMissingSchema } from './schemaErrors';
import { supabase } from './supabase';

/**
 * SCREEN TIME (real, read-only, via the bond-usage native module)
 *
 * Android only lets an app read usage statistics after the phone's owner turns
 * on "Usage access" for it by hand in Android Settings. There is no pop-up and
 * no way for an app to grant it to itself. So:
 * - we check the REAL state every time (it can be turned off at any moment),
 * - we open the right Settings screen when asked,
 * - we never upload or show numbers without that access.
 *
 * Uploading to your partner also needs share_screen_time to be ON in Privacy.
 * Battery and Screen Time are separate on purpose: different data, different
 * permission, different privacy switch, different background job.
 */

/** 'unsupported': not Android. 'needs-update': the installed build has no native module yet. */
export type UsageSupport = 'ready' | 'needs-update' | 'unsupported';

export function getUsageSupport(): UsageSupport {
  if (Platform.OS !== 'android') return 'unsupported';
  return BondUsage ? 'ready' : 'needs-update';
}

/** Real current state of Android's Usage access for Bond (false if unsupported). */
export function hasUsageAccess(): boolean {
  if (!BondUsage) return false;
  try {
    return BondUsage.hasUsageAccess();
  } catch {
    return false;
  }
}

export function openUsageAccessSettings(): void {
  BondUsage?.openUsageAccessSettings();
}

/** This phone's usage for one local calendar day (today by default, up to now). */
export async function readDayUsage(day: Date = new Date()): Promise<UsageResult> {
  if (!BondUsage) throw new Error('Screen Time needs the latest version of Bond on this phone.');
  const start = startOfDay(day);
  const end = addDays(start, 1);
  return BondUsage.getUsage(start.getTime(), end.getTime());
}

// ---------------- Upload to Supabase ----------------

const LAST_SYNC_KEY = 'bond.screenTime.lastSync';
/** Only the biggest apps are shared; enough for the list, small for the database. */
const MAX_APPS = 30;

export type ScreenTimeSyncResult =
  | { status: 'synced'; at: string }
  | { status: 'not-sharing' }
  | { status: 'no-access' }
  | { status: 'needs-update' }
  | { status: 'error'; message: string };

/** userId: the account it was for (older records don't have it). */
type LastSync = { at: string; day: string; userId?: string };

/** After being offline, days not fully sent yet are sent too, at most this many back (the 7-day chart). */
const MAX_CATCH_UP_DAYS = 7;

/** When this phone last uploaded screen time successfully (null if never). */
export async function getLastScreenTimeSync(): Promise<LastSync | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_SYNC_KEY);
    return raw ? (JSON.parse(raw) as LastSync) : null;
  } catch {
    return null;
  }
}

/** False once the server said app_usage_daily.last_used_at doesn't exist (0009 not applied). */
let lastUsedColumn = true;

async function uploadDay(userId: string, day: Date, usage: UsageResult, nowIso: string): Promise<void> {
  const key = dayKey(day);
  const total = await supabase.from('screen_time_daily').upsert({
    user_id: userId,
    day: key,
    total_ms: Math.round(usage.totalMs),
    launches: usage.launches,
    updated_at: nowIso,
  });
  if (total.error) throw total.error;

  const top = usage.apps.slice(0, MAX_APPS);
  if (top.length > 0) {
    const rows = top.map((a) => ({
      user_id: userId,
      day: key,
      package_name: a.packageName,
      app_name: a.appName,
      foreground_ms: Math.round(a.foregroundMs),
      launches: a.launches,
      updated_at: nowIso,
    }));
    // With migration 0009 the partner's "Recently used" list gets the real
    // last-used time of each app; without it, the same rows are sent without it.
    let apps = lastUsedColumn
      ? await supabase.from('app_usage_daily').upsert(
          rows.map((r, i) => ({
            ...r,
            last_used_at: top[i].lastUsedMs ? new Date(top[i].lastUsedMs as number).toISOString() : null,
          })),
        )
      : await supabase.from('app_usage_daily').upsert(rows);
    if (apps.error && lastUsedColumn && isMissingSchema(apps.error)) {
      lastUsedColumn = false;
      apps = await supabase.from('app_usage_daily').upsert(rows);
    }
    if (apps.error) throw apps.error;
  }

  // Drop rows for apps that fell out of the top list, so the partner never
  // sees an old number that no longer matches today's real ranking.
  let cleanup = supabase.from('app_usage_daily').delete().eq('user_id', userId).eq('day', key);
  if (top.length > 0) {
    const list = top.map((a) => `"${a.packageName.replace(/"/g, '')}"`).join(',');
    cleanup = cleanup.not('package_name', 'in', `(${list})`);
  }
  await cleanup;
}

let inflight: Promise<ScreenTimeSyncResult> | null = null;

/**
 * Read this phone's usage and upload it for the partner, only when allowed.
 * Safe to call often: concurrent calls share one run.
 */
export function syncScreenTime(userId: string): Promise<ScreenTimeSyncResult> {
  if (!inflight) {
    inflight = runSync(userId).finally(() => {
      inflight = null;
    });
  }
  return inflight;
}

async function runSync(userId: string): Promise<ScreenTimeSyncResult> {
  if (getUsageSupport() !== 'ready') return { status: 'needs-update' };
  if (!hasUsageAccess()) return { status: 'no-access' };
  try {
    // Offline / not signed in yet: an empty answer would look like "not
    // sharing". Fail instead, so it is sent again later (nothing is lost:
    // the totals are read from Android's own usage log each time).
    const { data: auth } = await supabase.auth.getSession();
    if (!auth.session) throw new Error('offline: not signed in right now');
    const { data: privacy, error } = await supabase
      .from('privacy_settings')
      .select('share_screen_time')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!privacy?.share_screen_time) {
      // Sharing is off: days from now on are never sent later as catch-up.
      await AsyncStorage.removeItem(LAST_SYNC_KEY).catch(() => undefined);
      return { status: 'not-sharing' };
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const last = await getLastScreenTimeSync();

    // First sync of a new day (also after being offline for days): finish
    // the day of the last upload (it may have been hours before midnight)
    // and send every day since then, up to a week back, from Android's own
    // usage log. Only for the same account, and only if sharing stayed on
    // (turning it off forgets the last upload, see above).
    const today = startOfDay(now);
    if (last && (!last.userId || last.userId === userId)) {
      const [y, m, d] = last.day.split('-').map(Number);
      const lastDay = new Date(y, m - 1, d);
      const oldest = addDays(today, -MAX_CATCH_UP_DAYS);
      for (let day = lastDay < oldest ? oldest : lastDay; day < today; day = addDays(day, 1)) {
        await uploadDay(userId, day, await readDayUsage(day), nowIso);
      }
    }

    await uploadDay(userId, now, await readDayUsage(now), nowIso);

    // Keep only about 30 days of shared summaries (see the Privacy Policy).
    const cutoff = dayKey(addDays(startOfDay(now), -30));
    await supabase.from('app_usage_daily').delete().eq('user_id', userId).lt('day', cutoff);
    await supabase.from('screen_time_daily').delete().eq('user_id', userId).lt('day', cutoff);
    try {
      await AsyncStorage.setItem(LAST_SYNC_KEY, JSON.stringify({ at: nowIso, day: dayKey(now), userId } satisfies LastSync));
    } catch {
      // only used for display
    }
    return { status: 'synced', at: nowIso };
  } catch (e) {
    const message = (e as { message?: string })?.message ?? 'Could not update screen time.';
    return { status: 'error', message };
  }
}
