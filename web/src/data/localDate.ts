/**
 * Unit I — the client's own "today", and noticing when it changes.
 *
 * Two rules, both of which the rest of this directory depends on:
 *
 * 1. **`Intl.DateTimeFormat('en-CA', { timeZone })`, never `toISOString().slice(0,10)`.**
 *    The UTC date in America/Denver is tomorrow from 17:00 or 18:00 onward, so a UTC-derived
 *    "today" rolls the whole wall over during dinner (H3 finding #6). `src/time.ts` is the
 *    single sanctioned producer and this module delegates to it rather than re-deriving —
 *    a second implementation is a second thing to get wrong.
 *
 * 2. **The date boundary is a CLIENT event.** Nothing on the server fires at local midnight,
 *    SSE carries no state, and the kiosk does not reload for months. If this module does not
 *    notice the rollover, the wall renders Monday at 06:00 on Tuesday — alive, structurally
 *    valid, and wrong (H3 finding #4). It is the only reason `localDate` is polled at all.
 */

import { localDate } from '../../../src/time.ts';
import type { LocalDate } from '../../../src/types.ts';

/** The household-local calendar date on the CLIENT's clock. */
export function wallLocalDate(atMs: number): LocalDate {
  return localDate(new Date(atMs));
}

export interface DateWatch {
  readonly lastDate: LocalDate | null;
}

export function initialDateWatch(): DateWatch {
  return { lastDate: null };
}

export interface DateObservation {
  readonly watch: DateWatch;
  /** True exactly once per change of local date. */
  readonly rolledOver: boolean;
}

/**
 * Feeds one clock reading in and reports whether the local day changed.
 *
 * The FIRST observation is never a rollover: the boot fetch already happened, and firing here
 * would double-fetch on every start. After that, any change fires exactly once — including a
 * change BACKWARDS, because NTP stepping the Pi's clock back over a boundary leaves the wall
 * showing a day that is no longer today, which is the same failure in the other direction.
 *
 * Across a DST transition this is a no-op by construction. On 2026-11-01 the local hour
 * 01:00–02:00 happens twice; both passes format to the same `LocalDate`, so no spurious
 * boundary fires, and the single real change at local midnight fires once.
 */
export function observeDate(watch: DateWatch, date: LocalDate): DateObservation {
  if (watch.lastDate === null) return { watch: { lastDate: date }, rolledOver: false };
  if (watch.lastDate === date) return { watch, rolledOver: false };
  return { watch: { lastDate: date }, rolledOver: true };
}
