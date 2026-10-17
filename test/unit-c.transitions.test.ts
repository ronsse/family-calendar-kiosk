/**
 * Unit C acceptance — the chore state machine.
 *
 * The acceptance bar is TOTALITY: every (state, operation) pair has a defined, tested
 * outcome, and no sequence of legitimate calls can strand a card in a state it cannot get
 * out of. A card stuck at 06:00 is not a caught exception anywhere — it is a child
 * tapping a button that does nothing, all morning.
 *
 * Three findings are re-asserted here directly, because they are the ones that cost real
 * money or real trust if they regress:
 *   H1 #12 — the ownership predicate, and a mismatch being a SILENT no-op.
 *   H3 #2  — the transition, not the ledger, is the double-pay guard.
 *   H1 #8  — reject returns the chore to `pending`; there is no `rejected` state.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import type { ChoreState, LocalDate } from '../src/types.ts';
import {
  approveChore,
  claimChore,
  choresForDate,
  listChoreAssignments,
  materializeChoreDay,
  rejectChore,
  unclaimChore,
  type ChoreTransitionResult,
} from '../src/domain/chores/index.ts';

type Db = ReturnType<typeof openDatabase>;

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

const DAY = '2026-08-24' as LocalDate;
const SATURDAY = '2026-08-22' as LocalDate;

/** Every card for one chore, keyed by child. */
function cards(db: Db, choreId: string, date: LocalDate = DAY) {
  return listChoreAssignments(db, date).filter((a) => a.choreId === choreId);
}

function cardFor(db: Db, choreId: string, childId: string, date: LocalDate = DAY) {
  const hit = cards(db, choreId, date).find((a) => a.childId === childId);
  assert.ok(hit, `no ${choreId} card for ${childId}`);
  return hit;
}

function rawRow(db: Db, assignmentId: number) {
  return db.prepare(`SELECT * FROM chore_assignment WHERE id = ?`).get(assignmentId) as
    | Record<string, unknown>
    | undefined;
}

function stateOf(db: Db, assignmentId: number): ChoreState | undefined {
  return (rawRow(db, assignmentId) as { state?: ChoreState } | undefined)?.state;
}

function ledgerRows(db: Db, assignmentId?: number) {
  return assignmentId === undefined
    ? (db.prepare(`SELECT * FROM ledger_entry`).all() as Record<string, unknown>[])
    : (db
        .prepare(
          `SELECT * FROM ledger_entry WHERE ref_type = 'chore_assignment' AND ref_id = ?`,
        )
        .all(String(assignmentId)) as Record<string, unknown>[]);
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test('claim moves pending -> claimed and stamps the claim, without moving points', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');

  const res = claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  assert.equal(res.ok, true);
  assert.equal(res.changed, true);
  assert.equal(res.state, 'claimed');
  assert.equal(res.ledgerEntryId, null, 'a claim is a request, never a payment');
  const row = rawRow(db, card.assignmentId);
  assert.equal(row?.state, 'claimed');
  assert.ok(row?.claimed_at_utc, 'claimed_at_utc is stamped');
  assert.equal(row?.decided_at_utc, null);
  assert.deepEqual(ledgerRows(db), []);
  db.close();
});

test('the view carries the claim time while claimed, and nothing once it is decided or unclaimed', () => {
  // The grown-up queue reads "18 min ago" off this. A pending card must say null, not the time
  // of a claim that was sent back: a stale stamp would make a redo look an hour old.
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');
  assert.equal(card.claimedAtUtc, null, 'a pending card has no claim time');

  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  const claimed = cardFor(db, 'ch-bed', 'child-a');
  assert.equal(claimed.state, 'claimed');
  assert.equal(claimed.claimedAtUtc, rawRow(db, card.assignmentId)?.claimed_at_utc);
  assert.ok(claimed.claimedAtUtc !== null && !Number.isNaN(Date.parse(claimed.claimedAtUtc)));

  unclaimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  assert.equal(cardFor(db, 'ch-bed', 'child-a').claimedAtUtc, null, 'unclaimed: no time');

  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  rejectChore(db, { assignmentId: card.assignmentId });
  assert.equal(cardFor(db, 'ch-bed', 'child-a').claimedAtUtc, null, 'sent back: no time');

  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(cardFor(db, 'ch-bed', 'child-a').claimedAtUtc, null, 'approved: not waiting, so no time');
  db.close();
});

