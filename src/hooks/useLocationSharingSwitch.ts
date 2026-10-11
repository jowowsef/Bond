import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState } from 'react-native';
import { askConfirm, confirmSharing, confirmStopSharing } from '@/lib/consent';
import { stopBackgroundLocation } from '@/lib/backgroundLocation';
import { disableLocationSharing, enableLocationSharing, getLocationAccessInfo } from '@/lib/location';
import { offerBackgroundLocation } from '@/lib/locationPermissionFlow';
import { openAppSettings } from '@/lib/setupPermissions';

const SLOW_MS = 20_000;
type Result = { ok: boolean; message?: string };

/** Never let a hung network call leave the switch stuck. */
function withTimeout(p: Promise<Result>): Promise<Result> {
  return Promise.race([
    p,
    new Promise<Result>((resolve) =>
      setTimeout(
        () => resolve({ ok: false, message: 'This is taking longer than usual. Check your connection and try again.' }),
        SLOW_MS,
      ),
    ),
  ]);
}

/**
 * The ONE location sharing switch logic, used by the Location tab and
 * Settings > Privacy. Each person controls only their own sharing; there is
 * no partner approval.
 *
 *  ON:  explain what the partner sees (Cancel / Confirm) -> Android
 *       "While using the app" permission -> sharing on -> explain Android's
 *       "Allow all the time" (needed to share while Bond is closed) and
 *       offer Settings; skipping it keeps foreground-only sharing.
 *       Foreground permission denied: stays off, with guidance.
 *  OFF: confirm (Cancel / Turn off) -> stop the pipeline, share_location =
 *       false, delete the last shared location (disableLocationSharing).
 *
 * `pending` is the value the switch should SHOW while a dialog is open or
 * the change is saving. Setting it and clearing it afterwards forces the
 * native switch back in sync with the real setting after a Cancel (a
 * controlled Android switch can otherwise stay flipped, so the next tap
 * would ask the opposite question). One attempt at a time: repeated taps
 * can't open a second dialog or a second permission request.
 */
export function useLocationSharingSwitch({
  userId,
  partnerName,
  onChanged,
  offerBackground = true,
}: {
  userId: string | null;
  partnerName: string;
  /** Reload whatever the screen shows (privacy row, markers, couple). */
  onChanged: () => Promise<unknown>;
  /** Offer "Allow all the time" after turning on (off where the screen already covers it). */
  offerBackground?: boolean;
}): { request: (next: boolean) => void; pending: boolean | null; busy: boolean } {
  const [pending, setPending] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const inFlight = useRef(false);
  /** A confirmed "turn on" waiting only for Android's location permission. */
  const pendingEnable = useRef(false);

  const request = useCallback(
    (next: boolean) => {
      if (!userId || inFlight.current) return;
      inFlight.current = true;
      setPending(next);
      void (async () => {
        try {
          if (next) {
            const ok = await confirmSharing('location', partnerName);
            if (!ok) return;
            setBusy(true);
            const result = await withTimeout(enableLocationSharing(userId));
            // Not allowed by Android yet: explain; if the person goes to
            // Settings, setup finishes by itself when they come back with it
            // allowed (they already confirmed; nothing is asked twice).
            if (!result.ok) pendingEnable.current = await explainNotEnabled(result.message);
            // Sharing is on. Background sharing needs Android's own choice.
            else if (offerBackground) await offerBackgroundLocation(partnerName);
          } else {
            pendingEnable.current = false;
            const ok = await confirmStopSharing('location', partnerName);
            if (!ok) return; // Cancel: nothing changes
            setBusy(true);
            const result = await withTimeout(disableLocationSharing(userId));
            if (!result.ok) Alert.alert('Could not turn off', result.message ?? 'Please check your connection and try again.');
            // Background sharing ends with location sharing (and its notification).
            else await stopBackgroundLocation();
          }
          await Promise.race([onChanged(), new Promise((r) => setTimeout(r, SLOW_MS))]).catch(() => undefined);
        } finally {
          inFlight.current = false;
          setBusy(false);
          setPending(null);
        }
      })();
    },
    [userId, partnerName, onChanged, offerBackground],
  );

  // Back from Android Settings after a confirmed "turn on" that was waiting
  // only for Android's location permission: finish it now, once. Never turns
  // sharing on without that earlier confirmation; dropped when this screen
  // goes away (sign-out, unpair) or the person turns sharing off.
  useEffect(() => {
    pendingEnable.current = false;
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active' || !pendingEnable.current || !userId || inFlight.current) return;
      void (async () => {
        const info = await getLocationAccessInfo().catch(() => null);
        if (!info || info.permission !== 'granted') return; // still not allowed: stay off, no new prompt
        pendingEnable.current = false;
        inFlight.current = true;
        setBusy(true);
        try {
          const result = await withTimeout(enableLocationSharing(userId));
          if (result.ok && offerBackground) await offerBackgroundLocation(partnerName);
          else Alert.alert('Location sharing is still off', result.message ?? 'Please try again.');
          await Promise.race([onChanged(), new Promise((r) => setTimeout(r, SLOW_MS))]).catch(() => undefined);
        } finally {
          inFlight.current = false;
          setBusy(false);
        }
      })();
    });
    return () => {
      sub.remove();
      pendingEnable.current = false;
    };
  }, [userId, partnerName, onChanged, offerBackground]);

  return { request, pending, busy };
}

/**
 * Sharing stays OFF; say why, with Open settings when Android blocked the
 * permission. Returns true if the person went to Settings (so the switch can
 * finish turning on when they come back with location allowed).
 */
async function explainNotEnabled(message?: string): Promise<boolean> {
  const info = await getLocationAccessInfo().catch(() => null);
  if (info && info.permission !== 'granted') {
    const go = await askConfirm(
      'Allow location on this phone',
      'Location sharing is still off: Android hasn\'t allowed location for Bond. In Settings, open Permissions > Location and choose "Allow all the time" (or "Allow only while using the app" to share only while Bond is open). Come back to Bond and it finishes by itself.',
      'Open settings',
      'Not now',
      false,
      'location-outline',
    );
    if (go) await openAppSettings();
    return go;
  }
  Alert.alert('Location sharing is still off', message ?? 'Please try again.');
  return false;
}
