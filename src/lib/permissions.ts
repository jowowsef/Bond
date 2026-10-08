import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import BondNative from '@modules/bond-native';

/** Current state of every Android permission/setting Bond relies on. */
export type PermissionReport = {
  notifications: boolean;
  locationForeground: boolean;
  locationBackground: boolean;
  usageAccess: boolean;
  vpnPermission: boolean;
  vpnRunning: boolean;
  vpnNeeded: boolean;
  accessibilityEnabled: boolean;
  batteryOptimizationIgnored: boolean;
  adultListSize: number;
  gamblingListSize: number;
  sdkInt: number;
  deviceModel: string;
};

export async function getPermissionReport(): Promise<PermissionReport> {
  const [notif, fg, bg] = await Promise.all([
    Notifications.getPermissionsAsync().catch(() => null),
    Location.getForegroundPermissionsAsync().catch(() => null),
    Location.getBackgroundPermissionsAsync().catch(() => null),
  ]);
  const protection = safe(() => BondNative.getProtectionStatus(), {
    vpnPermission: false,
    vpnRunning: false,
    vpnNeeded: false,
    accessibilityEnabled: false,
    adultListSize: 0,
    gamblingListSize: 0,
  });
  const info = safe(() => BondNative.getDeviceInfo(), {
    sdkInt: 0,
    manufacturer: '',
    model: 'Unknown',
    packageName: '',
  });
  return {
    notifications: !!notif?.granted,
    locationForeground: !!fg?.granted,
    locationBackground: !!bg?.granted,
    usageAccess: safe(() => BondNative.hasUsageAccess(), false),
    vpnPermission: protection.vpnPermission,
    vpnRunning: protection.vpnRunning,
    vpnNeeded: protection.vpnNeeded,
    accessibilityEnabled: protection.accessibilityEnabled,
    batteryOptimizationIgnored: safe(() => BondNative.isIgnoringBatteryOptimizations(), false),
    adultListSize: protection.adultListSize,
    gamblingListSize: protection.gamblingListSize,
    sdkInt: info.sdkInt,
    deviceModel: `${info.manufacturer} ${info.model}`.trim(),
  };
}

/** Run a native call; if the native module isn't available, use a fallback. */
export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}
