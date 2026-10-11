-- =====================================================================
-- 0012: Shared calendar (events, recurrence, reminders)
--
-- 1. public.calendar_events: one row per event or per repeating SERIES (a
--    yearly anniversary is ONE row, never one row per year). Owned by the
--    couple (couple_id); created_by / updated_by are set by the server.
--      - all-day = no start_time; end_time is optional and needs a start_time
--        (same day, not earlier than the start).
--      - start_date / start_time are the WALL-CLOCK date and time in
--        "timezone" (IANA name from the phone, e.g. Asia/Manila), so
--        "7:00 PM" stays 7:00 PM across daylight-saving changes.
--      - repeat: none | daily | weekly | monthly | yearly. Monthly on the
--        29th-31st falls on the LAST day of shorter months; yearly on Feb 29
--        falls on Feb 28 in other years (always counted from the original
--        date, so it never drifts).
-- 2. public.calendar_event_exceptions: a cancelled single occurrence of a
--    series ("delete only this one"; editing only one occurrence = cancel it
--    here + a new single event, done by the app).
-- 3. Security (row level security, checked by the server):
--      - only a member of a COMPLETE couple (both partners joined) can read,
--        create, edit or delete that couple's events and exceptions;
--      - couple_id, created_by and created_at can't be changed or faked;
--      - unknown time zones are refused.
-- 4. Unpair: when anyone leaves a couple, all of that couple's events are
--    deleted at once (and with them their exceptions and pending reminders),
--    so nothing carries over to a new partner who might join the same code.
-- 5. Reminders (server side, not an app timer): public.queue_calendar_reminders()
--    runs every minute (pg_cron job "bond-calendar-reminders"), finds
--    reminders that are due (looking back 10 minutes, in case a run was
--    missed), records each one ONCE in calendar_reminders_sent, and creates a
--    partner_alerts row (kind 'calendar_reminder') for BOTH partners who have
--    calendar reminders on. From there the existing 0011 trigger pushes it
--    through send-partner-alert (unchanged), and the app delivers it itself
--    when push isn't possible. All-day events remind at 9:00 AM local time.
--    A reminder whose time had already passed when the event was saved is
--    never sent late.
-- 6. privacy_settings.calendar_reminders (default on): each person's own
--    "Calendar reminders" switch in Settings.
--
-- Requires 0003, 0010 and 0011 (partner alert pipeline). pg_cron is needed
-- for reminders: if it isn't enabled, everything else is created and a
-- notice says so; enable pg_cron and run this file again.
-- Safe to run more than once. Existing triggers and functions are not changed.
--
-- HOW TO TELL WHETHER IT IS ALREADY APPLIED:
--   select to_regclass('public.calendar_events');   -- not null = applied
--   select jobname from cron.job where jobname = 'bond-calendar-reminders';
-- =====================================================================

do $chk$ begin
  if to_regclass('public.partner_alerts') is null then
    raise exception 'Apply migrations 0003 / 0010 first (partner_alerts is missing).';
  end if;
end $chk$;

-- ---------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------
-- My couple, but only while BOTH partners are in it (null otherwise).
create or replace function public.my_full_couple_id()
returns uuid language sql stable security definer set search_path = public as $$
  select m.couple_id
    from public.couple_members m
   where m.user_id = auth.uid()
     and (select count(*) from public.couple_members x where x.couple_id = m.couple_id) = 2;
$$;
revoke all on function public.my_full_couple_id() from public, anon;
grant execute on function public.my_full_couple_id() to authenticated;

-- Every occurrence of an event between two dates (inclusive), counted from
-- the ORIGINAL date each time (no drift; month ends and Feb 29 clamp).
create or replace function public.calendar_occurrences(p_start date, p_repeat text, p_from date, p_to date)
returns setof date language plpgsql immutable set search_path = public as $fn$
declare
  k integer;
  d date;
  guard integer := 0;
begin
  if p_to < p_start or p_from > p_to then return; end if;
  if p_repeat = 'none' then
    if p_start between p_from and p_to then return next p_start; end if;
    return;
  end if;
  if p_repeat = 'daily' then
    k := greatest(0, p_from - p_start);
    loop
      d := p_start + k;
      exit when d > p_to;
      return next d;
      k := k + 1;
    end loop;
  elsif p_repeat = 'weekly' then
    k := greatest(0, ceil((p_from - p_start) / 7.0)::integer);
    loop
      d := p_start + 7 * k;
      exit when d > p_to;
      return next d;
      k := k + 1;
    end loop;
  elsif p_repeat in ('monthly', 'yearly') then
    if p_repeat = 'monthly' then
      k := greatest(0, ((extract(year from p_from)::int - extract(year from p_start)::int) * 12
                        + extract(month from p_from)::int - extract(month from p_start)::int) - 1);
    else
      k := greatest(0, extract(year from p_from)::int - extract(year from p_start)::int - 1);
    end if;
    loop
      d := (p_start + case when p_repeat = 'monthly' then make_interval(months => k) else make_interval(years => k) end)::date;
      exit when d > p_to;
      if d >= p_from then return next d; end if;
      k := k + 1;
      guard := guard + 1;
      exit when guard > 100000;
    end loop;
  end if;
