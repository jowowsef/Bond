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
-- accounts (with its approvals, controls, activity and calendar). Names in
-- other people's history are set to empty, not deleted.
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


-- =====================================================================
-- STEP 2. Backup (copies only; deletes nothing). Run as one block.
-- =====================================================================
begin;
create schema if not exists bond_backup_20261011;
revoke all on schema bond_backup_20261011 from public, anon, authenticated;

create table bond_backup_20261011.anon_ids as
  select id from auth.users where is_anonymous;
create table bond_backup_20261011.affected_couples as
  select couple_id as id from public.couple_members where user_id in (select id from bond_backup_20261011.anon_ids)
  union select id from public.couples where created_by in (select id from bond_backup_20261011.anon_ids);
create table bond_backup_20261011.meta as
  select now() as taken_at,
         (select count(*) from auth.users where not is_anonymous) as regular_accounts_before;
create table bond_backup_20261011.auth_users as
  select id, created_at, last_sign_in_at, raw_user_meta_data
    from auth.users where id in (select id from bond_backup_20261011.anon_ids);

-- Every table that exists (some come from later migrations).
do $$
declare
  t record;
begin
  for t in select * from (values
      ('profiles',          'id in (select id from bond_backup_20261011.anon_ids)'),
      ('privacy_settings',  'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('presence',          'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('battery_status',    'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('device_permissions','user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('screen_time_daily', 'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('app_usage_daily',   'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('installed_apps',    'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('locations',         'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('current_app',       'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('push_tokens',       'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('battery_alert_state','user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('pairing_attempts',  'user_id in (select id from bond_backup_20261011.anon_ids)'),
      ('partner_alerts',    'recipient_id in (select id from bond_backup_20261011.anon_ids) or subject_id in (select id from bond_backup_20261011.anon_ids)'),
      ('couples',           'id in (select id from bond_backup_20261011.affected_couples)'),
      ('couple_members',    'couple_id in (select id from bond_backup_20261011.affected_couples)'),
      ('approval_requests', 'couple_id in (select id from bond_backup_20261011.affected_couples)'),
      ('control_requests',  'couple_id in (select id from bond_backup_20261011.affected_couples)'),
      ('active_controls',   'couple_id in (select id from bond_backup_20261011.affected_couples)'),
      ('activity_logs',     'couple_id in (select id from bond_backup_20261011.affected_couples)'),
      ('calendar_events',   'couple_id in (select id from bond_backup_20261011.affected_couples)'),
      ('calendar_event_exceptions', 'couple_id in (select id from bond_backup_20261011.affected_couples)')
    ) as v(name, cond)
  loop
    if to_regclass('public.' || t.name) is not null then
      execute format('create table bond_backup_20261011.%I as select * from public.%I where %s', t.name, t.name, t.cond);
    end if;
  end loop;
end $$;
commit;

-- 2b. Check the copy: one row per table with its count.
select 'anon_ids' as copied, count(*) from bond_backup_20261011.anon_ids
union all select 'affected_couples', count(*) from bond_backup_20261011.affected_couples
union all select 'profiles', count(*) from bond_backup_20261011.profiles
union all select 'couple_members', count(*) from bond_backup_20261011.couple_members;

-- 2c. Avatar folders to delete by hand in Storage -> avatars (SQL can't).
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
end $$;

-- No "partner unpaired" push can reach these phones while cleaning up.
delete from public.push_tokens where user_id in (select id from bond_backup_20261011.anon_ids);
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
