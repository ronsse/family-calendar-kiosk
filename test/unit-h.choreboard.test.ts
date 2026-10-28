/**
 * Unit H — duties versus paid extras, and lateness derived rather than stored.
 *
 * The interesting cases are all about REFUSING to call a chore late. This runs on a wall in a
 * living room that three children share and guests can see, so a false positive is a child
 * publicly told she is behind when she is not — and the H10 panel's whole finding was that a
 * shared wall makes a failure state a public one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  boardChores,
  choreProgress,
  hasKind,
  isOverdue,
} from '../web/src/views/logic/chores.ts';
import type {
  ChoreAssignmentView,
  ChoreKind,
  ChoreState,
  LocalDate,
  LocalTime,
} from '../src/types.ts';

const TODAY = '2026-08-27' as LocalDate;

function chore(over: Partial<ChoreAssignmentView> = {}): ChoreAssignmentView {
  return {
    assignmentId: 1,
    choreId: 'ch-1',
    childId: 'child-a',
    localDate: TODAY,
    state: 'pending' as ChoreState,
    kind: 'duty' as ChoreKind,
    countsTowardDay: true,
    dueByLocal: null,
    claimedAtUtc: null,
    points: 3,
    labelShort: 'Dishes',
    labelFull: 'Empty the dishwasher',
    icon: { assetId: 'ico', url: '/a.svg', isFallback: false },
    category: 'kitchen',
    ...over,
  };
}

const at = (t: string) => t as LocalTime;

// ---------------------------------------------------------------------------
// isOverdue — and mostly, when it must say no
// ---------------------------------------------------------------------------

test('a chore with no bound is never late', () => {
  assert.equal(isOverdue(chore({ dueByLocal: null }), at('23:59')), false);
});

test('a bound that has not passed is not late', () => {
  assert.equal(isOverdue(chore({ dueByLocal: at('18:00') }), at('17:59')), false);
});

test('a bound that has passed is late', () => {
  assert.equal(isOverdue(chore({ dueByLocal: at('18:00') }), at('18:01')), true);
});

test('the bound itself is not yet late', () => {
  // Half-open, matching `timeBoxState`: at exactly 18:00 the chore is due, not overdue. One
  // way to compare wall-clock times in this codebase, not two.
  assert.equal(isOverdue(chore({ dueByLocal: at('18:00') }), at('18:00')), false);
});

test('a chore she has already claimed is NOT late, however long a grown-up takes', () => {
  // The child's part is done. Leaving it marked would blame her for an adult's queue, which is
  // the single most unfair thing this feature could do.
  for (const state of ['claimed', 'approved', 'superseded'] as ChoreState[]) {
    assert.equal(
      isOverdue(chore({ state, dueByLocal: at('06:00') }), at('23:00')),
      false,
      `${state} must never read as late`,
    );
  }
});

test('a malformed bound is no bound at all', () => {
  // `LocalTime` is a string BRAND, so a value that crossed the wire wears it without earning
  // it. Being wrong here accuses a child of being late because somebody mistyped a string.
  for (const bad of ['25:00', '6:00', '18:0', '', 'six', '18:60', '-1:00']) {
    assert.equal(
      isOverdue(chore({ dueByLocal: bad as LocalTime }), at('23:59')),
      false,
      `"${bad}" must not make a chore late`,
    );
  }
});

test('a clock we cannot read makes nothing late', () => {
  for (const bad of ['', 'now', '99:99']) {
    assert.equal(isOverdue(chore({ dueByLocal: at('06:00') }), bad), false);
  }
});

test('null and undefined survive the branded type without throwing', () => {
  assert.equal(isOverdue(chore({ dueByLocal: undefined as unknown as null }), at('23:00')), false);
  assert.equal(isOverdue(chore({ dueByLocal: at('06:00') }), null as unknown as string), false);
});

// ---------------------------------------------------------------------------
// boardChores — the split, and that it does not re-order
// ---------------------------------------------------------------------------

test('a board carries only this child, only this kind', () => {
  const all = [
    chore({ assignmentId: 1, childId: 'child-a', kind: 'duty' }),
    chore({ assignmentId: 2, childId: 'child-a', kind: 'extra' }),
    chore({ assignmentId: 3, childId: 'child-b', kind: 'duty' }),
  ];
  assert.deepEqual(
    boardChores(all, 'child-a', 'duty', at('09:00')).map((b) => b.chore.assignmentId),
    [1],
  );
  assert.deepEqual(
    boardChores(all, 'child-a', 'extra', at('09:00')).map((b) => b.chore.assignmentId),
    [2],
  );
});

test('the board keeps one order all day — lateness marks in place and never re-sorts', () => {
  // The panel offered "sorted to the top" and both reviewers named the sort as the risk: the
  // pre-reader navigates by *always the same place*, and moving a tile out from under a finger
  // already reaching for it costs more than the ordering buys. The order is by due time, which
  // is fixed for the day; it must not move with the clock.
  const all = [
    chore({ assignmentId: 1, dueByLocal: null }),
    chore({ assignmentId: 2, dueByLocal: at('06:00') }), // late
    chore({ assignmentId: 3, dueByLocal: at('23:00') }),
  ];
  const board = boardChores(all, 'child-a', 'duty', at('09:00'));
  assert.deepEqual(board.map((b) => b.chore.assignmentId), [2, 3, 1], 'due time, unbounded last');
  assert.deepEqual(board.map((b) => b.overdue), [true, false, false]);
  const earlier = boardChores(all, 'child-a', 'duty', at('05:00'));
  assert.deepEqual(earlier.map((b) => b.chore.assignmentId), [2, 3, 1], 'the same place before it was late');
});

test('a shared job somebody else finished is off this child’s board', () => {
  // The household asked for it in those words (2026-09-15): once a first_complete race is won
  // the losers' cards do not linger, faded, on the other children's screens.
  const all = [
    chore({ assignmentId: 1, childId: 'child-a', state: 'superseded' }),
    chore({ assignmentId: 2, childId: 'child-a', state: 'pending' }),
    chore({ assignmentId: 3, childId: 'child-b', state: 'claimed' }),
  ];
  assert.deepEqual(
    boardChores(all, 'child-a', 'duty', at('09:00')).map((b) => b.chore.assignmentId),
    [2],
  );
  assert.deepEqual(
    boardChores(all, 'child-b', 'duty', at('09:00')).map((b) => b.chore.assignmentId),
    [3],
    'the winner keeps the card — it is her claim awaiting a grown-up',
  );
});

test('an absent or empty chore list is an empty board, not a crash', () => {
  assert.deepEqual(boardChores(undefined, 'child-a', 'duty', at('09:00')), []);
  assert.deepEqual(boardChores([], 'child-a', 'duty', at('09:00')), []);
});

// ---------------------------------------------------------------------------
// choreProgress — what the switcher ring shows
// ---------------------------------------------------------------------------

test('a superseded chore is in neither half of the ring', () => {
  // Losing a first_complete race is terminal and non-paying. Counted as DONE the ring would
  // credit her with work she did not do; counted in the total it could never fill.
  const all = [
    chore({ assignmentId: 1, state: 'approved' }),
    chore({ assignmentId: 2, state: 'pending' }),
    chore({ assignmentId: 3, state: 'superseded' }),
  ];
  const p = choreProgress(all, 'child-a', 'duty', (c) => c.state !== 'pending');
  assert.deepEqual(p, { done: 1, total: 2 });
});

test('the ring follows the tap gate, not the snapshot', () => {
  // What she can SEE includes her own optimistic tap. A ring reading state alone would sit
  // still for the whole undo window after she ticked something, which reads as the tap failing.
  const all = [chore({ assignmentId: 1, state: 'pending' })];
  const optimistic = choreProgress(all, 'child-a', 'duty', () => true);
  assert.deepEqual(optimistic, { done: 1, total: 1 });
});

test('a child with none of a kind gets an empty ring, not a missing one', () => {
  // Both destinations stay on screen whichever way this goes — the pre-reader navigates by
  // position — so `{done: 0, total: 0}` has to be a legal, drawable answer.
  assert.deepEqual(choreProgress([], 'child-a', 'extra', () => true), { done: 0, total: 0 });
  assert.deepEqual(choreProgress(undefined, 'child-a', 'extra', () => true), { done: 0, total: 0 });
});

test('hasKind answers per child and per kind', () => {
  const all = [chore({ childId: 'child-a', kind: 'extra' })];
  assert.equal(hasKind(all, 'child-a', 'extra'), true);
  assert.equal(hasKind(all, 'child-a', 'duty'), false);
  assert.equal(hasKind(all, 'child-b', 'extra'), false);
  assert.equal(hasKind(undefined, 'child-a', 'extra'), false);
});

// ---------------------------------------------------------------------------
// The rule the panel actually cared about
// ---------------------------------------------------------------------------

test('nothing here can ever produce a "missed" state', () => {
  // `missed` does not exist on a child's board, by construction rather than by convention: a
  // chore that ends the day pending is simply not on tomorrow's board. The only two answers
  // this module gives about a pending chore are "late" and "not late", and both are offers.
  const late = boardChores(
    [chore({ dueByLocal: at('06:00') })],
    'child-a',
    'duty',
    at('23:59'),
  );
  assert.equal(late.length, 1);
  assert.equal(late[0]?.overdue, true);
  assert.equal(late[0]?.chore.state, 'pending', 'the state itself is untouched — this is derived');
});

// ---------------------------------------------------------------------------
// The undo — driven, not grepped
// ---------------------------------------------------------------------------

import { shownChoreTap } from '../web/src/views/logic/chores.ts';
import { isChoreInteractive } from '../web/src/app/actions.ts';
import {
  DEBOUNCE_MS,
  IDLE_TAP_GATE,
  UNDO_MS,
  tapGate,
  tapValue,
  type TapGateState,
} from '../web/src/views/logic/tap.ts';

/** One card's tap, the way ChoreBoard does it: draw from the gate, tap with what that implies. */
function tapCard(gate: TapGateState, serverState: ChoreState, atMs: number) {
  const claimed = tapValue(gate, serverState !== 'pending');
  const shown = shownChoreTap(serverState, claimed);
  assert.notEqual(shown.next, null, `a ${shown.state} card must be a control`);
  return tapGate(gate, { type: 'tap', atMs, next: shown.next ?? false });
}

