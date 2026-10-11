-- =====================================================================
-- ONE-TIME: permanently delete the 8 old anonymous test accounts
-- (NO backup; NOT a migration; run by hand in the Supabase SQL editor)
-- =====================================================================
--
-- Deletes each anonymous account and everything of its own (profile,
-- sharing settings, location, battery, current app, screen time, app usage,
-- installed apps, device permissions, push tokens, alerts, pairing attempts,
-- sign-in sessions) plus its couples (members, requests, controls, history,
-- calendar). Email / Google accounts are never deleted.
--
-- How to run:
--   PART 1  Preview (read only). Check the 8 ids and the zeros, and note
--           the confirmation code it shows.
--   (optional) Storage -> avatars: delete the folders PART 1c lists (photos
--           are not removed by SQL; leftover files are just unused).
--   PART 2  Copy the block. Right after "begin;" add this line yourself,
--           with the code from PART 1:
--               set local bond.confirm_delete = 'delete-8-anonymous-<code>';
--           Without it, or if the accounts changed since the preview, or if
--           any check fails, the whole block is rolled back: nothing deleted.
--   PART 3  Verify (read only).
--
-- Running this whole file at once deletes nothing (no confirmation in it).
-- =====================================================================


-- =====================================================================
-- PART 1. Preview (read only)
-- =====================================================================
-- 1a. The exact accounts that would be deleted (expect 8 rows).
select id, created_at, last_sign_in_at
  from auth.users where is_anonymous
 order by id;

-- 1b. Checks (expect: 8, 0, 0, 0, 0, 0, 0) and the confirmation code.
with anon as (select id from auth.users where is_anonymous),
     hit as (select couple_id as id from public.couple_members where user_id in (select id from anon)
             union select id from public.couples where created_by in (select id from anon))
select
  (select count(*) from anon) as anonymous_accounts,
  (select count(*) from hit) as couples_to_delete,
  (select count(*) from public.couple_members m join auth.users u on u.id = m.user_id
    where m.couple_id in (select id from hit) and not u.is_anonymous) as regular_members_affected,
  (select count(*) from public.approval_requests where couple_id not in (select id from hit)
     and (requester_id in (select id from anon) or target_id in (select id from anon))) as other_approval_requests,
  (select count(*) from public.control_requests where couple_id not in (select id from hit)
     and (requester_id in (select id from anon) or target_id in (select id from anon))) as other_control_requests,
  (select count(*) from public.active_controls where couple_id not in (select id from hit)
     and (owner_id in (select id from anon) or requested_by in (select id from anon)
          or approved_by in (select id from anon) or revoked_by in (select id from anon))) as other_controls,
  (select count(*) from public.activity_logs where couple_id not in (select id from hit)
     and (actor_id in (select id from anon) or subject_id in (select id from anon))) as other_history,
  'delete-8-anonymous-' || left(md5((select string_agg(id::text, ',' order by id) from anon)), 12) as confirmation;

-- 1c. Avatar folders of these accounts (delete by hand in Storage -> avatars).
select distinct (storage.foldername(name))[1] as avatar_folder
  from storage.objects
 where bucket_id = 'avatars'
   and (storage.foldername(name))[1] in (select id::text from auth.users where is_anonymous);


-- =====================================================================
-- PART 2. Delete (one transaction). Add the confirmation line yourself
-- right after "begin;" (see the top of this file).
-- =====================================================================
begin;

-- The targets, fixed for this transaction.
create temporary table bond_targets on commit drop as
  select id from auth.users where is_anonymous;
create temporary table bond_target_couples on commit drop as
  select couple_id as id from public.couple_members where user_id in (select id from bond_targets)
  union select id from public.couples where created_by in (select id from bond_targets);
create temporary table bond_before on commit drop as
  select (select count(*) from auth.users where not is_anonymous) as regular_accounts,
         (select count(*) from public.couple_members m join auth.users u on u.id = m.user_id
           where not u.is_anonymous) as regular_memberships;

do $$
declare
  n bigint;
  expected text;
