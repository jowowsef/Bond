import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import {
  partnerRowOnly,
  readCurrentAppSetting,
  syncAfterLeavingBond,
  syncCurrentAppIfSharing,
  type CurrentAppRow,
  type CurrentAppSetting,
} from '@/lib/currentApp';
import { supabase, uniqueTopic } from '@/lib/supabase';

/**
 * My partner's "Currently Using": their sharing setting and their latest
 * check, live via realtime, re-read when Bond returns to the front, and
 * re-read on demand with `reload` (Home's pull to refresh). Reading only
 * shows what the partner's phone last sent; it can't make that phone check.
 *
 * Answers are applied in order: a slower, older request can never replace a
 * newer one, and a row is never replaced by one with an older checked_at.
 * Everything resets when the partner changes or the couple ends (partnerId
 * null), so an old partner's app never shows.
 */
export function usePartnerCurrentApp(
  partnerId: string | null,
  /** My own user id: my row is never shown as the partner's. */
  myId: string | null,
): {
  setting: CurrentAppSetting | null;
  row: CurrentAppRow | null;
  now: number;
  /** Fetch the newest record now. Rejects on a network / server error. */
  reload: () => Promise<void>;
} {
  const [setting, setSetting] = useState<CurrentAppSetting | null>(null);
  const [row, setRow] = useState<CurrentAppRow | null>(null);
  const [now, setNow] = useState(Date.now());
  const seq = useRef(0);
  const partnerRef = useRef(partnerId);
  partnerRef.current = partnerId;
  const myRef = useRef(myId);
  myRef.current = myId;

  const reload = useCallback(async () => {
    const id = partnerRef.current;
    if (!id) return;
    const mine = ++seq.current;
    const s = await readCurrentAppSetting(id);
    if (mine !== seq.current || partnerRef.current !== id) return; // a newer request is on its way
    if (s.kind === 'error') throw new Error('current app setting failed to load');
    setSetting(s);
    if (s.kind !== 'on') {
      setRow(null); // sharing off (or not available): nothing is shown
      setNow(Date.now());
      return;
    }
    const { data, error } = await supabase.from('current_app').select('*').eq('user_id', id).maybeSingle();
    if (mine !== seq.current || partnerRef.current !== id) return;
    if (error) throw error;
    // Only ever the partner's own row (never mine, a previous partner's or another account's).
    const next = partnerRowOnly((data as CurrentAppRow) ?? null, id, myRef.current);
    setRow((prev) =>
      prev && next && prev.user_id === next.user_id && new Date(prev.checked_at).getTime() > new Date(next.checked_at).getTime()
        ? prev
        : next,
    );
    setNow(Date.now());
  }, []);

  useEffect(() => {
    seq.current++;
    setSetting(null);
    setRow(null);
    if (!partnerId || partnerId === myId) return;
    const run = () => void reload().catch(() => {});
    run();
    const channel = supabase
      .channel(uniqueTopic(`current-app-watch-${partnerId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'current_app', filter: `user_id=eq.${partnerId}` }, run)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'privacy_settings', filter: `user_id=eq.${partnerId}` }, run)
      .subscribe();
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') run();
    });
    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [partnerId, myId, reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  return { setting, row, now, reload };
}

/**
 * Sends MY current app from the open app (only if I share it; the functions
 * check consent and Usage access themselves). Mounted in the main tabs with a
 * user id only while paired with setup finished.
 *  - Bond comes to the front: the app in front is Bond.
 *  - Bond leaves the screen: the next app is read right away (no timer, see
 *    syncAfterLeavingBond), so "opened TikTok from Bond" shows up at once.
 * App switches made later while Bond stays closed are picked up by the
 * background checks (see lib/currentApp.ts for their limits).
 */
export function useCurrentAppSync(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    void syncCurrentAppIfSharing(userId);
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void syncCurrentAppIfSharing(userId);
      else if (s === 'background') void syncAfterLeavingBond(userId);
    });
    return () => sub.remove();
  }, [userId]);
}
