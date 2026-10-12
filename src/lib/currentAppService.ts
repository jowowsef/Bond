import * as TaskManager from 'expo-task-manager';
import { uploadBatteryReading } from './battery';
import { currentAppSharingAllowed, recordObservation } from './currentApp';
import {
  CURRENT_APP_TASK,
  currentAppGeneration,
  logDiagnostic,
  serviceModes,
  stopCurrentAppService,
  updateServiceModes,
} from './currentAppServiceControl';
import { deliverPendingAlerts } from './partnerAlerts';
import { syncScreenTime } from './screenTime';
import { supabase } from './supabase';
import { checkSyncAllowed } from './syncGate';

/**
 * Receives each report from Bond's one background service
 * (modules/bond-usage CurrentAppService) and uploads it, only after checking
 * every rule again:
 *  - always: signed in, paired with both members, setup finished;
 *  - an app report: Currently Using sharing on + Usage access;
 *  - a battery report: battery sharing on;
 *  - a screen time report: screen time sharing on + Usage access (checked in
 *    syncScreenTime).
 * If a rule is definitely no longer true, only the affected part stops
 * (turning off Currently Using doesn't stop battery, and the other way
 * round); when nothing is left, the service stops with its notification. If
 * the server just can't be reached, the service is told to send it again
 * later ({ retry: true }).
 *
 * Every decision is written to the local diagnostics log (never uploaded),
 * so a detection problem can be told apart from an upload problem.
 *
 * The service asks for screen time itself (its own part, about every 15
 * minutes while the screen is on). It also picks up partner alerts.
 *
 * Must be defined at startup (imported from lib/backgroundJobs.ts, which the
 * app entry imports), because the service may start Bond's JavaScript
 * without a screen to deliver a report.
 */

/**
 * A recent 'allowed' answer is reused for a minute, so a burst of app switches
 * doesn't repeat the sign-in / pairing / setup reads every time. Each
 * feature's own consent is still checked for every report, and the answer is
 * forgotten at once on unpair / sign-out (see currentAppGeneration).
 */
const GATE_REUSE_MS = 60_000;
let lastAllowed: { userId: string; at: number } | null = null;

let lastAlertCheck = 0;

let cachedGeneration = currentAppGeneration();

type Gate = { userId: string } | { kind: 'denied' | 'unknown'; reason: string };

async function allowedUserId(): Promise<Gate> {
  // Unpair / sign-out / turned off since the last answer: forget it.
  if (cachedGeneration !== currentAppGeneration()) {
    cachedGeneration = currentAppGeneration();
    lastAllowed = null;
  }
  if (lastAllowed && Date.now() - lastAllowed.at < GATE_REUSE_MS) return { userId: lastAllowed.userId };
  const verdict = await checkSyncAllowed();
  if (verdict.kind !== 'allowed') {
    lastAllowed = null;
    return verdict;
  }
  lastAllowed = { userId: verdict.userId, at: Date.now() };
  return { userId: verdict.userId };
}

/** Stop only one part of the service (the other keeps running if it is on). */
async function dropPart(part: 'apps' | 'battery' | 'screenTime', why: string): Promise<void> {
  const now = serviceModes();
  const next = {
    apps: part === 'apps' ? false : now.apps,
    battery: part === 'battery' ? false : now.battery,
    screenTime: part === 'screenTime' ? false : now.screenTime,
  };
  logDiagnostic(`${part} stopped: ${why}`);
  if (!(await updateServiceModes(next))) await stopCurrentAppService();
}

export type NativeReport = {
  kind?: 'app' | 'battery' | 'screen_time';
  packageName?: string | null;
  appName?: string | null;
  level?: number;
  charging?: boolean;
  observedAt?: number;
  reason?: 'change' | 'heartbeat' | 'retry' | 'refresh' | 'no-access';
};

type TaskResult = { retry: boolean };

/** The task body (exported for tests). */
export async function handleReport(report: NativeReport): Promise<TaskResult> {
  const kind = report.kind ?? 'app';

  // While the service keeps Bond running, partner alerts addressed to me are
  // picked up with its next report (at most once a minute), even without push.
  if (Date.now() - lastAlertCheck >= 60_000) {
    lastAlertCheck = Date.now();
    void supabase.auth
      .getSession()
      .then(({ data: auth }) => (auth.session?.user.id ? deliverPendingAlerts(auth.session.user.id) : undefined))
      .catch(() => undefined);
  }

  try {
    if (kind === 'app' && report.reason === 'no-access') {
      await dropPart('apps', 'Usage access was turned off in Android');
      return { retry: false };
    }
    const gate = await allowedUserId();
    if ('kind' in gate) {
      if (gate.kind === 'unknown') {
        logDiagnostic(`${kind}: not uploaded, will retry (${gate.reason})`);
        return { retry: true };
      }
      logDiagnostic(`service stopped: ${gate.reason}`);
      await stopCurrentAppService();
      return { retry: false };
    }
    const userId = gate.userId;

    if (kind === 'screen_time') {
      const st = await syncScreenTime(userId).catch((e: unknown) => ({ status: 'error' as const, message: String((e as Error)?.message ?? e) }));
      if (st.status === 'not-sharing' || st.status === 'no-access' || st.status === 'needs-update') {
        await dropPart('screenTime', st.status === 'not-sharing' ? 'screen time sharing is off' : 'Usage access is off');
        return { retry: false };
      }
      logDiagnostic(`screen time: ${st.status === 'synced' ? 'uploaded' : 'upload failed, will retry'}`);
      return { retry: st.status === 'error' };
    }

    if (kind === 'battery') {
      const r = await uploadBatteryReading(userId, report.level ?? 0, !!report.charging);
      if (r === 'not-sharing') {
        await dropPart('battery', 'battery sharing is off');
        return { retry: false };
      }
      logDiagnostic(`battery ${report.level}%: ${r === 'uploaded' ? 'uploaded' : 'upload failed, will retry'}`);
      return { retry: r === 'failed' };
    }

    const allowed = await currentAppSharingAllowed(userId);
    if (allowed === 'no') {
      lastAllowed = null;
      await dropPart('apps', 'Currently Using is off or Usage access is missing');
      return { retry: false };
    }
    if (allowed === 'unknown') {
      logDiagnostic('app: not uploaded, will retry (setting check failed)');
      return { retry: true };
    }
    const result = await recordObservation(userId, {
      app: report.packageName && report.appName ? { packageName: report.packageName, appName: report.appName } : null,
      observedAt: typeof report.observedAt === 'number' ? report.observedAt : Date.now(),
    });
    logDiagnostic(`app ${report.packageName ?? 'none'}: ${result}`);

    return { retry: result === 'failed' };
  } catch (e) {
    logDiagnostic(`${kind}: error ${(e as Error)?.message ?? ''}`.trim());
    return { retry: true }; // never crash the background service
  }
}

TaskManager.defineTask(CURRENT_APP_TASK, async ({ data, error }): Promise<TaskResult> => {
  if (error) return { retry: false };
  return handleReport((data ?? {}) as NativeReport);
});
