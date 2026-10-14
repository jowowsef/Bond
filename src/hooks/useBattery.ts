import * as Battery from 'expo-battery';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getLocalBattery, isChargingState, syncBattery, type LocalBattery } from '@/lib/battery';
import { supabase, uniqueTopic } from '@/lib/supabase';
import type { BatteryStatus } from '@/lib/types';
import { assertSignedIn, onReconnect } from '@/lib/connectivity';
import { readCached, writeCached } from '@/lib/offlineCache';
import { useCouple } from '@/state/couple';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 min while the app is open
/** Older than this = show as possibly stale. */
export const BATTERY_STALE_MS = 30 * 60 * 1000;

/**
 * This phone's live battery (updates as the level / charging state changes),
 * plus `refresh` to read it from Android right now (pull to refresh).
 */
export function useMyBattery(): LocalBattery & { refresh: () => Promise<void> } {
  const level = Battery.useBatteryLevel();
  const state = Battery.useBatteryState();
  // A fresh reading from refresh(), used until Android reports the next change.
  const [fresh, setFresh] = useState<LocalBattery | null>(null);
  useEffect(() => {
    setFresh(null);
  }, [level, state]);
  const refresh = useCallback(async () => {
    setFresh(await getLocalBattery());
  }, []);
  return {
    ...(fresh ?? { level: Math.round((level ?? 0) * 100), charging: isChargingState(state) }),
    refresh,
  };
}

/**
 * Keeps my battery synced to Supabase while sharing is ON and the app is open:
 * on change, when returning to the foreground, when leaving it, and every 15
 * minutes while open. (The interval doesn't run while Bond is in the
 * background, because React Native pauses timers then; the background job
 * and background location updates send it then.)
 */
export function useBatterySync(userId: string | null): void {
  const [sharing, setSharing] = useState(false);

  // Read my own share_battery setting (and follow changes to it).
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const read = async () => {
      const { data, error } = await supabase.from('privacy_settings').select('share_battery').eq('user_id', userId).maybeSingle();
      // A failed read keeps the last known value. (Before, it was read as
      // "off" and stopped all battery updates until the setting changed.)
      if (active && !error) setSharing(!!data?.share_battery);
    };
    void read();
    const channel = supabase
      .channel(uniqueTopic(`battery-privacy-${userId}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'privacy_settings', filter: `user_id=eq.${userId}` },
        () => void read(),
      )
      .subscribe();
    // Re-check when Bond comes back (it may have changed, or the first read failed).
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active') void read();
    });
    return () => {
      active = false;
      appSub.remove();
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !sharing) return;
    const push = () => {
      syncBattery(userId).catch(() => {}); // retried on the next change / interval
    };
    push();
    const interval = setInterval(push, SYNC_INTERVAL_MS);
    const levelSub = Battery.addBatteryLevelListener(push);
    const stateSub = Battery.addBatteryStateListener(push);
    // Coming back, and leaving (the last reading before Bond goes to the background).
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active' || st === 'background') push();
    });
    return () => {
      clearInterval(interval);
      levelSub.remove();
      stateSub.remove();
      appSub.remove();
    };
  }, [userId, sharing]);
}

/** My partner's latest battery (live via realtime), or null when not shared. */
export function usePartnerBattery(partnerId: string | null): {
  battery: BatteryStatus | null;
  stale: boolean;
  /**
   * Whether the partner has battery sharing ON (null = not known yet). With
   * sharing on but no reading yet, the partner's phone hasn't sent one (for
   * example right after pairing): "waiting", not "not shared".
   */
  sharing: boolean | null;
  /** Re-read now (pull to refresh). Rejects on a network / database error. */
  reload: () => Promise<void>;
} {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [sharing, setSharing] = useState<boolean | null>(null);
  const [now, setNow] = useState(Date.now());
  const partnerRef = useRef(partnerId);
  partnerRef.current = partnerId;
  const seq = useRef(0);
  const { userId: myId } = useCouple();
  const myRef = useRef(myId);
  useEffect(() => {
    myRef.current = myId;
  }, [myId]);

  /**
   * Read the newest reading the partner's phone has sent. Used on open, on
   * realtime changes, when Bond comes back and by pull to refresh. Only the
   * latest request is applied, so a slower older answer can't put an old
   * percentage back. Rejects on a network / server error (the last value stays).
   */
  const reload = useCallback(async () => {
    const id = partnerRef.current;
    if (!id) return;
    const mine = ++seq.current;
    // Offline / not signed in yet: keep what is shown (an empty answer would look like "not shared").
    await assertSignedIn();
    const [row, privacy] = await Promise.all([
      supabase.from('battery_status').select('*').eq('user_id', id).maybeSingle(),
      supabase.from('privacy_settings').select('share_battery').eq('user_id', id).maybeSingle(),
    ]);
    if (mine !== seq.current || partnerRef.current !== id) return;
    if (row.error) throw row.error;
    const nextBattery = (row.data as BatteryStatus) ?? null;
    const nextSharing = privacy.error ? null : !!(privacy.data as { share_battery?: boolean } | null)?.share_battery;
    setBattery(nextBattery);
    if (nextSharing !== null) setSharing(nextSharing);
    setNow(Date.now());
    // Saved for opening Bond offline (only this account, about this partner).
    void writeCached(myRef.current, `partner-battery:${id}`, { battery: nextBattery, sharing: nextSharing });
  }, []);

  useEffect(() => {
    seq.current++;
    setBattery(null);
    setSharing(null);
    if (!partnerId) return;
    // Show the last saved reading at once (with its own time), until the server answers.
    const shown = seq.current;
    void readCached<{ battery: BatteryStatus | null; sharing: boolean | null }>(myRef.current, `partner-battery:${partnerId}`).then((c) => {
      if (!c || seq.current !== shown || partnerRef.current !== partnerId) return;
      setBattery(c.value.battery);
      setSharing(c.value.sharing);
    });
    const run = () => void reload().catch(() => {});
    run();
    const offReconnect = onReconnect(run);
    const channel = supabase
      .channel(uniqueTopic(`battery-watch-${partnerId}`))
      .on('postgres_changes', { event: '*', schema: 'public', table: 'battery_status', filter: `user_id=eq.${partnerId}` }, run)
      // The partner turning battery sharing on / off.
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'privacy_settings', filter: `user_id=eq.${partnerId}` }, run)
      .subscribe();
    const appSub = AppState.addEventListener('change', (st) => {
      if (st === 'active') run();
    });
    return () => {
      offReconnect();
      appSub.remove();
      void supabase.removeChannel(channel);
    };
  }, [partnerId, reload]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const stale = !!battery && now - new Date(battery.updated_at).getTime() > BATTERY_STALE_MS;
  return { battery, stale, sharing, reload };
}
