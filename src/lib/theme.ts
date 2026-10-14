// Bond's look: "Sky & Blush": soft, clean, light (and a matching dark mode).
// Sky blue = you, blush pink = your partner, a deeper blue for actions.
import { useSyncExternalStore } from 'react';
import { Appearance, StyleSheet } from 'react-native';
import BondPrefs from '../../modules/bond-prefs';

const light = {
  background: '#F7F9FC',
  card: '#FFFFFF',
  text: '#1F2A44',
  subtext: '#6B7590',
  muted: '#9AA3B8',
  border: '#E6EAF2',
  track: '#EEF2F8',        // empty part of progress bars, map blocks

  primary: '#3D6FD1',      // buttons, active tab, links
  primarySoft: '#E8EFFB',
  onPrimary: '#FFFFFF',    // text on a primary button

  me: '#8DB4F0',           // sky blue — "You"
  meSoft: '#EAF1FD',
  partner: '#F5A3B7',      // blush pink — your partner
  partnerSoft: '#FDEEF2',

  // Readable blue for text/icons on light backgrounds (badges, accents).
  blue: '#3D6FD1',
  blueSoft: '#E8EFFB',
  pink: '#D9637F',
  pinkSoft: '#FDEEF2',

  success: '#1F8A5B',
  successSoft: '#E3F5EC',
  warning: '#B7791F',
  warningSoft: '#FCF3E3',
  danger: '#D2475F',
  dangerSoft: '#FCE9EC',
};

/**
 * Same names, tuned for dark backgrounds: AMOLED black (true #000 background,
 * near-black cards), so OLED screens use less power. The brand sky blue and
 * blush pink stay.
 */
const dark: typeof light = {
  background: '#000000',
  card: '#0E0F12',
  text: '#F2F4F8',
  subtext: '#A7B0C4',
  muted: '#7A8296',
  border: '#1F2228',
  track: '#1A1C21',

  primary: '#8DB4F0',      // brand sky blue is readable on dark
  primarySoft: '#15203A',
  onPrimary: '#000000',    // dark text on the light blue button (white would be too faint)

  me: '#8DB4F0',
  meSoft: '#121C2C',
  partner: '#F5A3B7',
  partnerSoft: '#2A1720',

  blue: '#8DB4F0',
  blueSoft: '#15203A',
  pink: '#F5A3B7',
  pinkSoft: '#2A1720',

  success: '#4CC38A',
  successSoft: '#0E2417',
  warning: '#E5A84B',
  warningSoft: '#261C0A',
  danger: '#F2788C',
  dangerSoft: '#2A1218',
};

// ---------------- Theme choice ----------------
// The choice ("system" | "light" | "dark") is read once, synchronously, at
// startup from the bond-prefs native module, and saved there on change.
// Changing it updates everything IN PLACE: the shared `colors` / `shadow`
// objects are refilled, every themedStyles() sheet is rebuilt on next read,
// and every component using useThemeVersion() re-renders. No reload, so the
// current screen, navigation and all loaded data stay as they are.

export type ThemePreference = 'system' | 'light' | 'dark';
type Scheme = 'light' | 'dark';

/** False on builds without the bond-prefs native module (then: follow the phone). */
export const themeChoiceAvailable = !!BondPrefs;

function readPreference(): ThemePreference {
  try {
    return BondPrefs?.getTheme() ?? 'system';
  } catch {
    return 'system';
  }
}

function systemScheme(): Scheme {
  return Appearance.getColorScheme() === 'dark' ? 'dark' : 'light';
}

/** Tell Android too, so its own dialogs (Alert, pickers) match Bond. */
function applyToAndroid(pref: ThemePreference) {
  try {
    Appearance.setColorScheme(pref === 'system' ? 'unspecified' : pref);
  } catch {
    // older platform: ignore
  }
}

let preference: ThemePreference = readPreference();
applyToAndroid(preference);
let scheme: Scheme = preference === 'system' ? systemScheme() : preference;
let version = 0;
const listeners = new Set<() => void>();

/** The current palette. Same object for the whole session; its values change with the theme. */
export const colors: typeof light = { ...(scheme === 'dark' ? dark : light) };

