-- =====================================================================
-- 0015: secure pairing codes (randomness, 24-hour expiry, attempt limits)
-- =====================================================================
--
-- Before: codes came from random() (not a secure generator), never
-- expired, and anyone signed in could try codes without limit.
--
--  1. Codes come from gen_random_uuid()'s secure random bytes. Still 6
--     characters from the same 32-letter alphabet (easy to read and type).
--  2. A code works for 24 hours (couples.invite_expires_at). The person
--     waiting can make a new one any time (refresh_invite_code), which also
--     ends the old one.
--  3. Joining goes through pair_with_code(code), which RETURNS a status
--     instead of raising an error, so failed attempts are remembered:
--       - at most 5 wrong codes in 15 minutes and 20 in 24 hours per account,
--       - "not found", "expired" and "already full" all give the same answer
--         ('invalid'), so nobody can learn which codes exist.
--     The old join_couple(text) stays (so 0014 still applies) but no longer
--     pairs: it asks to update Bond. Older APKs can't pair until updated.
--  4. When one person leaves and the other stays, the remaining person gets
--     a fresh code with a new 24 hours (the old code stops working).
--     Unpair by approval and account deletion already remove the whole
--     couple (no code left).
--  5. Anonymous accounts can't create or join a couple (they could be made
--     in unlimited numbers to get around the attempt limit). Leaving still
--     works for them.
--
-- Running at the same time (READ COMMITTED):
--  - Every function that changes a couple locks the couple's row FIRST
--    (select ... for update), then reads or changes its members. Joining,
--    leaving and a new code for the same couple therefore run one after the
--    other, and each one sees the result of the one before it:
--      * join vs new code: the old code stops matching once the new one is
--        committed; a couple that just became full gets no new code;
--      * join vs leave: either the join comes first (the person who stays is
--        the new partner) or the leave does (the code no longer exists);
--      * leave vs leave: the second one sees the first, so an empty couple
--        is always removed (never left behind with a working code).
--  - One pairing attempt at a time per person (advisory lock).
--  - A person is in at most one couple (unique couple_members.user_id); a
--    simultaneous create + join by the same person answers already_paired.
--  - Codes are unique (unique index). Two transactions picking the same new
--    code at the same moment (about 1 in a billion) just pick again.
--
-- pairing_attempts is only read and written by these functions (RLS on, no
-- policies, no table access for the app). Rows older than a day are removed
-- on the person's next attempt; the account's rows go with the account.
--
-- Needs: 0014 (privileges). Safe to run more than once.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Secure code generator (same alphabet, no 0/O/1/I)
-- ---------------------------------------------------------------------
create or replace function public.generate_invite_code()
returns text language plpgsql volatile set search_path = public as $$
declare
  alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  b bytea;
  code text;
begin
  loop
    -- Bytes 0-5 of a version-4 UUID are fully random (secure generator);
    -- 256 is a multiple of 32, so every letter is equally likely.
    b := uuid_send(gen_random_uuid());
    code := '';
    for i in 0..5 loop
      code := code || substr(alphabet, 1 + (get_byte(b, i) % 32), 1);
    end loop;
    exit when not exists (select 1 from public.couples where invite_code = code);
  end loop;
  return code;
end;
$$;
revoke all on function public.generate_invite_code() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 2. Expiry (existing codes get 24 hours from now)
-- ---------------------------------------------------------------------
alter table public.couples add column if not exists invite_expires_at timestamptz;
update public.couples set invite_expires_at = now() + interval '24 hours' where invite_expires_at is null;
alter table public.couples alter column invite_expires_at set default (now() + interval '24 hours');
alter table public.couples alter column invite_expires_at set not null;

-- ---------------------------------------------------------------------
-- 3. Attempt log (server only)
-- ---------------------------------------------------------------------
create table if not exists public.pairing_attempts (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references auth.users(id) on delete cascade,
  attempted_at timestamptz not null default now(),
  success      boolean not null
);
create index if not exists pairing_attempts_user_time on public.pairing_attempts (user_id, attempted_at desc);
alter table public.pairing_attempts enable row level security;
revoke all on table public.pairing_attempts from anon, authenticated;