test('approve moves claimed -> approved and credits the ledger in one transaction', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');
  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });

  const res = approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(res.ok, true);
  assert.equal(res.changed, true);
  assert.equal(res.state, 'approved');
  assert.equal(res.childId, 'child-a');
  assert.ok(typeof res.ledgerEntryId === 'number');

  const entries = ledgerRows(db, card.assignmentId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.child_id, 'child-a');
  assert.equal(entries[0]?.delta, 1, 'the day snapshot pays, not the live chore');
  assert.equal(entries[0]?.reason, 'chore_approved');
  db.close();
});

test('the points paid are the day snapshot, even if the chore is repriced mid-claim', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');
  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  db.prepare(`UPDATE chore SET base_points = 500 WHERE id = 'ch-bed'`).run();

  approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(ledgerRows(db, card.assignmentId)[0]?.delta, 1);
  db.close();
});

// ---------------------------------------------------------------------------
// H1 #12 — the ownership predicate
// ---------------------------------------------------------------------------

test('claiming with a mismatched childId is a silent no-op', () => {
  const db = fresh();
  choresForDate(db, DAY);
  // The realistic mis-tap: three cards for the same chore sit adjacent, and the finger
  // lands on a sibling's while the body still names the selected child.
  const mine = cardFor(db, 'ch-bed', 'child-a');
  const sibling = cardFor(db, 'ch-bed', 'child-b');
  const beforeSibling = rawRow(db, sibling.assignmentId);
  const beforeMine = rawRow(db, mine.assignmentId);

  const res = claimChore(db, { assignmentId: sibling.assignmentId, childId: 'child-a' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'wrong_child');
  assert.notEqual(res.reason, 'not_claimable', 'never a fallthrough — that reads as "broken button"');
  assert.equal(res.state, null, 'nothing about the sibling is disclosed');
  assert.equal(res.childId, null);

  assert.deepEqual(rawRow(db, sibling.assignmentId), beforeSibling, "the sibling's row is untouched");
  assert.deepEqual(rawRow(db, mine.assignmentId), beforeMine, 'and nothing else moved either');
  assert.deepEqual(ledgerRows(db), [], 'no ledger entry appears');
  db.close();
});

test('a mismatched childId cannot be approved into a permanent ledger fact', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const sibling = cardFor(db, 'ch-bed', 'child-b');
  claimChore(db, { assignmentId: sibling.assignmentId, childId: 'child-b' });

  const res = approveChore(db, { assignmentId: sibling.assignmentId, childId: 'child-a' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'wrong_child');
  assert.equal(stateOf(db, sibling.assignmentId), 'claimed', 'still claimed by its owner');
  assert.deepEqual(ledgerRows(db), []);

  const rej = rejectChore(db, { assignmentId: sibling.assignmentId, childId: 'child-a' });
  assert.equal(rej.reason, 'wrong_child');
  assert.equal(stateOf(db, sibling.assignmentId), 'claimed');
  db.close();
});

test('approval credits the row owner, never a caller-supplied child', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-b');
  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-b' });
  // The admin route carries no childId at all; the credit is pinned to the row.
  approveChore(db, { assignmentId: card.assignmentId });
  const entries = ledgerRows(db, card.assignmentId);
  assert.equal(entries.length, 1);
  assert.equal(entries[0]?.child_id, 'child-b');
  db.close();
});

test('an unknown assignment id is refused rather than throwing', () => {
  const db = fresh();
  for (const res of [
    claimChore(db, { assignmentId: 987654, childId: 'child-a' }),
    approveChore(db, { assignmentId: 987654 }),
    rejectChore(db, { assignmentId: 987654 }),
  ]) {
    assert.equal(res.ok, false);
    assert.equal(res.reason, 'not_found');
  }
  db.close();
});

// ---------------------------------------------------------------------------
// unclaim — the child's own undo
// ---------------------------------------------------------------------------

test('unclaim moves claimed -> pending for the owner and records no decision', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');
  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });

  const res = unclaimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  assert.equal(res.ok, true);
  assert.equal(res.changed, true);
  assert.equal(res.state, 'pending');
  const row = rawRow(db, card.assignmentId);
  assert.equal(row?.state, 'pending');
  assert.equal(row?.claimed_at_utc, null, 'a stale claim stamp would read as claimed');
  assert.equal(row?.decided_at_utc, null, 'nobody decided anything');
  assert.deepEqual(ledgerRows(db), []);

  // And she can claim it again: the card is fully back on the board.
  assert.equal(claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' }).state, 'claimed');
  db.close();
});

