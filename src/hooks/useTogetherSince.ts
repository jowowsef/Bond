import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useCouple } from '@/state/couple';

/**
 * How long the two of you have been paired on Bond: from the moment the
 * second partner joined this couple (couple_members.joined_at), counted in
 * whole days on this phone's calendar. Null while loading, when not paired,
 * or if it can't be read.
 */
export function useTogetherSince(): { days: number; label: string } | null {
  const { couple, partnerId } = useCouple();
  const coupleId = couple?.id ?? null;
  const [joined, setJoined] = useState<{ coupleId: string; at: string } | null>(null);

  useEffect(() => {
    if (!coupleId || !partnerId) return;
    let cancelled = false;
    void supabase
      .from('couple_members')
      .select('joined_at')
      .eq('couple_id', coupleId)
      .order('joined_at', { ascending: false })
      .limit(1)
      .maybeSingle()
      .then(({ data }) => {
        const at = (data as { joined_at?: string } | null)?.joined_at;
        if (!cancelled && at) setJoined({ coupleId, at });
      });
    return () => {
      cancelled = true;
    };
  }, [coupleId, partnerId]);

  if (!joined || joined.coupleId !== coupleId || !partnerId) return null;
  const start = new Date(joined.at);
  const startDay = new Date(start.getFullYear(), start.getMonth(), start.getDate()).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const days = Math.max(0, Math.round((today - startDay) / 86_400_000));
  const label = start.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });
  return { days, label };
}
