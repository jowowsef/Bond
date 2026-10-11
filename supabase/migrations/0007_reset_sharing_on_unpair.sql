-- =====================================================================
-- 0007: Every new pairing starts with sharing OFF
--
-- When a person leaves a couple (approved unpair, leaving alone, or account
-- deletion), their four sharing switches are turned off, so nothing from the
-- previous pairing is shared with a future partner without asking again:
--   share_location, share_battery, share_screen_time, share_activity -> false
-- Their stored battery reading is removed too; the stored location is removed
-- by the existing on_privacy_changed trigger when share_location turns off.
--
-- Personal data is NOT touched: name, avatar color, photo, account and all
-- other profile settings stay exactly as they are.
--
-- Works for every path at once because all of them delete the person's row
-- from couple_members:
--   - respond_to_approval (approved unpair: both members),
--   - leave_couple (the person leaving),
--   - delete_my_account / deleting an auth user (cascade).
-- It runs inside the same transaction, so a failed unpair changes nothing.
--
-- Safe to run more than once. No tables, rows or policies are dropped.
-- Run after 0001-0006 in the Supabase SQL Editor.
-- =====================================================================

create or replace function public.on_couple_member_removed()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.privacy_settings
     set share_location = false,
         share_battery = false,
         share_screen_time = false,
         share_activity = false
   where user_id = old.user_id;
  delete from public.battery_status where user_id = old.user_id;
  return old;
end;
$fn$;

-- Only the trigger uses it; clients can't call it.
revoke all on function public.on_couple_member_removed() from public, anon, authenticated;

drop trigger if exists couple_member_removed on public.couple_members;
create trigger couple_member_removed
  after delete on public.couple_members
  for each row execute function public.on_couple_member_removed();
