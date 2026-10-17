/**
 * Unit D acceptance, part 2: redemption — the point at which points become real money and
 * are destroyed.
 *
 * The hazard here is not arithmetic either. It is the gap between "the balance was checked"
 * and "the points were spent": if anything can slip into it, a child is overdrawn, and an
 * append-only ledger has no way to un-say that. Every test below is about closing that gap.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase, inTransaction } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { addDays } from '../src/time.ts';
import type { LocalDate } from '../src/types.ts';
import {
  adjust,
  approveRedemption,
  balanceFor,
  cancelRedemption,
  creditChoreApproval,
  getRedemption,
  isLedgerError,
  ledgerHistory,
  rejectRedemption,
  requestRedemption,
  type LedgerErrorCode,
} from '../src/domain/ledger/index.ts';

let seq = 0;
function nextDate(): LocalDate {
  return addDays('2026-10-01' as LocalDate, seq++);
}

function seedInto(db: Db): Db {
  migrate(db);
  seedDev(db);
  return db;
}

function fresh(): Db {
  return seedInto(openDatabase({ path: ':memory:' }));
}

/** Gives `childId` exactly `points` points, the way a chore approval would. */
function earn(db: Db, childId: string, points: number): void {
  const day = db
    .prepare(
      `INSERT INTO chore_day (chore_id, local_date, points_each, model, created_at_utc)
       VALUES ('ch-bed', ?, ?, 'individual', '2026-10-01T00:00:00Z') RETURNING id`,
    )
    .get(nextDate(), points) as { id: number };
  const assignment = db
    .prepare(
      `INSERT INTO chore_assignment (chore_day_id, child_id, state, claimed_at_utc)
       VALUES (?, ?, 'claimed', '2026-10-01T12:00:00Z') RETURNING id`,
    )
    .get(day.id, childId) as { id: number };
  inTransaction(db, () =>
    creditChoreApproval(db, { childId, assignmentId: assignment.id, points }),
  );
}

function entryCount(db: Db, childId: string): number {
  return (
    db.prepare('SELECT COUNT(*) AS n FROM ledger_entry WHERE child_id = ?').get(childId) as {
      n: number;
    }
  ).n;
}

function expectLedgerError(fn: () => unknown, code: LedgerErrorCode): void {
  assert.throws(fn, (e: unknown) => {
    if (!isLedgerError(e)) assert.fail(`expected a LedgerError, got ${String(e)}`);
    assert.equal(e.code, code, `expected code ${code}, got ${e.code}: ${e.message}`);
    return true;
  });
}

// ---------------------------------------------------------------------------
// Requesting
// ---------------------------------------------------------------------------

test('an impossible ask is refused before it can occupy the pending slot', () => {
  const db = fresh();
  earn(db, 'child-a', 10);

  expectLedgerError(
    () => requestRedemption(db, { childId: 'child-a', pointsRequested: 11 }),
    'insufficient_points',
  );
  const open = db.prepare('SELECT COUNT(*) AS n FROM redemption_request').get() as { n: number };
  assert.equal(open.n, 0, 'the slot must still be free for an ask she can afford');

  const ok = requestRedemption(db, { childId: 'child-a', pointsRequested: 10 });
  assert.equal(ok.state, 'pending');
  assert.equal(ok.pointsRequested, 10, 'spending the whole balance is allowed');
  db.close();
});

test('a request snapshots the household rate, and the rate is not per child', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 4 });
  assert.equal(req.centsPerPoint, 10);
  assert.equal(req.cashCents, 40);

  db.prepare(`UPDATE household_config SET value_text = '25' WHERE key = 'cents_per_point'`).run();
  approveRedemption(db, req.id);

  const after = getRedemption(db, req.id);
  assert.ok(after);
  assert.equal(after.cashCents, 40, 'she is paid what she was shown when she asked');
  db.close();
});

test('only one request may be open per child', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  requestRedemption(db, { childId: 'child-a', pointsRequested: 3 });
  expectLedgerError(
    () => requestRedemption(db, { childId: 'child-a', pointsRequested: 3 }),
    'pending_redemption_exists',
  );
  db.close();
});

test('requesting moves no points — only approval does', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  requestRedemption(db, { childId: 'child-a', pointsRequested: 6 });
  assert.equal(balanceFor(db, 'child-a').points, 10);
  assert.equal(entryCount(db, 'child-a'), 1, 'the chore credit and nothing else');
  db.close();
});

