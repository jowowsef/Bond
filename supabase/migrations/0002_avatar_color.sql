-- =====================================================================
-- MIGRATION 0002: avatar colour
-- =====================================================================
-- Run in the Supabase SQL Editor after schema.sql + 0001. Safe to re-run.
--
-- Adds ONE column to the existing profiles table for the user's chosen
-- avatar colour ('blue' or 'pink'). Profile photos keep using the existing
-- profiles.avatar_path column and the existing private "avatars" storage
-- bucket, so no new table/bucket is needed.
--
-- RLS is unchanged: the existing "profiles read" policy already lets a user
-- read their own and their partner's profile (including this new column),
-- and "profiles update own" still restricts writes to the owner.
-- =====================================================================

alter table public.profiles
  add column if not exists avatar_color text
  check (avatar_color in ('blue', 'pink'));
