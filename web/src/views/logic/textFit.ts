/**
 * Unit H — words that FIT, instead of words that clip.
 *
 * A strip of chrome has a width it cannot argue with, and its neighbours change width under it:
 * the time is wider at 10:58 than at 7:31, each theme sets a different typeface, and a stale
 * wall's "Showing older information" takes 274px of a bar that is 816 beside a side rail. Two
 * strips took whatever was left and drew an ellipsis at the edge (2026-10-11): gallery's date
 * came out "Sun, Oct …" — it was given 89 of the 96px it needed — and the leave-by banner beside
 * a side rail came out "G… / S…", which is not a banner at all.
 *
 * An ellipsis on a wall is a word nobody can finish. So these strips CHOOSE instead: a short list
 * of ways to say the same thing, preferred first, and the first one that fits is drawn whole.
 * When none fits the answer is NOTHING rather than half of something — a date that is one tap
 * away on the calendar, a banner whose colour and emoji already say "leave soon".
 *
 * The renderer measures and this file decides. The room is the box on the glass and the ruler is
 * a canvas in the font that box draws in (`primitives/useTextRoom.ts`), so nothing here guesses
 * a typeface's widths; and because the ruler is handed in, the tests walk the room down with a
 * fake one and need no browser.
 *
 * No React, no `.tsx` import.
 */

import type { LocalDate } from '../../../../src/types.ts';
import { fontSizePx } from '../../design/tokens.ts';
import { localDateText } from './clock.ts';

/** Width of `words` drawn at `sizePx` in the strip's own font, in logical px. */
export type MeasureText = (words: string, sizePx: number) => number;

/**
 * A canvas measurement and the laid-out line can disagree by a fraction of a pixel, and the box
 * is read in whole pixels. A run that measures within this of its room is not trusted to fit:
 * the price of being wrong is the ellipsis this file exists to remove.
 */
export const FIT_SLACK_PX = 2;

/** Whether a run `widthPx` wide fits in `roomPx`, with the slack above. */
export function fitsIn(widthPx: number, roomPx: number): boolean {
  return widthPx + FIT_SLACK_PX <= roomPx;
}

/** The first candidate whose width fits the room, or null. Never a clipped one. */
export function firstThatFits<T>(
  candidates: readonly T[],
  roomPx: number,
  widthOf: (candidate: T) => number,
): T | null {
  for (const c of candidates) {
    if (fitsIn(widthOf(c), roomPx)) return c;
  }
  return null;
}

/** One way of setting a run of words: these words, at this size. */
export interface FittedWords {
  readonly words: string;
  readonly sizePx: number;
}

/**
 * The header's date, in the room the clock and the doors leave it.
 *
 * Smaller before shorter: "Sun, Oct 11" at the 14px floor before "Oct 11", because the weekday is
 * the half a child asks about ("is it a school day?") and the month is the half nobody does. Then
 * nothing at all: the five-day calendar is one tap away and opens on today.
 */
export function headerDateFit(date: LocalDate, roomPx: number, measure: MeasureText): FittedWords | null {
  const full = localDateText(date, 'short');
  const monthDay = localDateText(date, 'monthDay');
  if (full.length === 0) return null;
  const candidates: readonly FittedWords[] = [
    { words: full, sizePx: fontSizePx.small },
    { words: full, sizePx: fontSizePx.meta },
    { words: monthDay, sizePx: fontSizePx.meta },
  ];
  return firstThatFits(candidates, roomPx, (c) => measure(c.words, c.sizePx));
}
