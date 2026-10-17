/**
 * Unit H — quantity as repeated marks.
 *
 * A pre-reader cannot read "7".  She also cannot read "seven".  Quantity in the
 * picture band is therefore pips, and above `maxPips` it stops being countable at
 * a glance and becomes a single "lots" mark instead of a longer row of dots.
 *
 * The count is computed HERE, in the domain layer, and handed to the renderer as a
 * PipSpec — which is what lets the picture-band components avoid touching a
 * numeric field at all (test/unit-h.sources.test.ts asserts they do not).
 */

import type { ReadingBand } from '../../../../src/types.ts';
import { bandTypography } from '../../design/tokens.ts';

export interface PipSpec {
  /** Marks to draw filled. */
  readonly filled: number;
  /** Marks to draw hollow, after the filled ones.  0 for a bare count. */
  readonly empty: number;
  /** The real quantity exceeded what is countable; draw the "lots" mark. */
  readonly overflow: boolean;
  /** The real number behind the marks.  Only bands that show numerals read it. */
  readonly count: number;
}

const NONE: PipSpec = { filled: 0, empty: 0, overflow: false, count: 0 };

function clampCount(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.trunc(n));
}

/** A bare quantity — points, sleeps, waiting requests. */
export function pipsForCount(count: number, band: ReadingBand): PipSpec {
  const max = bandTypography[band].maxPips;
  const real = clampCount(count);
  if (max <= 0) return { ...NONE, count: real };
  return {
    filled: Math.min(real, max),
    empty: 0,
    overflow: real > max,
    count: real,
  };
}

/**
 * Progress — filled marks for what is done, hollow marks for what is left.
 * When the total exceeds `maxPips` the row is truncated rather than scaled: a
 * scaled row can show "all filled" when one step is still outstanding, and on
 * this wall that is a lie a child would act on.
 */
export function pipsForProgress(done: number, total: number, band: ReadingBand): PipSpec {
  const max = bandTypography[band].maxPips;
  const realTotal = clampCount(total);
  const realDone = Math.min(clampCount(done), realTotal);
  if (max <= 0) return { ...NONE, count: realDone };
  const complete = realTotal > 0 && realDone === realTotal;
  const filled = Math.min(realDone, max);
  const empty = Math.max(0, Math.min(realTotal - realDone, max - filled));
  // A finished routine shows a FULL row even when it had more steps than marks.
  // Trailing a "lots" heap after the last tick would read as "still going", which
  // is the one thing a child acts on wrongly.
  return { filled, empty, overflow: !complete && realTotal > max, count: realDone };
}
