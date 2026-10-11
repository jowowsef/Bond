import { Linking } from 'react-native';
import BondUsage from '../../modules/bond-usage';
import { askChoice, askConfirm } from './consent';
import { getUsageSupport, hasUsageAccess, openUsageAccessSettings } from './screenTime';

/**
 * The ONE way Bond asks for Android's "Usage access" (Screen Time and
 * Currently Using both need it). Bond never grants it itself and never tries
 * to get around Android's protections.
 *
 *  1. First time: a Bond explanation, then Android's Usage access page only
 *     if the person taps "Open settings".
 *  2. If the person came back and it is STILL off, Bond does not just send
 *     them to the same page again (that can be a loop when Android blocks
 *     it). It explains Android's "Restricted setting" instead, with the
 *     official way to allow it: App info > ⋮ > "Allow restricted settings",
 *     and offers App info, the Usage access page, or Not now.
 *
 * Android has no public way to tell an ordinary "off" from a restricted-
 * setting block, so Bond says it MAY be blocked, never that it is. When the
 * person turns it on, every screen notices on its own when Bond comes back
 * to the front (they read the real state again).
 */

/** When Bond last opened the Usage access page in this session (0 = never). */
let lastOpenedAt = 0;

/** Who installed Bond, if Android says (null = not from an app store, or unknown). */
export function installInfo(): { fromStore: boolean | null; sdkInt: number | null } {
  try {
    const info = BondUsage?.getInstallSource?.();
    if (!info) return { fromStore: null, sdkInt: null };
    const stores = ['com.android.vending', 'com.sec.android.app.samsungapps', 'com.amazon.venezia'];
    return { fromStore: !!info.installer && stores.includes(info.installer), sdkInt: info.sdkInt };
  } catch {
    return { fromStore: null, sdkInt: null };
  }
}

/** Forget the attempt (for example after it worked). */
export function resetUsageAccessAttempts(): void {
  lastOpenedAt = 0;
}

/**
 * Ask for Usage access for `purpose` (a short sentence about what it is for).
 * Resolves when the dialog closes; the real state is read again by the
 * screens when Bond returns to the front.
 */
export async function requestUsageAccess(purpose: string): Promise<void> {
  if (getUsageSupport() !== 'ready') return;
  if (hasUsageAccess()) {
    lastOpenedAt = 0;
    return;
  }

  if (lastOpenedAt > 0) {
    // They went to the page before and it is still off: explain instead of looping.
    const { fromStore, sdkInt } = installInfo();
    const sideloaded = fromStore === false && (sdkInt ?? 0) >= 33;
    const choice = await askChoice({
      title: 'Usage access is still off',
      body: sideloaded
        ? 'Bond was installed from a file instead of an app store, so Android may treat Usage access as a "Restricted setting" and refuse it ("Controlled by Restricted Setting").'
        : 'If Android showed "Controlled by Restricted Setting", it is blocking this permission for Bond until you allow it.',
      points: [
        'Open Bond\'s App info, tap ⋮ (top right), then "Allow restricted settings" and confirm.',
        'Then open Usage access again, find Bond and turn it on.',
        'Bond can\'t change this itself. Other features keep working without it.',
      ],
      confirmLabel: 'Open App info',
      secondaryLabel: 'Open Usage access',
      cancelLabel: 'Not now',
      icon: 'alert-circle-outline',
    });
    if (choice === 'confirm') await Linking.openSettings().catch(() => undefined);
    else if (choice === 'secondary') {
      lastOpenedAt = Date.now();
      openUsageAccessSettings();
    }
    return;
  }

  const go = await askConfirm(
    'Turn on Usage access',
    `${purpose} Android only allows this after you turn on "Usage access" for Bond. Android will open that page: find Bond, turn it on, then come back. Bond notices it by itself.`,
    'Open settings',
    'Not now',
    false,
    'settings-outline',
  );
  if (!go) return;
  lastOpenedAt = Date.now();
  openUsageAccessSettings();
}
