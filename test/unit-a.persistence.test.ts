/**
 * Unit A acceptance (build-plan.md §4): migrations run on an empty volume, and repository
 * functions round-trip every type.
 *
 * The interesting cases here are not CRUD — they are the three contracts that the review
 * program showed are easy to get subtly wrong: foreign keys actually being enforced, the
 * asset fallback chain being total, and materialization being idempotent AND self-repairing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase, assertIntegrity, inTransaction } from '../src/db/connection.ts';
import { migrate, seedDev, TARGET_VERSION } from '../src/db/migrate.ts';
import {
  listActiveChildren,
  listBalances,
  materializeRoutineRun,
  resolveAsset,
  routinesForDate,
  getCentsPerPoint,
} from '../src/db/repo.ts';
import type { LocalDate } from '../src/types.ts';

function fresh(seed = true) {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  if (seed) seedDev(db);
  return db;
}

test('migrate applies to an empty database and is idempotent', () => {
  const db = openDatabase({ path: ':memory:' });
  const first = migrate(db);
  assert.equal(first.applied, true);
  // TARGET_VERSION, not a literal. A fresh database is born at whatever schema.sql declares,
  // so pinning the number here means every future schema change breaks a test that is not
  // about that change — and the tempting fix is to bump the literal, which is exactly the
  // move that would have hidden the missing v1->v2 upgrade path below.
  assert.equal(first.version, TARGET_VERSION);
  const second = migrate(db);
  assert.equal(second.applied, false, 'second migrate must be a no-op, not an error');
  assert.equal(second.version, TARGET_VERSION);
  assertIntegrity(db);
  db.close();
});

/**
 * A version-1 database, built by taking a current one back.
 *
 * The alternative is to keep a copy of the old schema.sql around, which rots. Reversing each
 * step is exact by construction: if this ever stops producing a real v1 shape it is because a
 * step itself changed, and then the test SHOULD be rewritten.
 *
 * **Every new migration owes an entry here**, newest first, and forgetting one is loud rather
 * than silent: the leftover object collides when `migrate` tries to create it again, which is
 * how v3 announced itself. That noise is the feature — a helper that quietly produced a
 * not-quite-v1 database would test the upgrade path against a shape production never has.
 */
const UNDO: readonly { readonly from: number; readonly sql: string }[] = [
  { from: 12, sql: 'ALTER TABLE countdown DROP COLUMN horizon_days;' },
  { from: 11, sql: 'DROP TABLE scene_decision;' },
  { from: 10, sql: 'ALTER TABLE calendar_event DROP COLUMN category;' },
  { from: 9, sql: 'DROP TABLE dog_deed_done;' },
  { from: 8, sql: 'ALTER TABLE calendar_source DROP COLUMN keep_terms;' },
  { from: 7, sql: 'ALTER TABLE calendar_source DROP COLUMN event_filter;' },
  { from: 6, sql: 'ALTER TABLE countdown DROP COLUMN emoji;' },
  { from: 5, sql: 'ALTER TABLE calendar_event DROP COLUMN emoji;' },
  // The index goes with the table; naming it here as well would be a second thing to keep
  // in step with schema.sql for no gain.
  { from: 4, sql: 'DROP TABLE scene;' },
  { from: 3, sql: 'DROP TABLE door_tap;' },
  {
    from: 2,
    sql: 'ALTER TABLE chore DROP COLUMN kind; ALTER TABLE chore DROP COLUMN due_by_local;',
  },
];

function atVersionOne() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  for (const step of UNDO) db.exec(step.sql);
  db.exec('DELETE FROM schema_migration WHERE version >= 2');
  return db;
}

test('the undo list covers every migration, so atVersionOne really is version 1', () => {
  // Guards the helper above rather than the code: an UNDO list one step short would make every
  // upgrade test below run against a database that is already half-migrated.
  assert.equal(
    UNDO.length,
    TARGET_VERSION - 1,
    'a new migration step needs a matching entry in UNDO',
  );
  assert.deepEqual(
    UNDO.map((u) => u.from),
    Array.from({ length: TARGET_VERSION - 1 }, (_, i) => TARGET_VERSION - i),
    'UNDO must run newest-first and skip nothing',
  );
});

test('an existing version-1 database is upgraded in place, not refused', () => {
  const db = atVersionOne();
  // The failure this guards is not hypothetical: before the upgrade path existed, `migrate`
  // threw "no upgrade path exists" for any non-empty database. The wall's data lives in a
  // Docker volume that survives every deploy, so the ONLY database that would ever have hit
  // this code is the household's real one — the fresh-database path that every test used is
  // the one path production never takes.
  const result = migrate(db);
  assert.equal(result.applied, true);
  assert.equal(result.version, TARGET_VERSION);

  const cols = (db.pragma('table_info(chore)') as { name: string }[]).map((c) => c.name);
  assert.ok(cols.includes('kind'), 'kind must exist after the upgrade');
  assert.ok(cols.includes('due_by_local'), 'due_by_local must exist after the upgrade');
  assertIntegrity(db);
  db.close();
});

