/**
 * Unit H — one routine run, for one child.
 *
 * The steps, and nothing else — no title, no time-box pill. The switcher above it names the
 * routine and rings its progress, and this panel used to restate both directly underneath
 * (H5 §3.3/§3.4). What it owns is which step is next, the tap gate, the two actions, and how big
 * a step is and how many columns there are; the bands receive only the result.
 *
 * ## The pane is fixed, and the steps fit it (2026-10)
 *
 * The pane is what the child's screen leaves under the switch, and it does not grow. As a
 * routine gets longer, each step gives a little back — padding, then picture, then type — down
 * to the two floors this wall never trades: a step is a tap target (`tapPx.min`) and type is
 * 14px or more. Only past the floors does the pane scroll. The arithmetic is `fitRoutineGrid`
 * (logic/routineFit.ts, tested there); this panel measures the pane and hands every step the
 * same answer, so the rows are one height and never jump as states change.
 *
 * One column first, because one column keeps the order where the child's eye already is. When
 * one column cannot hold the routine — felt's pane holds three steps, and a four-step morning
 * scrolled — the steps go into the fewest columns that do hold them, left to right and then
 * down (`fitRoutineGrid`). A column is never narrower than a step's longest line: that was the
 * fault of the old per-band column COUNT (`stepColumns`), which cut the emergent reader's labels
 * to five letters, and the fit refuses such a grid and scrolls instead. When the steps do scroll,
 * the fold is drawn (`ScrollColumn`) and the NEXT step is scrolled into view, so the child who
 * has ticked four finds the fifth where she is looking.
 *
 * The time box has not gone anywhere — it still decides which routine the switcher DEFAULTS
 * to, in ChildView. What it never did, and still must not do, is gate interaction: steps stay
 * tappable before the window opens and after it closes. A child up at 05:50 who ticks "get
 * dressed" must not be told "not yet" by a clock, and H2 Q1 explicitly forbids hiding a
 * routine before its window (a blank wall at 05:30 is the failure, not a feature).
 */

import type { Child, RoutineRunView } from '../../../../src/types.ts';
import { useEffect, useRef, useState } from 'react';
import { colour, tapPx } from '../../design/tokens.ts';
import { BandLeaf, useBandTypography } from '../bands/registry.tsx';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { px } from '../primitives/style.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import { isStepDone, sortedSteps } from '../logic/progress.ts';
import { fitRoutineGrid, gridColumnPx, STEP_GAP_PX, stepOrderPx, stepTimeFits } from '../logic/routineFit.ts';
import { stepKey } from '../logic/tap.ts';
import { instantTimeText } from '../logic/clock.ts';

