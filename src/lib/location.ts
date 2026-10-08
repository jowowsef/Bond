import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { supabase } from './supabase';
import { colors } from './theme';

/**
 * LOCATION SHARING
 *
 * Two levels, both chosen by the phone's owner:
 *   1. "While using Bond"  — location is updated when the app is open.
 *   2. "Also in background" — Android runs a VISIBLE foreground service
 *      with a permanent notification ("Bond is sharing your location"),
 *      updating about every 5 minutes or 100 m. Turn it off anytime.
 *
 * We only ever store the LATEST location (no history). Turning sharing
 * off deletes it from the database.
 */

export const LOCATION_TASK = 'bond-location-task';
const LAST_GEOCODE_KEY = 'bond:lastGeocode';

type GeocodeCache = { lat: number; lng: number; name: string | null };

function distanceMeters(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** "Diliman, Quezon City" — uses Android's built-in geocoder (free). Cached to save battery. */
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

export async function uploadLocation(loc: Location.LocationObject, isBackground: boolean): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const userId = data.session?.user.id;
  if (!userId) return;
  const { latitude, longitude, accuracy } = loc.coords;
  const name = await placeName(latitude, longitude);
  // RLS refuses this write if sharing is OFF — a safety net against leaks.
  await supabase.from('locations').upsert({
    user_id: userId,
    latitude,
    longitude,
    accuracy_m: accuracy ?? null,
    place_name: name,
    is_background: isBackground,
    updated_at: new Date(loc.timestamp).toISOString(),
  });
}

/** One-off update while the app is open. */
export async function updateLocationNow(): Promise<void> {
  const perm = await Location.getForegroundPermissionsAsync();
  if (!perm.granted) return;
  const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
  await uploadLocation(loc, false);
}

/** Step 1: ask for "while using the app" permission and switch sharing on. */
export async function enableLocationSharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  const perm = await Location.requestForegroundPermissionsAsync();
  if (!perm.granted) {
    return { ok: false, message: 'Location permission was not allowed. You can change this in Android Settings.' };
  }
  const { error } = await supabase.from('privacy_settings').update({ share_location: true }).eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  try {
    await updateLocationNow();
  } catch {
    // GPS might be off — the next update will try again.
  }
  return { ok: true };
}

/** Step 2 (optional): background updates with a visible notification. */
export async function enableBackgroundLocation(partnerName: string): Promise<{ ok: boolean; message?: string }> {
  const fg = await Location.getForegroundPermissionsAsync();
  if (!fg.granted) return { ok: false, message: 'Turn on location sharing first.' };
  // On Android 11+ this opens Settings — choose "Allow all the time".
  const bg = await Location.requestBackgroundPermissionsAsync();
  if (!bg.granted) {
    return {
      ok: false,
      message: 'Background location was not allowed. In Android Settings choose "Allow all the time" for Bond, then try again.',
    };
  }
  await Location.startLocationUpdatesAsync(LOCATION_TASK, {
    accuracy: Location.Accuracy.Balanced,
    timeInterval: 5 * 60 * 1000,
    distanceInterval: 100,
    deferredUpdatesInterval: 5 * 60 * 1000,
    foregroundService: {
      notificationTitle: `Sharing your location with ${partnerName}`,
      notificationBody: 'Bond updates your location about every 5 minutes. Turn off in Bond → Location.',
      notificationColor: colors.primary,
    },
  });
  return { ok: true };
}

export async function isBackgroundLocationRunning(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK);
  } catch {
    return false;
  }
}

export async function stopBackgroundLocation(): Promise<void> {
  if (await isBackgroundLocationRunning()) {
    await Location.stopLocationUpdatesAsync(LOCATION_TASK);
  }
}

/** Turn everything off and delete the stored location. */
export async function disableLocationSharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  await stopBackgroundLocation();
  const { error } = await supabase.from('privacy_settings').update({ share_location: false }).eq('user_id', userId);
  if (error) return { ok: false, message: error.message };
  await supabase.from('locations').delete().eq('user_id', userId);
  return { ok: true };
}
