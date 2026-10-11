import { useFocusEffect } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { getWebSupport, readWebStatus, shareWebStatus, type WebStatus, type WebSupport } from '@/lib/webProtection';

/**
 * This phone's real Web Protection state, re-read on focus and whenever Bond
 * returns to the front (the owner may have changed it in Android Settings).
 * Each read also updates the on/off status the partner sees.
 */
export function useWebProtection(userId: string | null): {
  support: WebSupport;
  status: WebStatus | null;
  refresh: () => WebStatus | null;
} {
  const support = getWebSupport();
  const [status, setStatus] = useState<WebStatus | null>(() => readWebStatus());

  const refresh = useCallback(() => {
    const s = readWebStatus();
    setStatus(s);
    if (userId && s) void shareWebStatus(userId, s).catch(() => undefined);
    return s;
  }, [userId]);

  useFocusEffect(
    useCallback(() => {
      refresh();
    }, [refresh]),
  );
  useEffect(() => {
    const sub = AppState.addEventListener('change', (st) => {
      if (st === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return { support, status, refresh };
}