export function RoutinePanel({ run, child }: { run: RoutineRunView; child: Child }) {
  const { gate, actions, resetKey } = useWall();
  const { layout, frame } = useWallLayout();
  const typo = useBandTypography();
  const steps = sortedSteps(run);

  /**
   * The pane's real height, as the column measures it. NaN until the first measurement, which
   * `fitRoutineGrid` answers with the natural sizes in one column: the first frame is never drawn
   * squeezed for want of a number, and the next one is drawn to the glass.
   *
   * The WIDTH is the shell's body, which the pane spans edge to edge (ChildView pads nothing),
   * and which no screen of a given theme changes — so it is read from the frame rather than
   * measured, and a column count can never feed back into the measurement that chose it.
   */
  const [paneH, setPaneH] = useState(Number.NaN);
  // The order mark only where the theme numbers its steps — the numeral for a band that reads
  // one, the band's pips for the one that does not — so its width is charged to the column.
  const order = layout.numberedSteps ? { numeralPx: typo.numeralTextPx, maxPips: typo.maxPips } : null;
  const fit = fitRoutineGrid(
    steps.length,
    { heightPx: paneH, widthPx: frame.body.width },
    {
      iconPx: typo.stepIconPx,
      markPx: typo.stepMarkPx,
      labelPx: typo.primaryTextPx,
      floorPx: tapPx.min,
    },
    order,
  );
  // A done step's time ("7:02 AM") is the one part of a step a narrow column drops: the label
  // keeps the room, and the tick still says it is done (logic/routineFit.ts, `stepTimeFits`).
  const timeFits = stepTimeFits(
    fit,
    gridColumnPx(frame.body.width, fit.columns),
    stepOrderPx(order, steps.length, fit.contentPx),
    typo.statusTextPx,
  );

  const shown = steps.map((step) => ({
    step,
    done: gate.value(stepKey(step.runStepId), isStepDone(step)),
  }));
  const nextIndex = shown.findIndex((s) => !s.done);

  /**
   * Keep the next step on screen. The list is one child per step, in order — a grid fills row
   * by row, so that holds in columns too — and the next step is the `nextIndex`-th child of it;
   * `nearest` means a step already in view does not move, and a routine that fits does nothing
   * at all. Described narrowly for the same reason `ScrollColumn` describes its scroll box: this
   * tree has no DOM lib.
   */
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const list = listRef.current as unknown as { children: ArrayLike<Scrollable> } | null;
    if (list === null || nextIndex < 0) return;
    list.children[nextIndex]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [nextIndex]);

  return (
    <ScrollColumn gapPx={STEP_GAP_PX} ground={colour.bg} onHeight={setPaneH}>
      {/*
        NO HEADER. It used to draw the routine's icon, its name and a time-box pill — directly
        under a switcher that had just said the same word and shown the same progress. That is
        ~48px of a 420px screen spent restating the control above it.

        The time box did not disappear with it: `timeBoxState` still governs which routine the
        switcher defaults to, and the routine's own name is on its button. What is gone is the
        second copy. (H5 §3.3/§3.4.)
      */}
      {/*
        `fit.columns` equal columns — one, unless one cannot hold the routine — every step the
        same height (`fit.rowPx`). The 16px inert gutter between steps, across and down, is
        mis-tap prevention and is never spent on fitting.
      */}
      <div
        ref={listRef}
        data-routine-steps={fit.scrolls ? 'scrolls' : 'fits'}
        data-routine-columns={fit.columns}
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${String(fit.columns)}, minmax(0, 1fr))`,
          gap: px(STEP_GAP_PX),
          flex: '0 0 auto',
        }}
      >
        {shown.map(({ step, done }, i) => (
          <BandLeaf
            key={step.runStepId}
            leaf="RoutineStep"
            resetKey={resetKey}
            props={{
              runStepId: step.runStepId,
              position: step.position,
              labelShort: step.labelShort,
              labelFull: step.labelFull,
              icon: step.icon,
              done,
              doneAtText: done && timeFits ? instantTimeText(step.completedAtUtc) : '',
              undoPending: gate.undoPending(stepKey(step.runStepId)),
              // The ring, waiting for the second tap. See the `confirm` argument below.
              confirmPending: gate.confirmPending(stepKey(step.runStepId)),
              isNext: i === nextIndex,
              showOrder: layout.numberedSteps,
              fit,
              markSide: layout.stepMark,
              markShape: layout.stateMark,
              onToggle: () => {
                const key = stepKey(step.runStepId);
                const next = !gate.value(key, isStepDone(step));
                gate.tap(
                  key,
                  next,
                  () =>
                    next
                      ? actions.completeStep(step.runStepId, child.id)
                      : actions.revokeStep(step.runStepId, child.id),
                  // CONFIRM MODE IS OFF, from 2026-09-09. It was on from 2026-09-07.
                  //
                  // It was built to stop a sibling ticking another child's morning steps: this
                  // wall has no identity, and unlike a chore claim — which an adult approves —
                  // a routine tick is reviewed by nobody. The operator agreed to it in advance
                  // ("I think a double tap is fine"), then used it and did not: *"Why are the
                  // jobs one click but the bedtime is two clicks? You click on it twice, and
                  // then it shows a timer, and then a check mark. Why not just a check mark?
                  // It seems unnecessary. I don't like the double click action."*
                  //
                  // A decision taken on a hypothesis, reversed by use, which is the right
                  // direction for that trade to run — the cost was certain and paid every
                  // morning by every child, and the benefit was a mis-tap nobody had yet seen.
                  //
                  // THE COST OF REVERSING IT, recorded so it is a known risk and not a
                  // surprise: a sibling can now tick another child's routine in one tap, and
                  // nothing reviews it. The undo is still there and still needs no adult
                  // (`revokeStep`), so it is recoverable by the child it happened to. If it
                  // starts happening, the machinery is intact — this argument is one `true`.
                  false,
                );
              },
            }}
          />
        ))}
      </div>
    </ScrollColumn>
  );
}

/** The one DOM method this panel calls, typed by hand: the tree compiles without a DOM lib. */
interface Scrollable {
  scrollIntoView(options: { block: 'nearest'; behavior: 'smooth' }): void;
}
