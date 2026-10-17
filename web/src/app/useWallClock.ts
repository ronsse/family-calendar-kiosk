/**
 * Unit H — the client's clock, ticking.
 *
 * The wall is not reloaded for months and refetches only on SSE open and at the
 * date boundary.  Anything time-derived that is computed once at render is
 * therefore frozen forever: a routine whose window opens at 06:00 would never
 * visibly open.  This hook re-reads `Date.now()` on a timer and lets time-derived
 * state fall out of a normal re-render.
 *
 * It re-reads the clock rather than accumulating: the Pi has no RTC and NTP steps
 * the clock after boot, sometimes by hours.  An accumulated counter would be wrong
 * for the rest of the day; a re-read is wrong for at most one tick.
 */

import { useEffect, useMemo, useState } from 'react';
import type { LocalDate, LocalTime } from '../../../src/types.ts';
import { clientLocalDate, clientLocalTime } from '../views/logic/clock.ts';

export const DEFAULT_TICK_MS = 15_000;

export interface WallClock {
  nowMs: number;
  localDate: LocalDate;
  localTime: LocalTime;
}

export function useWallClock(tickMs: number = DEFAULT_TICK_MS): WallClock {
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
    }, tickMs);
    return () => {
      clearInterval(id);
    };
  }, [tickMs]);

  return useMemo(
    () => ({ nowMs, localDate: clientLocalDate(nowMs), localTime: clientLocalTime(nowMs) }),
    [nowMs],
  );
}
