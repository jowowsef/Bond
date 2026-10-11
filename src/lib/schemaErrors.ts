/**
 * True when a Supabase error means a column or table doesn't exist yet,
 * i.e. an optional database migration (0008 "Currently Using", 0009
 * "Recently used" times)
 * hasn't been applied. Callers then treat the feature as unavailable instead
 * of failing.
 */
export function isMissingSchema(error: { code?: string; message?: string } | null | undefined): boolean {
  if (!error) return false;
  return (
    error.code === '42703' || // undefined column
    error.code === '42P01' || // undefined table
    error.code === 'PGRST204' || // column not in schema cache
    error.code === 'PGRST205' || // table not in schema cache
    /share_current_app|current_app|last_used_at/.test(error.message ?? '')
  );
}
