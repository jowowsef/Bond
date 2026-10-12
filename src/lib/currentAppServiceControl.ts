import BondUsage from '../../modules/bond-usage';

/**
 * Start / stop Bond's ONE background foreground service (see modules/bond-usage
 * CurrentAppService). It has three parts: app checks for Currently Using,
 * battery changes for battery sharing, and a screen time summary about every
 * 15 minutes for screen time sharing; it runs while any of them is on. Kept free
 * of other imports so any file can stop it without import cycles. The rules
 * for WHEN it may run live in src/lib/backgroundService.ts (in the app) and
 * src/lib/currentAppService.ts (in the background task).
 */

export type ServiceModes = { apps: boolean; battery: boolean; screenTime: boolean };

export const CURRENT_APP_TASK = 'bond-current-app-watch';

/**
 * Bumped on unpair, sign-out and turning Currently Using off, so anything
 * cached for the old couple (the background task's "allowed" answer) is
 * forgotten at once.
 */
let couplingGeneration = 0;
export function bumpCurrentAppGeneration(): void {
  couplingGeneration++;
}
export function currentAppGeneration(): number {
  return couplingGeneration;
}

/** Checks while the screen is on (Android may stretch this when saving battery). */
export const CHECK_INTERVAL_MS = 20_000;
/** "Still the same app" refresh, so the partner's "Checked" time stays honest. */
export const HEARTBEAT_MS = 10 * 60_000;

/** False on builds made before the service existed (then the older checks still work). */
export function currentAppServiceAvailable(): boolean {
  return typeof BondUsage?.startCurrentAppService === 'function';
}

export function isCurrentAppServiceRunning(): boolean {
  try {
    return BondUsage?.isCurrentAppServiceRunning?.() ?? false;
  } catch {
    return false;
  }
}

/** Which parts of the service are running now (all false when it isn't). */
export function serviceModes(): ServiceModes & { running: boolean } {
  try {
    const m = BondUsage?.getBackgroundServiceModes?.();
    if (m) return { running: m.running, apps: m.apps, battery: m.battery, screenTime: !!m.screenTime };
  } catch {
    // older build
  }
  const running = isCurrentAppServiceRunning();
  return { running, apps: running, battery: false, screenTime: false };
}

/**
 * Change the parts of the RUNNING service (works from the background, where
 * Android doesn't allow starting a foreground service). Nothing left on =
 * stopped. Returns false if the service isn't running.
 */
export async function updateServiceModes(modes: ServiceModes): Promise<boolean> {
  if (!modes.apps && !modes.battery && !modes.screenTime) {
    await stopCurrentAppService();
    return true;
  }
  try {
    return BondUsage?.updateBackgroundServiceModes?.(modes.apps, modes.battery, modes.screenTime) ?? false;
  } catch {
    return false;
  }
}

/** Add a line to the local diagnostics log (never uploaded). */
export function logDiagnostic(message: string): void {
  try {
    BondUsage?.logBackgroundDiagnostic?.(message);
  } catch {
    // older build: no diagnostics
  }
}

/**
 * Start (or update) the service with these parts. Only call while Bond is
 * open (an Android rule) and every rule holds for the parts asked for.
 */
export async function startCurrentAppService(
  _partnerName: string,
  modes: ServiceModes = { apps: true, battery: false, screenTime: false },
): Promise<boolean> {
  if (!currentAppServiceAvailable()) return false;
  if (!modes.apps && !modes.battery && !modes.screenTime) {
    await stopCurrentAppService();
    return false;
  }
  try {
    await BondUsage!.startCurrentAppService!(CURRENT_APP_TASK, {
      // Neutral, short and the same every time (the notification is only
      // updated, never posted again, so it can't alert).
      title: 'Bond',
      body: 'Background activity is running',
      intervalMs: CHECK_INTERVAL_MS,
      heartbeatMs: HEARTBEAT_MS,
      watchApps: modes.apps,
      watchBattery: modes.battery,
      watchScreenTime: modes.screenTime,
    });
    return true;
  } catch {
    return false; // for example Usage access is off: nothing starts
  }
}

/** Stop the service and its notification. Safe to call any time. */
export async function stopCurrentAppService(): Promise<void> {
  bumpCurrentAppGeneration();
  try {
    await BondUsage?.stopCurrentAppService?.(CURRENT_APP_TASK);
  } catch {
    // not running / not available on this build
  }
}