test('upgrading twice is a no-op, and the second call does not re-run the step', () => {
  const db = atVersionOne();
  migrate(db);
  const again = migrate(db);
  assert.equal(again.applied, false, 'a database already at target must not be touched');
  assert.equal(again.version, TARGET_VERSION);
  db.close();
});

test('an upgraded database and a fresh one agree on the chore columns', () => {
  // The whole risk of a hand-written upgrade step: two ways to arrive, two shapes. A migrated
  // database cannot carry the CHECK constraints (SQLite will not add one to an existing
  // table), so this compares the column SET and not the full DDL — that asymmetry is
  // deliberate and documented in migrate.ts.
  const upgraded = atVersionOne();
  migrate(upgraded);
  const fresh_ = openDatabase({ path: ':memory:' });
  migrate(fresh_);
  const names = (d: ReturnType<typeof openDatabase>) =>
    (d.pragma('table_info(chore)') as { name: string }[]).map((c) => c.name).sort();
  assert.deepEqual(names(upgraded), names(fresh_));
  upgraded.close();
  fresh_.close();
});

test('a duty is what a chore is unless it says otherwise', () => {
  // The default matters more than it looks: every chore that already exists in the household's
  // database predates this column, and defaulting to 'extra' would silently promise money for
  // work that has always been unpaid.
  const db = atVersionOne();
  migrate(db);
  const row = db
    .prepare(`SELECT dflt_value AS d FROM pragma_table_info('chore') WHERE name = 'kind'`)
    .get() as { d: string | null } | undefined;
  assert.equal(row?.d, "'duty'");
  db.close();
});

test('foreign keys are enforced on the connection, not merely declared', () => {
  const db = fresh();
  assert.equal(db.pragma('foreign_keys', { simple: true }), 1);
  assert.throws(
    () => db.prepare(`INSERT INTO child VALUES ('x','X','fluent',1,'no-such-asset',99,1)`).run(),
    /FOREIGN KEY/i,
    'a dangling avatar reference must be rejected',
  );
  db.close();
});

test('children round-trip', () => {
  const db = fresh();
  const kids = listActiveChildren(db);
  assert.equal(kids.length, 3);
  assert.deepEqual(
    kids.map((c) => c.readingBand),
    ['fluent', 'emergent', 'picture'],
  );
  const preReader = kids.find((c) => c.readingBand === 'picture');
  assert.ok(preReader);
  assert.equal(preReader.ledgerEnabled, false, 'the pre-reader has no ledger');
  db.close();
});

test('asset resolution walks explicit -> category -> _default and never returns empty', () => {
  const db = fresh();

  const explicit = resolveAsset(db, 'ico-teeth', 'hygiene');
  assert.equal(explicit.assetId, 'ico-teeth');
  assert.equal(explicit.isFallback, false);

  // Unknown asset id, known category.
  const byCategory = resolveAsset(db, 'does-not-exist', 'hygiene');
  assert.equal(byCategory.assetId, 'ico-teeth');
  assert.equal(byCategory.isFallback, true);

  // Unknown asset id, unknown category -> terminal default.
  const byDefault = resolveAsset(db, 'does-not-exist', 'no-such-category');
  assert.equal(byDefault.assetId, 'ico-fallback');
  assert.equal(byDefault.isFallback, true);

  // An unvalidated asset must be skipped rather than rendered as an empty image.
  db.prepare(`INSERT INTO asset VALUES ('ico-unvalidated','icon','hygiene','icons/u.svg',NULL)`).run();
  const skipped = resolveAsset(db, 'ico-unvalidated', 'hygiene');
  assert.notEqual(skipped.assetId, 'ico-unvalidated');
  assert.ok(skipped.url.length > 0);
  db.close();
});

test('balances contain one row per active child on day one, before any ledger history', () => {
  const db = fresh();
  const ledgerCount = db.prepare('SELECT COUNT(*) AS n FROM ledger_entry').get() as { n: number };
  assert.equal(ledgerCount.n, 0, 'precondition: no ledger history');
  const balances = listBalances(db);
  assert.equal(balances.length, 3, 'every active child must appear, not just those with entries');
  assert.ok(balances.every((b) => b.points === 0));

  const rate = getCentsPerPoint(db);
  assert.equal(rate, 10);
  const preReader = balances.find((b) => b.childId === 'child-c');
  assert.ok(preReader);
  assert.equal(preReader.cashCents, null, 'ledger-disabled child has no cash value');
  const reader = balances.find((b) => b.childId === 'child-a');
  assert.ok(reader);
  assert.equal(reader.cashCents, 0);
  db.close();
});

test('materialization is idempotent under repeated concurrent-style calls', () => {
  const db = fresh();
  const date = '2026-09-01' as LocalDate; // a Tuesday

  const results = Array.from({ length: 25 }, () => materializeRoutineRun(db, 'rt-morning', date));
  const ids = new Set(results.map((r) => r.runId));
  assert.equal(ids.size, 1, 'all callers must agree on one canonical run');
  assert.equal(results.filter((r) => r.created).length, 1, 'exactly one caller creates it');

  const runs = db
    .prepare(`SELECT COUNT(*) AS n FROM routine_run WHERE routine_id='rt-morning' AND local_date=?`)
    .get(date) as { n: number };
  assert.equal(runs.n, 1);
  db.close();
});