test('unclaim is idempotent on a pending card and refuses a decided one', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');

  const twice = unclaimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  assert.equal(twice.ok, true);
  assert.equal(twice.changed, false, 'a double tap on Waiting is not a failure');

  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  approveChore(db, { assignmentId: card.assignmentId });
  const paid = unclaimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  assert.equal(paid.ok, false);
  assert.equal(paid.reason, 'not_claimable', 'approved is paid: unwinding it is a ledger matter');
  assert.equal(stateOf(db, card.assignmentId), 'approved');
  assert.equal(ledgerRows(db, card.assignmentId).length, 1, 'the credit stands');
  db.close();
});

test('a sibling cannot unclaim a card that is not hers', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const sibling = cardFor(db, 'ch-bed', 'child-b');
  claimChore(db, { assignmentId: sibling.assignmentId, childId: 'child-b' });

  const res = unclaimChore(db, { assignmentId: sibling.assignmentId, childId: 'child-a' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'wrong_child');
  assert.equal(res.state, null, 'nothing about the sibling leaks');
  assert.equal(stateOf(db, sibling.assignmentId), 'claimed');
  db.close();
});

test('unclaiming a first_complete win brings the superseded siblings back', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const all = cards(db, 'ch-pet');
  const winner = cardFor(db, 'ch-pet', 'child-b');
  claimChore(db, { assignmentId: winner.assignmentId, childId: 'child-b' });
  assert.equal(cards(db, 'ch-pet').filter((a) => a.state === 'superseded').length, 2);

  const res = unclaimChore(db, { assignmentId: winner.assignmentId, childId: 'child-b' });
  assert.equal(res.ok, true);
  assert.deepEqual(
    (res.restoredIds ?? []).sort(),
    all.filter((a) => a.childId !== 'child-b').map((a) => a.assignmentId).sort(),
  );
  const after = cards(db, 'ch-pet');
  assert.equal(after.filter((a) => a.state === 'pending').length, 3, 'the chore is on every board again');
  assert.equal(after.filter((a) => a.state === 'superseded').length, 0);

  // A sibling can now win it instead.
  const other = claimChore(db, { assignmentId: cardFor(db, 'ch-pet', 'child-a').assignmentId, childId: 'child-a' });
  assert.equal(other.state, 'claimed');
  assert.equal(stateOf(db, winner.assignmentId), 'superseded');
  db.close();
});

// ---------------------------------------------------------------------------
// first_complete
// ---------------------------------------------------------------------------

test('first_complete: one winner claimed, every other eligible child superseded', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const all = cards(db, 'ch-pet');
  assert.equal(all.length, 3);
  const winner = cardFor(db, 'ch-pet', 'child-b');

  const res = claimChore(db, { assignmentId: winner.assignmentId, childId: 'child-b' });
  assert.equal(res.ok, true);
  assert.equal(res.state, 'claimed');
  assert.deepEqual(
    res.supersededIds.sort(),
    all.filter((a) => a.childId !== 'child-b').map((a) => a.assignmentId).sort(),
  );

  const after = cards(db, 'ch-pet');
  assert.equal(after.filter((a) => a.state === 'claimed').length, 1);
  assert.equal(after.filter((a) => a.state === 'superseded').length, 2);
  assert.equal(after.filter((a) => a.state === 'pending').length, 0, 'no loser is left claimable');

  // Superseded is terminal and non-paying — not a failure. It still renders.
  assert.equal(after.length, 3, 'losers keep their cards so nothing vanishes off the wall');
  db.close();
});

test('first_complete losers are told they lost, not that the button is broken', () => {
  const db = fresh();
  choresForDate(db, DAY);
  claimChore(db, { assignmentId: cardFor(db, 'ch-pet', 'child-b').assignmentId, childId: 'child-b' });

  const loser = cardFor(db, 'ch-pet', 'child-a');
  const res = claimChore(db, { assignmentId: loser.assignmentId, childId: 'child-a' });
  assert.equal(res.ok, false);
  assert.equal(res.reason, 'already_claimed');
  assert.equal(stateOf(db, loser.assignmentId), 'superseded');
  db.close();
});

