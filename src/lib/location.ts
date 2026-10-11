import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { withdrawMyLocationOffRequests } from './requests';
import { errorMessage, supabase } from './supabase';

/**
 * LOCATION SHARING
 *
 * Two levels, both chosen by the phone's owner:
 *   1. "While using Bond": location is updated when the app is open.
 *   2. "Also in background": Android runs a VISIBLE foreground service
 *      with a permanent notification. (Not wired up yet.)
 *
 * We only ever store the LATEST location (no history). Turning sharing off
 * deletes it from the database.
 *
 * Every reading from this phone goes through ONE pipeline (submitFix):
 *   1. Validate: real coordinates, not an old cached fix, not out of order.
 *   2. Judge accuracy: a clearly worse reading is ignored unless it shows real
 *      movement (its error circle doesn't overlap the last one) or the last
 *      good reading is getting old. Nothing is invented or averaged.
 *   3. Share: at most one upload runs at a time and only the NEWEST waiting
 *      fix is sent next, so an older fix can never land after a newer one.
 */

const LAST_GEOCODE_KEY = 'bond:lastGeocode';

// ---------- tunables ----------
/** A reading older than this when it arrives is a cached fix, not a live one. */
const MAX_FIX_AGE_MS = 2 * 60 * 1000;
/** After this long without an accepted fix, a worse reading is accepted anyway. */
const REACCEPT_AFTER_MS = 2 * 60 * 1000;
/** Share at least this often while sharing (keeps "Live" honest when still). */
const SHARE_HEARTBEAT_MS = 2 * 60 * 1000;
/** ...or whenever we moved at least this far (and beyond the error radius). */
const SHARE_MIN_MOVE_M = 25;
/** Reverse geocoding must not hold up a write for longer than this. */
const GEOCODE_TIMEOUT_MS = 3000;
/** writeRow result when the write was dropped because sharing stopped. */
const SKIPPED = 'skipped';
/** Window in which a lower timestamp is treated as a late, out-of-order reading. */
const OUT_OF_ORDER_WINDOW_MS = 60 * 1000;

type GeocodeCache = { lat: number; lng: number; name: string | null };

export function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "Diliman, Quezon City" from Android's built-in geocoder (free). Cached to save battery. */
async function placeName(lat: number, lng: number): Promise<string | null> {
  try {
    const raw = await AsyncStorage.getItem(LAST_GEOCODE_KEY);
    const cache: GeocodeCache | null = raw ? JSON.parse(raw) : null;
    if (cache && distanceMeters(cache.lat, cache.lng, lat, lng) < 250) return cache.name;
    const [addr] = await Location.reverseGeocodeAsync({ latitude: lat, longitude: lng });
    const parts = [addr?.district ?? addr?.subregion ?? addr?.name, addr?.city ?? addr?.region].filter(
      (p, i, arr): p is string => !!p && arr.indexOf(p) === i,
    );
    const name = parts.length ? parts.join(', ') : null;
    await AsyncStorage.setItem(LAST_GEOCODE_KEY, JSON.stringify({ lat, lng, name }));
    return name;
  } catch {
    return null;
  }
}

/**
 * Monotonic milliseconds. Unlike Date.now(), it never jumps when the phone's
 * clock is corrected, so it is safe for "which reading arrived later".
 */
