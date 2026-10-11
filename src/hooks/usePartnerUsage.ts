import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { supabase, uniqueTopic } from '@/lib/supabase';
import type { AppUsageDay, ScreenTimeDay } from '@/lib/types';

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

  const reload = useCallback(async () => {
    if (!partnerId) {
      setLoading(false);
      return;
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
      setTotal(isSharing === false || !totalRow || totalRow.day !== day ? null : totalRow);
      setApps(isSharing === false ? [] : appRows);
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
    const run = () => void reload().catch(() => {});
    run();
    const channel = supabase
      .channel(uniqueTopic(`partner-usage-${partnerId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'screen_time_daily', filter: `user_id=eq.${partnerId}` }, run)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'privacy_settings', filter: `user_id=eq.${partnerId}` }, run)
      .subscribe();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [partnerId, reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  return { loading, error, sharing, total, apps, now, reload };
}
