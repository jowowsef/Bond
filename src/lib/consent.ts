import { Alert } from 'react-native';
import { confirmHostMounted, showConfirm, type ConfirmIcon, type ConfirmResult } from './confirmStore';

export type ShareKind = 'location' | 'battery' | 'screen_time' | 'current_app';

type Explain = { title: string; body: string; points: string[]; icon: ConfirmIcon };

/** Shown BEFORE a kind of sharing is turned on: what the partner sees, and what Android needs. */
const ON_TEXT: Record<ShareKind, (name: string) => Explain> = {
  location: (name) => ({
    title: 'Share your location?',
    body: `${name} will see where you are on the map while location sharing is on.`,
    points: [
      'Android asks for location permission next ("While using the app" is enough to start).',
      'With "Allow all the time", it continues while Bond is closed; Android shows a notification then.',
      'Only your latest position is kept. It is deleted when you turn sharing off.',
    ],
    icon: 'location-outline',
  }),
  battery: (name) => ({
    title: 'Share your battery?',
    body: `${name} will see your battery level and whether it is charging.`,
    points: [
      'No Android permission is needed.',
      `${name} gets an alert when your battery gets low.`,
      'Bond keeps a quiet notification ("Background activity is running") so it can send changes in the background: on charging changes, when the level moves, and about every 15 minutes.',
      "Turn off battery optimization for Bond so Android doesn't pause it.",
    ],
    icon: 'battery-half-outline',
  }),
  screen_time: (name) => ({
    title: 'Share your screen time?',
    body: `${name} will see today's screen time and your most-used apps (names and time).`,
    points: [
      'Needs Android\'s "Usage access" for Bond.',
      'Bond never sees what you do inside apps.',
      'Sent in the background about every 15 minutes while your screen is on, with the quiet "Background activity is running" notification. It shows when it was last synced.',
    ],
    icon: 'time-outline',
  }),
  current_app: (name) => ({
    title: 'Share the app you are using?',
    body: `${name} will see the name of the app open on your phone and when it was last detected.`,
    points: [
      'Needs Android\'s "Usage access" for Bond.',
      'Checked about every 20 seconds while your screen is on; Android shows a notification the whole time.',
      'Only the latest app, never a history, and nothing inside apps (no messages, notifications, typed text or passwords).',
    ],
    icon: 'phone-portrait-outline',
  }),
};

/** Shown BEFORE a kind of sharing is turned off: what stops, and what is removed. */
const OFF_TEXT: Record<ShareKind, (name: string) => Explain> = {
  location: (name) => ({
    title: 'Turn off location sharing?',
    body: `${name} will stop seeing your location right away.`,
    points: ['Your last shared location is deleted.', 'Background location sharing and its notification stop.'],
    icon: 'location-outline',
  }),
  battery: (name) => ({
    title: 'Turn off battery sharing?',
    body: `${name} will stop seeing your battery.`,
    points: ['Your last shared battery reading is deleted.', 'Low battery alerts about you stop.'],
    icon: 'battery-half-outline',
  }),
  screen_time: (name) => ({
    title: 'Turn off screen time sharing?',
    body: `${name} will stop seeing your screen time.`,
    points: [
      'Nothing new is sent.',
      'Summaries already sent are hidden from them right away and removed after 30 days.',
    ],
    icon: 'time-outline',
  }),
  current_app: (name) => ({
    title: 'Stop sharing the app you are using?',
    body: `${name} will stop seeing which app you are using.`,
    points: ['The background check and its notification stop.', 'The last shared app is deleted.'],
    icon: 'phone-portrait-outline',
  }),
};

/**
 * Explain what the partner will see BEFORE a kind of sharing is turned on.
 * Resolves true only if the person taps the confirm button.
 */
export function confirmSharing(
  kind: ShareKind,
  partnerName: string,
  labels: { cancel: string; confirm: string } = { cancel: 'Cancel', confirm: 'Turn on' },
): Promise<boolean> {
  const t = ON_TEXT[kind](partnerName);
  return ask({ ...t, confirmLabel: labels.confirm, cancelLabel: labels.cancel }).then((r) => r === 'confirm');
}

/** Explain what stops (and what is deleted) BEFORE turning a kind of sharing off. Cancel changes nothing. */
export function confirmStopSharing(kind: ShareKind, partnerName: string): Promise<boolean> {
  const t = OFF_TEXT[kind](partnerName);
  return ask({ ...t, confirmLabel: 'Turn off', cancelLabel: 'Cancel', destructive: true }).then((r) => r === 'confirm');
}

/** A two-button Bond dialog as a promise. Back button / tapping outside = cancel. */
export function askConfirm(
  title: string,
  body: string,
  confirmLabel: string,
  cancelLabel = 'Cancel',
  destructive = false,
  icon?: ConfirmIcon,
): Promise<boolean> {
  return ask({ title, body, confirmLabel, cancelLabel, destructive, icon }).then((r) => r === 'confirm');
}

/** Three choices (confirm / secondary / cancel), for example a permission that Android may be blocking. */
export function askChoice(request: {
  title: string;
  body: string;
  points?: string[];
  confirmLabel: string;
  secondaryLabel: string;
  cancelLabel?: string;
  icon?: ConfirmIcon;
}): Promise<ConfirmResult> {
  return ask(request);
}

function ask(request: {
  title: string;
  body: string;
  points?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  secondaryLabel?: string;
  destructive?: boolean;
  icon?: ConfirmIcon;
}): Promise<ConfirmResult> {
  if (confirmHostMounted()) return showConfirm(request);
  // No screen (for example JavaScript running in the background): Android's
  // standard dialog, same choices.
  return new Promise((resolve) => {
    let settled = false;
    const done = (v: ConfirmResult) => {
      if (!settled) {
        settled = true;
        resolve(v);
      }
    };
    const text = request.points?.length ? `${request.body}\n\n• ${request.points.join('\n• ')}` : request.body;
    Alert.alert(
      request.title,
      text,
      [
        { text: request.cancelLabel ?? 'Cancel', style: 'cancel', onPress: () => done('cancel') },
        ...(request.secondaryLabel ? [{ text: request.secondaryLabel, onPress: () => done('secondary') }] : []),
        { text: request.confirmLabel, style: request.destructive ? 'destructive' : 'default', onPress: () => done('confirm') },
      ],
      { cancelable: true, onDismiss: () => done('cancel') },
    );
  });
}
