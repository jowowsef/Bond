import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { askConfirm, confirmSharing, confirmStopSharing } from '@/lib/consent';
import {
  disableCurrentAppSharing,
  enableCurrentAppSharing,
  readCurrentAppSetting,
  recordCurrentAppChoice,
  readCurrentAppChoice,
  type CurrentAppSetting,
} from '@/lib/currentApp';
import { reconcileBackgroundService } from '@/lib/backgroundService';
import { currentAppServiceAvailable, serviceModes, updateServiceModes } from '@/lib/currentAppServiceControl';
import { getUsageSupport, hasUsageAccess } from '@/lib/screenTime';
import { requestUsageAccess } from '@/lib/usageAccessFlow';
import { getNotificationState, requestNotifications } from '@/lib/setupPermissions';
import { useCouple } from '@/state/couple';

/**
 * The real state of MY "Currently Using" sharing, from the saved setting,
 * Android's permissions and the native service (never guessed):
 *  - 'off':          sharing is off,
 *  - 'needs-access': sharing is on, but Android's Usage access is off, so
 *                    nothing can be read or shared,
 *  - 'starting':     on + Usage access, the service hasn't started yet,
 *  - 'running':      on + Usage access, the service is running,
 *  - 'open-only':    on + Usage access, but this build has no background
 *                    service (older Bond): checked only when Bond is opened or left,
 *  - 'unavailable':  the server isn't updated for this yet (migration 0008),
 *  - 'needs-update': this Bond has no Usage module,
 *  - 'error' / 'loading'.
 */
export type CurrentAppStatus =
  | 'loading'
  | 'off'
  | 'needs-access'
  | 'starting'
  | 'running'
  | 'open-only'
  | 'unavailable'
  | 'needs-update'
  | 'error';

/**
 * MY "Currently Using" sharing: the ONE flow used by Settings, Home and
 * Sharing setup.
 *
 * Every new pairing starts with it OFF (like all sharing).
 * Turning ON: the explanation of what is shared is shown ONCE per
 * account (Cancel / Agree); after that it is remembered and never asked again. Then sharing is switched on, and if Android's
 * Usage access is missing, Bond says so and opens that Settings page only
 * when the person taps Open settings. The switch only shows ON once sharing
 * really works (setting on AND Usage access on).
 * Turning OFF: immediately, without a confirmation; the service stops, no
 * new uploads, the last shared app is deleted, and the OFF choice is
 * remembered (a new pairing won't turn it back on).
 */
