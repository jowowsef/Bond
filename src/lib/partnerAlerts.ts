import Constants from 'expo-constants';
import * as Notifications from 'expo-notifications';
import { AppState, Platform } from 'react-native';
import { ensureAlertChannel, notificationsAllowed, showLocalNotification } from './notifications';
import { supabase } from './supabase';

/**
 * PARTNER ALERTS: low battery at 20 / 15 / 10 / 5 % (migrations 0003 /
 * 0004 / 0010), "Your partner has unpaired from you" (0010) and shared
 * calendar reminders (0012).
 *
 * The server decides when an alert is due (trigger in migration 0003) and
 * addresses it only to the partner. This file is the RECEIVING side:
 *  - deliverPendingAlerts(): picks up my undelivered alerts, claims each one
 *    on the server (first claim wins, so nothing is shown twice, even with
 *    push also set up) and shows it as a local notification.
 *  - registerPushToken(): if push is configured for this build (EAS project
 *    id + Firebase), saves this device's Expo push token so the Edge Function
 *    can push while Bond is closed. Without it, alerts arrive when Bond is
 *    open or when Android runs Bond's background check (about every 15 min).
 */

/** Alerts older than this are marked delivered without a notification (no flood of old news). */
const MAX_AGE_MS = 2 * 60 * 60 * 1000;

type PendingAlert = { id: string; title: string; body: string; created_at: string; kind: string; subject_id: string };

/** Who I'm paired with now, and since when (null = not paired). Undefined = couldn't check. */
async function currentPairing(userId: string): Promise<{ partnerId: string; since: number } | null | undefined> {
  const me = await supabase.from('couple_members').select('couple_id').eq('user_id', userId).maybeSingle();
  if (me.error) return undefined;
  if (!me.data) return null;
  const coupleId = me.data.couple_id as string;
  const [members, couple] = await Promise.all([
    supabase.from('couple_members').select('user_id').eq('couple_id', coupleId),
    supabase.from('couples').select('created_at').eq('id', coupleId).maybeSingle(),
  ]);
  if (members.error || couple.error) return undefined;
  const partner = (members.data ?? []).find((m) => m.user_id !== userId)?.user_id as string | undefined;
  if (!partner) return null;
  return { partnerId: partner, since: couple.data?.created_at ? new Date(couple.data.created_at as string).getTime() : 0 };
}

/**
 * Should this alert still be shown? Never news about someone who is no longer
 * my partner, and never "unpaired" after I already paired again.
 */
function stillRelevant(alert: PendingAlert, pairing: { partnerId: string; since: number } | null): boolean {
  if (alert.kind === 'battery_low') return !!pairing && alert.subject_id === pairing.partnerId;
  if (alert.kind === 'unpaired') return !pairing || pairing.since < new Date(alert.created_at).getTime();
  // Calendar reminders only while still paired (unpairing deletes the couple's events too).
  if (alert.kind === 'calendar_reminder') return !!pairing;
  return true;
}

let running: Promise<void> | null = null;

export function deliverPendingAlerts(userId: string): Promise<void> {
  if (!running) {
    running = run(userId).finally(() => {
      running = null;
    });
  }
  return running;
}

async function run(userId: string): Promise<void> {
  // Notifications off on this phone: leave alerts unclaimed (nothing is lost
  // or marked as seen). Bond never turns notifications on by itself.
  if (!(await notificationsAllowed())) return;
  const { data, error } = await supabase
    .from('partner_alerts')
    .select('id, title, body, created_at, kind, subject_id')
    .eq('recipient_id', userId)
    .is('delivered_at', null)
    .order('created_at', { ascending: true })
    .limit(20);
  if (error) {
    // Table missing (migration 0003 not run yet) or offline: try again later.
    return;
  }
  const alerts = (data as PendingAlert[]) ?? [];
  if (alerts.length === 0) return;
  const pairing = await currentPairing(userId);
  if (pairing === undefined) return; // offline: decide later
  for (const alert of alerts) {
    const { data: claimed, error: claimError } = await supabase.rpc('claim_partner_alert', { p_id: alert.id });
    if (claimError || claimed !== true) continue; // already delivered elsewhere (push, other phone)
    // Claimed but not shown: too old, about a former partner, or outdated.
    if (Date.now() - new Date(alert.created_at).getTime() > MAX_AGE_MS) continue;
    if (!stillRelevant(alert, pairing)) continue;
    // Bond is open: its own "You're no longer paired" screen already says it.
    if (alert.kind === 'unpaired' && AppState.currentState === 'active') continue;
    await showLocalNotification(alert.title, alert.body, { kind: alert.kind, alertId: alert.id });
  }
}

export type PushSetup = 'registered' | 'not-configured' | 'no-permission' | 'failed';

/** Save this device's push token for the signed-in user (only if push is set up for this build). */
export async function registerPushToken(): Promise<PushSetup> {
  if (Platform.OS !== 'android') return 'not-configured';
  const projectId =
    (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)?.eas?.projectId ??
    Constants.easConfig?.projectId;
  if (!projectId) return 'not-configured';
  if (!(await notificationsAllowed())) return 'no-permission';
  try {
    await ensureAlertChannel();
    const { data: token } = await Notifications.getExpoPushTokenAsync({ projectId });
    const { error } = await supabase.rpc('register_push_token', { p_token: token, p_platform: Platform.OS });
    return error ? 'failed' : 'registered';
  } catch {
    // Usually: Firebase (google-services.json) not set up in this build.
    return 'failed';
  }
}

/**
 * Bond is showing its own "You're no longer paired" screen: mark this
 * account's pending unpair alerts as delivered, so no notification about the
 * same event follows later (from the background check).
 */
export async function claimUnpairAlertsQuietly(userId: string): Promise<void> {
  const { data, error } = await supabase
    .from('partner_alerts')
    .select('id')
    .eq('recipient_id', userId)
    .eq('kind', 'unpaired')
    .is('delivered_at', null)
    .limit(10);
  if (error) return; // table / kind not there yet (0010), or offline
  for (const a of (data as { id: string }[]) ?? []) {
    await supabase.rpc('claim_partner_alert', { p_id: a.id });
  }
}
