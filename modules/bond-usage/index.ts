import { requireOptionalNativeModule } from 'expo';

/**
 * Bond Screen Time native module (Android, read-only).
 *
 * Loaded OPTIONALLY: if the installed app was built before this module
 * existed, this is null and the app shows "Needs an app update" instead of
 * crashing or inventing numbers. Fields added later (hourly, lastUsedMs,
 * getAppIcons) are optional for the same reason.
 */
export type UsageApp = {
  packageName: string;
  appName: string;
  foregroundMs: number;
  launches: number;
  /** Last moment in the period the app was on screen (ms since 1970, 0 = unknown). */
  lastUsedMs?: number;
};
/** Screen time inside one clock hour starting at startMs. */
export type UsageHour = { startMs: number; ms: number };
export type UsageResult = { totalMs: number; launches: number; apps: UsageApp[]; hourly?: UsageHour[] };

type BondUsageNative = {
  hasUsageAccess(): boolean;
  openUsageAccessSettings(): void;
  getUsage(startMs: number, endMs: number): Promise<UsageResult>;
  getAppIcons?(packages: string[], sizePx: number): Promise<Record<string, string | null>>;
  /** "Currently Using" foreground service (builds from this version on). */
  startCurrentAppService?(
    taskName: string,
    options: {
      title: string;
      body: string;
      intervalMs: number;
      heartbeatMs: number;
      /** App checks for Currently Using (needs Usage access). */
      watchApps?: boolean;
      /** Battery changes for battery sharing. */
      watchBattery?: boolean;
    },
  ): Promise<void>;
  stopCurrentAppService?(taskName: string): Promise<void>;
  isCurrentAppServiceRunning?(): boolean;
  getBackgroundServiceModes?(): { running: boolean; apps: boolean; battery: boolean };
  updateBackgroundServiceModes?(apps: boolean, battery: boolean): boolean;
  getBackgroundDiagnostics?(): string[];
  clearBackgroundDiagnostics?(): void;
  logBackgroundDiagnostic?(message: string): void;
  /** Which app installed Bond (null = unknown / sideloaded) and the Android version. */
  getInstallSource?(): { installer: string | null; sdkInt: number };
};

const BondUsage = requireOptionalNativeModule<BondUsageNative>('BondUsage');

export default BondUsage;
