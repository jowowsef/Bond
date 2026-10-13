import { useCallback, useEffect, useState } from 'react';
import { AppState, Linking } from 'react-native';
import BondUsage from '../../modules/bond-usage';
import { askChoice, askConfirm } from './consent';
import { installInfo } from './usageAccessFlow';

/**
 * LIVE CURRENTLY USING (optional, off by default)
 *
 * Bond's accessibility service (modules/bond-usage BondAppWatchService) tells
 * Bond the moment another app comes to the front, so the partner sees it
 * within a second or two. Only the app's package name is read, never anything
 * on the screen. It only adds speed to Currently Using: nothing is shared
 * unless Currently Using sharing is on, and without Live mode Bond falls back
 * to Android's usage log (slower on some phones).
 *
 * Only the phone's owner can turn it on, in Android's Accessibility settings;
 * Bond explains first and opens that page. They can turn it off there anytime.
 *
 * Status:
 *  - 'unavailable': this copy of Bond is too old;
 *  - 'off':         not turned on in Android;
 *  - 'on':          on and running;
 *  - 'closed':      turned on, but the phone closed it (Android usually
 *                   restarts it; opening Bond helps).
 */
export type LiveStatus = 'unavailable' | 'off' | 'on' | 'closed';

export function readLiveStatus(): LiveStatus {
  try {
    const s = BondUsage?.getLiveStatus?.();
    if (!s) return 'unavailable';
    if (!s.enabled) return 'off';
    return s.connected ? 'on' : 'closed';
  } catch {
    return 'unavailable';
  }
}

/** When Live mode last saw an app switch (ms, 0 = not yet / not available). */
export function liveLastChangeAt(): number {
  try {
    return BondUsage?.getLiveStatus?.()?.lastChangeAt ?? 0;
  } catch {
    return 0;
  }
}

/** The status, read again whenever Bond comes back to the front (after Android Settings). */
export function useLiveStatus(): { status: LiveStatus; refresh: () => void } {
  const [status, setStatus] = useState<LiveStatus>(() => readLiveStatus());
  const refresh = useCallback(() => setStatus(readLiveStatus()), []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);
  return { status, refresh };
}

let closedNoted = false;

/**
 * Write to the diagnostics log (once per app start) when Live mode is turned
 * on in Android but isn't running: the phone closed it and Android didn't
 * bring it back, so it must be turned off and on again in Accessibility.
 */
export function noteLiveIfClosed(log: (message: string) => void): void {
  if (closedNoted || readLiveStatus() !== 'closed') return;
  closedNoted = true;
  log('live: turned on in Android but NOT running (the phone closed it); turn it off and on again in Accessibility');
}

/** When Bond last opened the Accessibility page in this session (0 = never). */
let lastOpenedAt = 0;

function openAccessibility(): void {
  lastOpenedAt = Date.now();
  try {
    BondUsage?.openAccessibilitySettings?.();
  } catch {
    void Linking.openSettings().catch(() => undefined);
  }
}

/**
 * Explain Live mode, then open Android's Accessibility settings (only if the
 * person agrees). If they went there before and it is still off, explain
 * Android's "Restricted setting" (common for apps installed from a file)
 * instead of sending them to the same page again.
 */
export async function requestLiveMode(partnerName: string): Promise<void> {
  const status = readLiveStatus();
  if (status === 'unavailable' || status === 'on') return;

  if (status === 'off' && lastOpenedAt > 0) {
    const { fromStore, sdkInt } = installInfo();
    const sideloaded = fromStore === false && (sdkInt ?? 0) >= 33;
    const choice = await askChoice({
      title: 'Accessibility is still off',
      body: sideloaded
        ? 'Bond was installed from a file, so Android may show Bond as a "Restricted setting" and not let you turn it on.'
        : 'If Android showed "Restricted setting", it blocks this for Bond until you allow it.',
      points: [
        'Open Bond\'s App info, tap ⋮ (top right), then "Allow restricted settings" and confirm.',
        'Then open Accessibility again, find Bond in the list (under Installed apps or Downloaded apps) and turn it on.',
        'Currently Using keeps working without it, just less often.',
      ],
      confirmLabel: 'Open App info',
      secondaryLabel: 'Open Accessibility',
      cancelLabel: 'Not now',
      icon: 'alert-circle-outline',
    });
    if (choice === 'confirm') await Linking.openSettings().catch(() => undefined);
    else if (choice === 'secondary') openAccessibility();
    return;
  }

  if (status === 'closed') {
    const go = await askConfirm(
      'Live app detection was closed',
      'Accessibility is still on for Bond, but your phone closed it. In Accessibility, find Bond in the list and turn it off and on again.',
      'Open settings',
      'Not now',
      false,
      'phone-portrait-outline',
    );
    if (go) openAccessibility();
    return;
  }

  // Installed from a file on Android 13+: Android blocks the switch
  // ("Restricted setting") until it is allowed in App info, so say that first.
  const { fromStore, sdkInt } = installInfo();
  const restricted = fromStore !== true && (sdkInt ?? 0) >= 33;
  const choice = await askChoice({
    title: 'Turn on Accessibility',
    body: `So ${partnerName} sees the app you switch to right away. Bond only learns the name of the app that came to the front.`,
    points: [
      ...(restricted
        ? ['First: open App info, tap ⋮ (top right), then "Allow restricted settings" and confirm. Android needs this because Bond was installed from a file.']
        : []),
      'In Accessibility, find Bond in the list (under Installed apps or Downloaded apps) and turn it on.',
      'Android will ask to allow full control ("view and control screen" / "view and perform actions"). Tap Allow. That warning is expected: Android shows it for every app of this kind. Bond is set up so it can’t read your screen; it only learns the app’s name, and it never performs any actions.',
      'Then come back to Bond: the status changes to On. You can turn it off there anytime.',
    ],
    confirmLabel: 'Open Accessibility settings',
    secondaryLabel: restricted ? 'Open App info first' : undefined,
    cancelLabel: 'Not now',
    icon: 'phone-portrait-outline',
  });
  if (choice === 'confirm') openAccessibility();
  else if (choice === 'secondary') await Linking.openSettings().catch(() => undefined);
}

/** Android's "Let Bond always run in the background?" (the person chooses Allow or Deny). */
export function requestUnrestrictedBattery(): boolean {
  try {
    return BondUsage?.requestUnrestrictedBattery?.() ?? false;
  } catch {
    return false;
  }
}