end;
$fn$;
grant execute on function public.calendar_occurrences(date, text, date, date) to authenticated;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------
create table if not exists public.calendar_events (
  id           uuid primary key default gen_random_uuid(),
  couple_id    uuid not null references public.couples(id) on delete cascade,
  created_by   uuid references auth.users(id) on delete set null,
  updated_by   uuid references auth.users(id) on delete set null,
  title        text not null check (char_length(btrim(title)) between 1 and 120),
  start_date   date not null,
  start_time   time,
  end_time     time,
  timezone     text not null,
  description  text check (description is null or char_length(description) <= 2000),
  location     text check (location is null or char_length(location) <= 200),
  reminder     text not null default 'none' check (reminder in ('none', 'at_time', '15m', '1h', '1d')),
  repeat       text not null default 'none' check (repeat in ('none', 'daily', 'weekly', 'monthly', 'yearly')),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint calendar_events_end_needs_start check (end_time is null or start_time is not null),
  constraint calendar_events_end_after_start check (end_time is null or end_time >= start_time)
);
create index if not exists calendar_events_couple on public.calendar_events (couple_id, start_date);
create index if not exists calendar_events_reminders on public.calendar_events (reminder) where reminder <> 'none';

create table if not exists public.calendar_event_exceptions (
  event_id         uuid not null references public.calendar_events(id) on delete cascade,
  couple_id        uuid not null references public.couples(id) on delete cascade,
  occurrence_date  date not null,
  created_by       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at       timestamptz not null default now(),
  primary key (event_id, occurrence_date)
);
create index if not exists calendar_event_exceptions_couple on public.calendar_event_exceptions (couple_id);

-- Reminders already queued (server only; prevents duplicates).
create table if not exists public.calendar_reminders_sent (
  event_id         uuid not null references public.calendar_events(id) on delete cascade,
  occurrence_date  date not null,
  remind_at        timestamptz not null,
  sent_at          timestamptz not null default now(),
  primary key (event_id, occurrence_date, remind_at)
);
alter table public.calendar_reminders_sent enable row level security; -- no policies: app users can't read it

alter table public.privacy_settings add column if not exists calendar_reminders boolean not null default true;

-- ---------------------------------------------------------------------
-- Server-side guards (who / when can't be faked; time zone must exist)
-- ---------------------------------------------------------------------
create or replace function public.calendar_events_guard()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  if not exists (select 1 from pg_timezone_names where name = new.timezone) then
    raise exception 'Unknown time zone: %', new.timezone;
  end if;
  new.title := btrim(new.title);
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  else
    new.couple_id := old.couple_id;
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$fn$;
revoke all on function public.calendar_events_guard() from public, anon, authenticated;
drop trigger if exists calendar_events_guard on public.calendar_events;
create trigger calendar_events_guard
  before insert or update on public.calendar_events
  for each row execute function public.calendar_events_guard();

create or replace function public.calendar_exceptions_guard()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  -- The exception always belongs to its event's couple.
  select couple_id into new.couple_id from public.calendar_events where id = new.event_id;
  new.created_by := coalesce(auth.uid(), new.created_by);
  return new;
end;
$fn$;
revoke all on function public.calendar_exceptions_guard() from public, anon, authenticated;
drop trigger if exists calendar_exceptions_guard on public.calendar_event_exceptions;
create trigger calendar_exceptions_guard
  before insert on public.calendar_event_exceptions
  for each row execute function public.calendar_exceptions_guard();

-- ---------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------
alter table public.calendar_events enable row level security;
alter table public.calendar_event_exceptions enable row level security;

drop policy if exists "calendar read" on public.calendar_events;
create policy "calendar read" on public.calendar_events for select to authenticated
  using (couple_id = public.my_full_couple_id());
drop policy if exists "calendar insert" on public.calendar_events;
create policy "calendar insert" on public.calendar_events for insert to authenticated
  with check (couple_id = public.my_full_couple_id());
drop policy if exists "calendar update" on public.calendar_events;
create policy "calendar update" on public.calendar_events for update to authenticated
  using (couple_id = public.my_full_couple_id())
  with check (couple_id = public.my_full_couple_id());
drop policy if exists "calendar delete" on public.calendar_events;
create policy "calendar delete" on public.calendar_events for delete to authenticated
  using (couple_id = public.my_full_couple_id());

drop policy if exists "calendar exceptions read" on public.calendar_event_exceptions;
create policy "calendar exceptions read" on public.calendar_event_exceptions for select to authenticated
  using (couple_id = public.my_full_couple_id());
drop policy if exists "calendar exceptions insert" on public.calendar_event_exceptions;
create policy "calendar exceptions insert" on public.calendar_event_exceptions for insert to authenticated
  with check (couple_id = public.my_full_couple_id());
drop policy if exists "calendar exceptions delete" on public.calendar_event_exceptions;
create policy "calendar exceptions delete" on public.calendar_event_exceptions for delete to authenticated
  using (couple_id = public.my_full_couple_id());

grant select, insert, update, delete on public.calendar_events to authenticated;
grant select, insert, delete on public.calendar_event_exceptions to authenticated;

-- ---------------------------------------------------------------------
-- Unpair: the couple's events go with it (separate trigger; 0010's
-- cleanup and unpair-alert triggers are not changed)
-- ---------------------------------------------------------------------
create or replace function public.on_couple_member_removed_calendar()
returns trigger language plpgsql security definer set search_path = public as $fn$
begin
  delete from public.calendar_events where couple_id = old.couple_id;
  return old;
