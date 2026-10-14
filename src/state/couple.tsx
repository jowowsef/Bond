import AsyncStorage from '@react-native-async-storage/async-storage';
import type { Session } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  advancePairingSetup as advanceStoredSetup,
  ensurePairingSharingReset,
  noteNotPaired,
  resolvePairingSetup,
  type PairingSetupState,
  type SetupStep,
} from '@/lib/pairingSetup';
import { stopBackgroundLocation } from '@/lib/backgroundLocation';
import { resetCurrentAppUploads } from '@/lib/currentApp';
import { stopCurrentAppService } from '@/lib/currentAppServiceControl';
import { clearUnpairRecord, noteUnpaired, readUnpairRecord, runUnpairReset } from '@/lib/unpairReset';
import { signedAvatarUrls } from '@/lib/profilePhoto';
import { fetchPendingApprovals } from '@/lib/requests';
import { supabase, uniqueTopic } from '@/lib/supabase';
import type { ApprovalRequest, Couple, CoupleMember, Profile } from '@/lib/types';

/**
 * CoupleProvider holds the small amount of state every screen needs: who is
 * signed in (anonymous session), the couple, and both people's profiles.
 * Screens read it with useCouple().
 *
 * HOW PAIRING SURVIVES AN APP RESTART
 *  1. The login session is saved by Supabase itself (AsyncStorage, see
 *     src/lib/supabase.ts) and restored on launch. We never sign out on close.
 *  2. While we check whether that user is in a couple, the phase stays
 *     'loading' — so the app shows the logo, never the pairing screens.
 *  3. A copy of the last known couple info (ids, code, names — no passwords
 *     or tokens) is cached on the phone, so a paired user goes straight into
 *     the app even if the internet is slow or off at launch.
 *  4. A failed request never counts as "not paired". Only a successful answer
 *     from Supabase saying "no couple" moves the user back to onboarding.
 */

type Phase =
  | 'loading' // restoring the session / checking the couple
  | 'offline' // couldn't reach Supabase and nothing is cached yet
  | 'unpaired' // no session, or the server confirmed there's no couple
  | 'waiting' // in a couple but partner hasn't joined yet
  | 'paired'; // two people connected → main app

type Snapshot = {
  couple: Couple | null;
  members: CoupleMember[];
  myProfile: Profile | null;
  partnerProfile: Profile | null;
};

const EMPTY: Snapshot = { couple: null, members: [], myProfile: null, partnerProfile: null };

type CoupleContextValue = {
  phase: Phase;
  session: Session | null;
  userId: string | null;
  couple: Couple | null;
  members: CoupleMember[];
  myProfile: Profile | null;
  partnerProfile: Profile | null;
  partnerId: string | null;
  /**
   * Which post-pairing profile step is still needed. Derived from the saved
   * profile (so it survives restart / reinstall), null while still loading:
   *   'name'  → hasn't chosen a display name (empty, "Me", or still the
   *             name copied automatically from the email address)
   *   'color' → has a name but no avatar colour
   *   'done'  → profile ready → Home
   */
  profileStep: 'name' | 'color' | 'done' | null;
  /** Signed URL for MY avatar photo (or null when none / still resolving). */
  myAvatarUrl: string | null;
  /** Signed URL for my PARTNER's avatar photo. */
  partnerAvatarUrl: string | null;
  /** Pending approval requests waiting for MY decision (I am the target). */
  incomingRequests: ApprovalRequest[];
  /** Pending approval requests I have SENT (waiting on my partner). */
  outgoingRequests: ApprovalRequest[];
  /** Re-read couple + profiles from Supabase (also used as "Try again"). */
  refresh: () => Promise<void>;
  /** Re-read just the pending approval requests. */
  refreshRequests: () => Promise<void>;
  /** Forget the anonymous session (used after unpairing). */
  resetSession: () => Promise<void>;
  /**
   * Setup step for the CURRENT pairing. A new pairing goes 'sharing' ->
   * 'name' -> 'color' -> 'done'; an existing one is 'done'. 'unknown' while
   * checking or when not paired.
   */
  pairingSetup: PairingSetupState;
  /**
   * Finish one setup step for the current couple. False when it was refused
   * (leaving sharing setup before the new pairing's sharing reset succeeded).
   */
  advancePairingSetup: (from: SetupStep) => Promise<boolean>;
  /** Retry turning sharing off for a new pairing. True = safe to continue. */
  ensurePairingReset: () => Promise<boolean>;
  /**
   * After the server confirmed the couple ended (see lib/unpairReset.ts):
   *   'none'      nothing to show,
   *   'resetting' clearing the previous pairing's data on this account/phone,
   *   'failed'    that could not finish yet (unpairError says why; retry),
   *   'done'      cleared; the "You're no longer paired" screen waits for Continue.
   */
  unpairState: 'none' | 'resetting' | 'failed' | 'done';
  unpairError: string | null;
  retryUnpairReset: () => void;
  /** Continue on the confirmation screen: the notice is not shown again. */
  acknowledgeUnpair: () => Promise<void>;
};

