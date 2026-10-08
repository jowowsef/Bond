import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { Couple, CoupleMember, Profile } from '@/lib/types';

/**
 * CoupleProvider holds the small amount of state every screen needs during
 * this phase: who is signed in (anonymous session), the couple, and both
 * people's profiles. Screens read it with useCouple().
 *
 * It does NOT touch device data, location, or any native features yet.
 */

type Phase =
  | 'loading' // still checking the saved session
  | 'unpaired' // signed out, or signed in with no couple → onboarding
  | 'waiting' // in a couple but partner hasn't joined yet
  | 'paired'; // two people connected → main app

type CoupleContextValue = {
  phase: Phase;
  session: Session | null;
  userId: string | null;
  couple: Couple | null;
  members: CoupleMember[];
  myProfile: Profile | null;
  partnerProfile: Profile | null;
  partnerId: string | null;
  /** Re-read couple + profiles from Supabase. */
  refresh: () => Promise<void>;
  /** Forget the anonymous session (used after unpairing). */
  resetSession: () => Promise<void>;
};

const CoupleContext = createContext<CoupleContextValue | null>(null);

export function CoupleProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [couple, setCouple] = useState<Couple | null>(null);
  const [members, setMembers] = useState<CoupleMember[]>([]);
  const [myProfile, setMyProfile] = useState<Profile | null>(null);
  const [partnerProfile, setPartnerProfile] = useState<Profile | null>(null);

  const userId = session?.user.id ?? null;
  const partnerId = useMemo(
    () => members.find((m) => m.user_id !== userId)?.user_id ?? null,
    [members, userId],
  );

  // --- Keep the session in sync with Supabase ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- Load couple + profiles for the current user ---
  const refresh = useCallback(async () => {
    const { data: userData } = await supabase.auth.getUser();
    const uid = userData.user?.id;
    if (!uid) {
      setCouple(null);
      setMembers([]);
      setMyProfile(null);
      setPartnerProfile(null);
      return;
    }

    const { data: myMember } = await supabase.from('couple_members').select('*').eq('user_id', uid).maybeSingle();

    if (!myMember) {
      setCouple(null);
      setMembers([]);
    } else {
      const [{ data: c }, { data: allMembers }] = await Promise.all([
        supabase.from('couples').select('*').eq('id', myMember.couple_id).maybeSingle(),
        supabase.from('couple_members').select('*').eq('couple_id', myMember.couple_id),
      ]);
      setCouple((c as Couple) ?? null);
      setMembers((allMembers as CoupleMember[]) ?? []);
    }

    // Profiles (RLS lets me read mine + my partner's).
    const { data: profiles } = await supabase.from('profiles').select('*');
    const list = (profiles as Profile[]) ?? [];
    setMyProfile(list.find((p) => p.id === uid) ?? null);
    setPartnerProfile(list.find((p) => p.id !== uid) ?? null);
  }, []);

  // Reload whenever the signed-in user changes.
  useEffect(() => {
    if (authChecked) void refresh();
  }, [authChecked, userId, refresh]);

  // --- Live updates: re-read when couple membership changes ---
  const coupleId = couple?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`couple-watch-${userId}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_members' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void refresh())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [userId, coupleId, refresh]);

  // --- While waiting for a partner, poll as a safety net (realtime can lag) ---
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const waiting = !!couple && members.length < 2;
  useEffect(() => {
    if (waiting) {
      pollRef.current = setInterval(() => void refresh(), 4000);
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = null;
    };
  }, [waiting, refresh]);

  const resetSession = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setCouple(null);
    setMembers([]);
    setMyProfile(null);
    setPartnerProfile(null);
  }, []);

  const phase: Phase = !authChecked
    ? 'loading'
    : !session
      ? 'unpaired'
      : !couple
        ? 'unpaired'
        : members.length >= 2
          ? 'paired'
          : 'waiting';

  const value: CoupleContextValue = {
    phase,
    session,
    userId,
    couple,
    members,
    myProfile,
    partnerProfile,
    partnerId,
    refresh,
    resetSession,
  };

  return <CoupleContext.Provider value={value}>{children}</CoupleContext.Provider>;
}

export function useCouple(): CoupleContextValue {
  const ctx = useContext(CoupleContext);
  if (!ctx) throw new Error('useCouple must be used inside <CoupleProvider>');
  return ctx;
}