test('a claimed card is still a control: the second tap inside the window cancels locally', () => {
  // This was dead until 2026-09-13. The first tap turned the card to Waiting and, in the same
  // render, `interactive` went false — so the documented second tap landed on a plain div.
  let g = tapCard(IDLE_TAP_GATE, 'pending', 1000);
  assert.equal(shownChoreTap('pending', tapValue(g, false)).state, 'claimed', 'Waiting under the finger');
  g = tapCard(g, 'pending', 1000 + DEBOUNCE_MS + 1);
  assert.equal(g.phase, 'idle', 'cancelled, nothing sent');
  assert.equal(shownChoreTap('pending', tapValue(g, false)).state, 'pending', 'back to to-do');
});

test('after the window, a tap on Waiting asks to unclaim and draws the card as to-do', () => {
  // The server now says `claimed`; the child taps the Waiting card a minute later.
  let g = tapCard(IDLE_TAP_GATE, 'claimed', 60_000);
  assert.equal(g.phase, 'armed');
  assert.equal(g.optimistic, false, 'the tap asks for NOT claimed');
  assert.equal(shownChoreTap('claimed', tapValue(g, true)).state, 'pending');
  g = tapGate(g, { type: 'commit', atMs: 60_000 + UNDO_MS });
  assert.equal(g.phase, 'sending', 'and it is sent as an unclaim once the window closes');
});