test('the win and the supersessions commit together or not at all', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const winner = cardFor(db, 'ch-pet', 'child-b');
  const before = cards(db, 'ch-pet').map((a) => [a.assignmentId, a.state]);

  // Make the supersede leg fail. If the two legs were not one transaction, the winner
  // would be left `claimed` while the losers stayed `pending` — three children all told
  // the chore is theirs, and two of them about to be told no.
  db.prepare(
    `CREATE TRIGGER trg_test_block_supersede
       BEFORE UPDATE OF state ON chore_assignment
       WHEN NEW.state = 'superseded'
       BEGIN SELECT RAISE(ABORT, 'simulated supersede failure'); END`,
  ).run();

  assert.throws(
    () => claimChore(db, { assignmentId: winner.assignmentId, childId: 'child-b' }),
    /simulated supersede failure/,
  );
  assert.deepEqual(
    cards(db, 'ch-pet').map((a) => [a.assignmentId, a.state]),
    before,
    'the winning claim rolled back with the supersessions',
  );

  db.prepare(`DROP TRIGGER trg_test_block_supersede`).run();
  const res = claimChore(db, { assignmentId: winner.assignmentId, childId: 'child-b' });
  assert.equal(res.ok, true);
  assert.equal(res.supersededIds.length, 2, 'and it works once the fault clears');
  db.close();
});

test('shared: every eligible child claims independently and each is paid in full', () => {
  const db = fresh();
  choresForDate(db, SATURDAY);
  const all = cards(db, 'ch-tidy', SATURDAY);
  assert.equal(all.length, 3);

  for (const card of all) {
    const res = claimChore(db, { assignmentId: card.assignmentId, childId: card.childId });
    assert.equal(res.ok, true, `${card.childId} must be able to claim a shared chore`);
    assert.deepEqual(res.supersededIds, [], 'a shared claim supersedes nobody');
  }
  assert.ok(cards(db, 'ch-tidy', SATURDAY).every((a) => a.state === 'claimed'));

  for (const card of all) approveChore(db, { assignmentId: card.assignmentId });
  // child-c has ledger_enabled = 0, so two of the three produce an entry.
  const entries = ledgerRows(db);
  assert.equal(entries.length, 2);
  assert.ok(entries.every((e) => e.delta === 2), 'points_each is paid in full, not divided');
  assert.ok(cards(db, 'ch-tidy', SATURDAY).every((a) => a.state === 'approved'));
  db.close();
});

// ---------------------------------------------------------------------------
// H3 #2 — the transition is the double-pay guard
// ---------------------------------------------------------------------------

test('a double approve writes exactly one ledger row', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-table', 'child-a');
  const owner = card.childId;
  claimChore(db, { assignmentId: card.assignmentId, childId: owner });

  const first = approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(first.changed, true);
  assert.ok(typeof first.ledgerEntryId === 'number');

  // The adult's second tap, and the browser's retry of a slow request.
  for (let i = 0; i < 10; i++) {
    const again = approveChore(db, { assignmentId: card.assignmentId });
    assert.equal(again.ok, true, 'a retry is not an error to show a parent');
    assert.equal(again.changed, false);
    assert.equal(again.state, 'approved');
    assert.equal(again.ledgerEntryId, null, 'nothing was written by THIS call');
  }
  assert.equal(ledgerRows(db, card.assignmentId).length, 1, 'exactly one payment');
  const balance = db
    .prepare(`SELECT COALESCE(SUM(delta), 0) AS p FROM ledger_entry WHERE child_id = ?`)
    .get(owner) as { p: number };
  assert.equal(balance.p, 5);
  db.close();
});

test('a double claim on your own card is idempotent, not an error', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');
  const first = claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  assert.equal(first.changed, true);
  const stamp = rawRow(db, card.assignmentId)?.claimed_at_utc;

  const second = claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  assert.equal(second.ok, true);
  assert.equal(second.changed, false);
  assert.equal(second.state, 'claimed');
  assert.equal(rawRow(db, card.assignmentId)?.claimed_at_utc, stamp, 'the stamp is not rewritten');
  db.close();
});

// ---------------------------------------------------------------------------
// H1 #8 — reject returns the chore to pending
// ---------------------------------------------------------------------------

test('reject returns the chore to pending, and it can be redone and approved', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');

  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  const rej = rejectChore(db, { assignmentId: card.assignmentId });
  assert.equal(rej.ok, true);
  assert.equal(rej.changed, true);
  assert.equal(rej.state, 'pending', 'there is no `rejected` state — the card goes back on the board');
  const row = rawRow(db, card.assignmentId);
  assert.equal(row?.claimed_at_utc, null, 'a stale claim stamp would read as still claimed');
  assert.ok(row?.decided_at_utc, 'but the rejection is recorded');
  assert.deepEqual(ledgerRows(db), [], 'a rejection pays nothing');

  // The child redoes it.
  const reclaim = claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  assert.equal(reclaim.ok, true);
  assert.equal(reclaim.changed, true);
  assert.equal(reclaim.state, 'claimed');

  const approve = approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(approve.state, 'approved');
  assert.equal(ledgerRows(db, card.assignmentId).length, 1, 'one round trip, one payment');
  db.close();
});

