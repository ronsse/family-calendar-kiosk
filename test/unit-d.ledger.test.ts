/**
 * Unit D acceptance, part 1 (build-plan.md §4): the balance equals the sum of the entries
 * after approve, redeem and manual adjustment, and no path mutates a balance.
 *
 * The cases worth writing down are not arithmetic. They are the four ways this domain can
 * quietly become wrong: paying twice for one chore, paying a child who has no ledger, paying
 * a chore to the wrong sibling, and a retried adjustment paying twice.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase, inTransaction } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { listBalances } from '../src/db/repo.ts';
import { addDays } from '../src/time.ts';
import type { LocalDate } from '../src/types.ts';
import {
  adjust,
  approveRedemption,
  balanceFor,
  creditChoreApproval,
  isLedgerError,
  ledgerHistory,
  requestRedemption,
  type LedgerErrorCode,
} from '../src/domain/ledger/index.ts';

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

let seq = 0;
function nextDate(): LocalDate {
  return addDays('2026-09-01' as LocalDate, seq++);
}

/** A claimed assignment, as Unit C would have left it just before approval. */
function makeAssignment(
  db: Db,
  opts: { childId: string; points?: number; choreId?: string },
): number {
  const points = opts.points ?? 5;
  const choreId = opts.choreId ?? 'ch-bed';
  const day = db
    .prepare(
      `INSERT INTO chore_day (chore_id, local_date, points_each, model, created_at_utc)
       VALUES (?, ?, ?, 'individual', '2026-09-01T00:00:00Z') RETURNING id`,
    )
    .get(choreId, nextDate(), points) as { id: number };
  const assignment = db
    .prepare(
      `INSERT INTO chore_assignment (chore_day_id, child_id, state, claimed_at_utc)
       VALUES (?, ?, 'claimed', '2026-09-01T12:00:00Z') RETURNING id`,
    )
    .get(day.id, opts.childId) as { id: number };
  return assignment.id;
}

/** Unit C owns the transaction; this stands in for it. */
function credit(
  db: Db,
  args: { childId: string; assignmentId: number; points: number },
): number | null {
  return inTransaction(db, () => creditChoreApproval(db, args));
}

function rowCount(db: Db, childId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM ledger_entry WHERE child_id = ?').get(childId) as {
      n: number;
    }
  ).n;
}

function sumOfEntries(db: Db, childId: string): number {
  return (
    db
      .prepare('SELECT COALESCE(SUM(delta), 0) AS s FROM ledger_entry WHERE child_id = ?')
      .get(childId) as { s: number }
  ).s;
}

