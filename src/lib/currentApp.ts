import { getUsageSupport, hasUsageAccess } from './screenTime';
import BondUsage from '../../modules/bond-usage';
import { serviceModes, updateServiceModes } from './currentAppServiceControl';
import { isMissingSchema } from './schemaErrors';
import { supabase } from './supabase';

/**
 * CURRENTLY USING (optional, OFF by default)
 *
 * Shares which app is in front on this phone, so the partner's Home screen
 * can show it. It uses the same Android "Usage access" as Screen Time (the
 * existing bond-usage module, no extra permission or library): Android's
 * usage log says which app came to the front and whether it is still there.
 *
 * Only the app's name (and its package name, for the icon) plus the time of
 * the check are shared. Never notification contents, messages, typed text,
 * passwords, or anything inside the app. When no app is in front (screen off,
 * lock screen, home screen) that is shared as "no app", never a guess.
 *
 * It is sent only when ALL of these hold, checked right before each upload:
 * Usage access is on, share_current_app is on (by default for a new pairing
 * unless the person chose OFF, or turned on by hand after a one-time
 * explanation), and the caller already verified sign-in, pairing and
 * finished setup. The database refuses writes while share_current_app is off
 * (RLS) and deletes the row when it is turned off or the couple ends (0008).
 *
 * WHEN A CHECK HAPPENS (and honest limits)
 *  - Main path, while sharing is on: Bond's own foreground service (with a
 *    persistent notification) reads the usage log about every 20 seconds while
 *    the screen is on and reports when the app changes (see
 *    src/lib/currentAppService.ts). Android can still delay or stop it: battery
 *    saving, Samsung's sleeping-apps rules, or Bond being killed / force
 *    stopped (it starts again when Bond is opened).
 *  - When Bond is opened (the app in front is then Bond itself).
 *  - Right after Bond leaves the screen: the usage log is read for up to a
 *    few seconds until the next app shows up (see syncAfterLeavingBond).
 *  - While background location sharing runs: with each location update, at
 *    most every 2 minutes (Android delivers those when the phone moves).
 *  - The background job: about every 15 minutes at best; Samsung often holds
 *    it longer (up to about 30 to 45 minutes).
 * React Native pauses JavaScript timers while Bond is in the background, so
 * Bond can't poll every few seconds while it is closed; an app switch made
 * while Bond is closed (TikTok -> Shopee) shows up at the next check above.
 * So this is "what was in front at the last check", always shown with that
 * time, never a live feed.
 *
 * Needs database migration 0008. Until it is applied, the setting reads as
 * unavailable and nothing is sent.
 */

export type CurrentAppRow = {
  user_id: string;
  app_name: string | null;
  package_name: string | null;
  checked_at: string;
};

/** After this, the partner's card says "last seen" instead of "using now". */
export const CURRENT_APP_FRESH_MS = 20 * 60 * 1000;

export type CurrentAppSetting = { kind: 'on' } | { kind: 'off' } | { kind: 'unavailable' } | { kind: 'error' };

/** Read a person's share_current_app (mine, or my partner's while paired). */
export async function readCurrentAppSetting(userId: string): Promise<CurrentAppSetting> {
  const { data, error } = await supabase.from('privacy_settings').select('share_current_app').eq('user_id', userId).maybeSingle();
  if (error) return isMissingSchema(error) ? { kind: 'unavailable' } : { kind: 'error' };
  return (data as { share_current_app?: boolean } | null)?.share_current_app ? { kind: 'on' } : { kind: 'off' };
}

/** Which app is in front right now, read from Android's usage log (null = none). */
export async function readForegroundApp(): Promise<{ appName: string; packageName: string } | null> {
  if (!BondUsage) throw new Error('needs-update');
  const end = Date.now();
  const usage = await BondUsage.getUsage(end - 60 * 60 * 1000, end);
  // The app still in front when the log ends is counted up to the very end.
  const current = usage.apps
    .filter((a) => (a.lastUsedMs ?? 0) >= end - 1500)
    .sort((a, b) => (b.lastUsedMs ?? 0) - (a.lastUsedMs ?? 0))[0];
  return current ? { appName: current.appName.slice(0, 80), packageName: current.packageName.slice(0, 200) } : null;
}

