import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import { noteLocalNotification } from './activityUnread';
import { readCached, writeCached } from './offlineCache';
import { readStoredSession, supabase } from './supabase';

/**
 * Local notifications shown by Bond on THIS phone (no server involved).
 * Used to deliver partner alerts picked up by the app; see partnerAlerts.ts.
 */

export const ALERT_CHANNEL = 'partner-alerts';

Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

let channelReady = false;

/** Android groups notifications in channels the user can control in Settings. */
export async function ensureAlertChannel(): Promise<void> {
  if (channelReady || Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ALERT_CHANNEL, {
    name: 'Partner alerts',
    description: "For example when your partner's battery is low.",
    importance: Notifications.AndroidImportance.HIGH,
  });
  channelReady = true;
}

export async function notificationsAllowed(): Promise<boolean> {
  try {
    return (await Notifications.getPermissionsAsync()).granted;
  } catch {
    return false;
  }
}

/** One notification Bond showed, kept so it also appears in Bond's Notifications screen. */
export type InboxItem = { id: string; title: string; body: string; at: number; kind?: string };

const INBOX_KEY = 'inbox';
const INBOX_MAX = 50;

/** Whose inbox this phone shows now (also offline, from the saved session). */
async function inboxOwner(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.user.id ?? (await readStoredSession())?.user.id ?? null;
}

/** Notifications Bond showed on this phone for this account, newest first. */
export async function readInbox(): Promise<InboxItem[]> {
  const c = await readCached<InboxItem[]>(await inboxOwner(), INBOX_KEY);
  return c?.value ?? [];
}

async function addToInbox(item: InboxItem): Promise<void> {
  const owner = await inboxOwner();
  if (!owner) return;
  const list = (await readCached<InboxItem[]>(owner, INBOX_KEY))?.value ?? [];
  await writeCached(owner, INBOX_KEY, [item, ...list.filter((x) => x.id !== item.id)].slice(0, INBOX_MAX));
  noteLocalNotification(item.at);
}

/** Show a notification now. Silently does nothing if notifications are not allowed. */
export async function showLocalNotification(title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
  // Also in Bond's Notifications screen (even if Android hides the notification).
  await addToInbox({
    id: String(data.alertId ?? `${Date.now()}-${Math.round(Math.random() * 1e6)}`),
    title,
    body,
    at: Date.now(),
    kind: typeof data.kind === 'string' ? data.kind : undefined,
  }).catch(() => undefined);
  try {
    await ensureAlertChannel();
    await Notifications.scheduleNotificationAsync({
      content: { title, body, data, sound: 'default' },
      trigger: Platform.OS === 'android' ? { channelId: ALERT_CHANNEL } : null,
    });
  } catch {
    // not permitted: nothing else to do
  }
}