const CoupleContext = createContext<CoupleContextValue | null>(null);

// ---------- local cache (non-sensitive pairing info only) ----------
const cacheKey = (uid: string) => `bond:couple-snapshot:${uid}`;

async function readCache(uid: string): Promise<Snapshot | null> {
  try {
    const raw = await AsyncStorage.getItem(cacheKey(uid));
    return raw ? (JSON.parse(raw) as Snapshot) : null;
  } catch {
    return null;
  }
}

async function writeCache(uid: string, snap: Snapshot): Promise<void> {
  try {
    if (snap.couple) await AsyncStorage.setItem(cacheKey(uid), JSON.stringify(snap));
    else await AsyncStorage.removeItem(cacheKey(uid));
  } catch {
    // caching is best-effort
  }
}

// ---------- server lookup ----------
/** Returns ok:false on ANY request error, so callers never mistake an error for "no couple". */
async function fetchSnapshot(uid: string): Promise<{ ok: true; snapshot: Snapshot } | { ok: false }> {
  const { data: myMember, error: memberError } = await supabase
    .from('couple_members')
    .select('*')
    .eq('user_id', uid)
    .maybeSingle();
  if (memberError) return { ok: false };

  let couple: Couple | null = null;
  let members: CoupleMember[] = [];
  if (myMember) {
    const [coupleRes, membersRes] = await Promise.all([
      supabase.from('couples').select('*').eq('id', myMember.couple_id).maybeSingle(),
      supabase.from('couple_members').select('*').eq('couple_id', myMember.couple_id),
    ]);
    if (coupleRes.error || membersRes.error) return { ok: false };
    couple = (coupleRes.data as Couple) ?? null;
    members = (membersRes.data as CoupleMember[]) ?? [];
  }

  // Profiles (RLS lets me read mine + my partner's).
  const { data: profiles, error: profileError } = await supabase.from('profiles').select('*');
  if (profileError) return { ok: false };
  const list = (profiles as Profile[]) ?? [];
  // Every account has its own profile row, and RLS always lets me read it. If
  // it's missing, these requests did NOT run as me: when the login token can't
  // be refreshed (for example right after being offline), supabase-js sends
  // requests without it, and RLS then returns nothing, which looks exactly like
  // "no couple". Never treat that as "not paired" (it used to restart setup
  // and turn sharing off); treat it as a failed check and try again later.
  if (!list.some((p) => p.id === uid)) return { ok: false };

  return {
    ok: true,
    snapshot: {
      couple,
      members,
      myProfile: list.find((p) => p.id === uid) ?? null,
      partnerProfile: list.find((p) => p.id !== uid) ?? null,
    },
  };
}