test('the drawn state, the interactivity and the tap direction come from one place', () => {
  for (const state of ['pending', 'claimed', 'approved', 'superseded'] as ChoreState[]) {
    for (const claimed of [false, true]) {
      const shown = shownChoreTap(state, claimed);
      assert.equal(shown.next !== null, isChoreInteractive(shown.state), `${state}/${String(claimed)}`);
      if (state === 'approved' || state === 'superseded') {
        assert.equal(shown.state, state, 'a decided card is drawn as the server says, whatever the gate holds');
      }
    }
  }
  assert.equal(shownChoreTap('pending', true).next, false, 'Waiting taps toward unclaim');
  assert.equal(shownChoreTap('claimed', false).next, true, 'a taken-back card taps toward claim');
});

test('the board is ordered by due time, never by state, so a tapped card stays put', () => {
  const rows = [
    chore({ assignmentId: 1, dueByLocal: null, state: 'pending' }),
    chore({ assignmentId: 2, dueByLocal: at('19:30'), state: 'approved' }),
    chore({ assignmentId: 3, dueByLocal: at('07:30'), state: 'claimed' }),
    chore({ assignmentId: 4, dueByLocal: at('07:30'), state: 'pending' }),
  ];
  const ids = boardChores(rows, 'child-a', 'duty', at('12:00')).map((b) => b.chore.assignmentId);
  assert.deepEqual(ids, [3, 4, 2, 1], 'soonest first, unbounded last, ties by id');
  // Claiming #4 changes its state and nothing about where it sits.
  const after = boardChores(
    rows.map((r) => (r.assignmentId === 4 ? { ...r, state: 'claimed' as ChoreState } : r)),
    'child-a', 'duty', at('12:00'),
  ).map((b) => b.chore.assignmentId);
  assert.deepEqual(after, ids);
});