begin
  -- 1. Confirmation typed by hand, tied to these exact 8 accounts.
  select 'delete-8-anonymous-' || left(md5(string_agg(id::text, ',' order by id)), 12)
    into expected from bond_targets;
  if coalesce(current_setting('bond.confirm_delete', true), '') is distinct from expected then
    raise exception 'STOP: not confirmed for these accounts, nothing deleted. Run PART 1 and add right after "begin;": set local bond.confirm_delete = ''<confirmation from PART 1>'';';
  end if;
  -- 2. Exactly 8, all anonymous.
  select count(*) into n from bond_targets;
  if n <> 8 then raise exception 'STOP: expected 8 anonymous accounts, found %.', n; end if;
  -- 3. No Email / Google account in a couple that will be deleted.
  select count(*) into n from public.couple_members m join auth.users u on u.id = m.user_id
   where m.couple_id in (select id from bond_target_couples) and not u.is_anonymous;
  if n <> 0 then raise exception 'STOP: % Email/Google member(s) in the couples to delete.', n; end if;
  -- 4. Nothing in OTHER couples would be deleted or changed.
  select (select count(*) from public.approval_requests where couple_id not in (select id from bond_target_couples)
            and (requester_id in (select id from bond_targets) or target_id in (select id from bond_targets)))
       + (select count(*) from public.control_requests where couple_id not in (select id from bond_target_couples)
            and (requester_id in (select id from bond_targets) or target_id in (select id from bond_targets)))
       + (select count(*) from public.active_controls where couple_id not in (select id from bond_target_couples)
            and (owner_id in (select id from bond_targets) or requested_by in (select id from bond_targets)
                 or approved_by in (select id from bond_targets) or revoked_by in (select id from bond_targets)))
       + (select count(*) from public.activity_logs where couple_id not in (select id from bond_target_couples)
            and (actor_id in (select id from bond_targets) or subject_id in (select id from bond_targets)))
    into n;
  if n <> 0 then raise exception 'STOP: % row(s) in other couples name these accounts.', n; end if;
  -- 5. Calendar (0012, if installed): no event in another couple made by them.
  if to_regclass('public.calendar_events') is not null then
    execute 'select count(*) from public.calendar_events
              where couple_id not in (select id from bond_target_couples)
                and (created_by in (select id from bond_targets) or updated_by in (select id from bond_targets))' into n;
    if n <> 0 then raise exception 'STOP: % calendar event(s) in other couples were made by these accounts.', n; end if;
  end if;
end $$;

-- No push can reach the old phones while deleting.
delete from public.push_tokens where user_id in (select id from bond_targets);
-- Their couples' calendars first (the calendar guard keeps "created by" on updates).
do $$
begin
  if to_regclass('public.calendar_events') is not null then
    execute 'delete from public.calendar_events where couple_id in (select id from bond_target_couples)';
  end if;
end $$;
-- The accounts (everything of theirs follows by ON DELETE CASCADE).
delete from auth.users where id in (select id from bond_targets) and is_anonymous;
-- Their couples, now empty.
delete from public.couples where id in (select id from bond_target_couples);

-- Final checks: anything unexpected rolls the whole block back.
do $$
declare
  n bigint;
begin
  select count(*) into n from auth.users where id in (select id from bond_targets);
  if n <> 0 then raise exception 'STOP: % target account(s) still exist; nothing was changed.', n; end if;
  if (select count(*) from auth.users where not is_anonymous) <> (select regular_accounts from bond_before) then
    raise exception 'STOP: the number of Email/Google accounts changed; nothing was changed.';
  end if;
  if (select count(*) from public.couple_members m join auth.users u on u.id = m.user_id where not u.is_anonymous)
     <> (select regular_memberships from bond_before) then
    raise exception 'STOP: an Email/Google couple membership changed; nothing was changed.';
  end if;
  select count(*) into n from public.couples where id in (select id from bond_target_couples);
  if n <> 0 then raise exception 'STOP: % couple(s) were not removed; nothing was changed.', n; end if;
  -- The confirmation is used up.
  perform set_config('bond.confirm_delete', '', false);
end $$;

commit;


-- =====================================================================
-- PART 3. Verify (read only). Expect: 0, your Email/Google count, 0, 0.
-- =====================================================================
select
  (select count(*) from auth.users where is_anonymous) as anonymous_left,
  (select count(*) from auth.users where not is_anonymous) as email_google_accounts,
  (select count(*) from public.couples c where not exists (select 1 from public.couple_members m where m.couple_id = c.id)) as empty_couples,
  (select count(*) from public.profiles p where not exists (select 1 from auth.users u where u.id = p.id)) as orphan_profiles;