export function useCurrentAppSharing(userId: string | null, partnerName: string) {
  const { session, phase, pairingSetup } = useCouple();
  const [setting, setSetting] = useState<CurrentAppSetting | null>(null);
  const [access, setAccess] = useState(() => hasUsageAccess());
  const [serviceRunning, setServiceRunning] = useState(() => serviceModes().apps);
  const [notificationsOff, setNotificationsOff] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const lastAttempt = useRef<boolean | null>(null);
  const ready = phase === 'paired' && pairingSetup === 'done';

  const readLocal = useCallback(async () => {
    setAccess(hasUsageAccess());
    setServiceRunning(serviceModes().apps);
    setNotificationsOff((await getNotificationState().catch(() => 'granted')) === 'denied');
  }, []);

  const reload = useCallback(async () => {
    await readLocal();
    if (!userId) return;
    const s = await readCurrentAppSetting(userId);
    setSetting(s);
    // Sharing was turned on (through the dialog) before consent was
    // remembered: remember it now. A pairing's default-on is not consent and
    // is left as it is.
    const known = readCurrentAppChoice(session);
    if (s.kind === 'on' && !known.consented && !known.defaultOn) void recordCurrentAppChoice('on');
  }, [userId, readLocal, session]);

  useEffect(() => {
    void reload();
    const sub = AppState.addEventListener('change', (st) => {
      if (st !== 'active') return;
      void reload(); // back from Android Settings: read everything again
      setTimeout(() => void readLocal(), 2500); // the service starts a moment later
    });
    return () => sub.remove();
  }, [reload, readLocal]);

  /** Explain the missing Android permission, then open its page only on "Open settings". */
  const openAccessSettings = useCallback(() => {
    void requestUsageAccess('Currently Using needs to see which app is open; sharing starts by itself once it is on.');
  }, []);

  /** Android 13+: without notification permission the service still runs, but its notification is hidden. */
  const allowNotifications = useCallback(() => {
    void (async () => {
      const go = await askConfirm(
        'Show the sharing notification',
        'While Bond checks which app is open, Android shows a notification so you always know. Notifications are off ' +
          'for Bond, so it is hidden right now. Android will ask you to allow notifications.',
        'Continue',
        'Not now',
      );
      if (!go) return;
      await requestNotifications();
      await readLocal();
    })();
  }, [readLocal]);

  const turnOn = useCallback(async () => {
    if (!userId) return;
    if (getUsageSupport() !== 'ready') {
      setError('This copy of Bond is too old for Currently Using. Install the newest version.');
      return;
    }
    // One-time consent per account (remembered afterwards).
    if (!readCurrentAppChoice(session).consented) {
      const agreed = await confirmSharing('current_app', partnerName, { cancel: 'Cancel', confirm: 'Agree' });
      if (!agreed) return; // stays off
    }
    setBusy(true);
    setSetting({ kind: 'on' }); // the switch follows right away; corrected below if it fails
    const r = await enableCurrentAppSharing(userId);
    if (!r.ok) {
      setBusy(false);
      setError(r.message ?? 'Could not turn this on.');
      await reload();
      return;
    }
    await recordCurrentAppChoice('on');
    const allowed = hasUsageAccess();
    // Adds app checks to the one background service (battery keeps its part).
    if (allowed && ready) await reconcileBackgroundService(userId, partnerName).catch(() => null);
    setBusy(false);
    await reload();
    setTimeout(() => void readLocal(), 2500);
    if (!allowed) openAccessSettings();
  }, [userId, session, partnerName, ready, reload, readLocal, openAccessSettings]);

  const turnOff = useCallback(async () => {
    if (!userId) return;
    setBusy(true);
    setSetting({ kind: 'off' }); // the switch follows right away; corrected below if it fails
    // Stop app checks at once; battery sharing (if on) keeps running.
    const m = serviceModes();
    if (m.running) await updateServiceModes({ apps: false, battery: m.battery, screenTime: m.screenTime });
    const r = await disableCurrentAppSharing(userId);
    if (r.ok) await recordCurrentAppChoice('off');
    else setError(r.message ?? 'Could not turn this off.');
    if (ready) await reconcileBackgroundService(userId, partnerName).catch(() => null);
    setBusy(false);
    await reload();
  }, [userId, partnerName, ready, reload]);

  /** The switch. ON while sharing is on but Usage access is missing = fix the permission. */
  const toggle = useCallback(
    (next: boolean) => {
      if (inFlight.current || !userId) return;
      inFlight.current = true;
      lastAttempt.current = next;
      setError(null);
      void (async () => {
        try {
          if (next && setting?.kind === 'on' && !hasUsageAccess()) openAccessSettings();
          else if (next) await turnOn();
          else if (await confirmStopSharing('current_app', partnerName)) await turnOff(); // Cancel: nothing changes
        } catch {
          setError('Something went wrong. Check your connection and try again.');
        } finally {
          inFlight.current = false;
        }
      })();
    },
    [userId, setting, turnOn, turnOff, openAccessSettings, partnerName],
  );

  const retry = useCallback(() => {
    setError(null);
    if (lastAttempt.current === null) void reload();
    else toggle(lastAttempt.current);
  }, [reload, toggle]);

  let status: CurrentAppStatus;
  if (getUsageSupport() !== 'ready') status = 'needs-update';
  else if (!setting) status = 'loading';
  else if (setting.kind === 'unavailable') status = 'unavailable';
  else if (setting.kind === 'error') status = 'error';
  else if (setting.kind === 'off') status = 'off';
  else if (!access) status = 'needs-access';
  else if (!currentAppServiceAvailable()) status = 'open-only';
  else status = serviceRunning ? 'running' : 'starting';

  /** Only ON when sharing really works (never ON while a permission is missing). */
  const switchValue = status === 'running' || status === 'starting' || status === 'open-only';
  const switchDisabled = busy || status === 'loading' || status === 'unavailable' || status === 'needs-update';

  return {
    status,
    switchValue,
    switchDisabled,
    busy,
    error,
    notificationsOff,
    toggle,
    retry,
    openAccessSettings,
    allowNotifications,
    reload,
    ready,
  };
}

/** Short, truthful status text for my own sharing. */
export function currentAppStatusText(status: CurrentAppStatus, partnerName: string, ready = true): string {
  switch (status) {
    case 'running':
      return `On. ${partnerName} sees the app open on your phone (checked about every 20 seconds while the screen is on).`;
    case 'starting':
      return ready
        ? 'On. Starting the background checkâ€¦ If this stays, open Bond again (Android only starts it while Bond is open).'
        : 'On. It starts once setup is finished.';
    case 'open-only':
      return 'On, but this copy of Bond can only check when Bond is opened or left. Install the newest version for background checks.';
    case 'needs-access':
      return 'Waiting for Android: Usage access is off for Bond, so nothing is shared yet.';
    case 'off':
      return `Off. ${partnerName} doesn't see which app you use.`;
    case 'unavailable':
      return 'Not available yet: Bond needs a server update for this.';
    case 'needs-update':
      return 'Needs the newest version of Bond on this phone.';
    case 'error':
      return "Couldn't read this setting. Check your connection.";
    default:
      return 'Checkingâ€¦';
  }
}

