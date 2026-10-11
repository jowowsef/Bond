import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Pull-to-refresh state for a screen.
 * - Runs the real reload work passed in (not a fake spinner).
 * - Ignores extra pulls while one refresh is still running (no duplicate requests).
 * - Always stops the spinner, and reports a failure instead of throwing.
 */
export function usePullToRefresh(work: () => Promise<unknown>): {
  refreshing: boolean;
  onRefresh: () => void;
  failed: boolean;
} {
  const [refreshing, setRefreshing] = useState(false);
  const [failed, setFailed] = useState(false);
  const busy = useRef(false);
  const mounted = useRef(true);
  const workRef = useRef(work);
  workRef.current = work;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const onRefresh = useCallback(() => {
    if (busy.current) return;
    busy.current = true;
    setRefreshing(true);
    setFailed(false);
    void (async () => {
      try {
        await workRef.current();
      } catch {
        if (mounted.current) setFailed(true);
      } finally {
        busy.current = false;
        if (mounted.current) setRefreshing(false);
      }
    })();
  }, []);

  return { refreshing, onRefresh, failed };
}
