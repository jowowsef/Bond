import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase, uniqueTopic } from '@/lib/supabase';
import type { AppUsageDay, ScreenTimeDay } from '@/lib/types';
import { assertSignedIn, onReconnect } from '@/lib/connectivity';
import { readCached, writeCached } from '@/lib/offlineCache';
import { useCouple } from '@/state/couple';

/** A partner reading older than this gets an "out of date" note. */
export const PARTNER_STALE_MS = 60 * 60 * 1000;

export type PartnerUsage = {
  loading: boolean;
  /** Couldn't load (network / server); the last good data, if any, is kept. */
  error: boolean;
  /** The partner's share_screen_time (null = unknown). */
  sharing: boolean | null;
  /** That day's total, as last uploaded by the partner's phone (null = nothing sent). */
  total: ScreenTimeDay | null;
  /** That day's apps as uploaded (up to 30), most used first. */
  apps: AppUsageDay[];
  now: number;
  reload: () => Promise<void>;
};

/**
 * My partner's screen time for one day: the ONE loader used by Home, the
 * Screen Time tab and the Statistics screen. Data is what the partner's phone
 * uploaded (only while they share it; the database's row level security
 * returns nothing otherwise). Live via realtime; everything resets when the
 * partner changes or the couple ends (partnerId null), so an old partner's
 * numbers never show.
 */
export function usePartnerUsage(partnerId: string | null, day: string): PartnerUsage {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [sharing, setSharing] = useState<boolean | null>(null);
  const [total, setTotal] = useState<ScreenTimeDay | null>(null);
  const [apps, setApps] = useState<AppUsageDay[]>([]);
  const [now, setNow] = useState(Date.now());
  const current = useRef({ partnerId, day });
  current.current = { partnerId, day };
  const { userId: myId } = useCouple();
  const myRef = useRef(myId);
  useEffect(() => {
    myRef.current = myId;
  }, [myId]);

  const reload = useCallback(async () => {
    if (!partnerId) {
      setLoading(false);
      return;
    }
    // Offline / not signed in yet: keep what is shown (an empty answer would look like "not shared").
    try {
      await assertSignedIn();
    } catch (e) {
      setLoading(false);
      setError(true);
      throw e;
    }
    const [privacyRes, totalRes, appsRes] = await Promise.all([
      supabase.from('privacy_settings').select('share_screen_time').eq('user_id', partnerId).maybeSingle(),
      supabase.from('screen_time_daily').select('*').eq('user_id', partnerId).eq('day', day).maybeSingle(),
      supabase
        .from('app_usage_daily')
        .select('*')
        .eq('user_id', partnerId)
        .eq('day', day)
        .order('foreground_ms', { ascending: false })
        .limit(30),
    ]);
    // Ignore an answer for a partner or day that is no longer shown.
    if (current.current.partnerId !== partnerId || current.current.day !== day) return;
    const failed = !!(privacyRes.error || totalRes.error || appsRes.error);
    setError(failed);
    if (!failed) {
      const isSharing = privacyRes.data ? !!privacyRes.data.share_screen_time : null;
      setSharing(isSharing);
      // Only rows for the requested day (the query already asks for it; this
      // makes sure an earlier day's row can never be shown as today's).
      const totalRow = (totalRes.data as ScreenTimeDay | null) ?? null;
      const appRows = ((appsRes.data as AppUsageDay[]) ?? []).filter((r) => r.day === day);
      const nextTotal = isSharing === false || !totalRow || totalRow.day !== day ? null : totalRow;
      const nextApps = isSharing === false ? [] : appRows;
      setTotal(nextTotal);
      setApps(nextApps);
      void writeCached(myRef.current, `partner-usage:${partnerId}:${day}`, { sharing: isSharing, total: nextTotal, apps: nextApps });
    }
    setLoading(false);
    setNow(Date.now());
    if (failed) throw new Error('partner screen time failed to load');
  }, [partnerId, day]);

  useEffect(() => {
    setLoading(true);
    setError(false);
    setSharing(null);
    setTotal(null);
    setApps([]);
    if (!partnerId) {
      setLoading(false);
      return;
    }
    // Today's last saved summary at once (shown with its own time), until the server answers.
    let answered = false;
    void readCached<{ sharing: boolean | null; total: ScreenTimeDay | null; apps: AppUsageDay[] }>(
      myRef.current,
      `partner-usage:${partnerId}:${day}`,
    ).then((c) => {
      if (!c || answered || current.current.partnerId !== partnerId || current.current.day !== day) return;
      setSharing(c.value.sharing);
      setTotal(c.value.total);
      setApps(c.value.apps);
      setLoading(false);
    });
    const run = () =>
      void reload()
        .then(() => {
          answered = true;
        })
        .catch(() => {});
    run();
    const offReconnect = onReconnect(run);
    const channel = supabase
      .channel(uniqueTopic(`partner-usage-${partnerId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screen_time_daily', filter: `user_id=eq.${partnerId}` }, run)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'privacy_settings', filter: `user_id=eq.${partnerId}` }, run)
      .subscribe();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => {
      offReconnect();
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [partnerId, day, reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  return { loading, error, sharing, total, apps, now, reload };
}
