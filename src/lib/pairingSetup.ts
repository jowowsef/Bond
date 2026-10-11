import AsyncStorage from '@react-native-async-storage/async-storage';
import { isMissingSchema } from './schemaErrors';
import { supabase } from './supabase';

/**
 * PER-PAIRING SETUP (sharing consent), kept separate from personal settings.
 *
 * Every NEW pairing (a new couple id, even with the same two accounts) must
 * go through Bond's sharing setup again: location, battery, screen time and
 * activity all start OFF and are only turned on after the person confirms.
 *
 * Stored on this phone only, per account: which couple this account is set up
 * for ({ coupleId: null } = "this phone saw the account NOT paired").
 * Personal data (name, avatar color, photo, account) is never touched here.
 *
 * How a new pairing is recognised (no timing guesses):
 *  - Whenever this phone shows the account unpaired or waiting for a partner,
 *    noteNotPaired() writes { coupleId: null }. Pairing always happens on a
 *    phone that is in that state, so the couple seen afterwards is NEW.
 *  - A record for a DIFFERENT couple also means a new pairing (stale data
 *    from an earlier couple can never count as consent for this one).
 *  - NO record at all, while already paired, means this install never saw a
 *    pairing happen: the app was updated while paired, reinstalled, or this is
 *    another phone signing in. That couple keeps its current sharing.
 *
 * Order of a new pairing (each step is saved here, so it survives leaving
 * Bond, a trip to Android Settings, or a restart, and resumes where it was):
 *  1. turn this account's four sharing switches OFF on the server;
 *  2. 'sharing': Sharing setup. It can only be left once step 1 succeeded,
 *     so consent from the previous pairing can't survive a failed reset;
 *  3. 'name':  confirm the name the partner sees;
 *  4. 'color': choose the avatar color;
 *  5. done: Home.
 * Until done, the main screens, background location and the battery /
 * screen-time background jobs do not sync (see pairingSetupAllowsSync).
 */

export type SetupStep = 'sharing' | 'name' | 'color';
export type PairingSetupState = 'unknown' | SetupStep | 'done';

/** The screens inside Sharing setup, in order (one at a time). */
export const SHARING_STEPS = ['notifications', 'location', 'battery', 'screen_time', 'current_app'] as const;
export type SharingStep = (typeof SHARING_STEPS)[number];

type SetupRecord = {
  coupleId: string | null;
  done: boolean;
  sharingReset: boolean;
  step?: SetupStep;
  /** Which Sharing setup screen this pairing is on (survives restarts). */
  sharingStep?: SharingStep;
};

const NEXT: Record<SetupStep, SetupStep | 'done'> = { sharing: 'name', name: 'color', color: 'done' };

const keyFor = (userId: string) => `bond:pairing-setup:${userId}`;

async function readRecord(userId: string): Promise<SetupRecord | null> {
  try {
    const raw = await AsyncStorage.getItem(keyFor(userId));
    return raw ? (JSON.parse(raw) as SetupRecord) : null;
  } catch {
    return null;
  }
}

async function writeRecord(userId: string, record: SetupRecord): Promise<void> {
  try {
    await AsyncStorage.setItem(keyFor(userId), JSON.stringify(record));
  } catch {
    // best effort; worst case setup is shown once more
  }
}

/**
 * Turn all four kinds of sharing OFF for this account (its own row only).
 * Returns false if the server could not be reached, so it is retried
 * instead of being assumed done.
 */
async function resetSharing(userId: string): Promise<boolean> {
  const { error } = await supabase
    .from('privacy_settings')
    .update({ share_location: false, share_battery: false, share_screen_time: false, share_activity: false })
    .eq('user_id', userId);
  if (error) return false;
  // "Currently Using" (migration 0008). Before 0008 the column doesn't exist,
  // which is fine (nothing can be shared then); any other error is a failure.
  const extra = await supabase.from('privacy_settings').update({ share_current_app: false }).eq('user_id', userId);
  if (extra.error && !isMissingSchema(extra.error)) return false;
  // No stale battery reading or current app for the new partner (location is
  // removed by the database itself when share_location turns off).
  await supabase.from('battery_status').delete().eq('user_id', userId);
  await supabase.from('current_app').delete().eq('user_id', userId);
  // Screen-time summaries uploaded before this pairing are not shown to the
  // new partner (this phone's own statistics come from Android, not these rows).
  await supabase.from('screen_time_daily').delete().eq('user_id', userId);
  await supabase.from('app_usage_daily').delete().eq('user_id', userId);
  return true;
}

