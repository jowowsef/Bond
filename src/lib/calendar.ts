import * as Crypto from 'expo-crypto';
import type { Reminder, Repeat } from './calendarDates';
import { errorMessage, supabase } from './supabase';

/**
 * SHARED CALENDAR: reading and saving (migration 0012).
 *
 * The database decides who may see or change what (row level security):
 * only the two partners of a complete couple, for that couple's events.
 * created_by / updated_by / couple_id can't be faked from here.
 *
 * Saving is safe to retry: a new event gets its id on the phone BEFORE it is
 * sent, so sending the same event again (for example after a timeout) can't
 * create a second copy.
 */

export type CalendarEvent = {
  id: string;
  couple_id: string;
  created_by: string | null;
  updated_by: string | null;
  title: string;
  start_date: string;
  start_time: string | null;
  end_time: string | null;
  timezone: string;
  description: string | null;
  location: string | null;
  reminder: Reminder;
  repeat: Repeat;
  created_at: string;
  updated_at: string;
};

export type EventException = { event_id: string; occurrence_date: string };

export type EventInput = {
  title: string;
  start_date: string;
  start_time: string | null;
  end_time: string | null;
  description: string | null;
  location: string | null;
  reminder: Reminder;
  repeat: Repeat;
};

export type SaveResult = { ok: true; id: string } | { ok: false; message: string };

/** The phone's time zone (IANA name, e.g. "Asia/Manila"); times are kept in it. */
export function deviceTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

export function newEventId(): string {
  return Crypto.randomUUID();
}

const clean = (s: string | null) => {
  const t = (s ?? '').trim();
  return t ? t : null;
};

function friendly(error: { code?: string; message?: string }): string {
  if (error.code === '42501' || /row-level security/i.test(error.message ?? '')) {
    return 'Only the two of you, while paired, can change this calendar.';
  }
  if (error.code === '42P01' || error.code === 'PGRST205') return 'The calendar needs a server update first.';
  return errorMessage(error) || 'Could not save. Check your connection and try again.';
}

/** All events and cancelled occurrences of my couple (the database returns only those). */
export async function fetchCalendar(): Promise<{ events: CalendarEvent[]; exceptions: EventException[] }> {
  const [ev, ex] = await Promise.all([
    supabase.from('calendar_events').select('*').order('start_date', { ascending: true }),
    supabase.from('calendar_event_exceptions').select('event_id, occurrence_date'),
  ]);
  if (ev.error) throw new Error(friendly(ev.error));
  if (ex.error) throw new Error(friendly(ex.error));
  return { events: (ev.data as CalendarEvent[]) ?? [], exceptions: (ex.data as EventException[]) ?? [] };
}

export async function fetchEvent(id: string): Promise<CalendarEvent | null> {
  const { data, error } = await supabase.from('calendar_events').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(friendly(error));
  return (data as CalendarEvent) ?? null;
}

/** Create (with an id made on the phone, so a retry can't duplicate it). */
export async function createEvent(id: string, coupleId: string, input: EventInput): Promise<SaveResult> {
  const { error } = await supabase.from('calendar_events').insert({
    id,
    couple_id: coupleId,
    title: input.title.trim(),
    start_date: input.start_date,
    start_time: input.start_time,
    end_time: input.end_time,
    timezone: deviceTimeZone(),
    description: clean(input.description),
    location: clean(input.location),
    reminder: input.reminder,
    repeat: input.repeat,
  });
  // Already saved by an earlier attempt: that's the same event, not an error.
  if (error && error.code !== '23505') return { ok: false, message: friendly(error) };
  return { ok: true, id };
}

/** Edit the whole event (for a repeating event: every occurrence). */
export async function updateEvent(id: string, input: EventInput): Promise<SaveResult> {
  const { data, error } = await supabase
    .from('calendar_events')
    .update({
      title: input.title.trim(),
      start_date: input.start_date,
      start_time: input.start_time,
      end_time: input.end_time,
      timezone: deviceTimeZone(),
      description: clean(input.description),
      location: clean(input.location),
      reminder: input.reminder,
      repeat: input.repeat,
    })
    .eq('id', id)
    .select('id');
  if (error) return { ok: false, message: friendly(error) };
  if (!data || data.length === 0) return { ok: false, message: 'This event no longer exists.' };
  return { ok: true, id };
}

/** Delete the event (for a repeating event: the whole series). */
export async function deleteEvent(id: string): Promise<SaveResult> {
  const { error } = await supabase.from('calendar_events').delete().eq('id', id);
  if (error) return { ok: false, message: friendly(error) };
  return { ok: true, id };
}

/** Remove ONE occurrence of a repeating event (the rest stays). */
export async function cancelOccurrence(event: CalendarEvent, occurrenceDate: string): Promise<SaveResult> {
  const { error } = await supabase
    .from('calendar_event_exceptions')
    .insert({ event_id: event.id, couple_id: event.couple_id, occurrence_date: occurrenceDate });
  if (error && error.code !== '23505') return { ok: false, message: friendly(error) };
  return { ok: true, id: event.id };
}

/**
 * Change ONE occurrence of a repeating event: it becomes its own single
 * event, and that date is removed from the series. If the second step fails,
 * the first is undone, so the date never shows twice.
 */
export async function editOccurrence(event: CalendarEvent, occurrenceDate: string, newId: string, input: EventInput): Promise<SaveResult> {
  const created = await createEvent(newId, event.couple_id, { ...input, repeat: 'none' });
  if (!created.ok) return created;
  const cancelled = await cancelOccurrence(event, occurrenceDate);
  if (!cancelled.ok) {
    await supabase.from('calendar_events').delete().eq('id', newId);
    return cancelled;
  }
  return created;
}

/** My "Calendar reminders" preference (null = not available yet). */
export async function readCalendarReminders(userId: string): Promise<boolean | null> {
  const { data, error } = await supabase.from('privacy_settings').select('calendar_reminders').eq('user_id', userId).maybeSingle();
  if (error) return null;
  return (data as { calendar_reminders?: boolean } | null)?.calendar_reminders ?? true;
}

export async function setCalendarReminders(userId: string, on: boolean): Promise<boolean> {
  const { error } = await supabase.from('privacy_settings').update({ calendar_reminders: on }).eq('user_id', userId);
  return !error;
}
