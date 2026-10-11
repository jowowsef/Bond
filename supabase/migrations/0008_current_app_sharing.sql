-- =====================================================================
-- 0008: "Currently Using" sharing (optional, OFF by default)
--
-- Adds:
--   1. privacy_settings.share_current_app (default false): the person's own
--      consent to share which app is in front on their phone.
--   2. public.current_app: ONE row per person with the latest check only
--      (no history): the app name (and package, for the icon), or "no app"
--      (screen off / home screen), and when it was checked.
--   3. Row level security, same model as locations:
--        - you can read your own row; your partner can read it ONLY while
--          your share_current_app is on,
--        - you can write only your own row and ONLY while your
--          share_current_app is on (a stale background job can't leak).
--   4. Turning share_current_app off deletes the stored row.
--   5. The unpair trigger from 0007 also turns share_current_app off and
--      deletes the row when a person leaves a couple (approved unpair,
--      leaving alone, or account deletion). Its earlier behavior is kept:
--      the four other sharing switches go off and battery_status is deleted.
--
-- Nothing is dropped and no existing rows are changed (except that the new
-- column is added as false for everyone). Safe to run more than once.
--
-- HOW TO TELL WHETHER IT IS ALREADY APPLIED (run in SQL Editor):
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'privacy_settings'
--      and column_name = 'share_current_app';
--   One row = applied. No rows = not applied yet.
-- =====================================================================

alter table public.privacy_settings
  add column if not exists share_current_app boolean not null default false;

create table if not exists public.current_app (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  -- null = no app in front at check time (screen off, lock screen, home screen)
  app_name     text check (app_name is null or char_length(app_name) between 1 and 80),
  package_name text check (package_name is null or char_length(package_name) between 1 and 200),
  checked_at   timestamptz not null default now()
);

alter table public.current_app enable row level security;

drop policy if exists "current app read" on public.current_app;
create policy "current app read" on public.current_app for select to authenticated
  using (
    user_id = auth.uid()
    or (user_id = public.my_partner_id()
        and exists (select 1 from public.privacy_settings p
                     where p.user_id = current_app.user_id and p.share_current_app))
  );

drop policy if exists "current app insert" on public.current_app;
create policy "current app insert" on public.current_app for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.privacy_settings p where p.user_id = auth.uid() and p.share_current_app));

drop policy if exists "current app update" on public.current_app;
create policy "current app update" on public.current_app for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.privacy_settings p where p.user_id = auth.uid() and p.share_current_app));

drop policy if exists "current app delete" on public.current_app;
create policy "current app delete" on public.current_app for delete to authenticated
  using (user_id = auth.uid());

grant select, insert, update, delete on public.current_app to authenticated;

-- Turning sharing off removes the stored value right away.
create or replace function public.on_current_app_sharing_changed()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if old.share_current_app and not new.share_current_app then
    delete from public.current_app where user_id = new.user_id;
  end if;
  return new;
end;
$fn$;
revoke all on function public.on_current_app_sharing_changed() from public, anon, authenticated;

drop trigger if exists current_app_sharing_changed on public.privacy_settings;
create trigger current_app_sharing_changed
  after update of share_current_app on public.privacy_settings
  for each row execute function public.on_current_app_sharing_changed();

-- Leaving a couple: everything from 0007, plus the current-app sharing.
create or replace function public.on_couple_member_removed()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  update public.privacy_settings
     set share_location = false,
         share_battery = false,
         share_screen_time = false,
         share_activity = false,
         share_current_app = false
   where user_id = old.user_id;
  delete from public.battery_status where user_id = old.user_id;
  delete from public.current_app where user_id = old.user_id;
  return old;
end;
$fn$;
revoke all on function public.on_couple_member_removed() from public, anon, authenticated;

drop trigger if exists couple_member_removed on public.couple_members;
create trigger couple_member_removed
  after delete on public.couple_members
  for each row execute function public.on_couple_member_removed();

-- Live updates for the partner's Home card (RLS still applies).
do $mig$ begin
  alter publication supabase_realtime add table public.current_app;
exception when duplicate_object then null;
end $mig$;
