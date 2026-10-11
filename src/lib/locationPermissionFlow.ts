import { askConfirm } from './consent';
import { getBackgroundPermission, requestBackgroundPermission, type BackgroundPermission } from './backgroundLocation';
import { openAppSettings } from './setupPermissions';

/**
 * Second part of turning location sharing on (after the person confirmed and
 * Android's "While using the app" permission was granted): explain Android's
 * "Allow all the time" choice and guide to it.
 *
 * Android decides this, never Bond. On Android 11 and newer the choice is not
 * in the first permission dialog: Android opens Bond's location page in
 * Settings, where the person picks "Allow all the time" (or not). Location
 * sharing stays on either way; without it, Bond shares only while it is open.
 *
 * Shown only as part of a person's own action (turning sharing on, or tapping
 * "Allow all the time" on a status line), never by itself, so a decision the
 * person already made is not asked again and again.
 *
 * Resolves with the permission read fresh afterwards. When Settings was
 * opened, the screens re-read it again once the person comes back to Bond.
 */
export async function offerBackgroundLocation(partnerName: string): Promise<BackgroundPermission> {
  const perm = await getBackgroundPermission();
  if (perm === 'granted' || perm === 'no-foreground') return perm;

  const go = await askConfirm(
    'Also share while Bond is closed?',
    `Location sharing is on while Bond is open. To keep sharing with ${partnerName} when Bond is closed or your ` +
      'screen is locked, Android needs "Allow all the time" for Bond.\n\n' +
      'Android will open Bond\'s location page. Choose "Allow all the time", then come back to Bond. While Bond shares ' +
      'in the background, Android shows a notification, and it uses a bit more battery.\n\n' +
      'You can skip this; Bond then shares only while it is open.',
    'Open settings',
    'Not now',
  );
  if (!go) return perm;
  if (perm === 'ask') return requestBackgroundPermission();
  await openAppSettings();
  return getBackgroundPermission();
}
