/**
 * Calendar date logic (pure functions, no app imports, so they can be tested
 * on their own). Mirrors the server's public.calendar_occurrences() in
 * migration 0012 exactly, so the app and the reminder scheduler always agree.
 *
 * Dates are 'YYYY-MM-DD' strings for the event's WALL-CLOCK day; they are
 * never converted through a time zone, so an all-day event can't slide to
 * the day before or after. Times are 'HH:MM' (or 'HH:MM:SS' from the server).
 *
 * Repeats are counted from the ORIGINAL date every time (never from the
 * previous occurrence), so nothing drifts:
 *  - monthly on the 29th-31st: the last day of shorter months, back to the
 *    31st in longer ones;
 *  - yearly on Feb 29: Feb 28 in other years.
 */

export type Repeat = 'none' | 'daily' | 'weekly' | 'monthly' | 'yearly';
export type Reminder = 'none' | 'at_time' | '15m' | '1h' | '1d';

export type EventDates = {
  start_date: string;
  start_time: string | null;
  end_time: string | null;
  repeat: Repeat;
};

const pad = (n: number) => String(n).padStart(2, '0');

export function toKey(y: number, m: number, d: number): string {
  return `${y}-${pad(m)}-${pad(d)}`;
}

export function parseKey(key: string): { y: number; m: number; d: number } {
  const [y, m, d] = key.split('-').map(Number);
  return { y, m, d };
}

/** Today's date on this phone ('YYYY-MM-DD'). */
export function todayKey(now: Date = new Date()): string {
  return toKey(now.getFullYear(), now.getMonth() + 1, now.getDate());
}

const dayNumber = (key: string) => {
  const { y, m, d } = parseKey(key);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
};
const fromDayNumber = (n: number) => {
  const dt = new Date(n * 86_400_000);
  return toKey(dt.getUTCFullYear(), dt.getUTCMonth() + 1, dt.getUTCDate());
};

export function addDays(key: string, days: number): string {
  return fromDayNumber(dayNumber(key) + days);
}

