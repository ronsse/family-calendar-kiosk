/**
 * Unit H — the client's own clock, and every string derived from it.
 *
 * Two rules this module exists to enforce:
 *
 * 1. **Never `toISOString().slice(0,10)`.**  That is the UTC date, which in
 *    America/Denver is tomorrow from 17:00 or 18:00 onward — the wall would roll
 *    over to "tomorrow" during dinner (H3 finding #6).  Local dates and times come
 *    from `src/time.ts`, which is the only sanctioned producer, and the formatters
 *    below are all `timeZone`-pinned the same way.
 * 2. **Never throw on bad input.**  A malformed instant in one event must not take
 *    the wall down at 6:00 AM.  Everything here degrades to `null` and the renderer
 *    drops one line of text instead of the whole screen.
 */

import type { EventWhen, LocalDate, LocalTime } from '../../../../src/types.ts';
import { householdTimeZone, isLocalTime, localDate, localTime } from '../../../../src/time.ts';
import { householdLocale } from '../../../../src/config/presentation.ts';

interface ClockFormats {
  readonly time: Intl.DateTimeFormat;
  readonly dateFull: Intl.DateTimeFormat;
  readonly dateShort: Intl.DateTimeFormat;
  /** "Oct 11": the header's date when the weekday will not fit beside the clock (logic/textFit.ts). */
  readonly dateMonthDay: Intl.DateTimeFormat;
  /** "Sat": a ledger line from earlier this week, where "Oct 10" would make an adult count back. */
  readonly dateWeekday: Intl.DateTimeFormat;
}

/**
 * The formatters for one (locale, zone) pair. They were module constants pinned to the
 * compile-time zone until 2026-10-12; the household's settings now arrive with the snapshot,
 * so they are built on first use and kept. At most two pairs are ever held — the default the
 * bundle boots in and the household's — and a third evicts the oldest.
 */
const FORMATS = new Map<string, ClockFormats>();

/**
 * The zone a DATE-ONLY value is rendered in, and it is UTC on purpose — not the household's.
 * A `LocalDate` is a calendar day, not an instant: it is anchored at noon UTC below and must be
 * read back in the zone it was anchored in. Rendering it in the household zone instead only
 * works while that zone is within 12 hours of UTC; in UTC+13 and UTC+14 (New Zealand in summer,
 * Tonga, Kiribati) noon UTC is already tomorrow and every date on the wall rolls a day ahead.
 * In America/Denver the output is byte-identical either way. The instant formatter (`time`)
 * keeps the household zone, because an instant is exactly what it is given.
 */
const DATE_ONLY_ZONE = 'UTC';

function fmts(locale: string, timeZone: string): ClockFormats {
  const key = `${locale}|${timeZone}`;
  const hit = FORMATS.get(key);
  if (hit !== undefined) return hit;
  const f: ClockFormats = {
    time: new Intl.DateTimeFormat(locale, { timeZone, hour: 'numeric', minute: '2-digit' }),
    dateFull: new Intl.DateTimeFormat(locale, { timeZone: DATE_ONLY_ZONE, weekday: 'long', month: 'long', day: 'numeric' }),
    dateShort: new Intl.DateTimeFormat(locale, { timeZone: DATE_ONLY_ZONE, weekday: 'short', month: 'short', day: 'numeric' }),
    dateMonthDay: new Intl.DateTimeFormat(locale, { timeZone: DATE_ONLY_ZONE, month: 'short', day: 'numeric' }),
    dateWeekday: new Intl.DateTimeFormat(locale, { timeZone: DATE_ONLY_ZONE, weekday: 'short' }),
  };
  if (FORMATS.size >= 2) {
    const oldest = FORMATS.keys().next().value;
    if (oldest !== undefined) FORMATS.delete(oldest);
  }
  FORMATS.set(key, f);
  return f;
}

function current(): ClockFormats {
  return fmts(householdLocale(), householdTimeZone());
}