test('materialization snapshots per-child steps, and repairs a missing snapshot', () => {
  const db = fresh();
  const date = '2026-09-01' as LocalDate;
  const { runId } = materializeRoutineRun(db, 'rt-morning', date);

  const perChild = db
    .prepare(`SELECT child_id, COUNT(*) AS n FROM routine_run_step WHERE run_id=? GROUP BY child_id`)
    .all(runId) as { child_id: string; n: number }[];
  const counts = Object.fromEntries(perChild.map((r) => [r.child_id, r.n]));
  assert.deepEqual(counts, { 'child-a': 4, 'child-b': 3, 'child-c': 2 },
    'each child gets their own ordered step set from one shared routine');

  // The crash-between-writes case: run row exists, snapshot does not.
  db.prepare('DELETE FROM routine_run_step WHERE run_id = ?').run(runId);
  const repair = materializeRoutineRun(db, 'rt-morning', date);
  assert.equal(repair.runId, runId, 'repair must not create a second run');
  assert.equal(repair.created, false);
  assert.equal(repair.stepsRepaired, 9, 'the missing snapshot is rebuilt, not left empty');
  db.close();
});

test('a mid-day edit to the definition does not alter a run already in flight', () => {
  const db = fresh();
  const date = '2026-09-01' as LocalDate;
  const { runId } = materializeRoutineRun(db, 'rt-morning', date);

  db.prepare(`UPDATE routine_step SET label_full='SOMETHING ELSE' WHERE id='st-teeth'`).run();
  const snapshot = db
    .prepare(`SELECT label_full FROM routine_run_step WHERE run_id=? AND label_short='Teeth' LIMIT 1`)
    .get(runId) as { label_full: string };
  assert.equal(snapshot.label_full, 'Brush your teeth', 'today reads its snapshot, not the definition');
  db.close();
});

test('routines are selected by local day-of-week, not by instant arithmetic', () => {
  const db = fresh();
  assert.deepEqual(routinesForDate(db, '2026-09-01' as LocalDate).sort(), ['rt-bed', 'rt-morning']);
  // 2026-09-05 is a Saturday: the weekday-only morning routine must not appear.
  assert.deepEqual(routinesForDate(db, '2026-09-05' as LocalDate), ['rt-bed']);
  db.close();
});

test('inTransaction rolls back a failed multi-write', () => {
  const db = fresh();
  const before = db.prepare('SELECT COUNT(*) AS n FROM routine_run').get() as { n: number };
  assert.throws(() =>
    inTransaction(db, () => {
      db.prepare(
        `INSERT INTO routine_run(routine_id,local_date,opens_at_local,closes_at_local,created_at_utc)
         VALUES ('rt-morning','2026-09-02','06:00','08:00','2026-09-02T00:00:00Z')`,
      ).run();
      throw new Error('boom');
    }),
  );
  const after = db.prepare('SELECT COUNT(*) AS n FROM routine_run').get() as { n: number };
  assert.equal(after.n, before.n, 'the partial write must not survive');
  db.close();
});

test('a fully materialized run renders from a READ-ONLY database', () => {
  // Full disk, or a filesystem remounted read-only. Opening a write transaction
  // unconditionally would throw for every routine — including ones already complete on
  // disk — which is a blank wall at 6:00 AM while holding everything needed to render.
  // Found by Unit E while building on top of this function.
  const dir = mkdtempSync(join(tmpdir(), 'fc-ro-'));
  const file = join(dir, 'ro.db');
  try {
    const w = openDatabase({ path: file });
    migrate(w);
    seedDev(w);
    const written = materializeRoutineRun(w, 'rt-morning', '2026-09-01' as LocalDate);
    w.close();

    const ro = openDatabase({ path: file, readonly: true });
    const read = materializeRoutineRun(ro, 'rt-morning', '2026-09-01' as LocalDate);
    assert.equal(read.runId, written.runId, 'the existing run must render, not throw');
    assert.equal(read.created, false);
    ro.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a run with a MISSING snapshot still refuses on a read-only database', () => {
  // The repair path genuinely needs a write. Silently returning an empty run here would
  // trade a loud failure for a child staring at a routine with no steps.
  const dir = mkdtempSync(join(tmpdir(), 'fc-ro2-'));
  const file = join(dir, 'ro.db');
  try {
    const w = openDatabase({ path: file });
    migrate(w);
    seedDev(w);
    materializeRoutineRun(w, 'rt-morning', '2026-09-01' as LocalDate);
    w.prepare('DELETE FROM routine_run_step').run();
    w.close();

    const ro = openDatabase({ path: file, readonly: true });
    assert.throws(() => materializeRoutineRun(ro, 'rt-morning', '2026-09-01' as LocalDate));
    ro.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