// ---------------------------------------------------------------------------
// Approving
// ---------------------------------------------------------------------------

test('approval destroys exactly the points requested', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 6 });
  const result = approveRedemption(db, req.id);

  assert.equal(result.state, 'approved');
  assert.equal(balanceFor(db, 'child-a').points, 4);

  const entry = ledgerHistory(db, 'child-a').at(-1);
  assert.ok(entry);
  assert.equal(entry.id, result.ledgerEntryId);
  assert.equal(entry.delta, -6);
  assert.equal(entry.reason, 'redemption_approved');
  assert.equal(entry.refType, 'redemption_request');
  assert.equal(entry.refId, String(req.id));
  db.close();
});

test('two approvals of one request cannot drive the balance negative', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 10 });

  const first = approveRedemption(db, req.id);
  const second = approveRedemption(db, req.id);

  assert.equal(second.ledgerEntryId, first.ledgerEntryId, 'the retry resolves to the same entry');
  assert.equal(entryCount(db, 'child-a'), 2, 'one credit, one debit — not two debits');
  assert.equal(balanceFor(db, 'child-a').points, 0);
  db.close();
});

test('two connections approving the same request settle on one entry', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unit-d-'));
  const path = join(dir, 'ledger.db');
  const a = seedInto(openDatabase({ path }));
  earn(a, 'child-a', 10);
  const req = requestRedemption(a, { childId: 'child-a', pointsRequested: 10 });

  const b = openDatabase({ path });
  try {
    const viaA = approveRedemption(a, req.id);
    const viaB = approveRedemption(b, req.id);

    assert.equal(viaB.ledgerEntryId, viaA.ledgerEntryId);
    assert.equal(entryCount(b, 'child-a'), 2);
    assert.equal(balanceFor(b, 'child-a').points, 0);
    assert.ok(balanceFor(b, 'child-a').points >= 0, 'a balance may never go negative');
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the write lock serialises approvals rather than interleaving two read-modify-writes', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unit-d-'));
  const path = join(dir, 'ledger.db');
  const a = seedInto(openDatabase({ path }));
  earn(a, 'child-a', 10);
  const req = requestRedemption(a, { childId: 'child-a', pointsRequested: 10 });

  const b = openDatabase({ path });
  b.pragma('busy_timeout = 50'); // so the test proves the block without waiting on it
  try {
    a.prepare('BEGIN IMMEDIATE').run(); // A is mid-approval, holding the write lock
    assert.throws(
      () => approveRedemption(b, req.id),
      (e: unknown) => {
        const code = (e as { code?: string }).code;
        assert.equal(
          code,
          'SQLITE_BUSY',
          'IMMEDIATE must refuse the second writer, not let it read a stale balance',
        );
        return true;
      },
    );
    a.prepare('ROLLBACK').run();

    approveRedemption(b, req.id);
    assert.equal(balanceFor(b, 'child-a').points, 0);
    assert.equal(entryCount(b, 'child-a'), 2);
  } finally {
    a.close();
    b.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the balance is re-checked at approval, not trusted from request time', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 10 });

  adjust(db, { childId: 'child-a', delta: -5, note: 'clawback', requestId: 'uuid-clawback' });

  expectLedgerError(() => approveRedemption(db, req.id), 'insufficient_points');

  const after = getRedemption(db, req.id);
  assert.ok(after);
  assert.equal(after.state, 'pending', 'the refused approval rolls back with the entry');
  assert.equal(after.decidedAtUtc, null);
  assert.equal(balanceFor(db, 'child-a').points, 5);
  assert.equal(entryCount(db, 'child-a'), 2, 'the credit and the clawback, nothing else');
  db.close();
});

test('approving a rejected or cancelled request is refused, not silently re-run', () => {
  const db = fresh();
  earn(db, 'child-a', 10);

  const rejected = requestRedemption(db, { childId: 'child-a', pointsRequested: 4 });
  rejectRedemption(db, rejected.id);
  expectLedgerError(() => approveRedemption(db, rejected.id), 'not_claimable');

  const cancelled = requestRedemption(db, { childId: 'child-a', pointsRequested: 4 });
  cancelRedemption(db, cancelled.id, 'child-a');
  expectLedgerError(() => approveRedemption(db, cancelled.id), 'not_claimable');

  expectLedgerError(() => approveRedemption(db, 9999), 'not_claimable');
  assert.equal(balanceFor(db, 'child-a').points, 10);
  db.close();
});

