import * as BackgroundTask from 'expo-background-task';
import * as Battery from 'expo-battery';
import * as TaskManager from 'expo-task-manager';
import { Linking, Platform } from 'react-native';
import { syncBatteryIfSharing } from './battery';
import { syncCurrentAppIfSharing } from './currentApp';
// Defines the background location task at startup (Android may start Bond
// just to deliver a location while it is closed).
import './backgroundLocation';
// Defines the "Currently Using" task at startup (its native service may start
// Bond's JavaScript without a screen to deliver an observation).
import './currentAppService';
import { deliverPendingAlerts } from './partnerAlerts';
import { syncScreenTime } from './screenTime';
import { supabase } from './supabase';
import { checkSyncAllowed } from './syncGate';
import { readWebStatus, shareWebStatus } from './webProtection';

/**
 * BACKGROUND UPDATES (Android WorkManager, via expo-background-task)
 *
 * These let your battery and screen time reach your partner even when Bond is
 * closed. Honest limits, set by Android, not by Bond:
 * - At most about once every 15 minutes, and Android picks the exact time.
 * - Needs internet; Android may wait longer when the battery is low, the
 *   phone is idle (Doze) or Battery optimization is on for Bond.
 * - Stops completely if someone uses "Force stop" on Bond, until Bond is
 *   opened again. It does resume after a restart of the phone.
 *
 * SEPARATE jobs, so battery, screen time, partner alerts and Web Protection
 * status never share data, checks or
 * privacy switches. Each job checks its own setting before doing anything.
 *
 * Android runs all of them inside ONE scheduled worker, and schedules the
 * next run only after every job has reported back. A job that hangs (for
 * example a network call that never answers) would make Android cancel the
 * worker after about 10 minutes and stop ALL background updates until Bond is
 * opened again. So each job has a time limit (JOB_TIME_LIMIT_MS). (React Native
 * normally pauses JavaScript timers while Bond has no screen open, but
 * expo-task-manager keeps them running while it runs a task, so the limit
 * works in background runs too.)
 *
 * Samsung phones also hold background network work and run it in batches,
 * which can add up to about 30 minutes. Updates are never real time, and the
 * partner's screen shows how old each value is.
 *
 * This file must be imported from the app entry (index.ts) so the jobs are
 * defined even when Android starts Bond in the background without a screen.
 */

export const BATTERY_TASK = 'bond-battery-sync';
export const SCREEN_TIME_TASK = 'bond-screen-time-sync';
export const PARTNER_ALERTS_TASK = 'bond-partner-alerts';
export const WEB_STATUS_TASK = 'bond-web-status-sync';
export const CURRENT_APP_TASK = 'bond-current-app-sync';
const INTERVAL_MINUTES = 15; // Android's minimum
/** Each job finishes (or gives up) well within Android's worker limit. */
const JOB_TIME_LIMIT_MS = 45_000;

type JobResult = BackgroundTask.BackgroundTaskResult;
const { Success, Failed } = BackgroundTask.BackgroundTaskResult;

/** Run one job with a time limit; it always reports back, so the next run gets scheduled. */
function defineJob(name: string, job: () => Promise<JobResult>): void {
  TaskManager.defineTask(name, async () => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        job(),
        new Promise<JobResult>((resolve) => {
          timer = setTimeout(() => resolve(Failed), JOB_TIME_LIMIT_MS);
        }),
      ]);
    } catch {
      return Failed;
    } finally {
      if (timer) clearTimeout(timer);
    }
  });
}

async function signedInUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? null;
}

/**
 * The user id when this account's data may be sent now (signed in, paired
 * with both members, setup finished; see lib/syncGate.ts), otherwise null
 * (then nothing is sent).
 */
async function pairedAndSetUp(): Promise<string | null> {
  const verdict = await checkSyncAllowed();
  return verdict.kind === 'allowed' ? verdict.userId : null;
}

defineJob(BATTERY_TASK, async () => {
  const userId = await pairedAndSetUp();
  if (!userId) return Success;
  await syncBatteryIfSharing(userId); // reads share_battery from the server first
  return Success;
});

defineJob(SCREEN_TIME_TASK, async () => {
  const userId = await pairedAndSetUp();
  if (!userId) return Success;
  const result = await syncScreenTime(userId); // checks Usage access and share_screen_time itself
  return result.status === 'error' ? Failed : Success;
});

// "Currently Using": which app is in front at this check (consent + Usage
// access checked inside; pairing and setup checked here).
defineJob(CURRENT_APP_TASK, async () => {
  const userId = await pairedAndSetUp();
  if (userId) await syncCurrentAppIfSharing(userId);
  return Success;
});

// Receiving side of partner alerts: show any low-battery alerts addressed to me.
defineJob(PARTNER_ALERTS_TASK, async () => {
  const userId = await signedInUserId();
  if (userId) await deliverPendingAlerts(userId);
  return Success;
});

// Keep the partner's view of "Web Protection on/off" honest even if it was
// switched off in Android settings while Bond was closed. Only on/off is sent.
defineJob(WEB_STATUS_TASK, async () => {
  const userId = await signedInUserId();
  if (userId) await shareWebStatus(userId, readWebStatus());
  return Success;
});

/** Ask Android to run all jobs periodically. Safe to call on every app start. */
export async function registerBackgroundJobs(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    for (const name of [BATTERY_TASK, SCREEN_TIME_TASK, CURRENT_APP_TASK, PARTNER_ALERTS_TASK, WEB_STATUS_TASK]) {
      if (!(await TaskManager.isTaskRegisteredAsync(name))) {
        await BackgroundTask.registerTaskAsync(name, { minimumInterval: INTERVAL_MINUTES });
      }
    }
  } catch {
    // Background work is best-effort; the app still updates while open.
  }
}

/** Whether Android currently allows Bond's background jobs at all. */
export async function backgroundJobsAvailable(): Promise<boolean> {
  try {
    return (await BackgroundTask.getStatusAsync()) === BackgroundTask.BackgroundTaskStatus.Available;
  } catch {
    return false;
  }
}

/**
 * Is Android's Battery optimization ON for Bond? (null = could not tell.)
 *
 * This is NOT needed to read the battery level; that needs no permission.
 * It only affects how often Android lets the background jobs above run: with
 * optimization on, Android can hold them back for hours while the phone is idle.
 */
export async function isBatteryOptimizedForBond(): Promise<boolean | null> {
  if (Platform.OS !== 'android') return null;
  try {
    return await Battery.isBatteryOptimizationEnabledAsync();
  } catch {
    return null;
  }
}

/**
 * Open Android's battery optimization list so the user can choose
 * "Don't optimize" / "Unrestricted" for Bond. Bond never changes this itself.
 * Falls back to Bond's App info page, where Battery is also listed.
 */
export async function openBatteryOptimizationSettings(): Promise<void> {
  try {
    await Linking.sendIntent('android.settings.IGNORE_BATTERY_OPTIMIZATION_SETTINGS');
  } catch {
    try {
      await Linking.openSettings();
    } catch {
      // Some devices block both; nothing else we can safely do.
    }
  }
}
