-- =====================================================================
-- Bond — Supabase database schema
-- =====================================================================
-- HOW TO USE:
--   1. Open your Supabase project → SQL Editor → New query.
--   2. Paste this WHOLE file and click "Run".
--   3. It is safe to run on a fresh project. (Running it twice will error
--      on "already exists" — that's fine, it means it's already set up.)
--
-- SECURITY MODEL (in plain words):
--   * Every table has Row Level Security (RLS) ON. That means the database
--     itself refuses to show a row unless a policy below allows it.
--   * You can only ever see: your own rows, and your paired partner's rows
--     (and only the kinds of data your partner has chosen to share).
--   * Nobody can write directly into control_requests / active_controls.
--     Those only change through the functions at the bottom (RPCs), which
--     check that the DEVICE OWNER is the one approving.
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- PROFILES (one row per user, created automatically on sign-up)
-- ---------------------------------------------------------------------
create table public.profiles (
  id            uuid primary key references auth.users(id) on delete cascade,
  display_name  text not null default 'Me',
  avatar_path   text,                         -- path inside the "avatars" storage bucket
  mood          text,                         -- 'good' | 'okay' | 'not_great' | 'miss_you'
  quick_status  text,                         -- 'Studying', 'Sleeping', ...
  mood_updated_at timestamptz,
  created_at    timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- COUPLES + MEMBERS (max 2 members, both equal — no roles)
-- ---------------------------------------------------------------------
create table public.couples (
  id           uuid primary key default gen_random_uuid(),
  invite_code  text not null unique,
  created_by   uuid not null references auth.users(id) on delete cascade,
  created_at   timestamptz not null default now()
);

create table public.couple_members (
  couple_id  uuid not null references public.couples(id) on delete cascade,
  user_id    uuid not null unique references auth.users(id) on delete cascade, -- a user is in at most ONE couple
  joined_at  timestamptz not null default now(),
  primary key (couple_id, user_id)
);

-- ---------------------------------------------------------------------
-- PRIVACY SETTINGS (what I let my partner see)
-- ---------------------------------------------------------------------
create table public.privacy_settings (
  user_id            uuid primary key references auth.users(id) on delete cascade,
  share_location     boolean not null default false,  -- OFF until you turn it on
  share_screen_time  boolean not null default true,
  share_battery      boolean not null default true,
  share_activity     boolean not null default true,   -- online / last active
  battery_alerts     boolean not null default false,  -- notify me when partner's battery is low
  updated_at         timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- DEVICE DATA
-- ---------------------------------------------------------------------
-- Last time the app was seen running (gated by share_activity)
create table public.presence (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  last_seen  timestamptz not null default now()
);

-- Battery (gated by share_battery)
create table public.battery_status (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  level       integer check (level between 0 and 100),
  is_charging boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- Which Android permissions / protections are actually working on the device.
-- ALWAYS visible to the partner, so nobody can be misled about whether a
-- control they agreed on is really active.
create table public.device_permissions (
  user_id                 uuid primary key references auth.users(id) on delete cascade,
  notifications           boolean not null default false,
  location_foreground     boolean not null default false,
  location_background     boolean not null default false,
  usage_access            boolean not null default false,
  vpn_permission          boolean not null default false,
  website_protection_running boolean not null default false,
  accessibility_enabled   boolean not null default false,
  battery_optimization_ignored boolean not null default false,
  device_model            text,
  app_version             text,
  updated_at              timestamptz not null default now()
);

-- Daily screen time totals (gated by share_screen_time)
create table public.screen_time_daily (
  user_id      uuid not null references auth.users(id) on delete cascade,
  day          date not null,
  total_ms     bigint not null default 0,
  launches     integer not null default 0,
  updated_at   timestamptz not null default now(),
  primary key (user_id, day)
);

-- Per-app daily usage (gated by share_screen_time)
create table public.app_usage_daily (
  user_id       uuid not null references auth.users(id) on delete cascade,
  day           date not null,
  package_name  text not null,
  app_name      text not null,
  foreground_ms bigint not null default 0,
  launches      integer not null default 0,
  updated_at    timestamptz not null default now(),
  primary key (user_id, day, package_name)
);

-- List of launchable apps on the device, so the partner can pick apps
-- when REQUESTING a control. (Visible to partner; shown in Privacy screen.)
create table public.installed_apps (
  user_id       uuid not null references auth.users(id) on delete cascade,
  package_name  text not null,
  app_name      text not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, package_name)
);

-- ONLY the latest location is stored (no history). The row is deleted
-- when location sharing is turned off. (Gated by share_location.)
create table public.locations (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  latitude    double precision not null,
  longitude   double precision not null,
  accuracy_m  double precision,
  place_name  text,
  is_background boolean not null default false,
  updated_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- CONTROLS
-- ---------------------------------------------------------------------
-- control_type values:
--   'web_category'  value = 'adult' | 'gambling' | 'malware' | 'phishing'
--   'web_domain'    value = 'example.com'           (custom blocked website)
--   'web_allow'     value = 'example.com'           (allowlist, owner-only)
--   'app_block'     value = 'com.zhiliaoapp.musically' (block opening the app)
--   'app_internet'  value = package name           (restrict app internet, best effort)

create table public.control_requests (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  target_id     uuid not null references auth.users(id) on delete cascade, -- the DEVICE OWNER
  control_type  text not null check (control_type in ('web_category','web_domain','web_allow','app_block','app_internet')),
  value         text not null,
  label         text not null,       -- human-friendly, e.g. "TikTok" or "Adult websites"
  note          text,                -- optional message from requester
  status        text not null default 'pending' check (status in ('pending','approved','declined','cancelled')),
  created_at    timestamptz not null default now(),
  responded_at  timestamptz
);

create table public.active_controls (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  owner_id      uuid not null references auth.users(id) on delete cascade,  -- whose device it runs on
  control_type  text not null check (control_type in ('web_category','web_domain','web_allow','app_block','app_internet')),
  value         text not null,
  label         text not null,
  requested_by  uuid references auth.users(id) on delete set null,
  approved_by   uuid references auth.users(id) on delete set null,
  request_id    uuid references public.control_requests(id) on delete set null,
  status        text not null default 'active' check (status in ('active','revoked')),
  enabled_at    timestamptz not null default now(),
  revoked_at    timestamptz,
  revoked_by    uuid references auth.users(id) on delete set null
);

-- Only one ACTIVE copy of the same control per device
create unique index active_controls_unique_active
  on public.active_controls (owner_id, control_type, value) where status = 'active';

-- Only one PENDING copy of the same request
create unique index control_requests_unique_pending
  on public.control_requests (target_id, control_type, value) where status = 'pending';

-- ---------------------------------------------------------------------
-- ACTIVITY LOG (timeline + source for notifications)
-- ---------------------------------------------------------------------
create table public.activity_logs (
  id          uuid primary key default gen_random_uuid(),
  couple_id   uuid not null references public.couples(id) on delete cascade,
  actor_id    uuid references auth.users(id) on delete set null,   -- who did it
  subject_id  uuid references auth.users(id) on delete set null,   -- whose device it concerns
  kind        text not null,      -- e.g. 'request_created', 'request_approved', 'control_revoked'...
  message     text not null,      -- ready-to-show sentence
  created_at  timestamptz not null default now()
);
create index activity_logs_couple_time on public.activity_logs (couple_id, created_at desc);

-- =====================================================================
-- HELPER FUNCTIONS (used by the RLS policies)
-- "security definer" = runs with owner rights so it can look up the
-- couple without being blocked by RLS itself. They only ever return
-- information about the CALLER.
-- =====================================================================
create or replace function public.my_couple_id()
returns uuid language sql stable security definer set search_path = public as $$
  select couple_id from public.couple_members where user_id = auth.uid();
$$;

create or replace function public.my_partner_id()
returns uuid language sql stable security definer set search_path = public as $$
  select m2.user_id
  from public.couple_members m1
  join public.couple_members m2 on m2.couple_id = m1.couple_id and m2.user_id <> m1.user_id
  where m1.user_id = auth.uid();
$$;

-- Can the CALLER see this user's data of the given kind?
create or replace function public.can_see(target uuid, what text)
returns boolean language sql stable security definer set search_path = public as $$
  select case
    when target = auth.uid() then true
    when target is distinct from public.my_partner_id() then false
    else coalesce((
      select case what
        when 'location'    then share_location
        when 'screen_time' then share_screen_time
        when 'battery'     then share_battery
        when 'activity'    then share_activity
        else true end
      from public.privacy_settings where user_id = target
    ), false)
  end;
$$;

create or replace function public.display_name_of(uid uuid)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((select display_name from public.profiles where id = uid), 'Someone');
$$;

create or replace function public.log_activity(p_couple uuid, p_actor uuid, p_subject uuid, p_kind text, p_message text)
returns void language sql security definer set search_path = public as $$
  insert into public.activity_logs (couple_id, actor_id, subject_id, kind, message)
  values (p_couple, p_actor, p_subject, p_kind, p_message);
$$;
revoke all on function public.log_activity(uuid, uuid, uuid, text, text) from public, anon, authenticated;

-- =====================================================================
-- AUTOMATIC ROWS ON SIGN-UP
-- =====================================================================
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  -- Anonymous users have no email, so fall back to the name they typed
  -- during pairing (raw_user_meta_data.display_name), then to 'Me'.
  insert into public.profiles (id, display_name)
  values (new.id, coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
    'Me'));
  insert into public.privacy_settings (user_id) values (new.id);
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Log when location sharing is switched on/off, and delete the stored
-- location when it is switched off (don't keep data we don't need).
create or replace function public.on_privacy_changed()
returns trigger language plpgsql security definer set search_path = public as $$
declare c uuid := (select couple_id from public.couple_members where user_id = new.user_id);
begin
  new.updated_at := now();
  if new.share_location is distinct from old.share_location then
    if not new.share_location then
      delete from public.locations where user_id = new.user_id;
    end if;
    if c is not null then
      perform public.log_activity(c, new.user_id, new.user_id,
        case when new.share_location then 'location_on' else 'location_off' end,
        public.display_name_of(new.user_id) || case when new.share_location
          then ' turned location sharing on' else ' turned location sharing off' end);
    end if;
  end if;
  return new;
end;
$$;

create trigger privacy_settings_changed
  before update on public.privacy_settings
  for each row execute function public.on_privacy_changed();

-- =====================================================================
-- ROW LEVEL SECURITY
-- =====================================================================
alter table public.profiles            enable row level security;
alter table public.couples             enable row level security;
alter table public.couple_members      enable row level security;
alter table public.privacy_settings    enable row level security;
alter table public.presence            enable row level security;
alter table public.battery_status      enable row level security;
alter table public.device_permissions  enable row level security;
alter table public.screen_time_daily   enable row level security;
alter table public.app_usage_daily     enable row level security;
alter table public.installed_apps      enable row level security;
alter table public.locations           enable row level security;
alter table public.control_requests    enable row level security;
alter table public.active_controls     enable row level security;
alter table public.activity_logs       enable row level security;

-- profiles: see me + partner, edit only me
create policy "profiles read" on public.profiles for select to authenticated
  using (id = auth.uid() or id = public.my_partner_id());
create policy "profiles update own" on public.profiles for update to authenticated
  using (id = auth.uid()) with check (id = auth.uid());

-- couples / members: read-only for members; changes only via RPC functions
create policy "couples read" on public.couples for select to authenticated
  using (id = public.my_couple_id());
create policy "members read" on public.couple_members for select to authenticated
  using (couple_id = public.my_couple_id());

-- privacy settings: see me + partner (so the app can explain what's shared), edit only me
create policy "privacy read" on public.privacy_settings for select to authenticated
  using (user_id = auth.uid() or user_id = public.my_partner_id());
create policy "privacy update own" on public.privacy_settings for update to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Macro-style policies for "my own data, partner may read if shared"
create policy "presence read" on public.presence for select to authenticated
  using (public.can_see(user_id, 'activity'));
create policy "presence write" on public.presence for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "battery read" on public.battery_status for select to authenticated
  using (public.can_see(user_id, 'battery'));
create policy "battery write" on public.battery_status for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "permissions read" on public.device_permissions for select to authenticated
  using (user_id = auth.uid() or user_id = public.my_partner_id());
create policy "permissions write" on public.device_permissions for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "screen time read" on public.screen_time_daily for select to authenticated
  using (public.can_see(user_id, 'screen_time'));
create policy "screen time write" on public.screen_time_daily for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "app usage read" on public.app_usage_daily for select to authenticated
  using (public.can_see(user_id, 'screen_time'));
create policy "app usage write" on public.app_usage_daily for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

create policy "installed apps read" on public.installed_apps for select to authenticated
  using (user_id = auth.uid() or user_id = public.my_partner_id());
create policy "installed apps write" on public.installed_apps for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- Location: partner can read ONLY while sharing is on. Writing is only
-- allowed while YOUR sharing is on (so a stale background task can't leak).
create policy "location read" on public.locations for select to authenticated
  using (public.can_see(user_id, 'location'));
create policy "location insert" on public.locations for insert to authenticated
  with check (user_id = auth.uid()
    and exists (select 1 from public.privacy_settings p where p.user_id = auth.uid() and p.share_location));
create policy "location update" on public.locations for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid()
    and exists (select 1 from public.privacy_settings p where p.user_id = auth.uid() and p.share_location));
create policy "location delete" on public.locations for delete to authenticated
  using (user_id = auth.uid());

-- Controls + activity: readable by the couple, NO direct writes (RPC only)
create policy "requests read" on public.control_requests for select to authenticated
  using (couple_id = public.my_couple_id());
create policy "controls read" on public.active_controls for select to authenticated
  using (couple_id = public.my_couple_id());
create policy "activity read" on public.activity_logs for select to authenticated
  using (couple_id = public.my_couple_id());

-- =====================================================================
-- RPC FUNCTIONS (the only way to change couples & controls)
-- =====================================================================

-- Generates a friendly 6-character code (no 0/O/1/I to avoid confusion)
create or replace function public.generate_invite_code()
returns text language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  code text;
begin
  loop
    code := '';
    for i in 1..6 loop
      code := code || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
    end loop;
    exit when not exists (select 1 from public.couples where invite_code = code);
  end loop;
  return code;
end;
$$;

-- Create a couple and get an invite code
create or replace function public.create_couple()
returns public.couples language plpgsql security definer set search_path = public as $$
declare c public.couples;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception 'You are already in a couple. Unpair first in Settings.';
  end if;
  insert into public.couples (invite_code, created_by)
  values (public.generate_invite_code(), auth.uid()) returning * into c;
  insert into public.couple_members (couple_id, user_id) values (c.id, auth.uid());
  return c;
end;
$$;

-- Join with a code
create or replace function public.join_couple(p_code text)
returns public.couples language plpgsql security definer set search_path = public as $$
declare c public.couples;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if exists (select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception 'You are already in a couple. Unpair first in Settings.';
  end if;
  select * into c from public.couples where invite_code = upper(trim(p_code)) for update;
  if c.id is null then raise exception 'That code was not found. Check it and try again.'; end if;
  if (select count(*) from public.couple_members where couple_id = c.id) >= 2 then
    raise exception 'This couple already has two people.';
  end if;
  insert into public.couple_members (couple_id, user_id) values (c.id, auth.uid());
  perform public.log_activity(c.id, auth.uid(), auth.uid(), 'partner_joined',
    public.display_name_of(auth.uid()) || ' joined. You are now connected ❤️');
  return c;
end;
$$;

-- Unpair. Revokes every control on BOTH phones and cancels pending
-- requests, so nobody stays restricted after the relationship ends.
create or replace function public.leave_couple()
returns void language plpgsql security definer set search_path = public as $$
declare c uuid := public.my_couple_id();
begin
  if c is null then return; end if;
  update public.active_controls
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   where couple_id = c and status = 'active';
  update public.control_requests set status = 'cancelled', responded_at = now()
   where couple_id = c and status = 'pending';
  perform public.log_activity(c, auth.uid(), auth.uid(), 'partner_left',
    public.display_name_of(auth.uid()) || ' unpaired. All controls were turned off.');
  delete from public.couple_members where couple_id = c and user_id = auth.uid();
  if not exists (select 1 from public.couple_members where couple_id = c) then
    delete from public.couples where id = c;
  else
    -- give the remaining person a fresh code
    update public.couples set invite_code = public.generate_invite_code() where id = c;
  end if;
end;
$$;

-- Request a control on a device.
--   * target = partner  → creates a PENDING request (partner must approve)
--   * target = myself   → I'm restricting my own phone, so it's active immediately
create or replace function public.request_control(
  p_target uuid, p_type text, p_value text, p_label text, p_note text default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c uuid := public.my_couple_id();
  me uuid := auth.uid();
  req_id uuid;
  v text := lower(trim(p_value));
begin
  if c is null then raise exception 'Pair with your partner first.'; end if;
  if p_target is distinct from me and p_target is distinct from public.my_partner_id() then
    raise exception 'You can only request controls for yourself or your partner.';
  end if;
  if p_type = 'web_allow' and p_target <> me then
    raise exception 'Only the phone owner can add allowed websites.';
  end if;
  if p_type in ('app_block','app_internet') then v := trim(p_value); end if;
  if length(v) = 0 then raise exception 'Value is empty.'; end if;

  if p_target = me then
    insert into public.active_controls (couple_id, owner_id, control_type, value, label, requested_by, approved_by)
    values (c, me, p_type, v, p_label, me, me)
    on conflict do nothing;
    perform public.log_activity(c, me, me, 'control_enabled',
      public.display_name_of(me) || ' turned on "' || p_label || '" on their own phone');
    return null;
  end if;

  if exists (select 1 from public.active_controls
             where owner_id = p_target and control_type = p_type and value = v and status = 'active') then
    raise exception '"%" is already active on that phone.', p_label;
  end if;
  if exists (select 1 from public.control_requests
             where target_id = p_target and control_type = p_type and value = v and status = 'pending') then
    raise exception '"%" is already waiting for approval.', p_label;
  end if;

  insert into public.control_requests (couple_id, requester_id, target_id, control_type, value, label, note)
  values (c, me, p_target, p_type, v, p_label, nullif(trim(coalesce(p_note, '')), ''))
  returning id into req_id;

  perform public.log_activity(c, me, p_target, 'request_created',
    public.display_name_of(me) || ' asked to turn on "' || p_label || '" on '
    || public.display_name_of(p_target) || '''s phone');
  return req_id;
end;
$$;

-- Accept or decline. ONLY the device owner (target) can do this.
create or replace function public.respond_to_request(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.control_requests;
begin
  select * into r from public.control_requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.target_id <> auth.uid() then raise exception 'Only the owner of the phone can answer this request.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already answered.'; end if;

  update public.control_requests
     set status = case when p_accept then 'approved' else 'declined' end, responded_at = now()
   where id = r.id;

  if p_accept then
    insert into public.active_controls (couple_id, owner_id, control_type, value, label, requested_by, approved_by, request_id)
    values (r.couple_id, r.target_id, r.control_type, r.value, r.label, r.requester_id, auth.uid(), r.id)
    on conflict do nothing;
    perform public.log_activity(r.couple_id, auth.uid(), r.target_id, 'request_approved',
      public.display_name_of(auth.uid()) || ' accepted "' || r.label || '" on their phone');
  else
    perform public.log_activity(r.couple_id, auth.uid(), r.target_id, 'request_declined',
      public.display_name_of(auth.uid()) || ' declined "' || r.label || '"');
  end if;
end;
$$;

-- The requester can withdraw a request that hasn't been answered yet.
create or replace function public.cancel_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.control_requests;
begin
  select * into r from public.control_requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> auth.uid() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then return; end if;
  update public.control_requests set status = 'cancelled', responded_at = now() where id = r.id;
  perform public.log_activity(r.couple_id, auth.uid(), r.target_id, 'request_cancelled',
    public.display_name_of(auth.uid()) || ' withdrew the request for "' || r.label || '"');
end;
$$;

-- Turn a control OFF. The device OWNER can ALWAYS do this (nobody can be
-- locked out of their own phone). The person who requested it may also
-- withdraw it (that only ever loosens restrictions).
create or replace function public.revoke_control(p_control_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.active_controls;
begin
  select * into a from public.active_controls where id = p_control_id for update;
  if a.id is null then raise exception 'Control not found.'; end if;
  if auth.uid() <> a.owner_id and auth.uid() is distinct from a.requested_by then
    raise exception 'Only the phone owner (or the person who requested it) can turn this off.';
  end if;
  if a.status <> 'active' then return; end if;
  update public.active_controls
     set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
   where id = a.id;
  perform public.log_activity(a.couple_id, auth.uid(), a.owner_id, 'control_revoked',
    public.display_name_of(auth.uid()) || ' turned off "' || a.label || '" on '
    || case when auth.uid() = a.owner_id then 'their own phone'
            else public.display_name_of(a.owner_id) || '''s phone' end);
end;
$$;

grant execute on function public.create_couple() to authenticated;
grant execute on function public.join_couple(text) to authenticated;
grant execute on function public.leave_couple() to authenticated;
grant execute on function public.request_control(uuid, text, text, text, text) to authenticated;
grant execute on function public.respond_to_request(uuid, boolean) to authenticated;
grant execute on function public.cancel_request(uuid) to authenticated;
grant execute on function public.revoke_control(uuid) to authenticated;

-- =====================================================================
-- REALTIME (live updates). RLS still applies to realtime events.
-- =====================================================================
alter publication supabase_realtime add table
  public.profiles, public.privacy_settings, public.presence, public.battery_status,
  public.device_permissions, public.screen_time_daily, public.locations,
  public.control_requests, public.active_controls, public.activity_logs,
  public.couple_members;

-- =====================================================================
-- STORAGE: private "avatars" bucket. Files live at <user_id>/avatar-*.jpg
-- You can upload only into your own folder; you can read yours + partner's.
-- =====================================================================
insert into storage.buckets (id, name, public) values ('avatars', 'avatars', false)
on conflict (id) do nothing;

create policy "avatar read" on storage.objects for select to authenticated
  using (bucket_id = 'avatars' and (
    (storage.foldername(name))[1] = auth.uid()::text or
    (storage.foldername(name))[1] = public.my_partner_id()::text));
create policy "avatar insert" on storage.objects for insert to authenticated
  with check (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar update" on storage.objects for update to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
create policy "avatar delete" on storage.objects for delete to authenticated
  using (bucket_id = 'avatars' and (storage.foldername(name))[1] = auth.uid()::text);
