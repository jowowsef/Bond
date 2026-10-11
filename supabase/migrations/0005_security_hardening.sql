-- =====================================================================
-- 0005: Security and privacy hardening (pre-launch audit, 2026-10-10)
--
-- Run AFTER 0001-0004, in the Supabase SQL Editor. Safe to run more than once.
-- Nothing here deletes or rewrites existing user data. It:
--   1. limits avatar uploads (size + image types) on the storage bucket
--   2. validates profile names and avatar paths on the server
--   3. makes battery and screen-time sharing OFF by default for NEW accounts
--      (existing people keep exactly the settings they have now)
--   4. turns off the old App Protection functions (no longer used by the app)
--   5. tidies old, already-delivered partner alerts after 30 days
--   6. adds delete_my_account(), so people can delete their account in Bond
--   7. adds account_deletion_ready(), a read-only check the app runs first
-- =====================================================================

-- 1. Avatar uploads: at most 5 MB, images only. Existing files are untouched.
update storage.buckets
   set file_size_limit = 5242880,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']
 where id = 'avatars';

-- 2. Server-side checks on profile fields. NOT VALID = only new writes are
--    checked, so any existing row can never make this migration fail.
alter table public.profiles drop constraint if exists profiles_display_name_length;
alter table public.profiles
  add constraint profiles_display_name_length
  check (char_length(btrim(display_name)) between 1 and 40) not valid;

alter table public.profiles drop constraint if exists profiles_avatar_path_owned;
alter table public.profiles
  add constraint profiles_avatar_path_owned
  check (avatar_path is null
         or (avatar_path like id::text || '/%' and position('..' in avatar_path) = 0)) not valid;

-- 3. Privacy by default for NEW accounts only.
alter table public.privacy_settings alter column share_battery set default false;
alter table public.privacy_settings alter column share_screen_time set default false;

-- 4. Old App Protection / control functions: the app no longer calls them.
--    Revoking execute removes them as an attack surface; the tables and any
--    old rows stay as they are.
revoke execute on function public.request_control(uuid, text, text, text, text) from public, anon, authenticated;
revoke execute on function public.respond_to_request(uuid, boolean) from public, anon, authenticated;
revoke execute on function public.cancel_request(uuid) from public, anon, authenticated;
revoke execute on function public.revoke_control(uuid) from public, anon, authenticated;

-- 5. Same claim logic as 0003, plus: forget this person's alerts that were
--    delivered (or created) more than 30 days ago.
create or replace function public.claim_partner_alert(p_id uuid)
returns boolean language plpgsql security definer set search_path = public as $fn$
declare claimed boolean;
begin
  update public.partner_alerts
     set delivered_at = now(), delivered_via = 'app'
   where id = p_id and recipient_id = auth.uid() and delivered_at is null;
  claimed := found;
  delete from public.partner_alerts
   where recipient_id = auth.uid()
     and coalesce(delivered_at, created_at) < now() - interval '30 days';
  return claimed;
end;
$fn$;
-- Only signed-in users (the app calls this as the alert's recipient). The
-- grant is re-stated after the revoke so `authenticated` always keeps access.
revoke execute on function public.claim_partner_alert(uuid) from public, anon;
grant execute on function public.claim_partner_alert(uuid) to authenticated;

-- 6. Delete MY account and everything stored for it.
--    - Only ever acts on the caller (auth.uid()); takes no ids from the app.
--    - If the caller is paired, the couple is dissolved first (same result as
--      an approved unpair: shared history and open requests for that couple
--      are removed; the partner keeps their own account and data).
--    - Deleting the auth user removes every row that references it
--      (all tables use "on delete cascade").
--    - Profile photo FILES must be removed by the app first through the
--      Storage API (Supabase does not allow deleting them from SQL).
--    If anything fails, the whole function rolls back and nothing is deleted.
create or replace function public.delete_my_account()
returns void language plpgsql security definer set search_path = public as $fn$
declare
  me uuid := auth.uid();
  c uuid;
begin
  if me is null then raise exception 'Not signed in'; end if;
  select couple_id into c from public.couple_members where user_id = me;
  if c is not null then
    delete from public.couple_members where couple_id = c;
    delete from public.couples where id = c;
  end if;
  delete from auth.users where id = me;
  if not found then
    raise exception 'Account was not deleted';
  end if;
end;
$fn$;
revoke all on function public.delete_my_account() from public, anon;
grant execute on function public.delete_my_account() to authenticated;

-- 7. Read-only preflight, called by the app BEFORE it removes any photo.
--    Returns true only if nothing known would make delete_my_account() fail.
--    It is deliberately strict: when in doubt it returns false, and the app
--    then deletes nothing and says deletion isn't possible right now.
--    Checks (run as this function's owner, which is also the owner of
--    delete_my_account, because both are SECURITY DEFINER in this file):
--      a. the caller is signed in and their auth user exists;
--      b. the owner has DELETE permission on auth.users;
--      c. no foreign key in ANY schema references auth.users with an
--         ON DELETE action other than CASCADE or SET NULL (those would refuse
--         or could fail the delete);
--      d. no enabled, user-defined trigger on auth.users fires on DELETE
--         (such a trigger could raise an error and cancel the delete);
--      e. row-level security on auth.users can't hide the row from the owner:
--         not FORCED, and if enabled, the owner owns the table or may bypass RLS.
--    It changes nothing. Before this migration is applied the function does
--    not exist, so the app stops with "not available yet" and deletes nothing.
create or replace function public.account_deletion_ready()
returns boolean language plpgsql stable security definer set search_path = public as $fn$
begin
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  -- a. The caller's account exists.
  if not exists (select 1 from auth.users where id = auth.uid()) then return false; end if;

  -- b. The owner may delete accounts.
  if not has_table_privilege('auth.users', 'DELETE') then return false; end if;

  -- c. Foreign keys from any schema (c = cascade, n = set null are safe).
  if exists (
    select 1 from pg_catalog.pg_constraint
     where contype = 'f'
       and confrelid = 'auth.users'::regclass
       and confdeltype not in ('c', 'n')
  ) then return false; end if;

  -- d. Enabled, non-internal triggers that fire on DELETE (tgtype bit 8).
  if exists (
    select 1 from pg_catalog.pg_trigger
     where tgrelid = 'auth.users'::regclass
       and not tgisinternal
       and tgenabled <> 'D'
       and (tgtype & 8) = 8
  ) then return false; end if;

  -- e. Row-level security on auth.users.
  if exists (
    select 1 from pg_catalog.pg_class c
     where c.oid = 'auth.users'::regclass
       and c.relrowsecurity
       and (c.relforcerowsecurity
            or (c.relowner <> (select oid from pg_catalog.pg_roles where rolname = current_user)
                and not (select rolbypassrls from pg_catalog.pg_roles where rolname = current_user)))
  ) then return false; end if;

  return true;
end;
$fn$;
revoke all on function public.account_deletion_ready() from public, anon;
grant execute on function public.account_deletion_ready() to authenticated;