-- ---------------------------------------------------------------------
-- 4. Helpers (internal only)
-- ---------------------------------------------------------------------
-- Is this a signed-in Email / Google account (not anonymous)?
create or replace function public.is_full_account(p_user uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from auth.users where id = p_user and not coalesce(is_anonymous, false));
$$;
revoke all on function public.is_full_account(uuid) from public, anon, authenticated;

-- A new code + 24 hours for a couple whose row the caller has locked.
-- Retries if another transaction took the same code at the same moment.
create or replace function public.renew_invite_code(p_couple uuid)
returns public.couples language plpgsql security definer set search_path = public as $$
declare r public.couples;
begin
  for i in 1..5 loop
    begin
      update public.couples
         set invite_code = public.generate_invite_code(),
             invite_expires_at = now() + interval '24 hours'
       where id = p_couple
      returning * into r;
      return r;
    exception when unique_violation then
      null; -- same code chosen elsewhere just now: pick again
    end;
  end loop;
  raise exception 'Could not make a new code. Please try again.';
end;
$$;
revoke all on function public.renew_invite_code(uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- 5. Create a couple (as schema.sql, plus: no anonymous accounts, and a
--    retry if the new code was taken at the same moment)
-- ---------------------------------------------------------------------
create or replace function public.create_couple()
returns public.couples language plpgsql security definer set search_path = public as $$
declare c public.couples;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_full_account(auth.uid()) then
    raise exception 'Please sign in with Email or Google to pair.';
  end if;
  if exists (select 1 from public.couple_members where user_id = auth.uid()) then
    raise exception 'You are already in a couple. Unpair first in Settings.';
  end if;
  for i in 1..5 loop
    begin
      insert into public.couples (invite_code, created_by)
      values (public.generate_invite_code(), auth.uid()) returning * into c;
      exit;
    exception when unique_violation then
      if i = 5 then raise exception 'Could not make a code. Please try again.'; end if;
    end;
  end loop;
  insert into public.couple_members (couple_id, user_id) values (c.id, auth.uid());
  return c;
end;
$$;
revoke all on function public.create_couple() from public, anon;
grant execute on function public.create_couple() to authenticated;

-- ---------------------------------------------------------------------
-- 6. Join with a code: returns a status (never raises for a wrong code)
--    { "status": "ok", "couple": {...} }
--    { "status": "invalid", "attempts_left": n }
--    { "status": "rate_limited", "retry_after_seconds": n }
--    { "status": "already_paired" }
-- ---------------------------------------------------------------------
create or replace function public.pair_with_code(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  me uuid := auth.uid();
  code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  c public.couples;
  recent_n int;
  recent_oldest timestamptz;
  day_n int;
  day_oldest timestamptz;
  wait_s int;
begin
  if me is null then raise exception 'Not signed in'; end if;
  if not public.is_full_account(me) then
    raise exception 'Please sign in with Email or Google to pair.';
  end if;
  -- One attempt at a time per person (no burst around the limit).
  perform pg_advisory_xact_lock(hashtext('bond-pairing:' || me::text));

  if exists (select 1 from public.couple_members where user_id = me) then
    return jsonb_build_object('status', 'already_paired');
  end if;

  delete from public.pairing_attempts where user_id = me and attempted_at < now() - interval '1 day';
  select count(*), min(attempted_at) into recent_n, recent_oldest
    from public.pairing_attempts
   where user_id = me and not success and attempted_at > now() - interval '15 minutes';
  select count(*), min(attempted_at) into day_n, day_oldest
    from public.pairing_attempts
   where user_id = me and not success and attempted_at > now() - interval '1 day';
  if day_n >= 20 or recent_n >= 5 then
    wait_s := greatest(
      case when day_n >= 20 then ceil(extract(epoch from day_oldest + interval '1 day' - now())) else 0 end,
      case when recent_n >= 5 then ceil(extract(epoch from recent_oldest + interval '15 minutes' - now())) else 0 end,
      1)::int;
    return jsonb_build_object('status', 'rate_limited', 'retry_after_seconds', wait_s);
  end if;

  -- Locks the couple's row: a new code, a leave or another join for this
  -- couple waits for us (and we for them), and the checks below are made
  -- after any of them committed. A code replaced meanwhile no longer matches.
  select * into c from public.couples where invite_code = code for update;
  if c.id is null
     or c.invite_expires_at <= now()
     or (select count(*) from public.couple_members where couple_id = c.id) >= 2 then
    insert into public.pairing_attempts (user_id, success) values (me, false);
    return jsonb_build_object('status', 'invalid',
      'attempts_left', greatest(0, least(5 - (recent_n + 1), 20 - (day_n + 1))));
  end if;

  begin
    insert into public.couple_members (couple_id, user_id) values (c.id, me);
  exception when unique_violation then
    -- This person created or joined another couple at the same moment.
    return jsonb_build_object('status', 'already_paired');
  end;
  insert into public.pairing_attempts (user_id, success) values (me, true);
  return jsonb_build_object('status', 'ok', 'couple', to_jsonb(c));
end;
$$;
revoke all on function public.pair_with_code(text) from public, anon;
grant execute on function public.pair_with_code(text) to authenticated;

-- The old join (raises, so its tries could not be counted): retired.
create or replace function public.join_couple(p_code text)
returns public.couples language plpgsql security definer set search_path = public as $$
begin
  raise exception 'Please update Bond to the newest version to pair.';
end;
$$;
revoke all on function public.join_couple(text) from public, anon;
grant execute on function public.join_couple(text) to authenticated;

-- ---------------------------------------------------------------------
-- 7. New code for the person waiting (ends the old one)
-- ---------------------------------------------------------------------
create or replace function public.refresh_invite_code()
returns public.couples language plpgsql security definer set search_path = public as $$
declare
  c uuid := public.my_couple_id();
  locked uuid;
begin
  if auth.uid() is null then raise exception 'Not signed in'; end if;
  if not public.is_full_account(auth.uid()) then
    raise exception 'Please sign in with Email or Google to pair.';
  end if;
  if c is null then raise exception 'You are not waiting for a partner.'; end if;
  -- Lock first, then check: a join that committed meanwhile is seen.
  select id into locked from public.couples where id = c for update;
  if locked is null then raise exception 'You are not waiting for a partner.'; end if;
  if not exists (select 1 from public.couple_members where couple_id = c and user_id = auth.uid()) then
    raise exception 'You are not waiting for a partner.';
  end if;
  if (select count(*) from public.couple_members where couple_id = c) >= 2 then
    raise exception 'You are already paired.';
  end if;
  return public.renew_invite_code(c);
end;
$$;
revoke all on function public.refresh_invite_code() from public, anon;
grant execute on function public.refresh_invite_code() to authenticated;

-- ---------------------------------------------------------------------
-- 8. Leaving (as schema.sql, plus: the couple's row is locked first, and
--    the person who stays gets a fresh code with a new 24 hours)
-- ---------------------------------------------------------------------
create or replace function public.leave_couple()
returns void language plpgsql security definer set search_path = public as $$
declare
  c uuid := public.my_couple_id();
  locked uuid;
begin
  if c is null then return; end if;
  select id into locked from public.couples where id = c for update;
  if locked is null then return; end if;                     -- removed meanwhile
  if not exists (select 1 from public.couple_members where couple_id = c and user_id = auth.uid()) then
    return;                                                  -- already left meanwhile
  end if;
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
    perform public.renew_invite_code(c);
  end if;
end;
$$;
revoke all on function public.leave_couple() from public, anon;
grant execute on function public.leave_couple() to authenticated;