/** This phone shows the account unpaired / waiting: whatever couple comes next is a new pairing. */
export async function noteNotPaired(userId: string): Promise<void> {
  const record = await readRecord(userId);
  if (record && record.coupleId === null) return;
  await writeRecord(userId, { coupleId: null, done: false, sharingReset: false, step: 'sharing' });
}

/**
 * Does this account still have to do sharing setup for the couple it is in
 * now? For a new pairing, the sharing reset is attempted BEFORE answering.
 */
export async function resolvePairingSetup(userId: string, coupleId: string): Promise<Exclude<PairingSetupState, 'unknown'>> {
  const record = await readRecord(userId);

  if (!record) {
    // Never saw this pairing happen on this install: keep its current sharing.
    await writeRecord(userId, { coupleId, done: true, sharingReset: false });
    return 'done';
  }

  if (record.coupleId === coupleId) {
    if (!record.done && !record.sharingReset && (await resetSharing(userId))) {
      await writeRecord(userId, { ...record, sharingReset: true });
    }
    // Records from the earlier version have no step: they were in sharing setup.
    return record.done ? 'done' : record.step ?? 'sharing';
  }

  // Saw "not paired" or a different couple: this is a NEW pairing.
  const sharingReset = await resetSharing(userId);
  await writeRecord(userId, { coupleId, done: false, sharingReset, step: 'sharing' });
  return 'sharing';
}

/**
 * Make sure the sharing reset for the current new pairing has happened
 * (retrying if it failed before). True = safe to show and change settings.
 */
export async function ensurePairingSharingReset(userId: string, coupleId: string): Promise<boolean> {
  const record = await readRecord(userId);
  if (!record || record.coupleId !== coupleId || record.done || record.sharingReset) return true;
  if (!(await resetSharing(userId))) return false;
  await writeRecord(userId, { ...record, sharingReset: true });
  return true;
}

/**
 * Finish step `from` for this couple and return the step that comes next
 * (null = refused). Leaving Sharing setup is refused while the sharing reset
 * for this new pairing hasn't succeeded, so consent from the previous pairing
 * can never carry over. Leaving it with everything still off is fine: each
 * feature is opt-in and only turned on after a Cancel / Confirm step.
 * Repeating a step that is already finished changes nothing.
 */
export async function advancePairingSetup(
  userId: string,
  coupleId: string,
  from: SetupStep,
): Promise<Exclude<PairingSetupState, 'unknown'> | null> {
  const record = await readRecord(userId);
  // No setup running for this couple (an existing pairing): nothing to advance.
  if (!record || record.coupleId !== coupleId || record.done) return 'done';
  const current = record.step ?? 'sharing';
  if (current !== from) return current; // already further along (or a stale tap)
  if (from === 'sharing' && !record.sharingReset) return null;
  const next = NEXT[from];
  await writeRecord(userId, next === 'done' ? { ...record, done: true, step: undefined } : { ...record, step: next });
  return next;
}

/**
 * May this account's data be synced right now for `coupleId` (the couple the
 * server says it is in)? False while that pairing's setup is unfinished, or
 * when this phone last saw the account unpaired or in a different couple.
 * Used by background location and the background jobs, which run even when
 * no screen is open.
 */
export async function pairingSetupAllowsSync(userId: string, coupleId: string): Promise<boolean> {
  const record = await readRecord(userId);
  if (record === null) return true; // existing pairing from before this install's records
  return record.done === true && record.coupleId === coupleId;
}

/** The Sharing setup screen to show for this couple (the first one if none saved yet). */
export async function readSharingStep(userId: string, coupleId: string): Promise<SharingStep> {
  const record = await readRecord(userId);
  const saved = record && record.coupleId === coupleId ? record.sharingStep : undefined;
  return saved && (SHARING_STEPS as readonly string[]).includes(saved) ? saved : SHARING_STEPS[0];
}

/** Remember the Sharing setup screen (only for this couple's unfinished setup). */
export async function saveSharingStep(userId: string, coupleId: string, sharingStep: SharingStep): Promise<void> {
  const record = await readRecord(userId);
  if (!record || record.coupleId !== coupleId || record.done || (record.step ?? 'sharing') !== 'sharing') return;
  await writeRecord(userId, { ...record, sharingStep });
}
