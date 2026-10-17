/**
 * Unit H — today's chores for one child.
 *
 * Owns the claim action and the state a claim produces locally.  A claim is
 * optimistic through the tap gate: the card turns to "waiting" under the finger,
 * the request is held for the undo window, and a second tap cancels it without the
 * server ever hearing about it.
 *
 * Losing a `first_complete` race is not an error to render.  The snapshot comes
 * back with `superseded` and `boardChores` drops the card: a shared job that is done
 * is off everybody else's board (2026-09-15), and nothing on this wall tells a
 * five-year-old she was too slow.  The void treatment survives for the moment
 * between her sibling's tap and the next snapshot, and for the approvals queue.
 */

import type { Child, ChoreKind } from '../../../../src/types.ts';
import { childAccentForSlot, colour, spacePx, stateTreatments } from '../../design/tokens.ts';
import { useWall } from '../../app/wallContext.ts';
import { useWallLayout } from '../../app/layoutContext.ts';
import { BandLeaf, useActiveBand } from '../bands/registry.tsx';
import { ScrollColumn } from '../primitives/ScrollColumn.tsx';
import { px } from '../primitives/style.ts';
import { choreKey } from '../logic/tap.ts';
import { boardChores, shownChoreTap } from '../logic/chores.ts';
import { pipsForCount } from '../logic/pips.ts';
import { choreStateWords } from '../logic/words.ts';

export function ChoreBoard({ child, kind }: { child: Child; kind: ChoreKind }) {
  const { snapshot, gate, actions, clock, resetKey } = useWall();
  const { layout } = useWallLayout();
  const band = useActiveBand();
  const accent = childAccentForSlot(child.sortOrder);
  // `clock.localTime`, not a value computed once: lateness has to move with the wall's own tick
  // or a chore quietly never becomes overdue between snapshot rebuilds.
  const chores = boardChores(snapshot.chores, child.id, kind, clock.localTime);
  if (chores.length === 0) return null;

  // ONE column, and it scrolls (2026-09-13). This was the routine-step grid — two or three
  // columns by band — chosen on 2026-08-30 because a column was hiding the third chore below
  // a fold nothing announced. The grid fixed that by making the tiles narrower, and narrow
  // tiles are where the names went: "Empty the dish…" in a 264px cell, on the surface where a
  // child earns money. The household named the alternative in words: one column, scrollable.
  //
  // A full-width row keeps the whole name, and `ScrollColumn` draws the fold the grid was
  // avoiding — a fade with a chevron over the last cut row — so a list that outgrows the pane
  // is visibly continued rather than silently ended. Routine steps were a grid for longer and
  // are one column too where one column holds them, sized to fit their pane — and a few
  // columns, never narrower than a label's longest line, where it does not (logic/routineFit.ts).
  //
  // FELT LAYS ITS JOBS OUT AS TILES, TWO ACROSS (2026-10). Its body is 912px wide beside no
  // rail, and one full-width row there is a name in the first third and air in the rest. Two
  // across is 448px a tile — wider than the 392px card whose name broke mid-word, and the name
  // has its own row now in any case. Gallery and storybook keep the one-column ledger.
  const cards = chores.map(({ chore, overdue }) => {
        const key = choreKey(chore.assignmentId);
        const claimed = gate.value(key, chore.state !== 'pending');
        const { state: shownState, next } = shownChoreTap(chore.state, claimed);
        const treatment = stateTreatments[shownState];
        const words = choreStateWords[shownState];
        // The pre-reader has ledgerEnabled=false; her chores run the same machine
        // and simply carry no reward marks.
        const points = child.ledgerEnabled ? chore.points : 0;
        return (
          <BandLeaf
            key={chore.assignmentId}
            leaf="ChoreCard"
            resetKey={resetKey}
            props={{
              assignmentId: chore.assignmentId,
              labelShort: chore.labelShort,
              labelFull: chore.labelFull,
              icon: chore.icon,
              state: shownState,
              treatment,
              stateWordShort: words.short,
              stateWordFull: words.full,
              points,
              pips: pipsForCount(points, band),
              accent,
              interactive: next !== null,
              // An INVITATION, and the word matters (H10 panel, unanimous). This wall stands in
              // a living room; three children share it and can see each other's boards, and
              // guests see all of it. So a chore past its bound says there is still time, and
              // the `alert` glyph and the danger treatment are both deliberately unused. A
              // child's own tap clears it instantly, because a claimed chore is her part done.
              stillTime: overdue && shownState === 'pending',
              undoPending: gate.undoPending(key),
              // One control, two directions, exactly like a routine step. Inside the undo
              // window the gate cancels the held claim locally and sends nothing; after it,
              // the tap on a "Waiting" card is an unclaim the server hears about. Both are
              // the child's own; neither needs an adult.
              onClaim: () => {
                if (next === null) return;
                gate.tap(key, next, () =>
                  next
                    ? actions.claimChore(chore.assignmentId, child.id)
                    : actions.unclaimChore(chore.assignmentId, child.id),
                );
              },
              markSide: layout.choreMark,
              markShape: layout.stateMark,
            }}
          />
        );
      });

  return (
    <ScrollColumn gapPx={spacePx.tapGap} ground={colour.bg}>
      {layout.choreColumns === 2 ? (
        <div
          data-chore-columns="2"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
            // The same inert gutter as between rows: a miss lands on nothing, either way.
            gap: px(spacePx.tapGap),
            flex: '0 0 auto',
          }}
        >
          {cards}
        </div>
      ) : (
        cards
      )}
    </ScrollColumn>
  );
}
