import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import * as TaskManager from 'expo-task-manager';
import { Platform } from 'react-native';
import { syncBatteryIfSharing } from './battery';
import { syncCurrentAppIfSharing } from './currentApp';
import { submitFix, waitForShareIdle } from './location';
import { pairingSetupAllowsSync } from './pairingSetup';
import { supabase } from './supabase';

/**
 * BACKGROUND LOCATION (sharing while Bond is closed)
 *
 * There is no separate Bond switch for this. It runs only when ALL of these
 * are true:
 *  - location sharing is on (privacy_settings.share_location, OFF by default,
 *    turned on only after the person confirms, for each pairing),
 *  - the account is paired and the current pairing's setup is finished,
 *  - Android granted "Allow all the time" for Bond's location permission
 *    (read fresh every time; "While using the app" never counts).
 * With only "While using the app", location is shared while Bond is open and
 * the app says background updates are unavailable.
 * While it runs, Android shows a persistent notification (foreground service).
 *
 * Every background update re-checks sign-in, pairing, location sharing and
 * setup BEFORE uploading. If any of them is definitely no longer true, the
 * task stops itself. If the server just can't be reached, that one update is
 * skipped (nothing is guessed). The database itself also refuses location
 * writes while sharing is off (RLS), and 0007 turns sharing off on unpair, so
 * nothing here can bypass those safeguards.
 *
 * Positions go through the same pipeline as the open app (validation, newest
 * wins, only the latest position is stored).
 */

export const BG_LOCATION_TASK = 'bond-background-location';

/** Background updates: at most every 3 minutes or after ~75 m of movement. */
const BG_TIME_INTERVAL_MS = 3 * 60 * 1000;
const BG_DISTANCE_M = 75;

/**
 * The earlier version stored a separate "share while Bond is closed" choice
 * per account under this prefix. It is no longer read anywhere (so it can't
 * turn tracking on or off); this only removes the leftover entries.
 */
const LEGACY_CONSENT_PREFIX = 'bond:bg-location:';

export async function removeLegacyBackgroundConsent(): Promise<void> {
  try {
    const keys = (await AsyncStorage.getAllKeys()).filter((k) => k.startsWith(LEGACY_CONSENT_PREFIX));
    if (keys.length) await AsyncStorage.multiRemove(keys);
  } catch {
    // best effort; the entries are ignored either way
  }
}

export async function isBackgroundTrackingRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK);
  } catch {
    return false;
  }
}

/** Stop the background service and its notification. Safe to call any time. */
export async function stopBackgroundLocation(): Promise<void> {
  try {
    if (await Location.hasStartedLocationUpdatesAsync(BG_LOCATION_TASK)) {
      await Location.stopLocationUpdatesAsync(BG_LOCATION_TASK);
    }
  } catch {
    // not running / not available on this build
  }
}

/**
 * What Android allows for Bond's location right now:
 *  - 'granted':       "Allow all the time" (background works),
 *  - 'ask':           only "While using the app"; Android can still show its
 *                     background prompt (on Android 11+ that opens Settings),
 *  - 'blocked':       only "While using the app"; the person must change it in
 *                     Settings themselves,
 *  - 'no-foreground': no location permission at all.
 */
export type BackgroundPermission = 'granted' | 'ask' | 'blocked' | 'no-foreground';

/** What Android currently allows for background location (read fresh, never assumed). */
export async function getBackgroundPermission(): Promise<BackgroundPermission> {
  if (Platform.OS !== 'android') return 'blocked';
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return 'no-foreground';
  const bg = await Location.getBackgroundPermissionsAsync();
  if (bg.granted) return 'granted';
  return bg.canAskAgain ? 'ask' : 'blocked';
}

/**
 * Ask Android for "Allow all the time". On Android 11+ this opens Bond's
 * location page in Settings; the person must pick "Allow all the time" there.
 */
export async function requestBackgroundPermission(): Promise<BackgroundPermission> {
  try {
    await Location.requestBackgroundPermissionsAsync();
  } catch {
    // fall through to a fresh read
  }
  return getBackgroundPermission();
}

