/**
 * Unit B — Home Assistant adapter. Local-date ↔ instant conversion.
 *
 * INTERNAL TO THIS DIRECTORY. Nothing outside `src/calendar/homeassistant/` imports this.
 *
 * Two conversions are needed at the HA wire boundary and nowhere else:
 *
 *  1. `localMidnightUtc` — the fetch window arrives as floating LocalDates but HA's REST
 *     API filters by *instant*, so the window must be anchored. Anchoring it by naive
 *     arithmetic is H3 finding #6: adding 24h of UTC per day drifts by an hour twice a
 *     year, which silently drops the first or last day of the window.
 *
 *  2. `utcCalendarDate` — the misconfigured upstream calendar emits all-day events as
 *     "midnight UTC" instants. Its *author* meant a floating date, so the date must be
 *     read back in UTC — the zone the instant is midnight in — NOT in America/Denver.
 *     `localDate()` from src/time.ts would answer with the PREVIOUS day here, which is
 *     why this file exists instead of reusing it. See wire.ts for the full argument.
 *
 * `src/time.ts` stays the gatekeeper: every LocalDate produced here is validated by its
 * `isLocalDate` type guard before it is branded, so no unchecked cast escapes.
 */

import type { LocalDate } from '../../types.ts';
import { householdTimeZone, isLocalDate } from '../../time.ts';

export const MS_PER_DAY = 86_400_000;

/**
 * The household zone's parts formatter, built for the zone in force at CALL time and cached
 * for that zone. It used to be a module constant against the compile-time zone; the zone is a
 * household setting now (`configureTime`), and this runs in the sync worker, not per request.
 */
let zoneParts: { zone: string; fmt: Intl.DateTimeFormat } | null = null;

function zonePartsFormat(): Intl.DateTimeFormat {
  const zone = householdTimeZone();
  if (zoneParts?.zone !== zone) {
    zoneParts = {
      zone,
      fmt: new Intl.DateTimeFormat('en-CA', {
        timeZone: zone,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
      }),
    };
  }
  return zoneParts.fmt;
}

function numericPart(parts: Intl.DateTimeFormatPart[], type: Intl.DateTimeFormatPartTypes): number {
  const hit = parts.find((p) => p.type === type);
  if (!hit) throw new Error(`Intl emitted no ${type} part for ${householdTimeZone()}`);
  const n = Number(hit.value);
  if (!Number.isInteger(n)) throw new Error(`Intl emitted a non-numeric ${type}: ${hit.value}`);
  return n;
}

/** Milliseconds east of UTC in the household zone at `instant` (negative for Denver). */
function zoneOffsetMs(instant: Date): number {
  const parts = zonePartsFormat().formatToParts(instant);
  const asIfUtc = Date.UTC(
    numericPart(parts, 'year'),
    numericPart(parts, 'month') - 1,
    numericPart(parts, 'day'),
    numericPart(parts, 'hour'),
    numericPart(parts, 'minute'),
    numericPart(parts, 'second'),
  );
  return asIfUtc - instant.getTime();
}

/**
 * The instant at which `date` begins in the household zone.
 *
 * Fixed-point, not arithmetic: guess the offset from the naive instant, correct, then
 * re-read the offset at the corrected instant. Two rounds converge for every real zone,
 * and the result is verified to format back to `date` — so a zone whose local midnight
 * does not exist fails loudly here rather than shifting the window by an hour in silence.
 */
export function localMidnightUtc(date: LocalDate): Date {
  const naive = Date.parse(`${date}T00:00:00Z`);
  if (Number.isNaN(naive)) throw new Error(`bad LocalDate: ${date}`);

  let guess = naive;
  for (let round = 0; round < 2; round++) guess = naive - zoneOffsetMs(new Date(guess));

  const instant = new Date(guess);
  const parts = zonePartsFormat().formatToParts(instant);
  const y = String(numericPart(parts, 'year')).padStart(4, '0');
  const m = String(numericPart(parts, 'month')).padStart(2, '0');
  const d = String(numericPart(parts, 'day')).padStart(2, '0');
  if (`${y}-${m}-${d}` !== date) {
    throw new Error(`could not anchor ${date} in ${householdTimeZone()} (landed on ${y}-${m}-${d})`);
  }
  return instant;
}

/** True when `instant` is exactly 00:00:00.000 UTC. Exact: the JS time scale has no leap seconds. */
export function isUtcMidnight(instant: Date): boolean {
  return instant.getTime() % MS_PER_DAY === 0;
}

/**
 * The UTC calendar date of `instant`, as a validated LocalDate.
 *
 * This looks like the `toISOString().slice(0,10)` that src/time.ts bans, and the ban is
 * right — for an arbitrary instant. It is applied here only to an instant the upstream
 * wrote as literal midnight UTC to mean a floating date, where the UTC date parts ARE the
 * intended date. Callers must gate on `isUtcMidnightWireForm` (wire.ts) first.
 */
export function utcCalendarDate(instant: Date): LocalDate {
  const iso = instant.toISOString().slice(0, 10);
  if (!isLocalDate(iso)) throw new Error(`instant did not yield a calendar date: ${iso}`);
  return iso;
}