function mono(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

// =====================================================================
// THE PIPELINE
// =====================================================================

/** One accepted reading from this phone. */
export type LocationFix = {
  lat: number;
  lng: number;
  /** Reported horizontal accuracy (meters), when the phone provides it. */
  accuracy: number | null;
  /** Reported speed (m/s), when the phone provides it. */
  speed: number | null;
  /** When the phone took the reading (ms). */
  timestamp: number;
  /** When Bond received it (ms). */
  receivedAt: number;
  /** Monotonic receipt time (cannot be moved by clock changes); used for ordering. */
  receivedMono: number;
};

export type Movement = 'moving' | 'stationary' | null;

/** What the pipeline knows about this phone's location (for UI + debugging). */
export type LocationDiagnostics = {
  /** Latest ACCEPTED reading on this phone. */
  lastFix: LocationFix | null;
  /** Movement from consecutive readings (null when it can't be told reliably). */
  movement: Movement;
  /** When a reading was last written to Supabase for the partner. */
  lastSharedAt: number | null;
  /** True while a newer reading is waiting to be shared (for example offline). */
  sharePending: boolean;
  lastShareError: string | null;
  /** The last reading we refused, and why (debugging). */
  lastRejected: { reason: string; at: number; accuracy: number | null } | null;
  /** Problem starting the watcher (for example location services off). */
  watchError: string | null;
};

const EMPTY_DIAG: LocationDiagnostics = {
  lastFix: null,
  movement: null,
  lastSharedAt: null,
  sharePending: false,
  lastShareError: null,
  lastRejected: null,
  watchError: null,
};

let ownerId: string | null = null;
/** Bumped on every reset; a write job from an older "session" is dropped. */
let generation = 0;
let accepted: LocationFix | null = null;
let shared: LocationFix | null = null;
let pending: { userId: string; gen: number; fix: LocationFix; isBackground: boolean } | null = null;
let writing = false;
let movingStreak = 0;
let stillStreak = 0;
let diag: LocationDiagnostics = EMPTY_DIAG;
const listeners = new Set<() => void>();

function setDiag(patch: Partial<LocationDiagnostics>) {
  diag = { ...diag, ...patch }; // new object each time, so React sees the change
  for (const l of listeners) l();
}

export function subscribeLocationDiagnostics(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getLocationDiagnostics(): LocationDiagnostics {
  return diag;
}

/** Forget everything (sharing turned off, or a different user). */
export function resetLocationPipeline(): void {
  generation += 1;
  ownerId = null;
  accepted = null;
  shared = null;
  pending = null;
  movingStreak = 0;
  stillStreak = 0;
  setDiag(EMPTY_DIAG);
}

export function reportWatchError(message: string | null): void {
  if (diag.watchError !== message) setDiag({ watchError: message });
}

function toFix(loc: Location.LocationObject): LocationFix | null {
  const { latitude, longitude, accuracy, speed } = loc.coords;
  const valid =
    Number.isFinite(latitude) &&
    Number.isFinite(longitude) &&
    Math.abs(latitude) <= 90 &&
    Math.abs(longitude) <= 180 &&
    !(latitude === 0 && longitude === 0); // "null island" = no real fix
  if (!valid) return null;
  const now = Date.now();
  // A phone clock that runs ahead must not make a reading look newer than it is.
  const ts = Number.isFinite(loc.timestamp) ? Math.min(loc.timestamp, now) : now;
  return {
    lat: latitude,
    lng: longitude,
    accuracy: accuracy != null && accuracy >= 0 ? accuracy : null,
    speed: speed != null && speed >= 0 ? speed : null,
    timestamp: ts,
    receivedAt: now,
    receivedMono: mono(),
  };
}

/** Decide whether a reading should replace the current one. */
function judge(fix: LocationFix): string | null {
  if (fix.receivedAt - fix.timestamp > MAX_FIX_AGE_MS) return 'old cached reading';
  if (!accepted) return null;
  // Out of order = an older reading delivered late, e.g. a slow one-off read
  // finishing after the watcher. That race happens within seconds; beyond a
  // minute a lower timestamp means the phone clock was corrected, and the
  // newer arrival is the one to trust (otherwise location could freeze).
  if (fix.timestamp <= accepted.timestamp && fix.receivedMono - accepted.receivedMono < OUT_OF_ORDER_WINDOW_MS) {
    return 'older than the current reading';
  }

  const prevAcc = accepted.accuracy;
  const acc = fix.accuracy;
  if (acc != null && prevAcc != null) {
    const clearlyWorse = acc > Math.max(50, prevAcc * 2);
    const moved = distanceMeters(accepted.lat, accepted.lng, fix.lat, fix.lng);
    // Circles overlap: the "move" is within the error of the worse reading, so
    // it tells us nothing new. Ignore it while the current reading is recent.
    const overlaps = moved <= acc + prevAcc;
    const currentIsRecent = fix.receivedMono - accepted.receivedMono < REACCEPT_AFTER_MS;
    if (clearlyWorse && overlaps && currentIsRecent) return `worse accuracy (±${Math.round(acc)} m)`;
  }
  return null;
}

/** Movement from the phone's reported speed, with hysteresis against GPS noise. */
function updateMovement(fix: LocationFix): Movement {
  const good = fix.accuracy != null && fix.accuracy <= 50;
  if (fix.speed == null || !good) {
    // Can't judge from this reading. Keep the last answer only if it is recent.
    const lastWasRecent = !!accepted && fix.receivedMono - accepted.receivedMono < 60_000;
    return lastWasRecent ? diag.movement : null;
  }
  if (fix.speed >= 1.0) {
    movingStreak += 1;
    stillStreak = 0;
  } else if (fix.speed < 0.5) {
    stillStreak += 1;
    movingStreak = 0;
  }
  if (movingStreak >= 2) return 'moving';
  if (stillStreak >= 2) return 'stationary';
  return diag.movement;
}

function shouldShare(fix: LocationFix): boolean {
  if (!shared) return true;
  if (fix.receivedMono - shared.receivedMono >= SHARE_HEARTBEAT_MS) return true;
  const moved = distanceMeters(shared.lat, shared.lng, fix.lat, fix.lng);
  if (moved >= Math.max(SHARE_MIN_MOVE_M, fix.accuracy ?? 0)) return true;
  // Same place but a much more precise reading: share it so the partner sees it.
  if (shared.accuracy != null && shared.accuracy > 30 && fix.accuracy != null && fix.accuracy <= shared.accuracy / 2) {
    return true;
  }
  return false;
}

/** Returns null on success, 'skipped' if sharing stopped meanwhile, else an error. */
async function writeRow(userId: string, gen: number, fix: LocationFix, isBackground: boolean): Promise<string | null> {
  const name = await withTimeout(placeName(fix.lat, fix.lng), GEOCODE_TIMEOUT_MS, null);
  // Sharing may have been turned off (or the user changed) while geocoding.
  if (gen !== generation || ownerId !== userId) return SKIPPED;
  // RLS refuses this write if sharing is OFF, a second safety net against leaks.
  const { error } = await supabase.from('locations').upsert({
    user_id: userId,
    latitude: fix.lat,
    longitude: fix.lng,
    accuracy_m: fix.accuracy,
    place_name: name,
    is_background: isBackground,
    updated_at: new Date(fix.timestamp).toISOString(),
  });
  return error ? error.message : null;
}

function enqueueShare(userId: string, fix: LocationFix, isBackground: boolean) {
  pending = { userId, gen: generation, fix, isBackground }; // newer always replaces older
  setDiag({ sharePending: true });
  if (writing) return;
  writing = true;
  void (async () => {
    try {
      while (pending) {
        const job = pending;
        pending = null;
        if (job.gen !== generation || ownerId !== job.userId) continue; // sharing stopped / user changed
        // Never go backwards: compare by arrival order, not the phone clock.
        if (shared && job.fix.receivedMono <= shared.receivedMono) continue;
        const err = await writeRow(job.userId, job.gen, job.fix, job.isBackground);
        if (err === SKIPPED) continue;
        if (err) {
          if (!pending && job.gen === generation) pending = job; // keep it; the next reading retries
          setDiag({ lastShareError: err });
          break;
        }
        if (job.gen === generation) {
          shared = job.fix;
          setDiag({ lastSharedAt: Date.now(), lastShareError: null });
        }
      }
    } finally {
      writing = false;
      setDiag({ sharePending: !!pending });
    }
  })();
}

/**
 * Wait until no upload is in progress (or the time limit passes). Used by
 * the background location task, which Android may pause as soon as it
 * returns, so the latest position is actually sent first.
 */
export async function waitForShareIdle(timeoutMs = 20_000): Promise<void> {
  const until = Date.now() + timeoutMs;
  while (writing && Date.now() < until) {
    await new Promise((r) => setTimeout(r, 100));
  }
}

/**
 * Feed one reading from this phone into the pipeline. Safe to call from any
 * source (watcher, one-off read); ordering is enforced here.
 */
export function submitFix(userId: string, loc: Location.LocationObject, isBackground = false): void {
  if (!userId) return;
  if (ownerId !== userId) {
    resetLocationPipeline();
    ownerId = userId;
  }
  const fix = toFix(loc);
  if (!fix) {
    setDiag({ lastRejected: { reason: 'invalid coordinates', at: Date.now(), accuracy: null } });
    return;
  }
  const reason = judge(fix);
  if (reason) {
    setDiag({ lastRejected: { reason, at: fix.receivedAt, accuracy: fix.accuracy } });
    return;
  }
  const movement = updateMovement(fix);
  accepted = fix;
  setDiag({ lastFix: fix, movement });
  if (shouldShare(fix) || pending) enqueueShare(userId, fix, isBackground);
}

// =====================================================================
// PUBLIC HELPERS
// =====================================================================

/** One-off precise reading while the app is open (used when sharing is turned on). */
export async function updateLocationNow(): Promise<void> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted) return;
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
  submitFix(userId, loc, false);
}

