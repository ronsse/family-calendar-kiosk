/**
 * Unit H — rendering wrongness instead of hiding it (H2 gap #3).
 *
 * Stale-but-labelled satisfies the prime invariant.  Stale-and-confident does not.
 * The client compares the date the SERVER used against the date the CLIENT is
 * actually living in, because with a second of skew at local midnight the server
 * can answer "yesterday" and nothing else fires until the next boundary (H1 lens 3).
 */

import type { Freshness, LocalDate, MaterializationStatus } from '../../../../src/types.ts';
import { freshnessWords, type StateWords } from './words.ts';

/** A calendar this far behind is worth saying out loud, not worth hiding. */
export const CALENDAR_STALE_AFTER_SECONDS = 60 * 60;

export interface FreshnessStatus {
  readonly tone: MaterializationStatus;
  readonly words: StateWords;
  /** True when the snapshot is for a different local day than the client's. */
  readonly dayMismatch: boolean;
  /** True when the server answered a date other than the one asked for. */
  readonly requestMismatch: boolean;
}

export function freshnessStatus(
  freshness: Freshness,
  clientLocalDate: LocalDate,
  requestedLocalDate: LocalDate,
): FreshnessStatus {
  const dayMismatch = freshness.snapshotLocalDate !== clientLocalDate;
  const requestMismatch = freshness.snapshotLocalDate !== requestedLocalDate;
  // Only a calendar somebody ASKED for can be late. With none configured there is nothing
  // owed and nothing to report — badging that as staleness lights the pill permanently, and
  // a pill that never goes out is one nobody reads. Configured-but-never-synced still counts
  // as stale: an adult wired those calendars up and they are not arriving.
  const calendarStale =
    freshness.calendarConfigured &&
    (freshness.calendarSyncAgeSeconds === null ||
      freshness.calendarSyncAgeSeconds > CALENDAR_STALE_AFTER_SECONDS);

  let tone: MaterializationStatus = 'ok';
  if (freshness.routineMaterialization === 'error') tone = 'error';
  else if (dayMismatch || requestMismatch) tone = 'stale';
  else if (freshness.routineMaterialization === 'stale' || calendarStale) tone = 'stale';

  return { tone, words: freshnessWords[tone], dayMismatch, requestMismatch };
}
