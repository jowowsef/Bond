import { useEffect } from 'react';
import { AppState } from 'react-native';
import { deliverPendingAlerts, registerPushToken } from '@/lib/partnerAlerts';
import { supabase, uniqueTopic } from '@/lib/supabase';

/**
 * While Bond is open: show partner alerts addressed to me as soon as the
 * server creates them (Realtime), and catch up when Bond returns to the front.
 * Also registers this device for push once, if push is set up for this build.
 */
export function usePartnerAlerts(userId: string | null): void {
  useEffect(() => {
    if (!userId) return;
    const deliver = () => void deliverPendingAlerts(userId).catch(() => undefined);
    deliver();
    void registerPushToken().catch(() => undefined);

    const channel = supabase
      .channel(uniqueTopic('partner-alerts'))
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'partner_alerts', filter: `recipient_id=eq.${userId}` },
        deliver,
      )
      .subscribe();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') deliver();
    });
    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [userId]);
}