export function daysBetween(fromKey: string, toKeyStr: string): number {
  return dayNumber(toKeyStr) - dayNumber(fromKey);
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** start + k months, clamped to the month's last day (Postgres date + interval does the same). */
export function addMonthsClamped(startKey: string, k: number): string {
  const { y, m, d } = parseKey(startKey);
  const total = y * 12 + (m - 1) + k;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return toKey(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Every occurrence between fromKey and toKey (inclusive), minus cancelled ones. */
export function occurrencesBetween(
  ev: Pick<EventDates, 'start_date' | 'repeat'>,
  fromKey: string,
  toKeyStr: string,
  cancelled?: Set<string>,
): string[] {
  const out: string[] = [];
  const start = ev.start_date;
  if (toKeyStr < start || fromKey > toKeyStr) return out;
  const push = (k: string) => {
    if (!cancelled?.has(k)) out.push(k);
  };
  switch (ev.repeat) {
    case 'none':
      if (start >= fromKey && start <= toKeyStr) push(start);
      return out;
    case 'daily': {
      for (let k = Math.max(0, daysBetween(start, fromKey)); ; k++) {
        const d = addDays(start, k);
        if (d > toKeyStr) break;
        push(d);
      }
      return out;
    }
    case 'weekly': {
      for (let k = Math.max(0, Math.ceil(daysBetween(start, fromKey) / 7)); ; k++) {
        const d = addDays(start, 7 * k);
        if (d > toKeyStr) break;
        push(d);
      }
      return out;
    }
    case 'monthly':
    case 'yearly': {
      const s = parseKey(start);
      const f = parseKey(fromKey);
      const step = ev.repeat === 'monthly' ? 1 : 12;
      let k = ev.repeat === 'monthly' ? (f.y - s.y) * 12 + (f.m - s.m) - 1 : f.y - s.y - 1;
      for (k = Math.max(0, k); k < 100_000; k++) {
        const d = addMonthsClamped(start, k * step);
        if (d > toKeyStr) break;
        if (d >= fromKey) push(d);
      }
      return out;
    }
  }
  return out;
}

/** Minutes since midnight for 'HH:MM[:SS]'. */
export function timeToMinutes(t: string): number {
  const [h, m] = t.split(':').map(Number);
  return h * 60 + m;
}

/**
 * The next occurrence that isn't over yet, as seen on this phone:
 *  - all-day: today counts until midnight;
 *  - timed: until its end time (or its start time when there is no end).
 * null = no future occurrence (a past single event never gets a countdown).
 */
export function nextOccurrence(ev: EventDates, now: Date = new Date(), cancelled?: Set<string>): string | null {
  const today = todayKey(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const horizon = addDays(today, ev.repeat === 'yearly' ? 3 * 366 : 400);
  for (const d of occurrencesBetween(ev, today, horizon, cancelled)) {
    if (d > today) return d;
    const until = ev.end_time ?? ev.start_time;
    if (!until || timeToMinutes(until) > nowMin) return d; // today and not over yet
  }
  return null;
}

/** "Today" / "Tomorrow" / "12 days left" (never negative). */
export function countdownLabel(occurrenceKey: string, now: Date = new Date()): string {
  const days = daysBetween(todayKey(now), occurrenceKey);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  return `${days} days left`;
}

export type FormCheck = { ok: true } | { ok: false; message: string };

/** The same rules the database enforces, checked before saving. */
export function validateEvent(f: { title: string; start_date: string; start_time: string | null; end_time: string | null }): FormCheck {
  const title = f.title.trim();
  if (!title) return { ok: false, message: 'Add a title.' };
  if (title.length > 120) return { ok: false, message: 'The title is too long (120 characters at most).' };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.start_date)) return { ok: false, message: 'Choose a date.' };
  if (f.end_time && !f.start_time) return { ok: false, message: 'Add a start time before an end time.' };
  if (f.end_time && f.start_time && timeToMinutes(f.end_time) < timeToMinutes(f.start_time)) {
    return { ok: false, message: 'The end time is earlier than the start time.' };
  }
  return { ok: true };
}

// ---------------- display ----------------

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function monthTitle(y: number, m: number): string {
  return `${MONTHS[m - 1]} ${y}`;
}

export function weekdayOf(key: string): number {
  const { y, m, d } = parseKey(key);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

/** "Sat, October 11, 2026" */
export function formatLongDate(key: string): string {
  const { y, m, d } = parseKey(key);
  return `${WEEKDAYS[weekdayOf(key)]}, ${MONTHS[m - 1]} ${d}, ${y}`;
}

/** "Oct 11" */
export function formatShortDate(key: string): string {
  const { m, d } = parseKey(key);
  return `${MONTHS[m - 1].slice(0, 3)} ${d}`;
}

/** "7:05 PM" */
export function formatTime12(t: string): string {
  const [h, m] = t.split(':').map(Number);
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? 'AM' : 'PM'}`;
}

/** "All day" / "7:00 PM" / "7:00 PM - 9:00 PM" */
export function eventTimeText(e: { start_time: string | null; end_time: string | null }): string {
  if (!e.start_time) return 'All day';
  return e.end_time ? `${formatTime12(e.start_time)} - ${formatTime12(e.end_time)}` : formatTime12(e.start_time);
}

export const REPEAT_LABELS: Record<Repeat, string> = {
  none: 'Does not repeat',
  daily: 'Every day',
  weekly: 'Every week',
  monthly: 'Every month',
  yearly: 'Every year',
};

export const REMINDER_LABELS: Record<Reminder, string> = {
  none: 'No reminder',
  at_time: 'At event time',
  '15m': '15 minutes before',
  '1h': '1 hour before',
  '1d': '1 day before',
};