/** Bond's own Android package (the app in front while Bond is open). */
const OWN_PACKAGE = 'com.bond.couple';
/** The same app again within this time is not written again (fewer writes). */
const REPEAT_MS = 2 * 60 * 1000;

/** Result of one check: only 'failed' is worth retrying. */
export type WriteResult = 'written' | 'skipped' | 'superseded' | 'failed';

type Observation = { app: { appName: string; packageName: string } | null; observedAt: number };

/** A network step that takes longer than this is treated as failed (and retried later). */
const NETWORK_TIMEOUT_MS = 20_000;

/** The last observation this phone wrote, to skip identical repeats. */
let lastWritten: { userId: string; key: string; at: number } | null = null;
/**
 * Bumped on unpair, sign-out and turning sharing off: a check that was
 * already running then is dropped before it writes (nothing stale is sent
 * for a couple that ended).
 */
let generation = 0;

/**
 * ONE writer at a time, and the NEWEST request always wins: while a write is
 * running, a new request replaces any request still waiting (the replaced one
 * resolves 'superseded'), so the latest app is never lost behind an older one.
 * (Before, two requests waiting behind a running write could both resume and
 * the second, newer one was silently dropped, leaving an old app on the
 * partner's screen until the next change.)
 */
type Job = { userId: string; observe: () => Promise<Observation | null>; resolve: (r: WriteResult) => void };
let waiting: Job | null = null;
let running = false;

function schedule(userId: string, observe: () => Promise<Observation | null>): Promise<WriteResult> {
  return new Promise((resolve) => {
    if (waiting) waiting.resolve('superseded');
    waiting = { userId, observe, resolve };
    if (!running) void pump();
  });
}

async function pump(): Promise<void> {
  running = true;
  try {
    while (waiting) {
      const job = waiting;
      waiting = null;
      let result: WriteResult;
      try {
        result = await withTimeout(checkAndWrite(job.userId, job.observe), NETWORK_TIMEOUT_MS * 2);
      } catch {
        result = 'failed';
      }
      job.resolve(result);
    }
  } finally {
    running = false;
  }
}

