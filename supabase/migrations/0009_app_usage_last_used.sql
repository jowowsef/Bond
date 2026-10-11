-- =====================================================================
-- 0009: "Recently used" for the partner's Screen Time statistics
--
-- Adds one optional column to the existing per-app daily usage table:
--   app_usage_daily.last_used_at = the last moment that day the app was on
--   screen (from Android's usage log on the person's own phone).
-- The partner's statistics screen sorts "Recently used" by it.
--
-- Nothing else changes: same table, same row level security (the partner
-- can read these rows only while share_screen_time is on, through the
-- existing "app usage read" policy and can_see()), same 30-day cleanup.
-- Existing rows simply have no value until the next upload.
--
-- Independent of 0008 (either can be applied first). Needs only the base
-- schema (supabase/schema.sql). Safe to run more than once.
--
-- HOW TO TELL WHETHER IT IS ALREADY APPLIED (run in SQL Editor):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'app_usage_daily'
--      and column_name = 'last_used_at';
--   One row = applied. No rows = not applied yet.
-- =====================================================================

alter table public.app_usage_daily
  add column if not exists last_used_at timestamptz;
