import { useEffect, useRef } from 'react';
import { AppState } from 'react-native';
import { syncScreenTime } from '@/lib/screenTime';

/** No more often than this from the open app (the background job covers the rest). */
const MIN_GAP_MS = 2 * 60 * 1000;

/**
 * Sends MY screen time from the open app: when the main screens appear, when
 * Bond comes back to the front, and when it is left. Independent of every
 * other kind of sharing. syncScreenTime checks Usage access (read fresh, so a
 * permission granted in Android Settings is noticed on return) and
 * share_screen_time itself; nothing is sent when either is off. Mounted in
 * the main tabs with a user id only while paired with setup finished.
 * While Bond is closed, the background job sends it (about every 15 minutes
 * or later, as Android allows).
 */
export function useScreenTimeSync(userId: string | null): void {
  const last = useRef(0);
  useEffect(() => {
    if (!userId) return;
    const run = () => {
      if (Date.now() - last.current < MIN_GAP_MS) return;
      last.current = Date.now();
      void syncScreenTime(userId).then((r) => {
        if (r.status === 'error') last.current = 0; // failed: allowed again next time
      });
    };
    run();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active' || s === 'background') run();
    });
    return () => sub.remove();
  }, [userId]);
}
