-- =====================================================================
-- MIGRATION 0001: mutual approval requests
-- =====================================================================
-- Run this in the Supabase SQL Editor AFTER schema.sql.
-- Safe to run more than once (IF NOT EXISTS / CREATE OR REPLACE /
-- DROP POLICY IF EXISTS).
--
-- WHAT THIS IS:
--   A reusable "one partner asks, the other approves" system for sensitive
--   shared actions. Right now it governs:
--     * 'unpair'       — dissolving the couple
--     * 'location_off' — turning OFF your own location sharing
--   Future sensitive actions are added as new `action` values plus a branch
--   in respond_to_approval() — no new tables needed.
--
-- RULES (enforced by RLS + the RPCs below):
--   * Only the two members of the couple can SEE a request.
--   * Only the TARGET (the partner who must consent) can approve/decline.
--   * The REQUESTER cannot approve their own request (they can cancel it).
--   * Nobody can write the table directly — only through the RPCs.
--   * The shared state changes ONLY after approval.
-- =====================================================================

create table if not exists public.approval_requests (
  id            uuid primary key default gen_random_uuid(),
  couple_id     uuid not null references public.couples(id) on delete cascade,
  requester_id  uuid not null references auth.users(id) on delete cascade,
  target_id     uuid not null references auth.users(id) on delete cascade,
  action        text not null check (action in ('unpair','location_off')),
  details       jsonb not null default '{}'::jsonb,
  status        text not null default 'pending'
                  check (status in ('pending','approved','declined','cancelled','expired')),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '3 days',
  resolved_at   timestamptz
);

-- Only one pending request of a given action per requester at a time.
create unique index if not exists approval_requests_unique_pending
  on public.approval_requests (couple_id, requester_id, action) where status = 'pending';

create index if not exists approval_requests_couple_idx
  on public.approval_requests (couple_id, status);

alter table public.approval_requests enable row level security;

drop policy if exists "approval read" on public.approval_requests;
create policy "approval read" on public.approval_requests for select to authenticated
  using (couple_id = public.my_couple_id());
-- No direct insert/update/delete policies: writes happen only via the
-- SECURITY DEFINER functions below.

-- Add to realtime (ignore if already added).
do $mig$ begin
  alter publication supabase_realtime add table public.approval_requests;
exception when duplicate_object then null;
end $mig$;

-- ---------------------------------------------------------------------
-- Create a request. The target is always the partner.
-- ---------------------------------------------------------------------
create or replace function public.create_approval_request(p_action text, p_details jsonb default '{}'::jsonb)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare
  c uuid := public.my_couple_id();
  me uuid := auth.uid();
  partner uuid := public.my_partner_id();
  req_id uuid;
begin
  if c is null or partner is null then raise exception 'You are not paired.'; end if;
  if p_action not in ('unpair','location_off') then raise exception 'Unknown action.'; end if;

  if p_action = 'location_off' then
    if not coalesce((select share_location from public.privacy_settings where user_id = me), false) then
      raise exception 'Your location sharing is already off.';
    end if;
  end if;

  if exists (select 1 from public.approval_requests
             where couple_id = c and requester_id = me and action = p_action and status = 'pending') then
    raise exception 'You already have a pending request for this.';
  end if;

  insert into public.approval_requests (couple_id, requester_id, target_id, action, details)
  values (c, me, partner, p_action, coalesce(p_details, '{}'::jsonb))
  returning id into req_id;

  perform public.log_activity(c, me, me, 'approval_requested',
    public.display_name_of(me) || ' requested: ' ||
    case p_action when 'unpair' then 'to unpair'
                  when 'location_off' then 'to turn off their location sharing'
                  else p_action end);
  return req_id;
end;
$fn$;

-- ---------------------------------------------------------------------
-- Approve or decline. ONLY the target may do this. The shared state
-- changes only inside the "approve" branch.
-- ---------------------------------------------------------------------
create or replace function public.respond_to_approval(p_request_id uuid, p_accept boolean)
returns void language plpgsql security definer set search_path = public as $fn$
declare r public.approval_requests;
begin
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

-- ---------------------------------------------------------------------
-- The requester can withdraw their own pending request.
-- ---------------------------------------------------------------------
create or replace function public.cancel_approval(p_request_id uuid)
returns void language plpgsql security definer set search_path = public as $fn$
declare r public.approval_requests;
begin
  select * into r from public.approval_requests where id = p_request_id for update;
  if r.id is null or r.requester_id <> auth.uid() then raise exception 'Request not found.'; end if;
  if r.status <> 'pending' then return; end if;
  update public.approval_requests set status = 'cancelled', resolved_at = now() where id = r.id;
  perform public.log_activity(r.couple_id, auth.uid(), r.target_id, 'approval_cancelled',
    public.display_name_of(auth.uid()) || ' withdrew their request');
end;
$fn$;

grant execute on function public.create_approval_request(text, jsonb) to authenticated;
grant execute on function public.respond_to_approval(uuid, boolean) to authenticated;
grant execute on function public.cancel_approval(uuid) to authenticated;
