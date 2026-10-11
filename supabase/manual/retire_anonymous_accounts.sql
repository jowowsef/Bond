-- =====================================================================
-- ONE-TIME: retire the old anonymous test accounts (NOT a migration)
-- =====================================================================
--
-- Run each STEP separately in the Supabase SQL editor, in order, and check
-- its result before the next one. Nothing here touches Email / Google
-- accounts: STEP 3 stops (and changes nothing) unless the numbers match,
-- and it only deletes after a confirmation you type yourself (see STEP 3;
-- it is not in this file, so running the whole file deletes nothing).
--
-- Before STEP 3:
--   * Authentication -> Sign In / Providers -> "Allow anonymous sign-ins" OFF
--     (so no new anonymous account appears while cleaning up).
--   * Storage -> avatars: delete the folders listed by STEP 2c.
--
-- What STEP 3 removes (ON DELETE CASCADE from auth.users): each anonymous
-- account's profile, sharing settings, location, battery, current app,
-- screen time, app usage, installed apps, device permissions, push tokens,
-- alerts, requests and memberships, plus every couple linked to those
-- accounts (with its approvals, controls, activity and calendar). In OTHER
-- couples (one an anonymous account left earlier), requests made by or to
-- it are deleted and its name in the history is set to empty (STEP 1b
-- counts these; STEP 2 backs them up). Sign-in sessions go with the account.
--
-- Recovery: STEP 2 copies all of it into the private schema
-- bond_backup_20261011 (no app access). Anonymous accounts have no email
-- or password, so a deleted account can never be signed into again; the
-- copy is only for the data. Drop it after 7 days (STEP 5): it contains
-- location history.
-- =====================================================================


-- =====================================================================
-- STEP 1. Preview (read only). Expect: anonymous = 8, regular_affected = 0.
-- =====================================================================
with anon as (select id from auth.users where is_anonymous),
     hit as (select couple_id as id from public.couple_members where user_id in (select id from anon)
             union select id from public.couples where created_by in (select id from anon))
select
  (select count(*) from anon)                                         as anonymous,
  (select count(*) from hit)                                          as couples_affected,
  (select count(*) from public.couple_members m join auth.users u on u.id = m.user_id
    where m.couple_id in (select id from hit) and not u.is_anonymous) as regular_affected,
  (select count(*) from auth.users where not is_anonymous)            as regular_accounts;

-- 1b. Rows in OTHER couples that name an anonymous account (for example an
-- old couple it left). STEP 3 deletes the request rows and empties the
-- names in the history rows; STEP 2 backs all of them up. Expect zeros,
-- or small numbers you recognise.
with anon as (select id from auth.users where is_anonymous),
     hit as (select couple_id as id from public.couple_members where user_id in (select id from anon)
             union select id from public.couples where created_by in (select id from anon))
select
  (select count(*) from public.approval_requests where couple_id not in (select id from hit)
     and (requester_id in (select id from anon) or target_id in (select id from anon)))  as other_approval_requests_deleted,
  (select count(*) from public.control_requests where couple_id not in (select id from hit)
     and (requester_id in (select id from anon) or target_id in (select id from anon)))  as other_control_requests_deleted,
  (select count(*) from public.active_controls where couple_id not in (select id from hit)
     and (owner_id in (select id from anon) or requested_by in (select id from anon)
          or approved_by in (select id from anon) or revoked_by in (select id from anon))) as other_controls_changed,
  (select count(*) from public.activity_logs where couple_id not in (select id from hit)
     and (actor_id in (select id from anon) or subject_id in (select id from anon)))     as other_history_names_emptied;


-- =====================================================================
-- STEP 2. Backup (copies only; deletes nothing). Run as one block.
-- All or nothing: if anything fails, nothing is kept and it can simply be
-- run again. If it says the backup already exists, it was already made
-- (check 2b); to make a new one, first run: drop schema bond_backup_20261011 cascade;
-- =====================================================================
begin;
do $$
begin
  if to_regclass('bond_backup_20261011.anon_ids') is not null then
    raise exception 'The backup already exists (see 2b). Nothing was changed.';
  end if;
end $$;
create schema if not exists bond_backup_20261011;
revoke all on schema bond_backup_20261011 from public, anon, authenticated, service_role;

create table bond_backup_20261011.anon_ids as
  select id from auth.users where is_anonymous;
