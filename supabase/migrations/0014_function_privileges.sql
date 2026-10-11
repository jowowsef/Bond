-- =====================================================================
-- 0014: who may call which database function (Security Advisor fixes)
-- =====================================================================
--
-- Supabase gives EXECUTE on every new function in "public" to the roles
-- anon (no session) and authenticated (signed in) by default. Earlier files
-- only revoked from PUBLIC, so some functions were still callable without a
-- session. None of them leaked couple data (each checks auth.uid() or only
-- answers about the caller), but security should not depend on that. Here:
--
--  1. generate_invite_code(): fixed search_path; only create_couple (and,
--     after 0015, the other pairing functions) call it, never the app.
--  2. Internal / trigger-only functions: nobody calls them directly.
--     display_name_of(uid) could return ANY user's name for a known id
--     (for example a former partner's new name); it is only used inside
--     other security-definer functions, which run as the owner.
--  3. RLS helpers (my_couple_id, my_partner_id, can_see): signed-in users
--     only. They MUST stay callable by "authenticated": the RLS policies and
--     realtime use them for every read.
--  4. The app's RPCs: signed-in users only (they already refuse without a
--     session; now the database refuses before running them).
--  5. Functions created later: not callable without a session unless a file
--     grants it on purpose.
--
-- Not changed: functions already restricted in 0005-0013 (account deletion,
-- alerts, approvals, calendar, cleanup, triggers).
--
-- Login, pairing, unpairing, sync, notifications and calendar keep working:
-- triggers do not need EXECUTE when they fire, and security-definer
-- functions call these helpers as their owner.
--
-- Safe to run more than once, before or after 0011-0013.
-- =====================================================================

-- 1. Pairing code generator
alter function public.generate_invite_code() set search_path = public;
revoke all on function public.generate_invite_code() from public, anon, authenticated;

-- 2. Internal and trigger-only functions
revoke all on function public.display_name_of(uuid) from public, anon, authenticated;
revoke all on function public.handle_new_user()      from public, anon, authenticated;
revoke all on function public.on_privacy_changed()   from public, anon, authenticated;

-- 3. RLS helpers: signed-in only
revoke all on function public.my_couple_id()      from public, anon;
revoke all on function public.my_partner_id()     from public, anon;
revoke all on function public.can_see(uuid, text) from public, anon;
grant execute on function public.my_couple_id()      to authenticated;
grant execute on function public.my_partner_id()     to authenticated;
grant execute on function public.can_see(uuid, text) to authenticated;

-- 4. App RPCs: signed-in only
revoke all on function public.create_couple()                      from public, anon;
revoke all on function public.join_couple(text)                    from public, anon;
revoke all on function public.leave_couple()                       from public, anon;
revoke all on function public.create_approval_request(text, jsonb) from public, anon;
revoke all on function public.register_push_token(text, text)      from public, anon;
grant execute on function public.create_couple()                      to authenticated;
grant execute on function public.join_couple(text)                    to authenticated;
grant execute on function public.leave_couple()                       to authenticated;
grant execute on function public.create_approval_request(text, jsonb) to authenticated;
grant execute on function public.register_push_token(text, text)      to authenticated;

-- 5. Future functions created by this role: no automatic access without a session
alter default privileges in schema public revoke execute on functions from public, anon;
