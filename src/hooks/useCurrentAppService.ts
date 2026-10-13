import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { reconcileBackgroundService } from '@/lib/backgroundService';
import { logDiagnostic } from '@/lib/currentAppServiceControl';
import { noteLiveIfClosed } from '@/lib/liveMode';
import { supabase, uniqueTopic } from '@/lib/supabase';

/**
 * Keeps Bond's one background service in step with the rules (see
 * lib/backgroundService.ts): app checks while Currently Using is on with
 * Usage access, battery while battery sharing is on, stopped when neither.
 * Mounted once, in the main tabs, with a user id ONLY while paired with setup
 * finished (null otherwise, which stops it). undefined = not known yet (Bond is
 * still loading, or offline): the service is left as it is. Stopping it then
 * would stop background updates whenever Bond opens on a slow connection.
 *
 * Re-checked when Bond starts, when it comes back to the front (for example
 * after Usage access was changed in Android Settings), and when either
 * setting changes (here or on another phone). Starting needs Bond to be open
 * (an Android rule), so it is never attempted from the background.
 */
export function useCurrentAppService({ userId, partnerName }: { userId: string | null | undefined; partnerName: string }): void {
  const nameRef = useRef(partnerName);
  nameRef.current = partnerName;

  useEffect(() => {
    if (userId === undefined) return; // not known yet: change nothing
    const run = () => {
      if (userId && AppState.currentState !== 'active') return;
      noteLiveIfClosed(logDiagnostic);
      void reconcileBackgroundService(userId, nameRef.current).catch(() => undefined);
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    const channel = userId
      ? supabase
          .channel(uniqueTopic(`background-service-${userId}`))
          .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'privacy_settings', filter: `user_id=eq.${userId}` }, run)
          .subscribe()
      : null;
    return () => {
      sub.remove();
      if (channel) void supabase.removeChannel(channel);
    };
  }, [userId]);
}