end;
$fn$;
revoke all on function public.on_couple_member_removed_calendar() from public, anon, authenticated;
drop trigger if exists couple_member_removed_calendar on public.couple_members;
create trigger couple_member_removed_calendar
  after delete on public.couple_members
  for each row execute function public.on_couple_member_removed_calendar();

-- ---------------------------------------------------------------------
-- Reminders through the existing partner_alerts pipeline
-- ---------------------------------------------------------------------
alter table public.partner_alerts add column if not exists event_id uuid references public.calendar_events(id) on delete cascade;
alter table public.partner_alerts add column if not exists occurrence_date date;

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
  add constraint partner_alerts_kind_check check (kind in ('battery_low', 'unpaired', 'calendar_reminder'));

-- Gives each reminder alert its own value for partner_alerts' unique key.
create sequence if not exists public.calendar_reminder_seq;

create or replace function public.queue_calendar_reminders(p_now timestamptz default now())
returns integer language plpgsql security definer set search_path = public as $fn$
declare
  e public.calendar_events;
  occ date;
  local_today date;
  remind_local timestamp;
  remind_at timestamptz;
  msg text;
  r uuid;
  n integer := 0;
begin
  for e in select * from public.calendar_events where reminder <> 'none' loop
    local_today := (p_now at time zone e.timezone)::date;
    for occ in
      select d from public.calendar_occurrences(e.start_date, e.repeat, local_today - 1, local_today + 2) d
       where not exists (select 1 from public.calendar_event_exceptions x where x.event_id = e.id and x.occurrence_date = d)
    loop
      -- Wall-clock time in the event's zone, minus the reminder offset, then
      -- converted: daylight-saving changes are handled by the time zone.
      remind_local := (occ + coalesce(e.start_time, time '09:00'))
                      - case e.reminder when '15m' then interval '15 minutes'
                                        when '1h' then interval '1 hour'
                                        when '1d' then interval '1 day'
                                        else interval '0' end;
      remind_at := remind_local at time zone e.timezone;
      continue when remind_at > p_now;                                  -- not due yet
      continue when remind_at <= p_now - interval '10 minutes';         -- too old (missed)
      continue when remind_at < e.updated_at;                           -- was already past when saved

      insert into public.calendar_reminders_sent (event_id, occurrence_date, remind_at)
      values (e.id, occ, remind_at) on conflict do nothing;
      continue when not found;                                          -- already queued once

      msg := case
        when e.reminder = 'at_time' and e.start_time is null then 'Today'
        when e.reminder = 'at_time' then 'Starting now'
        when e.reminder = '15m' then 'In 15 minutes'
        when e.reminder = '1h' then 'In 1 hour'
        when e.start_time is null then 'Tomorrow'
        else 'Tomorrow at ' || to_char(e.start_time, 'FMHH12:MI AM')
      end;

      for r in
        select m.user_id
          from public.couple_members m
          left join public.privacy_settings p on p.user_id = m.user_id
         where m.couple_id = e.couple_id
           and coalesce(p.calendar_reminders, true)
           and (select count(*) from public.couple_members x where x.couple_id = e.couple_id) = 2
      loop
        insert into public.partner_alerts
          (recipient_id, subject_id, kind, threshold, level, cycle, title, body, event_id, occurrence_date)
        values (r, r, 'calendar_reminder', 0, 0, nextval('public.calendar_reminder_seq')::integer,
                left(e.title, 120), msg, e.id, occ);
        n := n + 1;
      end loop;
    end loop;
  end loop;
  delete from public.calendar_reminders_sent where sent_at < p_now - interval '30 days';
  return n;
end;
$fn$;
revoke all on function public.queue_calendar_reminders(timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- Realtime (row level security still applies)
-- ---------------------------------------------------------------------
do $rt$ begin
  alter publication supabase_realtime add table public.calendar_events;
exception when duplicate_object then null;
end $rt$;
do $rt$ begin
  alter publication supabase_realtime add table public.calendar_event_exceptions;
exception when duplicate_object then null;
end $rt$;

-- ---------------------------------------------------------------------
-- Every minute: queue due reminders (needs pg_cron)
-- ---------------------------------------------------------------------
do $cron$ begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    perform cron.unschedule(jobid) from cron.job where jobname = 'bond-calendar-reminders';
    perform cron.schedule('bond-calendar-reminders', '* * * * *', 'select public.queue_calendar_reminders()');
  else
    raise notice 'pg_cron is not enabled: calendar reminders will not be sent. Enable pg_cron, then run this migration again.';
  end if;
end $cron$;
