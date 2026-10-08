import { NativeModule, requireNativeModule } from 'expo';

export type AppUsage = {
  packageName: string;
  appName: string;
  foregroundMs: number;
  launches: number;
};

export type UsageResult = {
  totalMs: number;
  launches: number;
  apps: AppUsage[];
};

export type InstalledApp = {
  packageName: string;
  appName: string;
};

export type ControlsConfig = {
  webCategories: string[];
  blockedDomains: string[];
  allowedDomains: string[];
  blockedApps: string[];
  internetBlockedApps: string[];
  appLabels: Record<string, string>;
  partnerName: string;
};

export type ProtectionStatus = {
  vpnPermission: boolean;
  vpnRunning: boolean;
  vpnNeeded: boolean;
  accessibilityEnabled: boolean;
  adultListSize: number;
  gamblingListSize: number;
  startError?: string | null;
};

export type DeviceInfo = {
  sdkInt: number;
  manufacturer: string;
  model: string;
  packageName: string;
};

declare class BondNativeModule extends NativeModule<{}> {
  getDeviceInfo(): DeviceInfo;

  // Screen time
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  getUsage(startMs: number, endMs: number): Promise<UsageResult>;
  getInstalledApps(): Promise<InstalledApp[]>;
  getProtectedPackages(): string[];

  // Website protection
  isVpnPermissionGranted(): boolean;
  requestVpnPermission(): boolean;
  openVpnSettings(): void;
  applyControls(config: ControlsConfig): Promise<ProtectionStatus>;
  getProtectionStatus(): ProtectionStatus;

  // App blocking
  isAccessibilityEnabled(): boolean;
  openAccessibilitySettings(): void;
  openAppDetails(): void;

  // Battery optimisation
  isIgnoringBatteryOptimizations(): boolean;
  openBatteryOptimizationSettings(): void;
}

export default requireNativeModule<BondNativeModule>('BondNative');
