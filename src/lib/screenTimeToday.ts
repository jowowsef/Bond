/**
 * Today-only helpers for the Screen Time tab and Statistics (pure functions,
 * used for both people so the rules are the same).
 *
 * "Today" is this phone's local calendar day: from local midnight to now.
 * My own usage is read from Android for exactly that range; the partner's
 * rows are the ones their phone uploaded for that same date ('YYYY-MM-DD').
 */

export type UsageRow = { packageName: string; appName: string; ms: number; lastUsedMs: number | null };

/** All apps used today, most used first (ties: by name, so the order is stable). */
export function mostUsedToday(rows: UsageRow[]): UsageRow[] {
  return rows.filter((r) => r.ms > 0).sort((a, b) => b.ms - a.ms || a.appName.localeCompare(b.appName));
}

/** The main view's short list. */
export function topApps(rows: UsageRow[], n = 3): UsageRow[] {
  return mostUsedToday(rows).slice(0, n);
}

/**
 * Apps last used since local midnight, newest first. An app whose last use
 * is before midnight belongs to an earlier day and is left out.
 */
export function recentlyUsedToday(rows: UsageRow[], todayStartMs: number, nowMs = Date.now()): UsageRow[] {
  return rows
    .filter((r) => r.lastUsedMs !== null && r.lastUsedMs >= todayStartMs && r.lastUsedMs <= nowMs + 60_000)
    .sort((a, b) => (b.lastUsedMs ?? 0) - (a.lastUsedMs ?? 0));
}

/** Uploaded per-app rows (the partner's) for one date only, as UsageRows. */
export function partnerRowsForDay(
  apps: { day: string; package_name: string; app_name: string; foreground_ms: number; last_used_at?: string | null }[],
  day: string,
): UsageRow[] {
  return apps
    .filter((a) => a.day === day)
    .map((a) => ({
      packageName: a.package_name,
      appName: a.app_name,
      ms: a.foreground_ms,
      lastUsedMs: a.last_used_at ? new Date(a.last_used_at).getTime() : null,
    }));
}
