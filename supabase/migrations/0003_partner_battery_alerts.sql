-- =====================================================================
-- 0003: Partner low-battery alerts (20%, 15%, 10%, 5%)
--
-- Additive only: new tables, functions and one trigger. No existing table,
-- policy or row is changed.
--
-- How it works
--   1. Each phone already uploads ITS OWN battery to battery_status (RLS:
--      only the owner can write their row, and only while sharing is on).
--   2. A trigger on battery_status decides, on the server, whether a
--      threshold was crossed while discharging. It creates at most ONE alert
--      per threshold per discharge cycle, addressed only to the owner's
--      partner, and only if the owner shares battery AND the partner turned
--      on "Low battery alerts" (privacy_settings.battery_alerts).
--   3. Delivery: the partner's app picks pending alerts up (Realtime while
--      open, background check about every 15 minutes) and/or the
--      send-partner-alert Edge Function sends a push. Whoever "claims" the
--      alert first delivers it, so it is never shown twice.
-- Clients can't create alerts or choose recipients: there are no insert or
-- update policies on these tables.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Push tokens (Expo push tokens), one row per device.
-- Only the owner can see their own tokens; the Edge Function uses the
-- service role on the server.
-- ---------------------------------------------------------------------
create table if not exists public.push_tokens (
  token       text primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  platform    text not null default 'android',
  updated_at  timestamptz not null default now()
);
create index if not exists push_tokens_user on public.push_tokens (user_id);
alter table public.push_tokens enable row level security;
create policy "push tokens read own" on public.push_tokens for select to authenticated
  using (user_id = auth.uid());
create policy "push tokens delete own" on public.push_tokens for delete to authenticated
  using (user_id = auth.uid());

-- Register (or move) this device's token to the signed-in user.
create or replace function public.register_push_token(p_token text, p_platform text default 'android')
returns void language plpgsql security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if p_token is null or length(p_token) > 255 or p_token !~ '^Expo(nent)?PushToken\[[A-Za-z0-9_-]+\]$' then
    raise exception 'Invalid push token';
  end if;
  insert into public.push_tokens (token, user_id, platform, updated_at)
  values (p_token, auth.uid(), coalesce(nullif(p_platform, ''), 'android'), now())
  on conflict (token) do update
    set user_id = excluded.user_id, platform = excluded.platform, updated_at = now();
end;
$fn$;
grant execute on function public.register_push_token(text, text) to authenticated;

-- ---------------------------------------------------------------------
-- Per-phone discharge-cycle state (server only, no client access).
-- ---------------------------------------------------------------------
create table if not exists public.battery_alert_state (
  user_id          uuid primary key references auth.users(id) on delete cascade,
  cycle            integer not null default 0,
  lowest_notified  integer,          -- lowest threshold already alerted this cycle
  updated_at       timestamptz not null default now()
);
alter table public.battery_alert_state enable row level security;
-- (no policies: only the trigger below, running as owner, touches it)

-- ---------------------------------------------------------------------
-- Alerts waiting to be delivered to a partner.
-- ---------------------------------------------------------------------
create table if not exists public.partner_alerts (
  id            uuid primary key default gen_random_uuid(),
  recipient_id  uuid not null references auth.users(id) on delete cascade,
  subject_id    uuid not null references auth.users(id) on delete cascade,
  kind          text not null check (kind in ('battery_low')),
  threshold     integer not null,
  level         integer not null,
  cycle         integer not null,
  title         text not null,
  body          text not null,
  created_at    timestamptz not null default now(),
  delivered_at  timestamptz,
  delivered_via text,
  unique (recipient_id, subject_id, kind, threshold, cycle)
);
create index if not exists partner_alerts_pending on public.partner_alerts (recipient_id) where delivered_at is null;
alter table public.partner_alerts enable row level security;
create policy "partner alerts read own" on public.partner_alerts for select to authenticated
  using (recipient_id = auth.uid());

-- The recipient's app marks an alert as delivered. Returns true only for
-- the FIRST claim, so retries and the push path never show it twice.
create or replace function public.claim_partner_alert(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
begin
  update public.partner_alerts
     set delivered_at = now(), delivered_via = 'app'
   where id = p_id and recipient_id = auth.uid() and delivered_at is null;
  return found;
end;
$fn$;
grant execute on function public.claim_partner_alert(uuid) to authenticated;

-- ---------------------------------------------------------------------
-- The decision: runs whenever a phone uploads its battery.
-- ---------------------------------------------------------------------
create or replace function public.on_battery_status_alert()
returns trigger language plpgsql security definer set search_path = public as $fn$
declare
  st public.battery_alert_state;
  partner uuid;
  t integer;
  hit integer := null;
  owner_name text;
begin
  if new.level is null or new.level <= 0 or new.level > 100 then return new; end if;
  -- Ignore old readings (e.g. a delayed upload stamped long ago).
  if new.updated_at < now() - interval '15 minutes' then return new; end if;

  insert into public.battery_alert_state (user_id) values (new.user_id) on conflict (user_id) do nothing;
  select * into st from public.battery_alert_state where user_id = new.user_id for update;

  -- Charging, or back above 25%: a new discharge cycle starts.
  if new.is_charging or new.level > 25 then
    if st.lowest_notified is not null then
      update public.battery_alert_state
         set cycle = cycle + 1, lowest_notified = null, updated_at = now()
       where user_id = new.user_id;
    end if;
    return new;
  end if;

  -- The LOWEST threshold reached that wasn't alerted yet this cycle. If the
  -- phone was offline from 40% to 8%, this sends ONE alert (10%), not three.
  foreach t in array array[20, 15, 10, 5] loop
    if new.level <= t and (st.lowest_notified is null or t < st.lowest_notified) then
      hit := t;
    end if;
  end loop;
  if hit is null then return new; end if;

  update public.battery_alert_state set lowest_notified = hit, updated_at = now() where user_id = new.user_id;

  select m2.user_id into partner
    from public.couple_members m1
    join public.couple_members m2 on m2.couple_id = m1.couple_id and m2.user_id <> m1.user_id
   where m1.user_id = new.user_id;
  if partner is null then return new; end if;
  if not coalesce((select share_battery from public.privacy_settings where user_id = new.user_id), false) then return new; end if;
  if not coalesce((select battery_alerts from public.privacy_settings where user_id = partner), false) then return new; end if;

  owner_name := public.display_name_of(new.user_id);
  if owner_name in ('Me', 'Someone', '') then owner_name := 'Your partner'; end if;

  insert into public.partner_alerts (recipient_id, subject_id, kind, threshold, level, cycle, title, body)
  values (partner, new.user_id, 'battery_low', hit, new.level, st.cycle,
          'Low battery', owner_name || '''s battery is at ' || new.level || '%.')
  on conflict (recipient_id, subject_id, kind, threshold, cycle) do nothing;
  return new;
end;
$fn$;

drop trigger if exists battery_status_alert on public.battery_status;
create trigger battery_status_alert
  after insert or update on public.battery_status
  for each row execute function public.on_battery_status_alert();

-- Live delivery to the recipient's open app (RLS applies to Realtime too).
alter publication supabase_realtime add table public.partner_alerts;
