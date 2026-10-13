import AsyncStorage from '@react-native-async-storage/async-storage';
import { dayKey, formatDuration } from './format';
import { notificationsAllowed, showLocalNotification } from './notifications';
import { supabase } from './supabase';

/**
 * DAILY SUMMARY (optional, off by default, on the VIEWER's phone)
 *
 * Once a day, in the evening, one notification about the partner's day, for
 * example "Alex used their phone for 3h 12m today. Most: TikTok (45m)". Never
 * one per app switch.
 *
 * Built only from what the partner already shares: their screen time
 * summary (screen_time_daily, app_usage_daily). If they don't share screen
 * time, the server returns nothing (row level security) and no summary is
 * shown. No new data is collected and nothing is sent to a server: the
 * notification is made on this phone, by Bond's periodic background job (and
 * when Bond is opened), so it can arrive a little after the chosen hour.
 *
 * The choice is kept on this phone, per account.
 */

export const SUMMARY_HOUR = 21; // about 9 PM, local time

type Saved = { on: boolean; lastSentDay?: string };

const keyFor = (userId: string) => `bond:daily-summary:${userId}`;

async function read(userId: string): Promise<Saved> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw ? (JSON.parse(raw) as Saved) : { on: false };
  } catch {
    return { on: false };
  }
}

async function write(userId: string, saved: Saved): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(saved));
  } catch {
    // best effort
  }
}

export async function readDailySummary(userId: string): Promise<boolean> {
  return (await read(userId)).on;
}

export async function setDailySummary(userId: string, on: boolean): Promise<void> {
  const saved = await read(userId);
  // Turning it on after today's hour doesn't send one for today right away.
  const today = dayKey();
  const lastSentDay = on && !saved.on && new Date().getHours() >= SUMMARY_HOUR ? today : saved.lastSentDay;
  await write(userId, { on, lastSentDay });
}

/** The text for a summary (exported for tests). */
export function summaryText(name: string, totalMs: number, top: { app_name: string; foreground_ms: number } | null): string {
  const total = `${name} used their phone for ${formatDuration(totalMs)} today.`;
  return top && top.foreground_ms > 0 ? `${total} Most: ${top.app_name} (${formatDuration(top.foreground_ms)}).` : total;
}

/**
 * Show today's summary if it is on, it is the evening, and it wasn't shown
 * today. Safe to call often. `now` is for tests.
 */
export async function maybeSendDailySummary(userId: string, now: Date = new Date()): Promise<'sent' | 'skipped'> {
  const saved = await read(userId);
  const today = dayKey(now);
  if (!saved.on || now.getHours() < SUMMARY_HOUR || saved.lastSentDay === today) return 'skipped';
  if (!(await notificationsAllowed())) return 'skipped';

  const me = await supabase.from('couple_members').select('couple_id').eq('user_id', userId).maybeSingle();
  if (me.error || !me.data) return 'skipped';
  const partner = await supabase
    .from('couple_members')
    .select('user_id')
    .eq('couple_id', (me.data as { couple_id: string }).couple_id)
    .neq('user_id', userId)
    .maybeSingle();
  const partnerId = (partner.data as { user_id: string } | null)?.user_id;
  if (partner.error || !partnerId) return 'skipped';

  const [profile, total, top] = await Promise.all([
    supabase.from('profiles').select('display_name').eq('id', partnerId).maybeSingle(),
    supabase.from('screen_time_daily').select('total_ms, day').eq('user_id', partnerId).eq('day', today).maybeSingle(),
    supabase
      .from('app_usage_daily')
      .select('app_name, foreground_ms')
      .eq('user_id', partnerId)
      .eq('day', today)
      .order('foreground_ms', { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  // Not shared (or nothing yet today): no summary. Try again at the next check.
  const totalMs = (total.data as { total_ms?: number } | null)?.total_ms ?? 0;
  if (total.error || totalMs <= 0) return 'skipped';
  const name = (profile.data as { display_name?: string } | null)?.display_name?.trim() || 'Your partner';

  await showLocalNotification(
    `${name}'s day`,
    summaryText(name, totalMs, (top.data as { app_name: string; foreground_ms: number } | null) ?? null),
    { type: 'daily_summary' },
  );
  await write(userId, { ...saved, lastSentDay: today });
  return 'sent';
}