create table bond_backup_20261011.affected_couples as
  select couple_id as id from public.couple_members where user_id in (select id from bond_backup_20261011.anon_ids)
  union select id from public.couples where created_by in (select id from bond_backup_20261011.anon_ids);
create table bond_backup_20261011.meta as
  select now() as taken_at,
         (select count(*) from auth.users where not is_anonymous) as regular_accounts_before;
-- Whole account rows, so an account could be put back with its data. (Its
-- sign-in sessions are not copied: the phones sign in again anyway.)
create table bond_backup_20261011.auth_users as
  select * from auth.users where id in (select id from bond_backup_20261011.anon_ids);
do $$
begin
  if to_regclass('auth.identities') is not null then   -- anonymous accounts usually have none
    create table bond_backup_20261011.auth_identities as
      select * from auth.identities where user_id in (select id from bond_backup_20261011.anon_ids);
  end if;
end $$;

-- Every table that exists (some come from later migrations).
-- {A} = the anonymous accounts, {C} = their couples. Rows in other couples
-- that name an anonymous account are included (STEP 3 deletes or changes them).
do $$
declare
  t record;
  a constant text := '(select id from bond_backup_20261011.anon_ids)';
  c constant text := '(select id from bond_backup_20261011.affected_couples)';
begin
  for t in select * from (values
      ('profiles',          'id in {A}'),
      ('privacy_settings',  'user_id in {A}'),
      ('presence',          'user_id in {A}'),
      ('battery_status',    'user_id in {A}'),
      ('device_permissions','user_id in {A}'),
      ('screen_time_daily', 'user_id in {A}'),
      ('app_usage_daily',   'user_id in {A}'),
      ('installed_apps',    'user_id in {A}'),
      ('locations',         'user_id in {A}'),
      ('current_app',       'user_id in {A}'),
      ('push_tokens',       'user_id in {A}'),
      ('battery_alert_state','user_id in {A}'),
      ('pairing_attempts',  'user_id in {A}'),
      ('partner_alerts',    'recipient_id in {A} or subject_id in {A}'),
      ('couples',           'id in {C}'),
      ('couple_members',    'couple_id in {C}'),
      ('approval_requests', 'couple_id in {C} or requester_id in {A} or target_id in {A}'),
      ('control_requests',  'couple_id in {C} or requester_id in {A} or target_id in {A}'),
      ('active_controls',   'couple_id in {C} or owner_id in {A} or requested_by in {A} or approved_by in {A} or revoked_by in {A}'),
      ('activity_logs',     'couple_id in {C} or actor_id in {A} or subject_id in {A}'),
      ('calendar_events',   'couple_id in {C} or created_by in {A} or updated_by in {A}'),
      ('calendar_event_exceptions', 'couple_id in {C} or created_by in {A}'),
      ('calendar_reminders_sent', 'event_id in (select id from public.calendar_events where couple_id in {C})')
    ) as v(name, cond)
  loop
    if to_regclass('public.' || t.name) is not null then
      execute format('create table bond_backup_20261011.%I as select * from public.%I where %s',
                     t.name, t.name, replace(replace(t.cond, '{A}', a), '{C}', c));
    end if;
  end loop;
end $$;
-- No access for the app's roles, whatever default privileges exist.
revoke all on all tables in schema bond_backup_20261011 from public, anon, authenticated, service_role;
commit;

-- 2b. Check the copy: one row per table with its count.
select 'anon_ids' as copied, count(*) from bond_backup_20261011.anon_ids
union all select 'affected_couples', count(*) from bond_backup_20261011.affected_couples
union all select 'auth_users', count(*) from bond_backup_20261011.auth_users
union all select 'profiles', count(*) from bond_backup_20261011.profiles
union all select 'couple_members', count(*) from bond_backup_20261011.couple_members;