function shadowFor(s: Scheme) {
  return {
    shadowColor: s === 'dark' ? '#000000' : '#1F2A44',
    shadowOpacity: s === 'dark' ? 0.3 : 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 1,
  };
}

export const shadow = shadowFor(scheme);

function applyScheme(next: Scheme) {
  if (next === scheme) return;
  scheme = next;
  Object.assign(colors, next === 'dark' ? dark : light);
  Object.assign(shadow, shadowFor(next));
  version += 1;
  listeners.forEach((l) => l());
}

// Following the phone: switch live when Android's theme changes.
Appearance.addChangeListener(({ colorScheme: next }) => {
  if (preference !== 'system') return;
  applyScheme(next === 'dark' ? 'dark' : 'light');
});

export function getThemePreference(): ThemePreference {
  return preference;
}

export function isDarkTheme(): boolean {
  return scheme === 'dark';
}

/**
 * Save and apply a theme choice immediately (no reload). Returns false only
 * on builds without the bond-prefs module, where nothing can be saved.
 */
export function setThemePreference(pref: ThemePreference): boolean {
  if (!BondPrefs) return false;
  BondPrefs.setTheme(pref);
  preference = pref;
  applyToAndroid(pref);
  applyScheme(pref === 'system' ? systemScheme() : pref);
  // Listeners also run when only the preference changed (e.g. dark -> system while the phone is dark).
  version += 1;
  listeners.forEach((l) => l());
  return true;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Re-render the calling component when the theme changes. Every component
 * that draws with `colors` or a themedStyles() sheet calls this first.
 */
export function useThemeVersion(): number {
  return useSyncExternalStore(subscribe, () => version);
}

/** A value derived from the palette, recomputed after each theme change. */
export function themed<T extends object>(factory: () => T): T {
  let cached: T | null = null;
  let at = -1;
  const current = (): T => {
    if (at !== version || !cached) {
      cached = factory();
      at = version;
    }
    return cached;
  };
  return new Proxy({} as T, {
    get: (_t, p) => (current() as Record<string | symbol, unknown>)[p],
    has: (_t, p) => p in current(),
    ownKeys: () => Reflect.ownKeys(current()),
    getOwnPropertyDescriptor: (_t, p) => {
      const d = Object.getOwnPropertyDescriptor(current(), p);
      return d ? { ...d, configurable: true } : undefined;
    },
  });
}

/** StyleSheet.create, rebuilt from the current palette after each theme change. */
export function themedStyles<T extends StyleSheet.NamedStyles<T> | StyleSheet.NamedStyles<any>>(
  factory: () => T & StyleSheet.NamedStyles<any>,
): T {
  return themed(() => StyleSheet.create(factory()));
}

export const radius = { sm: 10, md: 14, lg: 18, xl: 26, pill: 999 };

export const spacing = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32 };

/**
 * Inter is embedded in the Android build by the expo-font plugin (see
 * app.json) as ONE family with weights 400–800, so `fontWeight` picks the
 * right file automatically. Inter is the closest free match to Apple's
 * San Francisco font (which can't be shipped in Android apps).
 */
export const fontFamily = 'Inter';

export const font = {
  hero: { fontFamily, fontSize: 34, fontWeight: '800' as const, letterSpacing: -0.8 },
  title: { fontFamily, fontSize: 26, fontWeight: '800' as const, letterSpacing: -0.6 },
  h2: { fontFamily, fontSize: 19, fontWeight: '700' as const, letterSpacing: -0.3 },
  h3: { fontFamily, fontSize: 16, fontWeight: '700' as const, letterSpacing: -0.2 },
  body: { fontFamily, fontSize: 15, fontWeight: '400' as const, letterSpacing: -0.1 },
  small: { fontFamily, fontSize: 13, fontWeight: '500' as const },
  tiny: { fontFamily, fontSize: 11, fontWeight: '600' as const, letterSpacing: 0.4 },
  number: { fontFamily, fontSize: 30, fontWeight: '800' as const, letterSpacing: -0.6 },
};
