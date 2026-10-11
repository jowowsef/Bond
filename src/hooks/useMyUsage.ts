import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { getUsageSupport, hasUsageAccess, readDayUsage } from '@/lib/screenTime';
import type { UsageResult } from '../../modules/bond-usage';

export type MyUsageState =
  | { kind: 'loading' }
  | { kind: 'needs-update' }
  | { kind: 'unsupported' }
  | { kind: 'no-access' }
  | { kind: 'ready'; usage: UsageResult; readAt: number }
  | { kind: 'error'; message: string };

/**
 * This phone's real usage for one day (today unless `day` 'YYYY-MM-DD' is
 * given), from Android Usage access, read-only.
 * Re-read when the screen gains focus and when Bond returns to the front
 * (Usage access may have just been turned on or off in Android Settings).
 * `reload` rejects on failure so pull to refresh can report it.
 */
export function useMyUsage(day?: string): { state: MyUsageState; reload: () => Promise<void> } {
  const [state, setState] = useState<MyUsageState>({ kind: 'loading' });
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const reload = useCallback(async () => {
    const support = getUsageSupport();
    if (support !== 'ready') {
      setState({ kind: support });
      return;
    }
    if (!hasUsageAccess()) {
      setState({ kind: 'no-access' });
      return;
    }
    try {
      const [y, m, d] = (day ?? '').split('-').map(Number);
      const usage = await readDayUsage(day && y && m && d ? new Date(y, m - 1, d) : new Date());
      if (mounted.current) setState({ kind: 'ready', usage, readAt: Date.now() });
    } catch (e) {
      if (mounted.current) setState({ kind: 'error', message: (e as Error)?.message ?? 'Could not read usage.' });
      throw e;
    }
  }, [day]);

  // Another day was chosen: show Loading, never the previous day's numbers.
  useEffect(() => {
    setState({ kind: 'loading' });
  }, [day]);

  useFocusEffect(
    useCallback(() => {
      void reload().catch(() => {});
    }, [reload]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') void reload().catch(() => {});
    });
    return () => sub.remove();
  }, [reload]);

  return { state, reload };
}