// ---------------------------------------------------------------------------
// Rejecting and cancelling
// ---------------------------------------------------------------------------

test('rejection writes no ledger row and frees the slot', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 10 });

  assert.deepEqual(rejectRedemption(db, req.id), { state: 'rejected' });
  assert.deepEqual(rejectRedemption(db, req.id), { state: 'rejected' }, 'idempotent');
  assert.equal(balanceFor(db, 'child-a').points, 10);
  assert.equal(entryCount(db, 'child-a'), 1);

  const again = requestRedemption(db, { childId: 'child-a', pointsRequested: 3 });
  assert.equal(again.state, 'pending');
  db.close();
});

test('a child may cancel her own request, and only her own', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  earn(db, 'child-b', 10);
  const hers = requestRedemption(db, { childId: 'child-a', pointsRequested: 5 });

  expectLedgerError(() => cancelRedemption(db, hers.id, 'child-b'), 'wrong_child');
  const untouched = getRedemption(db, hers.id);
  assert.ok(untouched);
  assert.equal(untouched.state, 'pending', 'a sibling mis-tap changes nothing at all');

  assert.deepEqual(cancelRedemption(db, hers.id, 'child-a'), { state: 'cancelled' });
  assert.deepEqual(cancelRedemption(db, hers.id, 'child-a'), { state: 'cancelled' }, 'idempotent');
  assert.equal(balanceFor(db, 'child-a').points, 10);
  assert.equal(entryCount(db, 'child-a'), 1);
  db.close();
});

test('ownership is decided before state — a sibling never sees not_claimable', () => {
  const db = fresh();
  earn(db, 'child-a', 10);
  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 5 });
  approveRedemption(db, req.id);

  expectLedgerError(
    () => cancelRedemption(db, req.id, 'child-b'),
    'wrong_child',
  );
  db.close();
});

// ---------------------------------------------------------------------------
// The whole arc
// ---------------------------------------------------------------------------

test('after approve, redeem and adjust the balance is the arithmetic sum of the deltas', () => {
  const db = fresh();
  const expected: number[] = [];

  earn(db, 'child-a', 5);
  expected.push(5);
  earn(db, 'child-a', 3);
  expected.push(3);

  adjust(db, { childId: 'child-a', delta: 7, note: 'helped with the shed', requestId: 'uuid-1' });
  expected.push(7);

  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 12 });
  approveRedemption(db, req.id);
  expected.push(-12);

  adjust(db, { childId: 'child-a', delta: -1, note: 'correction', requestId: 'uuid-2' });
  expected.push(-1);

  earn(db, 'child-a', 4);
  expected.push(4);

  const arithmetic = expected.reduce((a, b) => a + b, 0);
  assert.equal(arithmetic, 6);
  assert.equal(balanceFor(db, 'child-a').points, arithmetic);
  assert.equal(balanceFor(db, 'child-a').cashCents, arithmetic * 10);
  assert.deepEqual(
    ledgerHistory(db, 'child-a').map((e) => e.delta),
    expected,
  );
  db.close();
});

test('the ledger is append-only: every earlier entry survives every later write unchanged', () => {
  const db = fresh();
  const snapshots: string[] = [];
  const capture = (): void => {
    snapshots.push(JSON.stringify(ledgerHistory(db, 'child-a').map((e) => ({ ...e, createdAtUtc: '' }))));
  };

  earn(db, 'child-a', 9);
  capture();
  adjust(db, { childId: 'child-a', delta: 3, note: 'bonus', requestId: 'uuid-1' });
  capture();
  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 12 });
  approveRedemption(db, req.id);
  capture();

  for (let i = 1; i < snapshots.length; i++) {
    const earlier = snapshots[i - 1] as string;
    const later = snapshots[i] as string;
    assert.ok(
      later.startsWith(earlier.slice(0, -1)),
      `write ${i} rewrote history instead of appending to it`,
    );
  }
  assert.equal(balanceFor(db, 'child-a').points, 0);
  db.close();
});

test('there is no paid state, and the schema refuses to invent one', () => {
  const db = fresh();
  earn(db, 'child-a', 5);
  const req = requestRedemption(db, { childId: 'child-a', pointsRequested: 5 });
  approveRedemption(db, req.id);

  assert.throws(
    () => db.prepare(`UPDATE redemption_request SET state = 'paid' WHERE id = ?`).run(req.id),
    /CHECK constraint failed/,
    'H2 Q2: the physical handover is unobservable and must not be modelled as system truth',
  );
  db.close();
});