/** Reject after `ms` (works while Bond is open and inside background tasks, where timers run). */
function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    p,
    new Promise<T>((_, reject) => {
      timer = setTimeout(() => reject(new Error('timeout')), ms);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

/**
 * Forget everything about the current couple's uploads (unpair, sign-out,
 * sharing turned off): anything waiting or running is not written.
 */
export function resetCurrentAppUploads(): void {
  generation++;
  lastWritten = null;
  if (waiting) {
    waiting.resolve('skipped');
    waiting = null;
  }
}

/**
 * Upload what is in front now, only when allowed (see the rules above).
 * The caller must already have checked sign-in, pairing and finished setup.
 */
export function syncCurrentAppIfSharing(userId: string): Promise<boolean> {
  return schedule(userId, async () => ({ observedAt: Date.now(), app: await readForegroundApp() })).then((r) => r === 'written');
}

/**
 * Call the moment Bond leaves the screen. Android writes "the next app came
 * to the front" a moment AFTER Bond leaves, and JavaScript timers are paused
 * in the background, so instead of waiting with a timer this reads the usage
 * log again (each read is one short native call) until an app other than
 * Bond is in front, for at most a few seconds. If none appears (home screen,
 * lock screen, screen off), that is what gets shared: "no app".
 */
export function syncAfterLeavingBond(userId: string): Promise<boolean> {
  return schedule(userId, async () => {
    const deadline = Date.now() + 4000;
    let last: Observation = { observedAt: Date.now(), app: null };
    for (let i = 0; i < 25 && Date.now() < deadline; i++) {
      last = { observedAt: Date.now(), app: await readForegroundApp() };
      if (last.app && last.app.packageName !== OWN_PACKAGE) break;
    }
    // Still Bond (its own screen was still closing): nothing new to share.
    return last.app?.packageName === OWN_PACKAGE ? null : last;
  }).then((r) => r === 'written');
}

/**
 * An observation from the native Currently Using service (it already read the
 * usage log). Same rules, repeat-skipping and ordered write as every other
 * check. Returns what happened, so the service can retry a failed upload.
 */
export function recordObservation(
  userId: string,
  obs: { app: { appName: string; packageName: string } | null; observedAt: number },
): Promise<WriteResult> {
  return schedule(userId, async () => obs);
}

/** Is sharing on (server) and Usage access granted (Android)? For the service's own checks. */
export async function currentAppSharingAllowed(userId: string): Promise<'yes' | 'no' | 'unknown'> {
  if (getUsageSupport() !== 'ready' || !hasUsageAccess()) return 'no';
  const setting = await withTimeout(readCurrentAppSetting(userId), NETWORK_TIMEOUT_MS).catch(
    () => ({ kind: 'error' }) as CurrentAppSetting,
  );
  if (setting.kind === 'error') return 'unknown';
  return setting.kind === 'on' ? 'yes' : 'no';
}

async function checkAndWrite(userId: string, observe: () => Promise<Observation | null>): Promise<WriteResult> {
  const gen = generation;
  if (getUsageSupport() !== 'ready' || !hasUsageAccess()) return 'skipped';
  const setting = await withTimeout(readCurrentAppSetting(userId), NETWORK_TIMEOUT_MS);
  if (setting.kind === 'error') return 'failed';
  if (setting.kind !== 'on') {
    lastWritten = null;
    return 'skipped';
  }
  const obs = await observe();
  if (!obs) return 'skipped';
  const key = obs.app?.packageName ?? '(none)';
  if (lastWritten && lastWritten.userId === userId && lastWritten.key === key && obs.observedAt - lastWritten.at < REPEAT_MS) {
    return 'skipped'; // same app, written moments ago
  }
  if (gen !== generation) return 'skipped'; // unpaired / signed out / turned off meanwhile
  // Remember it only if it was really stored (a newer stored row wins).
  if (!(await withTimeout(writeObservation(userId, obs), NETWORK_TIMEOUT_MS))) return 'skipped';
  if (gen === generation) lastWritten = { userId, key, at: obs.observedAt };
  return 'written';
}

/**
 * Write one observation without ever replacing a NEWER one (two checks can
 * finish out of order, for example the background job and the open app):
 * update only if the stored checked_at is older; if there is no row yet,
 * insert it (an existing newer row is left alone).
 */
async function writeObservation(userId: string, obs: Observation): Promise<boolean> {
  const values = {
    app_name: obs.app?.appName ?? null,
    package_name: obs.app?.packageName ?? null,
    checked_at: new Date(obs.observedAt).toISOString(),
  };
  const updated = await supabase
    .from('current_app')
    .update(values)
    .eq('user_id', userId)
    .lt('checked_at', values.checked_at)
    .select('user_id');
  if (updated.error) throw updated.error;
  if ((updated.data?.length ?? 0) > 0) return true;
  const inserted = await supabase
    .from('current_app')
    .upsert({ user_id: userId, ...values }, { onConflict: 'user_id', ignoreDuplicates: true })
    .select('user_id');
  if (inserted.error) throw inserted.error;
  return (inserted.data?.length ?? 0) > 0; // 0 rows: a newer row already exists
}

/** Turn sharing on (the caller has shown the explanation and checked Usage access). */
export async function enableCurrentAppSharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  const { error } = await supabase.from('privacy_settings').update({ share_current_app: true }).eq('user_id', userId);
  if (error) {
    return {
      ok: false,
      message: isMissingSchema(error)
        ? 'This needs a small database update before it can be used.'
        : 'Could not turn this on. Check your connection and try again.',
    };
  }
  await syncCurrentAppIfSharing(userId);
  return { ok: true };
}

/** Turn sharing off and remove the stored value (and stop the app checks; battery keeps its part). */
export async function disableCurrentAppSharing(userId: string): Promise<{ ok: boolean; message?: string }> {
  const m = serviceModes();
  if (m.running && m.apps) await updateServiceModes({ apps: false, battery: m.battery, screenTime: m.screenTime });
  const { error } = await supabase.from('privacy_settings').update({ share_current_app: false }).eq('user_id', userId);
  if (error && !isMissingSchema(error)) {
    return { ok: false, message: 'Could not turn this off. Check your connection and try again.' };
  }
  await supabase.from('current_app').delete().eq('user_id', userId);
  resetCurrentAppUploads();
  return { ok: true };
}

// ---------------- The person's choice (remembered on the account) ----------------
//
// Kept in the account's own metadata (Supabase Auth, no database change), so it
// follows the account to every phone and survives restarts and new pairings:
//   bond_current_app_consent_at: when the person agreed, once, in Bond's
//                                explanation dialog (turning it on by hand),
//   bond_current_app_default_at: when a new pairing turned it on by default
//                                (no dialog; kept apart from real consent),
//   bond_current_app: 'on' | 'off', the latest choice ('off' is always the
//                     person's own and is never overridden).
// The server switch privacy_settings.share_current_app stays the one that
// actually allows sharing (row level security); unpairing still turns it off.

type ChoiceMeta = {
  bond_current_app?: 'on' | 'off';
  bond_current_app_consent_at?: string | null;
  bond_current_app_default_at?: string;
  /** Set when this account's first couple ended (see unpairReset.ts). */
  bond_previously_paired?: boolean;
};

export function readCurrentAppChoice(session: { user: { user_metadata?: Record<string, unknown> } } | null): {
  consented: boolean;
  /** Turned on by a new pairing's default (not by the person's own dialog). */
  defaultOn: boolean;
  choice: 'on' | 'off' | null;
} {
  const meta = (session?.user.user_metadata ?? {}) as ChoiceMeta;
  return {
    consented: typeof meta.bond_current_app_consent_at === 'string',
    defaultOn: typeof meta.bond_current_app_default_at === 'string',
    choice: meta.bond_current_app === 'on' || meta.bond_current_app === 'off' ? meta.bond_current_app : null,
  };
}

/** Remember an explicit choice (turning ON also records the one-time consent). Best effort. */
export async function recordCurrentAppChoice(choice: 'on' | 'off'): Promise<void> {
  const { data } = await supabase.auth.getSession();
  const meta = (data.session?.user.user_metadata ?? {}) as ChoiceMeta;
  const next: ChoiceMeta = { bond_current_app: choice };
  if (choice === 'on' && !meta.bond_current_app_consent_at) next.bond_current_app_consent_at = new Date().toISOString();
  if (meta.bond_current_app === next.bond_current_app && !next.bond_current_app_consent_at) return;
  await supabase.auth.updateUser({ data: next }).catch(() => undefined);
}

// Every new pairing (also the account's first) starts with Currently Using
// OFF like every other kind of sharing; it is turned on only by the person in
// Sharing setup or Settings (with the one-time explanation per pairing).

/**
 * The partner's row, and only theirs: a row for anyone else (my own, a
 * previous partner's, or a different account after switching) is never shown.
 */
export function partnerRowOnly(row: CurrentAppRow | null, partnerId: string | null, myId: string | null): CurrentAppRow | null {
  if (!row || !partnerId || partnerId === myId || row.user_id !== partnerId) return null;
  return row;
}
