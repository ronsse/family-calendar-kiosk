/**
 * Unit H — routine time boxes, evaluated on the CLIENT's clock.
 *
 * `RoutineRunView` ships `opensAtLocal` / `closesAtLocal` as data and never a
 * server-computed `locked` flag.  A snapshot built at 00:00 carrying `locked`
 * would never open at 06:00, because the wall only refetches on SSE open and at
 * the date boundary — the fatal flaw H2 Q1 found.  So the box is derived here,
 * from a clock that is re-read on a timer.
 *
 * Two deliberate refusals:
 *
 * - **The phase never blocks a tap.**  `blocksInteraction` is the literal type
 *   `false`.  A child up at 05:50 who ticks a step must not be told "not yet" by a
 *   clock, and a routine that is late must not become untickable.  The phase
 *   changes EMPHASIS only.
 * - **A malformed time fails OPEN.**  If either bound is unparseable the routine
 *   is treated as open all day.  The alternative — hiding or freezing it — is the
 *   6:00 AM blank wall this project exists to prevent (H2 Q1: "hiding a routine
 *   before its window opens renders a blank wall at 05:30").
 */

import { minutesOfDay } from './clock.ts';

export type TimeBoxPhase = 'before' | 'open' | 'after';

export interface TimeBoxState {
  readonly phase: TimeBoxPhase;
  /** True when the window runs past local midnight (bedtime 19:30 → 06:00). */
  readonly wrapsMidnight: boolean;
  /** True when a bound could not be parsed and the box was failed open. */
  readonly degraded: boolean;
  /** Minutes until the window opens.  0 unless `phase === 'before'`. */
  readonly minutesUntilOpen: number;
  /** Minutes until the window closes.  0 unless `phase === 'open'`. */
  readonly minutesUntilClose: number;
  /** Never true.  The clock moves emphasis, never permission. */
  readonly blocksInteraction: false;
}

const DAY_MINUTES = 24 * 60;

const ALWAYS_OPEN: TimeBoxState = {
  phase: 'open',
  wrapsMidnight: false,
  degraded: true,
  minutesUntilOpen: 0,
  minutesUntilClose: 0,
  blocksInteraction: false,
};

/**
 * @param opensAtLocal  "HH:MM", floating local time from the run view.
 * @param closesAtLocal "HH:MM".  When it is <= opens, the window wraps midnight.
 * @param nowLocal      "HH:MM" from the CLIENT's clock, in the household zone.
 */
export function timeBoxState(
  opensAtLocal: string,
  closesAtLocal: string,
  nowLocal: string,
): TimeBoxState {
  const opens = minutesOfDay(opensAtLocal);
  const closes = minutesOfDay(closesAtLocal);
  const now = minutesOfDay(nowLocal);
  if (opens === null || closes === null || now === null) return ALWAYS_OPEN;

  const wrapsMidnight = closes <= opens;

  if (wrapsMidnight) {
    // opens === closes is a zero-length window; it reads as 24 hours, not zero.
    const open = now >= opens || now < closes;
    if (open) {
      const untilClose = now < closes ? closes - now : DAY_MINUTES - now + closes;
      return {
        phase: 'open',
        wrapsMidnight,
        degraded: false,
        minutesUntilOpen: 0,
        minutesUntilClose: untilClose,
        blocksInteraction: false,
      };
    }
    // Outside a wrapping window there is no "after" — tonight's opening is ahead.
    return {
      phase: 'before',
      wrapsMidnight,
      degraded: false,
      minutesUntilOpen: opens - now,
      minutesUntilClose: 0,
      blocksInteraction: false,
    };
  }

  if (now < opens) {
    return {
      phase: 'before',
      wrapsMidnight,
      degraded: false,
      minutesUntilOpen: opens - now,
      minutesUntilClose: 0,
      blocksInteraction: false,
    };
  }
  if (now < closes) {
    return {
      phase: 'open',
      wrapsMidnight,
      degraded: false,
      minutesUntilOpen: 0,
      minutesUntilClose: closes - now,
      blocksInteraction: false,
    };
  }
  return {
    phase: 'after',
    wrapsMidnight,
    degraded: false,
    minutesUntilOpen: 0,
    minutesUntilClose: 0,
    blocksInteraction: false,
  };
}