export function CoupleProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [authChecked, setAuthChecked] = useState(false);
  const [snapshot, setSnapshot] = useState<Snapshot>(EMPTY);
  /** The user id whose couple state we actually know (from server or cache). */
  const [knownFor, setKnownFor] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  /** The saved session couldn't be restored because of an error (e.g. offline with an expired token). */
  const [authError, setAuthError] = useState(false);
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  /** Signed avatar URLs keyed by storage path. */
  const [avatarUrls, setAvatarUrls] = useState<Record<string, string>>({});

  const userId = session?.user.id ?? null;
  const userIdRef = useRef<string | null>(null);
  userIdRef.current = userId;

  const { couple, members, myProfile, partnerProfile } = snapshot;
  const partnerId = useMemo(
    () => members.find((m) => m.user_id !== userId)?.user_id ?? null,
    [members, userId],
  );

  const incomingRequests = useMemo(
    () => requests.filter((r) => r.target_id === userId),
    [requests, userId],
  );
  const outgoingRequests = useMemo(
    () => requests.filter((r) => r.requester_id === userId),
    [requests, userId],
  );

  // Post-pairing profile step, derived entirely from the saved profile so it
  // is consistent across devices and survives restart / reinstall.
  // A name that Supabase copied from the email address (e.g. "denize.cruz")
  // was not chosen by the person, unless Bond's name step confirmed it.
  const autoName = session?.user.email ? session.user.email.split('@')[0] : null;
  const nameConfirmed = session?.user.user_metadata?.bond_name_confirmed === true;
  const profileStep: 'name' | 'color' | 'done' | null = (() => {
    if (!userId || !myProfile) return null; // still loading
    const name = myProfile.display_name?.trim();
    if (!name || name === 'Me') return 'name';
    if (!nameConfirmed && autoName && name === autoName) return 'name';
    if (myProfile.avatar_color !== 'blue' && myProfile.avatar_color !== 'pink') return 'color';
    return 'done';
  })();

  // Resolve signed URLs for whichever avatar photos exist (mine + partner's).
  const myPath = myProfile?.avatar_path ?? null;
  const partnerPath = partnerProfile?.avatar_path ?? null;
  useEffect(() => {
    const paths = [myPath, partnerPath].filter((p): p is string => !!p);
    if (paths.length === 0) {
      setAvatarUrls({});
      return;
    }
    let cancelled = false;
    signedAvatarUrls(paths)
      .then((map) => {
        if (!cancelled) setAvatarUrls(map);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [myPath, partnerPath]);

  const myAvatarUrl = myPath ? avatarUrls[myPath] ?? null : null;

  // --- Sharing setup for the current pairing (see lib/pairingSetup.ts) ---
  const [pairingSetup, setPairingSetup] = useState<PairingSetupState>('unknown');
  const setupCoupleId = couple?.id ?? null;
  const fullCouple = members.length >= 2;
  useEffect(() => {
    if (!userId || !setupCoupleId || !fullCouple) {
      setPairingSetup('unknown');
      return;
    }
    let cancelled = false;
    setPairingSetup('unknown');
    void resolvePairingSetup(userId, setupCoupleId)
      .then((state) => {
        if (!cancelled) setPairingSetup(state);
      })
      .catch(() => {
        if (!cancelled) setPairingSetup('sharing'); // when unsure, ask again rather than share silently
      });
    return () => {
      cancelled = true;
    };
  }, [userId, setupCoupleId, fullCouple]);

  const advancePairingSetup = useCallback(
    async (from: SetupStep) => {
      if (!userId || !setupCoupleId) return false;
      const next = await advanceStoredSetup(userId, setupCoupleId, from);
      if (!next) return false;
      setPairingSetup(next);
      return true;
    },
    [userId, setupCoupleId],
  );

  const ensurePairingReset = useCallback(async () => {
    if (!userId || !setupCoupleId) return false;
    return ensurePairingSharingReset(userId, setupCoupleId);
  }, [userId, setupCoupleId]);
  const partnerAvatarUrl = partnerPath ? avatarUrls[partnerPath] ?? null : null;

  // --- Restore the saved session, then follow sign-in / sign-out ---
  useEffect(() => {
    supabase.auth.getSession().then(({ data, error }) => {
      setSession(data.session);
      // An error here (not just "no session") means we couldn't restore it —
      // Supabase keeps it saved, so show "Unable to connect", not onboarding.
      setAuthError(!data.session && !!error);
      setAuthChecked(true);
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession);
      if (newSession) setAuthError(false);
    });
    return () => sub.subscription.unsubscribe();
  }, []);

  // --- Unpair: the server confirmed the couple ended (see lib/unpairReset.ts) ---
  const [unpairState, setUnpairState] = useState<'none' | 'resetting' | 'failed' | 'done'>('none');
  const [unpairError, setUnpairError] = useState<string | null>(null);
  /** The couple this phone last KNEW for the user (cache or server), to recognise an unpair. */
  const knownCoupleRef = useRef<{ uid: string; coupleId: string | null; full: boolean } | null>(null);
  const resetRunning = useRef(false);

  const startUnpairReset = useCallback(async (uid: string) => {
    if (resetRunning.current) return; // one reset at a time
    resetRunning.current = true;
    setUnpairState('resetting');
    setUnpairError(null);
    try {
      const result = await runUnpairReset(uid);
      if (userIdRef.current !== uid) return;
      if (result.ok) {
        // Show the reset profile (name, color, photo back to defaults).
        const fresh = await fetchSnapshot(uid);
        if (fresh.ok && userIdRef.current === uid) {
          setSnapshot(fresh.snapshot);
          await writeCache(uid, fresh.snapshot);
        }
        setUnpairState('done');
      } else {
        setUnpairError(result.message);
        setUnpairState('failed');
      }
    } finally {
      resetRunning.current = false;
    }
  }, []);

  /** Apply a fresh server answer for `uid` (ignored if the user changed meanwhile). */
  const applyServer = useCallback(async (uid: string): Promise<boolean> => {
    const result = await fetchSnapshot(uid);
    if (userIdRef.current && userIdRef.current !== uid) return false;
    if (!result.ok) return false;
    const before = knownCoupleRef.current;
    const next = result.snapshot;
    knownCoupleRef.current = { uid, coupleId: next.couple?.id ?? null, full: next.members.length >= 2 };
    // Confirmed by the server: this account WAS paired and now has no couple.
    const justUnpaired = !!before && before.uid === uid && !!before.coupleId && before.full && !next.couple;
    if (justUnpaired) setUnpairState('resetting'); // same render as the unpaired phase: no flash of other screens
    setSnapshot(next);
    setKnownFor(uid);
    setLoadFailed(false);
    await writeCache(uid, next);
    if (justUnpaired && before?.coupleId) {
      await noteUnpaired(uid, before.coupleId).catch(() => undefined);
      void startUnpairReset(uid);
    } else if (next.couple && next.members.length >= 2) {
      // Paired (again): an old notice no longer applies.
      const record = await readUnpairRecord(uid);
      if (record && record.coupleId !== next.couple.id) {
        await clearUnpairRecord(uid);
        setUnpairState('none');
      }
    }
    return true;
  }, [startUnpairReset]);

  // --- On launch / when the user changes: cache first, then the server ---
  useEffect(() => {
    if (!authChecked) return;
    if (!userId) {
      setSnapshot(EMPTY);
      setKnownFor(null);
      setLoadFailed(false);
      return;
    }
    let cancelled = false;
    (async () => {
      const [cached, record] = await Promise.all([readCache(userId), readUnpairRecord(userId)]);
      if (cancelled) return;
      knownCoupleRef.current = {
        uid: userId,
        coupleId: cached?.couple?.id ?? null,
        full: (cached?.members.length ?? 0) >= 2,
      };
      if (record) {
        // An unpair recognised earlier and not acknowledged yet: show it again,
        // and finish the reset if it was interrupted (closed / offline).
        setUnpairState(record.resetDone ? 'done' : 'resetting');
        if (!record.resetDone) void startUnpairReset(userId);
      }
      if (cached) {
        // Paired before → show the app right away; the server check below confirms it.
        setSnapshot(cached);
        setKnownFor(userId);
      }
      const ok = await applyServer(userId);
      if (!cancelled && !ok && !cached) setLoadFailed(true);
      if (!cancelled) await refreshRequests();
    })();
    return () => {
      cancelled = true;
    };
  }, [authChecked, userId, applyServer, startUnpairReset]);

  // --- Pending approval requests (loaded SEPARATELY so a missing table or a
  //     failed request never affects pairing restore) ---
  const refreshRequests = useCallback(async () => {
    if (!userIdRef.current) {
      setRequests([]);
      return;
    }
    const pending = await fetchPendingApprovals();
    setRequests(pending);
  }, []);

  // --- Public refresh: used after pairing, by realtime, polling and "Try again" ---
  const refresh = useCallback(async () => {
    // Right after an anonymous sign-in (or on "Try again" after a failed
    // restore) the session may not be in state yet — ask Supabase for it.
    let uid = userIdRef.current;
    if (!uid) {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setSession(data.session);
        setAuthError(false);
        uid = data.session.user.id;
      }
    }
    if (!uid) return;
    await applyServer(uid);
    await refreshRequests();
  }, [applyServer, refreshRequests]);

  // --- Re-check when the app comes back to the foreground ---
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && userIdRef.current) void refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  // --- Live updates: re-read when couple membership or profiles change ---
  const coupleId = couple?.id ?? null;
  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(uniqueTopic(`couple-watch-${userId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'couple_members' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'profiles' }, () => void refresh())
      .on('postgres_changes', { event: '*', schema: 'public', table: 'approval_requests' }, () => void refresh())
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
    const uid = userIdRef.current;
    if (uid) await AsyncStorage.removeItem(cacheKey(uid)).catch(() => undefined);
    // No background location for an account that is signed out / deleted.
    await stopBackgroundLocation();
    await stopCurrentAppService();
    resetCurrentAppUploads();
    // This phone only (the account may already be deleted on the server).
    await supabase.auth.signOut({ scope: 'local' }).catch(() => undefined);
    setSession(null);
    setSnapshot(EMPTY);
    setKnownFor(null);
    setLoadFailed(false);
    setAuthError(false);
    setRequests([]);
    setAvatarUrls({});
    knownCoupleRef.current = null;
    setUnpairState('none');
    setUnpairError(null);
  }, []);

  const retryUnpairReset = useCallback(() => {
    const uid = userIdRef.current;
    if (uid) void startUnpairReset(uid);
  }, [startUnpairReset]);

  const acknowledgeUnpair = useCallback(async () => {
    const uid = userIdRef.current;
    if (uid) await clearUnpairRecord(uid);
    setUnpairState('none');
    setUnpairError(null);
  }, []);

  const coupleKnown = !!userId && knownFor === userId;
  const phase: Phase = !authChecked
    ? 'loading'
    : !userId
      ? authError
        ? 'offline'
        : 'unpaired'
      : !coupleKnown
        ? loadFailed
          ? 'offline'
          : 'loading'
        : !couple
          ? 'unpaired'
          : members.length >= 2
            ? 'paired'
            : 'waiting';

  // This phone shows the account unpaired or waiting: the next couple is a NEW
  // pairing (see lib/pairingSetup.ts). Only confirmed states count; a failed
  // request never moves the phase to 'unpaired'.
  useEffect(() => {
    if (userId && (phase === 'unpaired' || phase === 'waiting')) void noteNotPaired(userId);
  }, [userId, phase]);

  const value: CoupleContextValue = {
    phase,
    session,
    userId,
    couple,
    members,
    myProfile,
    partnerProfile,
    partnerId,
    profileStep,
    myAvatarUrl,
    partnerAvatarUrl,
    incomingRequests,
    outgoingRequests,
    refresh,
    refreshRequests,
    resetSession,
    pairingSetup,
    advancePairingSetup,
    ensurePairingReset,
    unpairState,
    unpairError,
    retryUnpairReset,
    acknowledgeUnpair,
  };

  return <CoupleContext.Provider value={value}>{children}</CoupleContext.Provider>;
}

export function useCouple(): CoupleContextValue {
  const ctx = useContext(CoupleContext);
  if (!ctx) throw new Error('useCouple must be used inside <CoupleProvider>');
  return ctx;
}
