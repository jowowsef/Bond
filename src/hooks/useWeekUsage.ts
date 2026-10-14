import { useCallback, useEffect, useState } from 'react';
import { addDays, dayKey, startOfDay } from '@/lib/format';
import { getUsageSupport, hasUsageAccess, readDayUsage } from '@/lib/screenTime';
import { supabase } from '@/lib/supabase';

/**
 * The last 7 days of screen time (oldest first, today last), for the week
 * chart: mine read from this phone (Android usage, needs Usage access), my
 * partner's from the daily totals their phone uploaded (only while they share
 * screen time; days with nothing uploaded count as 0).
 * `mine` / `partner` are null when that side can't be shown.
 */
export type WeekUsage = {
  days: string[];
  mine: number[] | null;
  partner: number[] | null;
  loading: boolean;
  reload: () => Promise<void>;
};

export function useWeekUsage(partnerId: string | null): WeekUsage {
  const [state, setState] = useState<Omit<WeekUsage, 'reload'>>({ days: lastSevenDays(), mine: null, partner: null, loading: true });

  const reload = useCallback(async () => {
    const days = lastSevenDays();
    const today = startOfDay();

    let mine: number[] | null = null;
    if (getUsageSupport() === 'ready' && hasUsageAccess()) {
      const totals = await Promise.all(
        days.map((_, i) =>
          readDayUsage(addDays(today, i - 6))
            .then((u) => u.totalMs)
            .catch(() => 0),
        ),
      );
      mine = totals;
    }

    let partner: number[] | null = null;
    if (partnerId) {
      const [privacy, rows] = await Promise.all([
        supabase.from('privacy_settings').select('share_screen_time').eq('user_id', partnerId).maybeSingle(),
        supabase.from('screen_time_daily').select('day, total_ms').eq('user_id', partnerId).gte('day', days[0]).lte('day', days[6]),
      ]);
      const sharing = !!(privacy.data as { share_screen_time?: boolean } | null)?.share_screen_time;
      if (!privacy.error && !rows.error && sharing) {
        const byDay = new Map(((rows.data as { day: string; total_ms: number }[]) ?? []).map((r) => [r.day, r.total_ms]));
        partner = days.map((d) => byDay.get(d) ?? 0);
      }
    }
    setState({ days, mine, partner, loading: false });
  }, [partnerId]);

  useEffect(() => {
    // Next tick: the first read starts after this render.
    const t = setTimeout(() => void reload(), 0);
    return () => clearTimeout(t);
  }, [reload]);

  return { ...state, reload };
}

function lastSevenDays(): string[] {
  const today = startOfDay();
  return Array.from({ length: 7 }, (_, i) => dayKey(addDays(today, i - 6)));
}

/** Average per day over the days that have any screen time (0 if none). */
export function dailyAverage(totals: number[] | null): number | null {
  if (!totals) return null;
  const used = totals.filter((t) => t > 0);
  return used.length ? used.reduce((a, b) => a + b, 0) / used.length : 0;
}