function expectLedgerError(fn: () => unknown, code: LedgerErrorCode): void {
  assert.throws(fn, (e: unknown) => {
    if (!isLedgerError(e)) assert.fail(`expected a LedgerError, got ${String(e)}`);
    assert.equal(e.code, code, `expected code ${code}, got ${e.code}: ${e.message}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Balance is derived, never stored
// ---------------------------------------------------------------------------

test('no table stores a balance — the sum IS the balance', () => {
  const db = fresh();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`)
    .all() as { name: string }[];
  const offenders: string[] = [];
  for (const t of tables) {
    const cols = db.prepare(`SELECT name FROM pragma_table_info(?)`).all(t.name) as {
      name: string;
    }[];
    for (const c of cols) {
      if (/^(balance|points|total)$/.test(c.name) || /_balance$/.test(c.name)) {
        offenders.push(`${t.name}.${c.name}`);
      }
    }
  }
  assert.deepEqual(offenders, [], 'a stored balance is a second copy of truth');
  db.close();
});

test('a child with no history has a balance of zero, not no balance', () => {
  const db = fresh();
  const b = balanceFor(db, 'child-a');
  assert.equal(b.points, 0);
  assert.equal(b.cashCents, 0, 'zero points at 10c is zero cash, not null');
  db.close();
});

test('balanceFor and Unit A listBalances never disagree', () => {
  const db = fresh();
  credit(db, { childId: 'child-a', assignmentId: makeAssignment(db, { childId: 'child-a' }), points: 7 });
  adjust(db, { childId: 'child-b', delta: 3, note: 'bonus', requestId: 'req-b1' });

  for (const b of listBalances(db)) {
    assert.deepEqual(balanceFor(db, b.childId), b, `disagreement for ${b.childId}`);
  }
  db.close();
});

test('cash is points times the single household rate', () => {
  const db = fresh();
  credit(db, { childId: 'child-a', assignmentId: makeAssignment(db, { childId: 'child-a' }), points: 12 });
  const b = balanceFor(db, 'child-a');
  assert.equal(b.points, 12);
  assert.equal(b.cashCents, 120, '12 points at 10 cents');
  db.close();
});

// ---------------------------------------------------------------------------
// The seam: chore credit
// ---------------------------------------------------------------------------

test('double-approving one chore writes exactly one row, and the second call is not an error', () => {
  const db = fresh();
  const assignmentId = makeAssignment(db, { childId: 'child-a', points: 5 });

  const first = credit(db, { childId: 'child-a', assignmentId, points: 5 });
  const second = credit(db, { childId: 'child-a', assignmentId, points: 5 });

  assert.equal(typeof first, 'number');
  assert.equal(second, first, 'the retry must resolve to the same canonical entry');
  assert.equal(rowCount(db, 'child-a'), 1);
  assert.equal(balanceFor(db, 'child-a').points, 5, 'a double tap must not double-pay');
  db.close();
});

test('creditChoreApproval refuses to run outside a transaction', () => {
  const db = fresh();
  const assignmentId = makeAssignment(db, { childId: 'child-a' });
  assert.throws(
    () => creditChoreApproval(db, { childId: 'child-a', assignmentId, points: 5 }),
    /inside a transaction/,
    'the transition and the payment must commit together or not at all',
  );
  assert.equal(rowCount(db, 'child-a'), 0);
  db.close();
});

test('a chore is never paid to a sibling who did not do it', () => {
  const db = fresh();
  const assignmentId = makeAssignment(db, { childId: 'child-b', points: 5 });

  expectLedgerError(
    () => credit(db, { childId: 'child-a', assignmentId, points: 5 }),
    'wrong_child',
  );
  assert.equal(rowCount(db, 'child-a'), 0);
  assert.equal(rowCount(db, 'child-b'), 0, 'the rollback takes the whole transaction with it');
  db.close();
});

test('a zero-point chore approves and pays nothing, without jamming the transaction', () => {
  const db = fresh();
  const assignmentId = makeAssignment(db, { childId: 'child-a', points: 0 });
  const entryId = credit(db, { childId: 'child-a', assignmentId, points: 0 });
  assert.equal(entryId, null);
  assert.equal(rowCount(db, 'child-a'), 0, 'CHECK (delta <> 0) forbids a zero-value row');

  // and the connection is still usable — the approve button did not jam
  const next = makeAssignment(db, { childId: 'child-a', points: 4 });
  assert.equal(typeof credit(db, { childId: 'child-a', assignmentId: next, points: 4 }), 'number');
  assert.equal(balanceFor(db, 'child-a').points, 4);
  db.close();
});

test('two different chores on the same day both pay', () => {
  const db = fresh();
  const a1 = makeAssignment(db, { childId: 'child-a', points: 5, choreId: 'ch-table' });
  const a2 = makeAssignment(db, { childId: 'child-a', points: 3, choreId: 'ch-pet' });
  credit(db, { childId: 'child-a', assignmentId: a1, points: 5 });
  credit(db, { childId: 'child-a', assignmentId: a2, points: 3 });
  assert.equal(balanceFor(db, 'child-a').points, 8);
  assert.equal(rowCount(db, 'child-a'), 2);
  db.close();
});

// ---------------------------------------------------------------------------
// The pre-reader: a completion history, not a balance
// ---------------------------------------------------------------------------

test('the pre-reader accrues zero ledger rows across many approvals', () => {
  const db = fresh();
  for (let i = 0; i < 25; i++) {
    const assignmentId = makeAssignment(db, { childId: 'child-c', points: 5 });
    assert.equal(
      credit(db, { childId: 'child-c', assignmentId, points: 5 }),
      null,
      'ledgerEntryId is null for a child with no ledger',
    );
  }
  assert.equal(rowCount(db, 'child-c'), 0);
  const b = balanceFor(db, 'child-c');
  assert.equal(b.points, 0);
  assert.equal(b.cashCents, null, 'no ledger means no cash value, not zero cash');
  assert.deepEqual(ledgerHistory(db, 'child-c'), []);
  db.close();
});

test('the pre-reader cannot request a redemption', () => {
  const db = fresh();
  expectLedgerError(
    () => requestRedemption(db, { childId: 'child-c', pointsRequested: 1 }),
    'ledger_disabled',
  );
  const open = db.prepare('SELECT COUNT(*) AS n FROM redemption_request').get() as { n: number };
  assert.equal(open.n, 0, 'the refusal must happen before the row exists');
  db.close();
});

test('the pre-reader cannot be adjusted into having a balance', () => {
  const db = fresh();
  expectLedgerError(
    () => adjust(db, { childId: 'child-c', delta: 50, note: 'be fair', requestId: 'req-c1' }),
    'ledger_disabled',
  );
  assert.equal(rowCount(db, 'child-c'), 0);
  db.close();
});

// ---------------------------------------------------------------------------
// Manual adjustment — the caller-supplied idempotency key
// ---------------------------------------------------------------------------

test('adjust twice with the same requestId yields one row; different ones yield two', () => {
  const db = fresh();
  const first = adjust(db, { childId: 'child-a', delta: 10, note: 'tidy week', requestId: 'uuid-1' });
  const retry = adjust(db, { childId: 'child-a', delta: 10, note: 'tidy week', requestId: 'uuid-1' });

  assert.equal(retry.id, first.id, 'a retry is the same user action arriving twice');
  assert.equal(rowCount(db, 'child-a'), 1);
  assert.equal(balanceFor(db, 'child-a').points, 10);

  adjust(db, { childId: 'child-a', delta: 10, note: 'second bonus', requestId: 'uuid-2' });
  assert.equal(rowCount(db, 'child-a'), 2, 'a genuine second bonus must not be swallowed');
  assert.equal(balanceFor(db, 'child-a').points, 20);
  db.close();
});

test('a retried adjustment returns the original entry, it does not amend it', () => {
  const db = fresh();
  const first = adjust(db, { childId: 'child-a', delta: 10, note: 'bonus', requestId: 'uuid-1' });
  const retry = adjust(db, { childId: 'child-a', delta: 999, note: 'typo', requestId: 'uuid-1' });
  assert.equal(retry.delta, 10);
  assert.equal(retry.note, 'bonus');
  assert.equal(retry.id, first.id);
  assert.equal(balanceFor(db, 'child-a').points, 10);
  db.close();
});

test('adjust carries a negative correction, and refuses a zero delta', () => {
  const db = fresh();
  adjust(db, { childId: 'child-a', delta: 10, note: null, requestId: 'uuid-1' });
  adjust(db, { childId: 'child-a', delta: -4, note: 'broke a window', requestId: 'uuid-2' });
  assert.equal(balanceFor(db, 'child-a').points, 6);

  assert.throws(
    () => adjust(db, { childId: 'child-a', delta: 0, note: null, requestId: 'uuid-3' }),
    /non-zero integer/,
  );
  assert.throws(
    () => adjust(db, { childId: 'child-a', delta: 1.5, note: null, requestId: 'uuid-4' }),
    /non-zero integer/,
  );
  assert.throws(
    () => adjust(db, { childId: 'child-a', delta: 1, note: null, requestId: '' }),
    /idempotency key/,
  );
  assert.equal(rowCount(db, 'child-a'), 2);
  db.close();
});

test('the same requestId for two children is two entries, one each', () => {
  const db = fresh();
  adjust(db, { childId: 'child-a', delta: 5, note: 'shared uuid', requestId: 'uuid-shared' });
  adjust(db, { childId: 'child-b', delta: 5, note: 'shared uuid', requestId: 'uuid-shared' });
  assert.equal(balanceFor(db, 'child-a').points, 5);
  assert.equal(balanceFor(db, 'child-b').points, 5);
  db.close();
});

// ---------------------------------------------------------------------------
// History — what settles "I had forty!"
// ---------------------------------------------------------------------------

test('history carries a running total that lands exactly on the balance', () => {
  const db = fresh();
  const deltas: number[] = [];

  for (const points of [5, 3, 2]) {
    const assignmentId = makeAssignment(db, { childId: 'child-a', points });
    credit(db, { childId: 'child-a', assignmentId, points });
    deltas.push(points);
  }
  adjust(db, { childId: 'child-a', delta: 4, note: 'bonus', requestId: 'uuid-1' });
  deltas.push(4);

  const request = requestRedemption(db, { childId: 'child-a', pointsRequested: 6 });
  approveRedemption(db, request.id);
  deltas.push(-6);

  const history = ledgerHistory(db, 'child-a');
  assert.equal(history.length, deltas.length);

  let running = 0;
  history.forEach((row, i) => {
    running += deltas[i] as number;
    assert.equal(row.delta, deltas[i], `entry ${i} delta`);
    assert.equal(row.runningTotal, running, `entry ${i} running total`);
    assert.ok(row.reason.length > 0 && row.refType.length > 0 && row.refId.length > 0);
  });

  const last = history.at(-1);
  assert.ok(last);
  assert.equal(last.runningTotal, balanceFor(db, 'child-a').points);
  assert.equal(last.runningTotal, sumOfEntries(db, 'child-a'));
  db.close();
});

test('each entry deep-links to what caused it', () => {
  const db = fresh();
  const assignmentId = makeAssignment(db, { childId: 'child-a', points: 5 });
  credit(db, { childId: 'child-a', assignmentId, points: 5 });
  adjust(db, { childId: 'child-a', delta: 2, note: 'bonus', requestId: 'uuid-1' });

  const [chore, manual] = ledgerHistory(db, 'child-a');
  assert.ok(chore && manual);
  assert.equal(chore.reason, 'chore_approved');
  assert.equal(chore.refType, 'chore_assignment');
  assert.equal(chore.refId, String(assignmentId));
  assert.equal(manual.reason, 'adjustment');
  assert.equal(manual.refType, 'manual');
  assert.equal(manual.refId, 'uuid-1', 'the requestId is stored verbatim');
  db.close();
});

test('clearing ledger_enabled hides the cash value, it does not rewrite the points', () => {
  const db = fresh();
  credit(db, {
    childId: 'child-a',
    assignmentId: makeAssignment(db, { childId: 'child-a', points: 8 }),
    points: 8,
  });
  db.prepare(`UPDATE child SET ledger_enabled = 0 WHERE id = 'child-a'`).run();

  const b = balanceFor(db, 'child-a');
  assert.equal(b.points, 8, 'the entries still say 8 — reading is not gated, writing is');
  assert.equal(b.cashCents, null);

  const viaUnitA = listBalances(db).find((x) => x.childId === 'child-a');
  assert.deepEqual(b, viaUnitA, 'one notion of a balance, or there are two');

  // and she still cannot accrue a new one
  expectLedgerError(
    () => adjust(db, { childId: 'child-a', delta: 1, note: null, requestId: 'uuid-late' }),
    'ledger_disabled',
  );
  db.close();
});
