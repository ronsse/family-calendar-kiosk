/**
 * Unit H — what a scroll column tells React, and the rule that it speaks only on a CHANGE.
 *
 * `ScrollColumn` measures its box after every render (the rows are what change the scroll
 * height) and on every resize and scroll. It used to hand each measurement straight to React —
 * `setEdges(was => same ? was : next)`, plus `onHeight` since the routine began fitting its pane
 * (2026-10-11) — trusting React to drop a set that changed nothing. React does not promise that,
 * and on 2026-10-11 it did not: switching children on a throwaway wall blanked the body behind
 * the error boundary with React #185, "Maximum update depth exceeded", at roughly one press in
 * fifteen, with every measured number CONSTANT through the fifty renders that preceded it.
 *
 * The mechanism, so nobody re-learns it. A resize or a scroll sets state at a LOW priority. If
 * a click's urgent render lands before that one, React renders without it and rebuilds the
 * state from the hook's base, replaying the urgent updates on top — so `was` is a FRESH object
 * on every replay, never the one on the screen. The "same, keep it" branch therefore returned a
 * new object every time, the column re-rendered, its layout effect measured and set again, and
 * the low-priority update that would have settled it never got a turn: fifty commits, then the
 * throw. The chore board's column did it too, with no `onHeight` anywhere near it; the routine's
 * auto-fit only made the trigger common, because the pane now changes height between children.
 *
 * So the column remembers what it last ASKED for and asks only when the answer is different.
 * An unchanged measurement schedules nothing at all, whatever React would have done with it, and
 * a changed one is a plain object whose identity survives any replay. React will apply every
 * update it was given, so what was last asked for is what the state becomes.
 */

/** The three numbers a scroll box answers, read off the DOM by `ScrollColumn`. */
export interface ScrollBoxNumbers {
  readonly scrollTop: number;
  readonly clientHeight: number;
  readonly scrollHeight: number;
}

/** Whether more of the list is hidden above and below what is in view. */
export interface ScrollEdges {
  readonly above: boolean;
  readonly below: boolean;
}

/** A list that fits: what `ScrollColumn`'s state starts as, and so what the latch starts as. */
export const NO_EDGES: ScrollEdges = { above: false, below: false };

/** A pixel of slack each way, so sub-pixel layout never draws a cue over a list that fits. */
export function scrollEdges(box: ScrollBoxNumbers): ScrollEdges {
  return {
    above: box.scrollTop > 1,
    below: box.scrollTop + box.clientHeight < box.scrollHeight - 1,
  };
}

/** The height the rows have: the box less its padding, top and bottom. */
export function rowsHeightPx(box: ScrollBoxNumbers, padPx: number): number {
  return box.clientHeight - 2 * padPx;
}

/** What one measurement changed. `null` means "unchanged: tell React nothing". */
export interface MeasureNews {
  readonly heightPx: number | null;
  readonly edges: ScrollEdges | null;
}

export interface MeasureLatch {
  /**
   * Measure, and say only what differs from what was last said. `sink` is whoever hears the
   * height; a different listener is told even an unchanged height, because it has never heard
   * it. With no listener the height is not news at all.
   */
  read(box: ScrollBoxNumbers, padPx: number, sink: object | undefined): MeasureNews;
}

/** One per mounted column: its memory is the state it has asked React to hold. */
export function measureLatch(): MeasureLatch {
  let edges: ScrollEdges = NO_EDGES;
  let told: { sink: object; heightPx: number } | null = null;
  return {
    read(box, padPx, sink) {
      const nextEdges = scrollEdges(box);
      const edgesNews =
        nextEdges.above === edges.above && nextEdges.below === edges.below ? null : nextEdges;
      if (edgesNews !== null) edges = edgesNews;

      let heightNews: number | null = null;
      if (sink !== undefined) {
        const heightPx = rowsHeightPx(box, padPx);
        if (told === null || told.sink !== sink || told.heightPx !== heightPx) {
          told = { sink, heightPx };
          heightNews = heightPx;
        }
      }
      return { heightPx: heightNews, edges: edgesNews };
    },
  };
}
