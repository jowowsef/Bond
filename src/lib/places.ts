import AsyncStorage from '@react-native-async-storage/async-storage';
import { Linking } from 'react-native';
import { distanceMeters } from './location';

/**
 * SAVED PLACES (Location tab): Home, School, Work, and others, saved ON THIS
 * PHONE only (never uploaded), for this couple. Used to label where each of
 * you is ("At Home") and to open directions. A place is added from a position
 * Bond already shows (your location, or your partner's shared location), so
 * no new location data is collected.
 */
export type PlaceKind = 'home' | 'school' | 'work' | 'gym' | 'other';

export type SavedPlace = { id: string; kind: PlaceKind; name: string; lat: number; lng: number };

export const PLACE_KINDS: { kind: PlaceKind; label: string; icon: 'home' | 'school' | 'briefcase' | 'barbell' | 'location' }[] = [
  { kind: 'home', label: 'Home', icon: 'home' },
  { kind: 'school', label: 'School', icon: 'school' },
  { kind: 'work', label: 'Work', icon: 'briefcase' },
  { kind: 'gym', label: 'Gym', icon: 'barbell' },
  { kind: 'other', label: 'Other', icon: 'location' },
];

/** Within this distance, a person counts as "at" a place. */
export const AT_PLACE_M = 150;

const keyFor = (userId: string, coupleId: string) => `bond:places:${userId}:${coupleId}`;

export async function readPlaces(userId: string, coupleId: string): Promise<SavedPlace[]> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId, coupleId));
    const list = raw ? (JSON.parse(raw) as SavedPlace[]) : [];
    return Array.isArray(list) ? list.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lng)) : [];
  } catch {
    return [];
  }
}

async function writePlaces(userId: string, coupleId: string, places: SavedPlace[]): Promise<void> {
  await AsyncStorage.setItem(keyFor(userId, coupleId), JSON.stringify(places));
}

export async function addPlace(
  userId: string,
  coupleId: string,
  place: Omit<SavedPlace, 'id'>,
): Promise<SavedPlace[]> {
  const list = await readPlaces(userId, coupleId);
  const next = [...list, { ...place, name: place.name.trim().slice(0, 30), id: `${Date.now()}-${Math.round(Math.random() * 1e6)}` }];
  await writePlaces(userId, coupleId, next);
  return next;
}

export async function removePlace(userId: string, coupleId: string, id: string): Promise<SavedPlace[]> {
  const next = (await readPlaces(userId, coupleId)).filter((p) => p.id !== id);
  await writePlaces(userId, coupleId, next);
  return next;
}

/** The saved place a position is at (the nearest within AT_PLACE_M), or null. */
export function placeAt(lat: number, lng: number, places: SavedPlace[]): SavedPlace | null {
  let best: { p: SavedPlace; d: number } | null = null;
  for (const p of places) {
    const d = distanceMeters(lat, lng, p.lat, p.lng);
    if (d <= AT_PLACE_M && (!best || d < best.d)) best = { p, d };
  }
  return best?.p ?? null;
}

/** "350 m away" / "1.2 km away". */
export function distanceLabel(meters: number, suffix = 'away'): string {
  if (meters < 1000) return `${Math.max(10, Math.round(meters / 10) * 10)} m ${suffix}`;
  return `${(meters / 1000).toFixed(meters < 10_000 ? 1 : 0)} km ${suffix}`;
}

/** Open directions to a point in the phone's maps app (Google Maps when installed). */
export async function openDirections(lat: number, lng: number): Promise<void> {
  const url = `https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  try {
    await Linking.openURL(url);
  } catch {
    await Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}`).catch(() => undefined);
  }
}
