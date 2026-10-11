-- =====================================================================
-- 0006: Reject unauthenticated callers in five SECURITY DEFINER RPCs
--
-- SECURITY FIX
-- These functions run with the owner's rights (they bypass RLS). Their
-- identity checks compare a row's user id with auth.uid(), for example
-- `if r.target_id <> auth.uid() then raise ...`. When the caller is not
-- signed in, auth.uid() is NULL and `x <> NULL` is NULL (not TRUE), so
-- the RAISE never fires. A caller holding only the public anon key and a
-- known row id could have answered or withdrawn a request (including
-- approving an UNPAIR or a location-off request) or turned off a control.
--
-- The fix: the FIRST statement of each function rejects a NULL auth.uid(),
-- before any lookup, lock or change. Everything after that line is copied
-- byte-for-byte from the current definitions (supabase/schema.sql and
-- supabase/migrations/0001_approval_requests.sql): same signatures, return
-- types, SECURITY DEFINER + search_path, FOR UPDATE row locks, status
-- transitions, error messages and activity logging. Signed-in callers see
-- no change. CREATE OR REPLACE with an identical signature keeps each
-- function's existing privileges (no DROP is used).
--
-- PERMISSIONS (see the end of this file)
-- Only PUBLIC and anon lose EXECUTE. No `authenticated` grant is removed;
-- the two functions the app uses (respond_to_approval, cancel_approval)
-- get their existing `authenticated` grant re-stated, so the app's
-- approval flow keeps working.
--
-- SAFETY: no tables, rows, RLS policies or other functions are changed.
-- Safe to run more than once. The SQL Editor runs it as one transaction:
-- if any statement fails, nothing is applied.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Control requests and controls (old App Protection; the app no longer
--    calls these). Source: supabase/schema.sql
-- ---------------------------------------------------------------------
create or replace function public.respond_to_request(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $$
declare r public.control_requests;
begin
  -- 0006: refuse callers who are not signed in (auth.uid() would be NULL).
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

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

create or replace function public.cancel_request(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare r public.control_requests;
begin
  -- 0006: refuse callers who are not signed in (auth.uid() would be NULL).
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into r from public.control_requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> auth.uid() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then return; end if;
  update public.control_requests set status = 'cancelled', responded_at = now() where id = r.id;
  perform public.log_activity(r.couple_id, auth.uid(), r.target_id, 'request_cancelled',
    public.display_name_of(auth.uid()) || ' withdrew the request for "' || r.label || '"');
end;
$$;

create or replace function public.revoke_control(p_control_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare a public.active_controls;
begin
  -- 0006: refuse callers who are not signed in (auth.uid() would be NULL).
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

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

-- ---------------------------------------------------------------------
-- 2. Approval requests (USED BY THE APP to approve, decline or withdraw
--    unpair and location-off requests). Source: 0001_approval_requests.sql
-- ---------------------------------------------------------------------
create or replace function public.respond_to_approval(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $fn$
declare r public.approval_requests;
begin
  -- 0006: refuse callers who are not signed in (auth.uid() would be NULL).
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into r from public.approval_requests where id = p_request_id for update;
  if r.id is null then raise exception 'Request not found.'; end if;
  if r.target_id <> auth.uid() then raise exception 'Only your partner can answer this request.'; end if;
  if r.status <> 'pending' then raise exception 'This request was already answered.'; end if;

  if now() > r.expires_at then
    update public.approval_requests set status = 'expired', resolved_at = now() where id = r.id;
    raise exception 'This request has expired.';
  end if;

  if not p_accept then
    update public.approval_requests set status = 'declined', resolved_at = now() where id = r.id;
    perform public.log_activity(r.couple_id, auth.uid(), r.requester_id, 'approval_declined',
      public.display_name_of(auth.uid()) || ' declined the request');
    return;
  end if;

  update public.approval_requests set status = 'approved', resolved_at = now() where id = r.id;

  if r.action = 'location_off' then
    update public.privacy_settings set share_location = false where user_id = r.requester_id;
    perform public.log_activity(r.couple_id, auth.uid(), r.requester_id, 'approval_approved',
      public.display_name_of(auth.uid()) || ' approved turning off '
      || public.display_name_of(r.requester_id) || '''s location sharing');

  elsif r.action = 'unpair' then
    -- Dissolve the whole couple: turn off every control, cancel pending
    -- requests on both sides, remove both members, remove the couple.
    update public.active_controls set status = 'revoked', revoked_at = now(), revoked_by = auth.uid()
      where couple_id = r.couple_id and status = 'active';
    update public.control_requests set status = 'cancelled', responded_at = now()
      where couple_id = r.couple_id and status = 'pending';
    update public.approval_requests set status = 'cancelled', resolved_at = now()
      where couple_id = r.couple_id and status = 'pending' and id <> r.id;
    perform public.log_activity(r.couple_id, auth.uid(), null, 'unpaired',
      'You are no longer paired. All controls were turned off.');
    delete from public.couple_members where couple_id = r.couple_id;
    delete from public.couples where id = r.couple_id;
  end if;
end;
$fn$;

create or replace function public.cancel_approval(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare r public.approval_requests;
begin
  -- 0006: refuse callers who are not signed in (auth.uid() would be NULL).
  if auth.uid() is null then raise exception 'Not authenticated'; end if;

  select * into r from public.approval_requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> auth.uid() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then return; end if;
  update public.approval_requests set status = 'cancelled', resolved_at = now() where id = r.id;
  perform public.log_activity(r.couple_id, auth.uid(), r.target_id, 'approval_cancelled',
    public.display_name_of(auth.uid()) || ' withdrew their request');
end;
$fn$;

-- ---------------------------------------------------------------------
-- 3. Permissions: callers who are not signed in may not execute these.
--    (PUBLIC is Postgres's default grant; anon is Supabase's not-signed-in
--    role.) `authenticated` is unchanged.
-- ---------------------------------------------------------------------
revoke execute on function public.respond_to_request(uuid, boolean) from public, anon;
revoke execute on function public.cancel_request(uuid)              from public, anon;
revoke execute on function public.revoke_control(uuid)              from public, anon;
revoke execute on function public.respond_to_approval(uuid, boolean) from public, anon;
revoke execute on function public.cancel_approval(uuid)             from public, anon;

-- The app calls these two as a signed-in user. Re-stating the grant from
-- 0001 guarantees the revoke above can never remove the app's access,
-- even if the live database only had it through PUBLIC. (No-op if present.)
grant execute on function public.respond_to_approval(uuid, boolean) to authenticated;
grant execute on function public.cancel_approval(uuid)             to authenticated;