test('reject/claim can cycle repeatedly and still pay exactly once', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-a');
  for (let i = 0; i < 5; i++) {
    claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
    rejectChore(db, { assignmentId: card.assignmentId });
    assert.equal(stateOf(db, card.assignmentId), 'pending');
  }
  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(ledgerRows(db, card.assignmentId).length, 1);
  db.close();
});

// ---------------------------------------------------------------------------
// The children the ledger does not pay
// ---------------------------------------------------------------------------

test('the pre-reader runs the full state machine and is never written to the ledger', () => {
  const db = fresh();
  choresForDate(db, DAY);
  const card = cardFor(db, 'ch-bed', 'child-c');
  const child = db.prepare(`SELECT ledger_enabled FROM child WHERE id = 'child-c'`).get() as {
    ledger_enabled: number;
  };
  assert.equal(child.ledger_enabled, 0);

  assert.equal(claimChore(db, { assignmentId: card.assignmentId, childId: 'child-c' }).state, 'claimed');
  const res = approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(res.ok, true);
  assert.equal(res.changed, true);
  assert.equal(res.state, 'approved', 'she has a completion history');
  assert.equal(res.ledgerEntryId, null, 'and no balance');
  assert.deepEqual(ledgerRows(db), []);
  // The card renders its stamp from the assignment state, not from ledger data.
  assert.equal(cardFor(db, 'ch-bed', 'child-c').state, 'approved');
  db.close();
});

test('a zero-point chore approves cleanly instead of sticking on claimed', () => {
  const db = fresh();
  // `base_points >= 0` permits this; `ledger_entry.delta <> 0` would reject the credit and
  // roll the approval back with it, leaving the card claimed for the rest of the day.
  db.prepare(
    `INSERT INTO chore(id, label_short, label_full, icon_asset_id, category, assignment_model, base_points, rrule, active) VALUES ('ch-free','Free','A chore worth nothing','ico-table','kitchen','individual',0,'FREQ=DAILY',1)`,
  ).run();
  materializeChoreDay(db, 'ch-free', DAY);
  const card = cardFor(db, 'ch-free', 'child-a');

  claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  const res = approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(res.ok, true);
  assert.equal(res.state, 'approved');
  assert.equal(res.ledgerEntryId, null);
  assert.deepEqual(ledgerRows(db), []);
  db.close();
});

// ---------------------------------------------------------------------------
// Totality
// ---------------------------------------------------------------------------

type Op = 'claim' | 'approve' | 'reject';

function apply(db: Db, op: Op, assignmentId: number, childId: string): ChoreTransitionResult {
  // Every op is given the acting child, so the ownership predicate is exercised on all
  // three paths rather than only on claim.
  if (op === 'claim') return claimChore(db, { assignmentId, childId });
  if (op === 'approve') return approveChore(db, { assignmentId, childId });
  return rejectChore(db, { assignmentId, childId });
}

/** A fresh database whose target row sits in `state`, reached only by legitimate calls. */
function inState(state: ChoreState): { db: Db; assignmentId: number; childId: string } {
  const db = fresh();
  choresForDate(db, DAY);
  if (state === 'superseded') {
    const winner = cardFor(db, 'ch-pet', 'child-b');
    claimChore(db, { assignmentId: winner.assignmentId, childId: 'child-b' });
    const loser = cardFor(db, 'ch-pet', 'child-a');
    assert.equal(stateOf(db, loser.assignmentId), 'superseded');
    return { db, assignmentId: loser.assignmentId, childId: 'child-a' };
  }
  const card = cardFor(db, 'ch-bed', 'child-a');
  if (state === 'claimed' || state === 'approved') {
    claimChore(db, { assignmentId: card.assignmentId, childId: 'child-a' });
  }
  if (state === 'approved') approveChore(db, { assignmentId: card.assignmentId });
  assert.equal(stateOf(db, card.assignmentId), state);
  return { db, assignmentId: card.assignmentId, childId: 'child-a' };
}

