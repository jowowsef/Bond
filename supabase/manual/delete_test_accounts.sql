-- =====================================================================
-- ONE-TIME: permanently delete the 2 Bond test accounts (fresh start)
-- (NO backup; NOT a migration; run by hand in the Supabase SQL editor)
-- =====================================================================
--
-- Deletes the only 2 accounts in this Bond project (Email / Google sign-in)
-- and everything of theirs in Bond's database: profile, sharing settings,
-- location, battery, current app, screen time, app usage, installed apps,
-- device permissions, push tokens, alerts, pairing attempts, sign-in
-- sessions, the Google / email sign-in link (auth.identities), and their
-- couple (members, requests, controls, history, calendar).
--
-- It does NOT touch anything outside this Supabase project: the Google
-- accounts themselves, Gmail, Google Cloud, Firebase and Expo are unchanged.
-- (Optional: remove "Bond" from each Google account's third-party
-- connections at myaccount.google.com/connections.)
--
-- Simpler alternative: on each phone, Settings > Delete account. That also
-- removes the profile photos. This script is for when the app can't be used.
--
-- How to run:
--   PART 1  Preview (read only). Check the 2 accounts and the numbers, and
--           note the confirmation code it shows.
--   Storage -> avatars: delete the folders PART 1c lists (SQL can't delete
--           Storage files; leftover files would just be unused).
--   PART 2  Copy the block. Right after "begin;" add this line yourself,
--           with the code from PART 1:
--               set local bond.confirm_delete = 'delete-2-test-accounts-<code>';
--           Without it, if the accounts changed since the preview, or if any
--           check fails, the whole block is rolled back: nothing deleted.
--   PART 3  Verify (read only).
--
-- Running this whole file at once deletes nothing (no confirmation in it).
-- =====================================================================


-- =====================================================================
-- PART 1. Preview (read only)
-- =====================================================================
-- 1a. The accounts that would be deleted (expect exactly 2 rows).
select u.id, u.email, u.created_at, u.last_sign_in_at,
       (select string_agg(i.provider, ', ' order by i.provider) from auth.identities i where i.user_id = u.id) as sign_in_with
  from auth.users u
 order by u.created_at;

-- 1b. Checks (expect: 2, 0, 0 or 1, and the code).
select
  (select count(*) from auth.users)                       as accounts_total,
  (select count(*) from auth.users where is_anonymous)    as anonymous_accounts,
  (select count(*) from public.couples)                   as couples,
  (select count(*) from public.couple_members)            as couple_members,
  'delete-2-test-accounts-' || left(md5((select string_agg(id::text, ',' order by id) from auth.users)), 12) as confirmation;

-- 1c. Profile photo folders (delete by hand in Storage -> avatars).
select (storage.foldername(name))[1] as avatar_folder, count(*) as files
  from storage.objects
 where bucket_id = 'avatars'
 group by 1;


-- =====================================================================
-- PART 2. Delete (one transaction). Add the confirmation line yourself
-- right after "begin;" (see the top of this file).
-- =====================================================================
begin;

-- The targets, fixed for this transaction: every account (there must be exactly 2).
create temporary table bond_targets on commit drop as
  select id from auth.users;
create temporary table bond_target_couples on commit drop as
  select couple_id as id from public.couple_members where user_id in (select id from bond_targets)
  union select id from public.couples where created_by in (select id from bond_targets);

do $$
declare
  n bigint;
  expected text;
begin
  -- 1. Confirmation typed by hand, tied to these exact 2 accounts.
  select 'delete-2-test-accounts-' || left(md5(string_agg(id::text, ',' order by id)), 12)
    into expected from bond_targets;
  if coalesce(current_setting('bond.confirm_delete', true), '') is distinct from expected then
    raise exception 'STOP: not confirmed for these accounts, nothing deleted. Run PART 1 and add right after "begin;": set local bond.confirm_delete = ''<confirmation from PART 1>'';';
  end if;
  -- 2. Exactly 2 accounts exist, none anonymous (nobody else signed up meanwhile).
  select count(*) into n from bond_targets;
  if n <> 2 then raise exception 'STOP: expected exactly 2 accounts, found %.', n; end if;
  select count(*) into n from auth.users where is_anonymous;
  if n <> 0 then raise exception 'STOP: % anonymous account(s) exist; this script is only for the 2 test accounts.', n; end if;
end $$;

-- No push can reach the phones while deleting.
delete from public.push_tokens where user_id in (select id from bond_targets);
-- Their couples' calendars first (the calendar guard keeps "created by" on updates).
do $$
begin
  if to_regclass('public.calendar_events') is not null then
    execute 'delete from public.calendar_events where couple_id in (select id from bond_target_couples)';
  end if;
end $$;
-- The accounts (everything of theirs follows by ON DELETE CASCADE,
-- including auth.identities and auth.sessions).
delete from auth.users where id in (select id from bond_targets);
-- Their couples, if any are left.
delete from public.couples where id in (select id from bond_target_couples);

-- Final checks: anything unexpected rolls the whole block back.
do $$
declare
  n bigint;
begin
  select count(*) into n from auth.users;
  if n <> 0 then raise exception 'STOP: % account(s) still exist; nothing was changed.', n; end if;
  select count(*) into n from public.couples where id in (select id from bond_target_couples);
  if n <> 0 then raise exception 'STOP: % couple(s) were not removed; nothing was changed.', n; end if;
  -- The confirmation is used up.
  perform set_config('bond.confirm_delete', '', false);
end $$;

commit;


-- =====================================================================
-- PART 3. Verify (read only). Expect all zeros (avatar_files: 0 once the
-- Storage folders are deleted).
-- =====================================================================
select
  (select count(*) from auth.users)               as accounts,
  (select count(*) from auth.identities)          as sign_in_links,
  (select count(*) from public.profiles)          as profiles,
  (select count(*) from public.couples)           as couples,
  (select count(*) from public.couple_members)    as couple_members,
  (select count(*) from public.privacy_settings)  as privacy_rows,
  (select count(*) from public.locations)         as locations,
  (select count(*) from public.push_tokens)       as push_tokens,
  (select count(*) from public.partner_alerts)    as alerts,
  (select count(*) from storage.objects where bucket_id = 'avatars') as avatar_files;
