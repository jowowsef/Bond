import { useCallback, useEffect, useState } from 'react';
import { supabase, uniqueTopic } from '@/lib/supabase';
import type { ActivityLog } from '@/lib/types';
import { assertSignedIn, onReconnect } from '@/lib/connectivity';
import { readCached, writeCached } from '@/lib/offlineCache';
import { useCouple } from '@/state/couple';

type FeedState = {
  logs: ActivityLog[];
  loading: boolean;
  error: boolean;
  reload: () => Promise<void>;
};

/**
 * Loads recent couple activity (from the activity_logs table) with proper
 * loading / error / empty states. Also refreshes live when new activity
 * arrives. `limit` keeps Home light (a few rows) vs the Activity tab (more).
 */
export function useActivityFeed(limit = 30): FeedState {
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const { userId: myId, couple } = useCouple();
  const coupleId = couple?.id ?? null;
  const cacheKey = `activity:${coupleId ?? 'none'}:${limit}`;

  const reload = useCallback(async () => {
    // Offline / not signed in yet: keep what is shown (an empty answer would look like "no activity").
    const signedIn = await assertSignedIn().then(
      () => true,
      () => false,
    );
    if (!signedIn) {
      setError(true);
      setLoading(false);
      return;
    }
    const { data, error: err } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (err) {
      setError(true);
    } else {
      setError(false);
      const next = (data as ActivityLog[]) ?? [];
      setLogs(next);
      void writeCached(myId, cacheKey, next);
    }
    setLoading(false);
  }, [limit, myId, cacheKey]);

  useEffect(() => {
    // The last saved activity at once (only this account, this couple), until the server answers.
    let answered = false;
    void readCached<ActivityLog[]>(myId, cacheKey).then((c) => {
      if (!c || answered) return;
      setLogs((cur) => (cur.length ? cur : c.value.filter((l) => !coupleId || l.couple_id === coupleId)));
      setLoading(false);
    });
    void reload().then(() => {
      answered = true;
    });
    const offReconnect = onReconnect(() => void reload());
    const channel = supabase
      .channel(uniqueTopic(`activity-feed-${limit}`))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, () => void reload())
      .subscribe();
    return () => {
      offReconnect();
      void supabase.removeChannel(channel);
    };
  }, [reload, limit, myId, cacheKey, coupleId]);

  return { logs, loading, error, reload };
}

/**
 * The text to show for an activity row. Most rows use the stored message, but
 * the initial pairing event is rendered dynamically from the two current
 * display names (so it reads "Jj and Denizee are now connected" instead of the
 * "Me joined…" text that was stored before either name was chosen). No new
 * events are created — this is display-only.
 */
export function activityMessage(
  log: ActivityLog,
  names: { myName?: string | null; partnerName?: string | null; myUserId?: string | null },
): string {
  const known = (n?: string | null) => !!n && n.trim() !== '' && n.trim() !== 'Me';
  if (log.kind === 'partner_joined') {
    const a = names.myName?.trim();
    const b = names.partnerName?.trim();
    if (known(a) && known(b)) return `${a} and ${b} are now connected.`;
    return 'You are now connected.';
  }
  return perspectiveMessage(log, names.myUserId ?? null, known(names.partnerName) ? names.partnerName!.trim() : 'Your partner')
    ?? log.message;
}

/**
 * Rewrites a stored message from the viewer's point of view, deciding WHO
 * acted from actor_id (never from names). The stored row is not changed.
 * Returns null when the kind or actor is unknown, so the stored text is used.
 */
function perspectiveMessage(log: ActivityLog, myUserId: string | null, partner: string): string | null {
  if (!myUserId || !log.actor_id) return null;
  const mine = log.actor_id === myUserId;
  const label = log.message.match(/"([^"]+)"/)?.[1]; // control name, when the message has one
  const quoted = label ? `"${label}"` : 'the control';
  // Partner's name at the start of a sentence; possessive form for "Sef's".
  const P = partner;
  const Ps = partner === 'Your partner' ? "your partner's" : partner.endsWith('s') ? `${partner}'` : `${partner}'s`;

  switch (log.kind) {
    case 'approval_requested': {
      const unpair = /to unpair/.test(log.message);
      if (unpair) return mine ? 'You asked to unpair.' : `${P} asked to unpair.`;
      return mine ? 'You asked to turn off your location sharing.' : `${P} asked to turn off their location sharing.`;
    }
    case 'approval_approved':
      return mine ? `You approved turning off ${Ps} location sharing.` : `${P} approved turning off your location sharing.`;
    case 'approval_declined':
      return mine ? `You declined ${Ps} request.` : `${P} declined your request.`;
    case 'approval_cancelled':
      return mine ? 'You withdrew your request.' : `${P} withdrew their request.`;
    case 'location_on':
      return mine ? 'You turned location sharing on.' : `${P} turned location sharing on.`;
    case 'location_off':
      return mine ? 'You turned location sharing off.' : `${P} turned location sharing off.`;
    case 'partner_left':
      return mine ? 'You unpaired. All controls were turned off.' : `${P} unpaired. All controls were turned off.`;
    case 'control_enabled':
      return mine ? `You turned on ${quoted} on your own phone.` : `${P} turned on ${quoted} on their own phone.`;
    case 'request_created':
      return mine ? `You asked to turn on ${quoted} on ${Ps} phone.` : `${P} asked to turn on ${quoted} on your phone.`;
    case 'request_approved':
      return mine ? `You accepted ${quoted} on your phone.` : `${P} accepted ${quoted} on their phone.`;
    case 'request_declined':
      return mine ? `You declined ${quoted}.` : `${P} declined ${quoted}.`;
    case 'request_cancelled':
      return mine ? `You withdrew the request for ${quoted}.` : `${P} withdrew the request for ${quoted}.`;
    default:
      return null;
  }
}

/** Pick an icon + tone for an activity row from its `kind`. */
export function activityVisual(kind: string): { icon: string; tone: 'primary' | 'success' | 'blue' | 'warning' | 'neutral' } {
  if (kind.startsWith('approval_requested') || kind.includes('request')) return { icon: 'mail-outline', tone: 'primary' };
  if (kind.includes('approved')) return { icon: 'checkmark-circle-outline', tone: 'success' };
  if (kind.includes('declined') || kind.includes('cancelled')) return { icon: 'close-circle-outline', tone: 'neutral' };
  if (kind.startsWith('location')) return { icon: 'location-outline', tone: 'blue' };
  if (kind === 'unpaired' || kind === 'partner_left') return { icon: 'unlink-outline', tone: 'warning' };
  if (kind === 'partner_joined') return { icon: 'heart-outline', tone: 'primary' };
  if (kind.includes('control')) return { icon: 'shield-outline', tone: 'success' };
  return { icon: 'ellipse-outline', tone: 'neutral' };
}

/** A short heading for an activity row, from its `kind` (display only). */
export function activityTitle(kind: string): string {
  if (kind === 'partner_joined') return 'Connected';
  if (kind === 'unpaired' || kind === 'partner_left') return 'Unpaired';
  if (kind === 'control_enabled') return 'Control turned on';
  if (kind === 'control_revoked') return 'Control turned off';
  if (kind.includes('approved')) return 'Request approved';
  if (kind.includes('declined')) return 'Request declined';
  if (kind.includes('cancelled')) return 'Request cancelled';
  if (kind.includes('request')) return 'New request';
  if (kind.startsWith('location')) return 'Location';
  return 'Update';
}