const TABLE: {
  from: ChoreState;
  op: Op;
  ok: boolean;
  changed: boolean;
  reason: string | null;
  to: ChoreState;
}[] = [
  { from: 'pending',    op: 'claim',   ok: true,  changed: true,  reason: null,              to: 'claimed' },
  { from: 'pending',    op: 'approve', ok: false, changed: false, reason: 'not_claimable',   to: 'pending' },
  { from: 'pending',    op: 'reject',  ok: true,  changed: false, reason: null,              to: 'pending' },
  { from: 'claimed',    op: 'claim',   ok: true,  changed: false, reason: null,              to: 'claimed' },
  { from: 'claimed',    op: 'approve', ok: true,  changed: true,  reason: null,              to: 'approved' },
  { from: 'claimed',    op: 'reject',  ok: true,  changed: true,  reason: null,              to: 'pending' },
  { from: 'approved',   op: 'claim',   ok: false, changed: false, reason: 'not_claimable',   to: 'approved' },
  { from: 'approved',   op: 'approve', ok: true,  changed: false, reason: null,              to: 'approved' },
  { from: 'approved',   op: 'reject',  ok: false, changed: false, reason: 'not_claimable',   to: 'approved' },
  { from: 'superseded', op: 'claim',   ok: false, changed: false, reason: 'already_claimed', to: 'superseded' },
  { from: 'superseded', op: 'approve', ok: false, changed: false, reason: 'not_claimable',   to: 'superseded' },
  { from: 'superseded', op: 'reject',  ok: false, changed: false, reason: 'not_claimable',   to: 'superseded' },
];

test('the state machine is total: every (state, operation) pair is defined', () => {
  const states: ChoreState[] = ['pending', 'claimed', 'approved', 'superseded'];
  const ops: Op[] = ['claim', 'approve', 'reject'];
  assert.equal(TABLE.length, states.length * ops.length, 'the table covers the whole machine');

  for (const cell of TABLE) {
    const { db, assignmentId, childId } = inState(cell.from);
    const res = apply(db, cell.op, assignmentId, childId);
    const label = `${cell.from} --${cell.op}-->`;
    assert.equal(res.ok, cell.ok, `${label} ok`);
    assert.equal(res.changed, cell.changed, `${label} changed`);
    assert.equal(res.reason, cell.reason, `${label} reason`);
    assert.equal(stateOf(db, assignmentId), cell.to, `${label} resulting state`);
    // A refusal must never move anything, and must never pay.
    if (!cell.ok) assert.equal(res.ledgerEntryId, null, `${label} paid on a refusal`);
    db.close();
  }
});

test('no sequence of legitimate calls reaches an unrecoverable state', () => {
  const ops: Op[] = ['claim', 'approve', 'reject'];
  const valid = new Set<ChoreState>(['pending', 'claimed', 'approved', 'superseded']);
  const terminal = new Set<ChoreState>(['approved', 'superseded']);

  const sequences: Op[][] = [[]];
  for (let depth = 0; depth < 4; depth++) {
    for (const prefix of sequences.filter((s) => s.length === depth)) {
      for (const op of ops) sequences.push([...prefix, op]);
    }
  }
  assert.equal(sequences.length, 1 + 3 + 9 + 27 + 81);

  for (const start of ['pending', 'superseded'] as ChoreState[]) {
    for (const sequence of sequences) {
      const { db, assignmentId, childId } = inState(start);
      for (const op of sequence) {
        // No legitimate call may throw: an exception here is a 500 the wall renders as
        // nothing at all.
        const res = apply(db, op, assignmentId, childId);
        const now = stateOf(db, assignmentId);
        assert.ok(now && valid.has(now), `${sequence.join(',')} left state ${String(now)}`);
        if (!res.ok) assert.equal(res.ledgerEntryId, null);
      }

      const reached = stateOf(db, assignmentId) as ChoreState;
      // Recoverability: either the card is already resolved, or a child plus a parent can
      // still resolve it with ordinary taps. Nothing sits un-actionable all day.
      if (!terminal.has(reached)) {
        claimChore(db, { assignmentId, childId });
        approveChore(db, { assignmentId });
        assert.equal(
          stateOf(db, assignmentId),
          'approved',
          `${start}/${sequence.join(',')} could not be driven to a resolution`,
        );
      }
      // And however it got there, it was paid at most once.
      const paid = ledgerRows(db, assignmentId).length;
      assert.ok(paid <= 1, `${start}/${sequence.join(',')} paid ${paid} times`);
      db.close();
    }
  }
});
