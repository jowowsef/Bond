import { useCallback, useEffect, useState } from 'react';
import { supabase, uniqueTopic } from '@/lib/supabase';
import type { ActivityLog } from '@/lib/types';

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

  const reload = useCallback(async () => {
    const { data, error: err } = await supabase
      .from('activity_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(limit);
    if (err) {
      setError(true);
    } else {
      setError(false);
      setLogs((data as ActivityLog[]) ?? []);
    }
    setLoading(false);
  }, [limit]);

  useEffect(() => {
    void reload();
    const channel = supabase
      .channel(uniqueTopic(`activity-feed-${limit}`))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'activity_logs' }, () => void reload())
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [reload, limit]);

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
  names: { myName?: string | null; partnerName?: string | null },
): string {
  if (log.kind === 'partner_joined') {
    const a = names.myName?.trim();
    const b = names.partnerName?.trim();
    const known = (n?: string) => !!n && n !== 'Me';
    if (known(a) && known(b)) return `${a} and ${b} are now connected.`;
    return 'You are now connected.';
  }
  return log.message;
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
