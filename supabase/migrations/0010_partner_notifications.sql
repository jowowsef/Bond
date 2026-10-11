-- =====================================================================
-- 0010: Better partner battery alerts + "your partner unpaired" alert
--
-- Builds on 0003 / 0004 (partner_alerts, battery_alert_state, push tokens,
-- send-partner-alert function) and 0008 (Currently Using). It does NOT edit
-- those files; it replaces two functions and adds one trigger.
--
-- 1. Battery alerts (replaces on_battery_status_alert from 0004):
--    - Thresholds 20 / 15 / 10 / 5 %, only to the paired partner, only while
--      the battery's owner shares their battery (unchanged).
--    - A real CROSSING is needed: the previous valid reading (within the
--      last 3 hours) must be above the threshold. The first reading after
--      sharing starts never alerts by itself.
--    - Readings older than 15 minutes, or older than the last one seen
--      (a delayed / out-of-order upload), are ignored. A reading stamped in
--      the future (phone clock ahead) is recorded at the server's time, so
--      it can't block the readings after it.
--    - Several thresholds crossed at once (phone was offline): ONE alert,
--      for the lowest one.
--    - Below 5 %: no repeats. A threshold is alerted again only after the
--      battery came back at least 3 % ABOVE it (a quick plug-in no longer
--      resets everything, as it did before).
-- 2. Unpair alert: when a couple of two ends (approved unpair, leaving, or
--    account deletion), each former member EXCEPT the person who did it gets
--    one alert: "Your partner has unpaired from you." No names. Created in
--    the same transaction as the unpair, so a failed unpair sends nothing.
-- 3. Unpair cleanup (adds to 0008's on_couple_member_removed, which is kept
--    exactly as it was otherwise): the person's battery alert state and any
--    UNDELIVERED battery alerts to or about them are deleted, so an old
--    partner's battery never shows up later.
--
-- Delivery is unchanged: the send-partner-alert Edge Function (push, when
-- configured) or the app itself (when open, and Android's background check).
--
-- Requires 0003, 0004 and 0008 (it stops with a clear error otherwise).
-- Safe to run more than once. Nothing existing is dropped except the old
-- kind check on partner_alerts, which is widened to allow 'unpaired'.
--
-- HOW TO TELL WHETHER IT IS ALREADY APPLIED:
--   select column_name from information_schema.columns
--    where table_schema = 'public' and table_name = 'battery_alert_state'
--      and column_name = 'last_level';
--   One row = applied.
-- =====================================================================

do $chk$ begin
  if to_regclass('public.partner_alerts') is null or to_regclass('public.battery_alert_state') is null then
    raise exception 'Apply migrations 0003 and 0004 first.';
  end if;
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'privacy_settings' and column_name = 'share_current_app') then
    raise exception 'Apply migration 0008 first.';
  end if;
end $chk$;

-- ---------------------------------------------------------------------
-- 1. Battery alerts
-- ---------------------------------------------------------------------
alter table public.battery_alert_state add column if not exists last_level integer;
alter table public.battery_alert_state add column if not exists last_at timestamptz;

create or replace function public.on_battery_status_alert()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  st public.battery_alert_state;
  prev integer;
  at_time timestamptz;
  new_lowest integer;
  partner uuid;
  t integer;
  hit integer := null;
  owner_name text;