export type LocationAccessInfo = {
  permission: 'granted' | 'denied' | 'undetermined';
  /** true = precise, false = approximate only, null = unknown. */
  precise: boolean | null;
  /** Phone-wide location services (GPS) switch. */
  servicesOn: boolean;
};

/** What the OS currently allows, read fresh (never assumed). */
export async function getLocationAccessInfo(): Promise<LocationAccessInfo> {
  const [perm, servicesOn] = await Promise.all([
    Location.getForegroundPermissionsAsync(),
    Location.hasServicesEnabledAsync().catch(() => true),
  ]);
  const permission = perm.granted ? 'granted' : perm.canAskAgain ? 'undetermined' : 'denied';
  const a = perm.android?.accuracy;
  const precise = a === 'fine' ? true : a === 'coarse' ? false : null;
  return { permission, precise, servicesOn };
}

/** Ask Android to turn on location services (shows the system dialog). */
export async function askToTurnOnLocationServices(): Promise<boolean> {
  try {
    await Location.enableNetworkProviderAsync();
    return true;
  } catch {
    return false;
  }
}

/** Step 1: ask for "while using the app" permission and switch sharing on. */
export async function enableLocationSharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    return { ok: false, message: 'Location permission was not allowed. You can change this in Android Settings.' };
  }
  // A leftover "turn off" request must not switch this back off later.
  await withdrawMyLocationOffRequests(userId);
  const { error } = await supabase.from('privacy_settings').update({ share_location: true }).eq('user_id', userId);
  if (error) return { ok: false, message: errorMessage(error) };
  try {
    await updateLocationNow();
  } catch {
    // GPS might be off; the watcher will try again.
  }
  return { ok: true };
}

/** Turn everything off and delete the stored location. */
export async function disableLocationSharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  // Location sharing is each person's own choice: off takes effect at once.
  // Old "turn off" requests are withdrawn first so a late approval can't flip it later.
  await withdrawMyLocationOffRequests(userId);
  // Drop anything waiting to upload. Even if an upload is already in flight,
  // the database refuses location writes once share_location is off (RLS).
  resetLocationPipeline();
  const { error } = await supabase.from('privacy_settings').update({ share_location: false }).eq('user_id', userId);
  if (error) return { ok: false, message: errorMessage(error) };
  await supabase.from('locations').delete().eq('user_id', userId);
  return { ok: true };
}
