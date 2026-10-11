-- =====================================================================
-- 0013: Remove "Activity visibility" (last active) + daily data cleanup
--
-- 1. Activity visibility is removed from the app (nothing showed it any
--    more). Here: everyone's share_activity is turned off and every stored
--    "last active" time (public.presence) is deleted. The app no longer
--    writes it. The column and table are left in place (no schema change),
--    so older app versions don't break; they just stay empty.
-- 2. Daily cleanup, so the privacy policy's retention promises hold even
--    when a phone stops syncing:
--      - shared screen-time summaries (screen_time_daily, app_usage_daily)
--        older than 30 days;
--      - partner alerts (low battery, unpaired, calendar reminders) older
--        than 30 days.
--    Runs every day at 03:15 UTC as pg_cron job "bond-daily-cleanup" (pg_cron
--    was enabled for 0012). Without pg_cron a notice is shown; run this file
--    again after enabling it.
--
-- Safe to run more than once. No tables or columns are dropped.
--
-- HOW TO TELL WHETHER IT IS ALREADY APPLIED:
--   select jobname from cron.job where jobname = 'bond-daily-cleanup';
-- =====================================================================

-- 1. Activity off for everyone, stored "last active" times deleted.
update public.privacy_settings set share_activity = false where share_activity;
delete from public.presence;
alter table public.privacy_settings alter column share_activity set default false;

-- 2. Cleanup function (server only).
create or replace function public.bond_daily_cleanup()
returns void language plpgsql security definer set search_path = public as $fn$
begin
  delete from public.screen_time_daily where day < (now() at time zone 'utc')::date - 30;
  delete from public.app_usage_daily where day < (now() at time zone 'utc')::date - 30;
  if to_regclass('public.partner_alerts') is not null then
    delete from public.partner_alerts where created_at < now() - interval '30 days';
  end if;
  -- Nothing should write "last active" any more; keep it empty.
  delete from public.presence;
end;
$fn$;
revoke all on function public.bond_daily_cleanup() from public, anon, authenticated;

do $cron$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'bond-daily-cleanup';
    perform cron.schedule('bond-daily-cleanup', '15 3 * * *', 'select public.bond_daily_cleanup()');
  else
    raise notice 'pg_cron is not enabled: the daily cleanup is not scheduled. Enable pg_cron, then run this migration again.';
  end if;
end $cron$;
