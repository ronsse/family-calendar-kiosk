/**
 * Shared time helpers. Small, dependency-free, and the ONLY sanctioned way to produce a
 * LocalDate.
 *
 * `toISOString().slice(0,10)` is banned: it yields the UTC date, which in America/Denver
 * is tomorrow's date from 17:00 or 18:00 onward depending on DST — so the wall would roll
 * over to "tomorrow" during dinner (H3 finding #6). Every "today" on both server and
 * client comes from `Intl.DateTimeFormat('en-CA', { timeZone })`, which emits YYYY-MM-DD.
 */

import { DAY_CODES, DEFAULT_TZ, type LocalDate, type LocalTime, type Utc } from './types.ts';

/**
 * The household's zone, held here and nowhere else (2026-10-12; until then it was a compile-time
 * constant). It starts as `DEFAULT_TZ` and is changed only by `configureTime`: on the
 * server by `main.ts` (and the sync worker) from the household's `timezone` setting at boot,
 * in the browser by the snapshot, which carries the zone the server built that snapshot in.
 * Both sides must agree or "today" differs between them at dinner time.
 */
let zone: string = DEFAULT_TZ;

function dateFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

function timeFormat(timeZone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

let DATE_FMT = dateFormat(zone);
let TIME_FMT = timeFormat(zone);

/**
 * Moves every local date and time this module produces into `timeZone`.
 *
 * Throws (a RangeError from Intl) on a zone this runtime does not know, and changes nothing in
 * that case: both formatters are built before either is swapped in. Callers validate first —
 * `parseHousehold` on the server, `applyHouseholdView` in the bundle.
 */
export function configureTime(o: { timeZone: string }): void {
  const date = dateFormat(o.timeZone);
  const time = timeFormat(o.timeZone);
  zone = o.timeZone;
  DATE_FMT = date;
  TIME_FMT = time;
}

/** The zone every local date and time is currently computed in. */
export function householdTimeZone(): string {
  return zone;
}

/** The local calendar date at `instant` (default: now). */
export function localDate(instant: Date = new Date()): LocalDate {
  return DATE_FMT.format(instant) as LocalDate;
}

/** The local wall-clock time at `instant` (default: now), as "HH:MM". */
export function localTime(instant: Date = new Date()): LocalTime {
  return TIME_FMT.format(instant) as LocalTime;
}

export function nowUtc(instant: Date = new Date()): Utc {
  return instant.toISOString() as Utc;
}

/**
 * Whole-day difference between two local dates.
 *
 * Computed in UTC *from the date parts only*, never from the original instants. Parsing
 * "2026-12-25" as a UTC midnight and subtracting is exact because both operands are
 * anchored the same way — which is what makes "3 sleeps until Christmas" survive a DST
 * boundary that would break an instant delta (H3 finding #6).
 */
export function daysBetween(from: LocalDate, to: LocalDate): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`bad LocalDate: ${from} / ${to}`);
  return Math.round((b - a) / 86_400_000);
}

/** Add whole days to a local date, staying in local-date space. */
export function addDays(date: LocalDate, days: number): LocalDate {
  const t = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(t)) throw new Error(`bad LocalDate: ${date}`);
  return new Date(t + days * 86_400_000).toISOString().slice(0, 10) as LocalDate;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// A real clock reading, not just the shape of one: `25:00` used to pass.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isLocalDate(v: string): v is LocalDate {
  return DATE_RE.test(v) && !Number.isNaN(Date.parse(`${v}T00:00:00Z`));
}

export function isLocalTime(v: string): v is LocalTime {
  return TIME_RE.test(v);
}

/** Two-letter day code matching `routine.days_of_week` ("MO,TU,…"). */
export function dayCode(date: LocalDate): (typeof DAY_CODES)[number] {
  const idx = new Date(`${date}T00:00:00Z`).getUTCDay();
  const code = DAY_CODES[idx];
  if (!code) throw new Error(`bad LocalDate: ${date}`);
  return code;
}

/**
 * The ISO week a local date falls in, as "2026-W38".  Monday-start, week 1 holds the year's
 * first Thursday — the same numbering the scene generator uses for its ids (`2026w38-…`), so
 * the picture and the dog's week turn over together.  Pure date arithmetic in UTC on the
 * date string: no zone is involved once the LocalDate has been decided.
 */
export function isoWeekKey(date: LocalDate): string {
  const d = new Date(`${date}T00:00:00Z`);
  // Shift to the Thursday of this week; its year is the ISO year.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const jan1 = Date.UTC(year, 0, 1);
  const week = Math.ceil(((d.getTime() - jan1) / 86_400_000 + 1) / 7);
  return `${String(year)}-W${String(week).padStart(2, '0')}`;
}