/** The household-local calendar date on the CLIENT's clock. */
export function clientLocalDate(atMs: number): LocalDate {
  return localDate(new Date(atMs));
}

/** The household-local wall-clock time on the CLIENT's clock, "HH:MM". */
export function clientLocalTime(atMs: number): LocalTime {
  return localTime(new Date(atMs));
}

/** `null` rather than an Invalid Date, so nothing downstream can throw. */
function safeInstant(utc: string | null | undefined): Date | null {
  if (typeof utc !== 'string' || utc.length === 0) return null;
  const ms = Date.parse(utc);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/** Minutes since local midnight.  `null` when the time is not "HH:MM". */
export function minutesOfDay(t: string): number | null {
  if (!isLocalTime(t)) return null;
  const hh = Number(t.slice(0, 2));
  const mm = Number(t.slice(3, 5));
  if (!Number.isInteger(hh) || !Number.isInteger(mm)) return null;
  if (hh > 23 || mm > 59) return null;
  return hh * 60 + mm;
}

/**
 * Hand angles for the picture band's analog dial, in degrees clockwise from 12.
 * A dial is how a pre-reader gets "when" without a numeral: no digits are drawn.
 */
export function clockHands(t: string): { hourDeg: number; minuteDeg: number } | null {
  const mins = minutesOfDay(t);
  if (mins === null) return null;
  const minuteOfHour = mins % 60;
  const hourOfDay = Math.floor(mins / 60) % 12;
  return {
    hourDeg: hourOfDay * 30 + minuteOfHour * 0.5,
    minuteDeg: minuteOfHour * 6,
  };
}

/** The local wall-clock start of an event; `null` for an all-day event. */
export function eventStartLocalTime(when: EventWhen): LocalTime | null {
  if (when.kind !== 'timed') return null;
  const at = safeInstant(when.startsAtUtc);
  return at === null ? null : localTime(at);
}

/**
 * "7:30 AM", or the all-day word.  Bands that show no text ignore this and draw
 * the dial instead; the string is computed once here rather than three times.
 */
export function eventTimeText(when: EventWhen, allDayWord = 'All day'): string {
  if (when.kind !== 'timed') return allDayWord;
  const at = safeInstant(when.startsAtUtc);
  return at === null ? '' : current().time.format(at);
}

/**
 * "4:30 PM" — the CURRENT time as words, for the header.
 *
 * Goes through the same timeZone-pinned formatter as every other time on the wall.  Taking
 * the instant and letting `Intl` place it is the whole point: deriving "4:30 PM" from the
 * `LocalTime` string by hand would be a second, unpinned implementation of the thing
 * src/time.ts exists to be the only copy of.
 */
export function clientTimeText(atMs: number): string {
  return Number.isFinite(atMs) ? current().time.format(new Date(atMs)) : '';
}

/** "7:12" for a completed routine step.  Empty when the instant is unusable. */
export function instantTimeText(utc: string | null): string {
  const at = safeInstant(utc);
  return at === null ? '' : current().time.format(at);
}

/**
 * A LocalDate rendered as words.  Anchored at NOON UTC and formatted in UTC
 * (`DATE_ONLY_ZONE`), so the day that comes back is the day that went in whatever the
 * household's offset — the household zone used to be the formatting zone here, which
 * rolled every date a day ahead east of UTC+12.
 */
export function localDateText(
  date: LocalDate,
  style: 'full' | 'short' | 'monthDay' | 'weekday' = 'full',
): string {
  const ms = Date.parse(`${date}T12:00:00Z`);
  if (Number.isNaN(ms)) return '';
  const f = current();
  const fmt =
    style === 'full'
      ? f.dateFull
      : style === 'short'
        ? f.dateShort
        : style === 'monthDay'
          ? f.dateMonthDay
          : f.dateWeekday;
  return fmt.format(new Date(ms));
}