begin
  if new.level is null or new.level <= 0 or new.level > 100 then return new; end if;
  if new.updated_at < now() - interval '15 minutes' then return new; end if;

  insert into public.battery_alert_state (user_id) values (new.user_id) on conflict (user_id) do nothing;
  select * into st from public.battery_alert_state where user_id = new.user_id for update;

  -- The reading's time, never later than the server's clock.
  at_time := least(new.updated_at, now());

  -- Out of order (an older reading arriving late): ignore.
  if st.last_at is not null and at_time <= st.last_at then return new; end if;

  -- The previous reading counts only if it is recent (consecutive readings).
  prev := case when st.last_at is not null and st.last_at > at_time - interval '3 hours' then st.last_level end;

  -- Re-arm thresholds the battery has risen at least 3 % above.
  new_lowest := null;
  if st.lowest_notified is not null then
    foreach t in array array[5, 10, 15, 20] loop
      if new_lowest is null and t >= st.lowest_notified and new.level < t + 3 then
        new_lowest := t;
      end if;
    end loop;
  end if;

  -- The lowest threshold really crossed now and not alerted yet.
  if not new.is_charging and prev is not null then
    foreach t in array array[20, 15, 10, 5] loop
      if prev > t and new.level <= t and (new_lowest is null or t < new_lowest) then
        hit := t;
      end if;
    end loop;
  end if;

  update public.battery_alert_state
     set last_level = new.level,
         last_at = at_time,
         -- Something was re-armed: a new cycle, so the same threshold may alert again.
         cycle = cycle + case when new_lowest is distinct from st.lowest_notified then 1 else 0 end,
         lowest_notified = coalesce(hit, new_lowest),
         updated_at = now()
   where user_id = new.user_id
  returning * into st;

  if hit is null then return new; end if;

  select m2.user_id into partner
    from public.couple_members m1
    join public.couple_members m2 on m2.couple_id = m1.couple_id and m2.user_id <> m1.user_id
   where m1.user_id = new.user_id;
  if partner is null then return new; end if;
  if not coalesce((select share_battery from public.privacy_settings where user_id = new.user_id), false) then return new; end if;

  owner_name := public.display_name_of(new.user_id);
  if owner_name in ('Me', 'Someone', '') then owner_name := 'Your partner'; end if;
  insert into public.partner_alerts (recipient_id, subject_id, kind, threshold, level, cycle, title, body)
  values (partner, new.user_id, 'battery_low', hit, new.level, st.cycle,
          'Low battery', owner_name || '''s battery is at ' || new.level || '%.')
  on conflict (recipient_id, subject_id, kind, threshold, cycle) do nothing;
  return new;
end;
$fn$;
revoke all on function public.on_battery_status_alert() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Unpair alert
-- ---------------------------------------------------------------------
do $kind$
declare c text;
begin
  for c in
    select conname from pg_constraint
     where conrelid = 'public.partner_alerts'::regclass and contype = 'c'
       and pg_get_constraintdef(oid) ilike '%kind%'
  loop
    execute format('alter table public.partner_alerts drop constraint %I', c);
  end loop;
end $kind$;
alter table public.partner_alerts
  add constraint partner_alerts_kind_check check (kind in ('battery_low', 'unpaired'));

create or replace function public.notify_partner_unpaired()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  actor uuid := auth.uid();
  c uuid;
  r uuid;
  next_cycle integer;
begin
  for c in select distinct couple_id from removed loop
    -- Only a couple of two people (a code nobody joined is not an unpair).
    if (select count(*) from (
          select user_id from removed where couple_id = c
          union select user_id from public.couple_members where couple_id = c) m) < 2 then
      continue;
    end if;
    for r in
      select user_id from removed where couple_id = c
      union select user_id from public.couple_members where couple_id = c
    loop
      if actor is not null and r = actor then continue; end if;   -- not to the person who did it
      if not exists (select 1 from auth.users where id = r) then continue; end if; -- deleted account
      select coalesce(max(cycle), 0) + 1 into next_cycle
        from public.partner_alerts where recipient_id = r and kind = 'unpaired';
      insert into public.partner_alerts (recipient_id, subject_id, kind, threshold, level, cycle, title, body)
      values (r, r, 'unpaired', 0, 0, next_cycle, 'Bond', 'Your partner has unpaired from you.')
      on conflict do nothing;
    end loop;
  end loop;
  return null;
end;
$fn$;
revoke all on function public.notify_partner_unpaired() from public, anon, authenticated;

drop trigger if exists couple_members_unpaired_notify on public.couple_members;
create trigger couple_members_unpaired_notify
  after delete on public.couple_members
  referencing old table as removed
  for each statement execute function public.notify_partner_unpaired();

-- ---------------------------------------------------------------------
-- 3. Unpair cleanup: 0008's function, plus the battery alert leftovers
-- ---------------------------------------------------------------------
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
  delete from public.battery_alert_state where user_id = old.user_id;
  delete from public.partner_alerts
   where kind = 'battery_low' and delivered_at is null
     and (recipient_id = old.user_id or subject_id = old.user_id);
  return old;
end;
$fn$;
revoke all on function public.on_couple_member_removed() from public, anon, authenticated;
-- (the couple_member_removed trigger from 0007 / 0008 already calls it)
