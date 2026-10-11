/**
 * Bond's own confirmation dialog, callable from anywhere (screens, hooks,
 * plain functions) as a promise. Rendered by <ConfirmHost /> in the root
 * layout. If the host isn't mounted (for example JavaScript running without
 * a screen), callers fall back to Android's standard dialog (see consent.ts).
 *
 * This is only for Bond's own explanations. Android's permission dialogs and
 * Settings pages are Android's and are never imitated or bypassed.
 */

export type ConfirmIcon =
  | 'location-outline'
  | 'battery-half-outline'
  | 'time-outline'
  | 'pulse-outline'
  | 'phone-portrait-outline'
  | 'shield-checkmark-outline'
  | 'notifications-outline'
  | 'settings-outline'
  | 'alert-circle-outline'
  | 'unlink-outline'
  | 'calendar-outline'
  | 'trash-outline';

export type ConfirmRequest = {
  title: string;
  body: string;
  /** Short points under the text (for example what is shared, what is deleted). */
  points?: string[];
  confirmLabel: string;
  cancelLabel?: string;
  /** A third, neutral choice (for example "Open App info"). */
  secondaryLabel?: string;
  destructive?: boolean;
  icon?: ConfirmIcon;
};

export type ConfirmResult = 'confirm' | 'cancel' | 'secondary';

type Pending = ConfirmRequest & { resolve: (r: ConfirmResult) => void };

let current: Pending | null = null;
const queue: Pending[] = [];
const listeners = new Set<() => void>();
let hostMounted = 0;

function emit() {
  listeners.forEach((l) => l());
}

export function subscribeConfirm(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getCurrentConfirm(): Pending | null {
  return current;
}

export function confirmHostMounted(): boolean {
  return hostMounted > 0;
}

export function markHostMounted(mounted: boolean): void {
  hostMounted += mounted ? 1 : -1;
}

/** Show the dialog; one at a time (others wait their turn). */
export function showConfirm(request: ConfirmRequest): Promise<ConfirmResult> {
  return new Promise((resolve) => {
    queue.push({ ...request, resolve });
    if (!current) next();
  });
}

function next() {
  current = queue.shift() ?? null;
  emit();
}

/** Called by the host when a button (or back) is pressed. */
export function answerConfirm(result: ConfirmResult): void {
  const p = current;
  if (!p) return;
  p.resolve(result);
  next();
}
