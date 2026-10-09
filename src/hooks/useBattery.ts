import * as Battery from 'expo-battery';
import { useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { isChargingState, syncBattery, type LocalBattery } from '@/lib/battery';
import { supabase, uniqueTopic } from '@/lib/supabase';
import type { BatteryStatus } from '@/lib/types';

const SYNC_INTERVAL_MS = 15 * 60 * 1000; // 15 min while the app is open
/** Older than this = show as possibly stale. */
export const BATTERY_STALE_MS = 30 * 60 * 1000;

/** This phone's live battery (updates as the level / charging state changes). */
export function useMyBattery(): LocalBattery {
  const level = Battery.useBatteryLevel();
  const state = Battery.useBatteryState();
  return {
    level: Math.round((level ?? 0) * 100),
    charging: isChargingState(state),
  };
}

/**
 * Keeps my battery synced to Supabase while sharing is ON and the app is open:
 * on change, when returning to the foreground, and every 15 minutes.
 */
export function useBatterySync(userId: string | null): void {
  const [sharing, setSharing] = useState(false);

  // Read my own share_battery setting (and follow changes to it).
  useEffect(() => {
    if (!userId) return;
    let active = true;
    const read = async () => {
      const { data } = await supabase.from('privacy_settings').select('share_battery').eq('user_id', userId).maybeSingle();
      if (active) setSharing(!!data?.share_battery);
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
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [userId]);

  useEffect(() => {
    if (!userId || !sharing) return;
    const push = () => {
      void syncBattery(userId);
    };
    push();
    const interval = setInterval(push, SYNC_INTERVAL_MS);
    const levelSub = Battery.addBatteryLevelListener(push);
    const stateSub = Battery.addBatteryStateListener(push);
    const appSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') push();
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
export function usePartnerBattery(partnerId: string | null): { battery: BatteryStatus | null; stale: boolean } {
  const [battery, setBattery] = useState<BatteryStatus | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    if (!partnerId) {
      setBattery(null);
      return;
    }
    let active = true;
    const load = async () => {
      const { data } = await supabase.from('battery_status').select('*').eq('user_id', partnerId).maybeSingle();
      if (active) setBattery((data as BatteryStatus) ?? null);
    };
    void load();
    const channel = supabase
      .channel(uniqueTopic(`battery-watch-${partnerId}`))
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'battery_status', filter: `user_id=eq.${partnerId}` },
        () => void load(),
      )
      .subscribe();
    return () => {
      active = false;
      void supabase.removeChannel(channel);
    };
  }, [partnerId]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60_000);
    return () => clearInterval(t);
  }, []);

  const stale = !!battery && now - new Date(battery.updated_at).getTime() > BATTERY_STALE_MS;
  return { battery, stale };
}
