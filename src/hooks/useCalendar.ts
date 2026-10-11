import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState } from 'react-native';
import { fetchCalendar, type CalendarEvent, type EventException } from '@/lib/calendar';
import { supabase, uniqueTopic } from '@/lib/supabase';

/**
 * The couple's shared calendar, kept live:
 *  - loaded when shown, re-read on every change from either phone
 *    (Realtime), when Bond comes back to the front, and on pull to refresh
 *    (those two also catch up after a dropped Realtime connection);
 *  - only the latest request is applied (no older answer overwrites a newer one);
 *  - on a failed read the last good data stays on screen with an error flag
 *    (offline), never an empty calendar.
 * coupleId null (not paired) = nothing, and everything is cleared, so a
 * previous couple's events never show.
 */
export function useCalendar(coupleId: string | null) {
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [exceptions, setExceptions] = useState<EventException[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const seq = useRef(0);
  const coupleRef = useRef(coupleId);
  coupleRef.current = coupleId;

  const reload = useCallback(async () => {
    const id = coupleRef.current;
    if (!id) return;
    const mine = ++seq.current;
    try {
      const data = await fetchCalendar();
      if (mine !== seq.current || coupleRef.current !== id) return;
      // Belt and braces: only this couple's rows.
      setEvents(data.events.filter((e) => e.couple_id === id));
      setExceptions(data.exceptions);
      setError(null);
    } catch (e) {
      if (mine !== seq.current) return;
      setError((e as Error).message || 'Could not load the calendar.');
      throw e;
    } finally {
      if (mine === seq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    seq.current++;
    setEvents([]);
    setExceptions([]);
    setError(null);
    setLoading(!!coupleId);
    if (!coupleId) return;
    const run = () => void reload().catch(() => undefined);
    run();
    // New and changed rows: only this couple's. Deletions can't be filtered
    // by Realtime (a delete carries only the row id), so any calendar delete
    // triggers a re-read, which the database limits to this couple.
    const channel = supabase
      .channel(uniqueTopic(`calendar-${coupleId}`))
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendar_events', filter: `couple_id=eq.${coupleId}` }, run)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'calendar_events', filter: `couple_id=eq.${coupleId}` }, run)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'calendar_events' }, run)
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'calendar_event_exceptions', filter: `couple_id=eq.${coupleId}` }, run)
      .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'calendar_event_exceptions' }, run)
      .subscribe();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') run();
    });
    return () => {
      sub.remove();
      void supabase.removeChannel(channel);
    };
  }, [coupleId, reload]);

  /** Cancelled occurrence dates per event. */
  const cancelled = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const x of exceptions) {
      if (!map.has(x.event_id)) map.set(x.event_id, new Set());
      map.get(x.event_id)!.add(x.occurrence_date);
    }
    return map;
  }, [exceptions]);

  return { events, cancelled, loading, error, reload };
}