-- 2c. Avatar folders to delete by hand in Storage -> avatars (SQL can't).
-- The photos themselves are not copied by STEP 2; download them first if
-- you want to keep any.
select distinct (storage.foldername(name))[1] as avatar_folder
  from storage.objects
 where bucket_id = 'avatars'
   and (storage.foldername(name))[1] in (select id::text from bond_backup_20261011.anon_ids);


-- =====================================================================
-- STEP 3. Delete (one transaction; stops and changes nothing if any check
-- fails). Run the whole block at once.
--
-- It needs a confirmation that is deliberately NOT in this file (running
-- the whole file therefore deletes nothing). Copy this block, and right
-- after "begin;" add this line yourself:
--
--     set local bond.confirm_delete = 'retire-8-anonymous';
--
-- "set local" lasts only until this transaction ends (commit or error).
-- =====================================================================
begin;
do $$
declare
  n_anon int;
  n_regular_hit int;
begin
  if coalesce(current_setting('bond.confirm_delete', true), '') <> 'retire-8-anonymous' then
    raise exception 'STOP: not confirmed, nothing deleted. Right after "begin;" add: set local bond.confirm_delete = ''retire-8-anonymous'';';
  end if;
  if to_regclass('bond_backup_20261011.anon_ids') is null then
    raise exception 'STOP: run STEP 2 (backup) first.';
  end if;
  select count(*) into n_anon from auth.users where is_anonymous;
  if n_anon <> 8 then
    raise exception 'STOP: expected 8 anonymous accounts, found %.', n_anon;
  end if;
  if exists (select id from auth.users where is_anonymous
             except select id from bond_backup_20261011.anon_ids) then
    raise exception 'STOP: an anonymous account is missing from the backup (run STEP 2 again).';
  end if;
  select count(*) into n_regular_hit
    from public.couple_members m join auth.users u on u.id = m.user_id
   where m.couple_id in (select id from bond_backup_20261011.affected_couples) and not u.is_anonymous;
  if n_regular_hit <> 0 then
    raise exception 'STOP: % Email/Google account(s) are in an affected couple.', n_regular_hit;
  end if;
  -- Calendar (0012): its guard keeps "created by" on every update, so an
  -- event in ANOTHER couple made by one of these accounts would block the
  -- delete. (Normally impossible: leaving a couple deletes its calendar.)
  if to_regclass('public.calendar_events') is not null then
    execute 'select count(*) from public.calendar_events
              where couple_id not in (select id from bond_backup_20261011.affected_couples)
                and (created_by in (select id from bond_backup_20261011.anon_ids)
                     or updated_by in (select id from bond_backup_20261011.anon_ids))' into n_regular_hit;
    if n_regular_hit <> 0 then
      raise exception 'STOP: % calendar event(s) in other couples were made by these accounts; ask before going on.', n_regular_hit;
    end if;
  end if;
end $$;

-- No "partner unpaired" push can reach these phones while cleaning up.
delete from public.push_tokens where user_id in (select id from bond_backup_20261011.anon_ids);
-- Their couples' calendars first (backed up in STEP 2), so the account
-- delete below never has to change a calendar row.
do $$
begin
  if to_regclass('public.calendar_events') is not null then
    execute 'delete from public.calendar_events where couple_id in (select id from bond_backup_20261011.affected_couples)';
  end if;
end $$;
-- The accounts (everything of theirs follows by ON DELETE CASCADE).
delete from auth.users where is_anonymous and id in (select id from bond_backup_20261011.anon_ids);
-- Couples linked to them that are now empty.
delete from public.couples where id in (select id from bond_backup_20261011.affected_couples);

-- Final checks before committing.
do $$
begin
  if exists (select 1 from auth.users where is_anonymous) then
    raise exception 'STOP: anonymous accounts remain; nothing was changed.';
  end if;
  if (select count(*) from auth.users where not is_anonymous)
     <> (select regular_accounts_before from bond_backup_20261011.meta) then
    raise exception 'STOP: the number of Email/Google accounts changed; nothing was changed.';
  end if;
  -- The confirmation is used up (also if it was set for the whole session).
  perform set_config('bond.confirm_delete', '', false);
end $$;
commit;


-- =====================================================================
-- STEP 4. Verify (read only). Expect: 0, regular_accounts unchanged, 0, 0.
-- =====================================================================
select
  (select count(*) from auth.users where is_anonymous) as anonymous_left,
  (select count(*) from auth.users where not is_anonymous) as regular_accounts,
  (select regular_accounts_before from bond_backup_20261011.meta) as regular_before,
  (select count(*) from public.couples where id in (select id from bond_backup_20261011.affected_couples)) as old_couples_left,
  (select count(*) from public.profiles where id in (select id from bond_backup_20261011.anon_ids)) as old_profiles_left;


-- =====================================================================
-- STEP 5. After 7 days (or once everything works): remove the copy.
-- =====================================================================
-- drop schema bond_backup_20261011 cascade;
