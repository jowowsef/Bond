import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Linking, Platform } from 'react-native';

/**
 * HONEST PERMISSION HELPERS
 *
 * These only use the Expo modules that are actually part of the current
 * build (expo-notifications, expo-location). We never pretend a permission
 * was granted: we ask Android, then report back the real state. When Android
 * requires the user to visit a system Settings page, we open it.
 *
 * Usage access (Screen Time) and Web Protection live in screenTime.ts and
 * webProtection.ts, next to their native modules.
 */

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

// ---------------- Notifications ----------------
export async function getNotificationState(): Promise<PermissionState> {
  const perm = await Notifications.getPermissionsAsync();
  if (perm.granted) return 'granted';
  if (perm.canAskAgain) return 'undetermined';
  return 'denied';
}

export async function requestNotifications(): Promise<PermissionState> {
  const current = await Notifications.getPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) {
    // Android won't show the dialog again — the user must enable it in Settings.
    await openNotificationSettings();
    return 'denied';
  }
  const asked = await Notifications.requestPermissionsAsync();
  return asked.granted ? 'granted' : asked.canAskAgain ? 'undetermined' : 'denied';
}

// ---------------- Location (foreground) ----------------
export async function getLocationState(): Promise<PermissionState> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (perm.granted) return 'granted';
  if (perm.canAskAgain) return 'undetermined';
  return 'denied';
}

/**
 * Ask Android for location while Bond is in use (the first of Android's two
 * location steps). Only the permission: it never turns on sharing. If
 * Android won't ask again, opens Bond's App info instead.
 */
export async function requestLocationForeground(): Promise<PermissionState> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) {
    await openAppSettings();
    return 'denied';
  }
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.granted ? 'granted' : asked.canAskAgain ? 'undetermined' : 'denied';
}

const ANDROID_PACKAGE = 'com.bond.couple';

/**
 * Bond's own notification page in Android Settings (where the switch is),
 * falling back to App info on devices that don't support it.
 */
export async function openNotificationSettings(): Promise<void> {
  if (Platform.OS === 'android') {
    try {
      await Linking.sendIntent('android.settings.APP_NOTIFICATION_SETTINGS', [
        { key: 'android.provider.extra.APP_PACKAGE', value: ANDROID_PACKAGE },
      ]);
      return;
    } catch {
      // fall back to App info
    }
  }
  await openAppSettings();
}

export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Some devices restrict this; nothing else we can safely do.
  }
}

