import * as BackgroundTask from 'expo-background-task';
import type * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { runDeviceSync } from './deviceSync';
import { LOCATION_TASK, uploadLocation } from './location';

/**
 * Background jobs. IMPORTANT: tasks must be defined at the top level of a
 * file that is imported when the app starts (we import this file in
 * src/app/_layout.tsx). Android may start the app "headless" (no screen)
 * just to run these.
 */

export const SYNC_TASK = 'bond-sync-task';

// Runs about every 15 minutes (Android decides the exact timing).
TaskManager.defineTask(SYNC_TASK, async () => {
  try {
    await runDeviceSync({ foreground: false });
    return BackgroundTask.BackgroundTaskResult.Success;
  } catch {
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
});

// Receives location updates while background sharing is ON.
TaskManager.defineTask<{ locations: Location.LocationObject[] }>(LOCATION_TASK, async ({ data, error }) => {
  if (error || !data?.locations?.length) return;
  const latest = data.locations[data.locations.length - 1];
  try {
    await uploadLocation(latest, true);
  } catch {
    // offline — the next update will try again
  }
});

export async function registerBackgroundSync(): Promise<void> {
  try {
    const status = await BackgroundTask.getStatusAsync();
    if (status !== BackgroundTask.BackgroundTaskStatus.Available) return;
    const registered = await TaskManager.isTaskRegisteredAsync(SYNC_TASK);
    if (!registered) {
      await BackgroundTask.registerTaskAsync(SYNC_TASK, { minimumInterval: 15 });
    }
  } catch (e) {
    console.warn('Could not register background sync', e);
  }
}

export async function unregisterBackgroundSync(): Promise<void> {
  try {
    if (await TaskManager.isTaskRegisteredAsync(SYNC_TASK)) {
      await BackgroundTask.unregisterTaskAsync(SYNC_TASK);
    }
  } catch {
    // ignore
  }
}