/**
 * Start the background service if everything allows it. Must be called while
 * Bond is open (Android doesn't allow starting it from the background).
 */
export async function startBackgroundLocation(partnerName: string): Promise<boolean> {
  if ((await getBackgroundPermission()) !== 'granted') return false;
  if (await isBackgroundTrackingRunning()) return true;
  try {
    await Location.startLocationUpdatesAsync(BG_LOCATION_TASK, {
      accuracy: Location.Accuracy.Balanced,
      timeInterval: BG_TIME_INTERVAL_MS,
      distanceInterval: BG_DISTANCE_M,
      foregroundService: {
        notificationTitle: `Sharing your location with ${partnerName}`,
        notificationBody: 'Bond shares your location while it is closed. To stop, turn off Location sharing in Bond.',
        notificationColor: '#3D6FD1',
        killServiceOnDestroy: false,
      },
    });
    return true;
  } catch {
    return false;
  }
}

let lastCurrentAppSync = 0;
let lastBatterySync = 0;

type Verdict = { kind: 'allowed'; userId: string } | { kind: 'denied' } | { kind: 'unknown' };

/** Every rule, checked fresh before each background upload. */
async function checkBackgroundAllowed(): Promise<Verdict> {
  const { data: auth } = await supabase.auth.getSession();
  const userId = auth.session?.user.id;
  if (!userId) return { kind: 'denied' }; // signed out / account deleted

  const member = await supabase.from('couple_members').select('couple_id').eq('user_id', userId).maybeSingle();
  if (member.error) return { kind: 'unknown' };
  if (!member.data) return { kind: 'denied' }; // unpaired
  const coupleId = member.data.couple_id as string;
  // This couple's setup must be finished on this phone (a new pairing's isn't yet).
  if (!(await pairingSetupAllowsSync(userId, coupleId))) return { kind: 'denied' };

  const [members, privacy] = await Promise.all([
    supabase.from('couple_members').select('user_id').eq('couple_id', coupleId),
    supabase.from('privacy_settings').select('share_location').eq('user_id', userId).maybeSingle(),
  ]);
  if (members.error || privacy.error) return { kind: 'unknown' };
  if ((members.data?.length ?? 0) < 2) return { kind: 'denied' }; // partner left
  if (!privacy.data?.share_location) return { kind: 'denied' }; // sharing turned off
  return { kind: 'allowed', userId };
}

// Must be defined at the top level (this file is imported from the app entry
// through backgroundJobs.ts) so Android can deliver updates while Bond is closed.
TaskManager.defineTask(BG_LOCATION_TASK, async ({ data, error }) => {
  if (error) return;
  const locations = (data as { locations?: Location.LocationObject[] } | undefined)?.locations ?? [];
  const latest = locations[locations.length - 1];
  if (!latest) return;
  try {
    const verdict = await checkBackgroundAllowed();
    if (verdict.kind === 'denied') {
      // A rule no longer holds: stop the service and its notification. It
      // starts again only from the open app, once every rule holds again.
      await stopBackgroundLocation();
      return;
    }
    if (verdict.kind === 'unknown') return; // offline: skip this update, try the next one
    submitFix(verdict.userId, latest, true);
    await waitForShareIdle();
    // Same checks already passed (sign-in, pairing, setup): also refresh
    // "Currently Using", at most every 2 minutes (it checks its own consent
    // and Usage access).
    if (Date.now() - lastCurrentAppSync > 2 * 60 * 1000) {
      lastCurrentAppSync = Date.now();
      await syncCurrentAppIfSharing(verdict.userId);
    }
    // Battery too, at most every 5 minutes (it checks share_battery itself).
    if (Date.now() - lastBatterySync > 5 * 60 * 1000) {
      lastBatterySync = Date.now();
      await syncBatteryIfSharing(verdict.userId).catch(() => false);
    }
  } catch {
    // never crash the background service
  }
});
