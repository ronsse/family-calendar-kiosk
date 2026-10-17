/**
 * Approval undo (pass 2, #3), driven the way the Waiting screen drives it: a tap holds, the clock
 * ticks, and whatever is due is SENT. The assertions are on what reaches the sender, because an
 * undo that still sends is worse than no undo at all.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ApprovalItem } from '../web/src/app/adminActions.ts';
import {
  UNDO_WINDOW_MS,
  dueDecisions,
  holdDecision,
  isHeld,
  nextDueAtMs,
  undoDecision,
  type HeldDecision,
} from '../web/src/views/logic/heldDecisions.ts';

function item(n: number): ApprovalItem {
  return {
    key: `chore:${String(n)}`,
    kind: 'chore',
    id: n,
    childId: 'child-a',
    childName: 'A',
    avatar: { assetId: 'av', url: '/av.png', isFallback: false },
    sortOrder: 0,
    labelFull: `Chore ${String(n)}`,
    icon: null,
    points: 2,
    cashCents: null,
    atUtc: null,
  };
}

type Step =
  | { tap: number; decision: 'approve' | 'reject'; at: number }
  | { undo: number; at: number }
  | { tick: number }
  | { flush: true };

/** The screen in miniature: returns every (id, decision) that was SENT, in order. */
function drive(steps: readonly Step[]): string[] {
  let held: readonly HeldDecision[] = [];
  const sent: string[] = [];
  const send = (hs: readonly HeldDecision[]) => {
    for (const h of hs) sent.push(`${String(h.item.id)}:${h.decision}`);
  };
  for (const s of steps) {
    if ('tap' in s) held = holdDecision(held, item(s.tap), s.decision, '1234', s.at);
    else if ('undo' in s) held = undoDecision(held, item(s.undo).key);
    else if ('tick' in s) {
      const { due, rest } = dueDecisions(held, s.tick);
      send(due);
      held = rest;
    } else {
      send(held);
      held = [];
    }
  }
  return sent;
}

test('a tap sends nothing inside the window and sends once when it closes', () => {
  assert.deepEqual(drive([{ tap: 1, decision: 'approve', at: 0 }, { tick: UNDO_WINDOW_MS - 1 }]), []);
  assert.deepEqual(
    drive([{ tap: 1, decision: 'approve', at: 0 }, { tick: UNDO_WINDOW_MS }, { tick: UNDO_WINDOW_MS * 3 }]),
    ['1:approve'],
  );
});

test('Undo inside the window means nothing is ever sent', () => {
  assert.deepEqual(
    drive([{ tap: 1, decision: 'approve', at: 0 }, { undo: 1, at: 1000 }, { tick: UNDO_WINDOW_MS * 2 }, { flush: true }]),
    [],
  );
});

test('changing your mind on a row replaces the decision and restarts its window', () => {
  assert.deepEqual(
    drive([
      { tap: 1, decision: 'approve', at: 0 },
      { tap: 1, decision: 'reject', at: 3000 },
      { tick: UNDO_WINDOW_MS },
      { tick: 3000 + UNDO_WINDOW_MS },
    ]),
    ['1:reject'],
  );
});

test('rows hold independently, and leaving the screen sends everything still held', () => {
  assert.deepEqual(
    drive([
      { tap: 1, decision: 'approve', at: 0 },
      { tap: 2, decision: 'reject', at: 2000 },
      { tick: UNDO_WINDOW_MS },
      { tap: 3, decision: 'approve', at: UNDO_WINDOW_MS + 1 },
      { undo: 3, at: UNDO_WINDOW_MS + 2 },
      { flush: true },
    ]),
    ['1:approve', '2:reject'],
  );
});

test('the timer is set for the earliest due row', () => {
  let held: readonly HeldDecision[] = [];
  assert.equal(nextDueAtMs(held), null);
  held = holdDecision(held, item(1), 'approve', '1234', 500);
  held = holdDecision(held, item(2), 'approve', '1234', 100);
  assert.equal(nextDueAtMs(held), 100 + UNDO_WINDOW_MS);
  assert.ok(isHeld(held, item(1).key));
});
