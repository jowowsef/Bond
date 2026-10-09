import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import { Linking } from 'react-native';

/**
 * HONEST PERMISSION HELPERS
 *
 * These only use the Expo modules that are actually part of the current
 * build (expo-notifications, expo-location). We never pretend a permission
 * was granted — we ask Android, then report back the real state. When Android
 * requires the user to visit a system Settings page, we open it.
 *
 * Usage Access (for Screen Time) and other native-only permissions are NOT
 * here: they need the native Bond module that isn't in this build yet, so the
 * UI shows them honestly as "available in a later update" rather than faking
 * a status.
 */

export type PermissionState = 'granted' | 'denied' | 'undetermined' | 'unavailable';

export type FeatureKey = 'notifications' | 'location';

export type FeatureInfo = {
  key: FeatureKey;
  title: string;
  description: string;
  required: boolean;
  icon: 'notifications-outline' | 'location-outline';
};

export const SETUP_FEATURES: FeatureInfo[] = [
  {
    key: 'notifications',
    title: 'Notifications',
    description: 'So you see requests and updates from your partner, even when Bond is closed.',
    required: false,
    icon: 'notifications-outline',
  },
  {
    key: 'location',
    title: 'Location sharing',
    description: 'Let your partner see your location while this is on. You can turn it off anytime (with their approval).',
    required: false,
    icon: 'location-outline',
  },
];

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
    await openAppSettings();
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

/** Asks for the OS location permission. Does NOT turn on sharing by itself. */
export async function requestLocationPermission(): Promise<PermissionState> {
  const current = await Location.getForegroundPermissionsAsync();
  if (current.granted) return 'granted';
  if (!current.canAskAgain) {
    await openAppSettings();
    return 'denied';
  }
  const asked = await Location.requestForegroundPermissionsAsync();
  return asked.granted ? 'granted' : asked.canAskAgain ? 'undetermined' : 'denied';
}

export async function getFeatureState(key: FeatureKey): Promise<PermissionState> {
  return key === 'notifications' ? getNotificationState() : getLocationState();
}

export async function requestFeature(key: FeatureKey): Promise<PermissionState> {
  return key === 'notifications' ? requestNotifications() : requestLocationPermission();
}

export async function openAppSettings(): Promise<void> {
  try {
    await Linking.openSettings();
  } catch {
    // Some devices restrict this; nothing else we can safely do.
  }
}

/**
 * Screen Time needs Android's Usage Access, which depends on the native Bond
 * module that isn't in this build yet. Kept as a single flag so screens can
 * stay honest; it flips to true only when that native support actually ships.
 */
export const USAGE_ACCESS_AVAILABLE: boolean = false;
