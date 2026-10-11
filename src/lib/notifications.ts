import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';

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

/** Show a notification now. Silently does nothing if notifications are not allowed. */
export async function showLocalNotification(title: string, body: string, data: Record<string, unknown> = {}): Promise<void> {
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
