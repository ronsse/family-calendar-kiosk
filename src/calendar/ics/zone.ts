/**
 * iCal adapter. Wall-clock time in a named zone -> instant.
 *
 * INTERNAL TO THIS DIRECTORY.
 *
 * ical.js hands back a `DTSTART;TZID=America/Denver:20261007T150000` as a FLOATING time —
 * the TZID is only a parameter on the property, because no VTIMEZONE was registered with
 * it. So the conversion is done here, against the IANA database Node already carries,
 * rather than by trusting the feed's own VTIMEZONE block (Google writes correct ones, but
 * "correct" is the only kind of VTIMEZONE this code would ever need, and Intl has them all).
 *
 * The method is the same fixed-point as the HA adapter's `localMidnightUtc`: guess the
 * offset at the naive instant, correct, re-read the offset at the corrected instant. Two
 * rounds converge everywhere. An ambiguous wall time (the repeated hour in autumn) resolves
 * to its FIRST occurrence. One that does not exist (the hour skipped at spring-forward)
 * resolves an hour early; no calendar app will write one, so that is documented, not fixed.
 */

const FORMATTERS = new Map<string, Intl.DateTimeFormat>();

function formatterFor(tz: string): Intl.DateTimeFormat {
  let f = FORMATTERS.get(tz);
  if (!f) {
    // Throws RangeError for an unknown zone, which the caller turns into a sync failure.
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    });
    FORMATTERS.set(tz, f);
  }
  return f;
}

function offsetMs(tz: string, instantMs: number): number {
  const parts = formatterFor(tz).formatToParts(new Date(instantMs));
  const n = (type: Intl.DateTimeFormatPartTypes): number => {
    const hit = parts.find((p) => p.type === type);
    if (!hit) throw new Error(`Intl emitted no ${type} part`);
    return Number(hit.value);
  };
  const asIfUtc = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour'), n('minute'), n('second'));
  return asIfUtc - Math.floor(instantMs / 1000) * 1000;
}

export interface WallClock {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
}

/** True when `tz` is a zone this runtime can resolve. */
export function isKnownZone(tz: string): boolean {
  try {
    formatterFor(tz);
    return true;
  } catch {
    return false;
  }
}

export function wallClockToUtc(t: WallClock, tz: string): Date {
  const naive = Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  if (tz === 'UTC' || tz === 'Etc/UTC') return new Date(naive);
  // Seed from the offset an hour BEFORE the naive instant: across the autumn overlap that
  // lands on the first (daylight) occurrence.
  let guess = naive - offsetMs(tz, naive - 3_600_000);
  guess = naive - offsetMs(tz, guess);
  return new Date(guess);
}
