/**
 * Unit E — the read path. This is the 6:00 AM screen.
 *
 * The assertions worth having here are not "the function returns rows". They are the four
 * properties the design review paid for and that a later refactor could quietly undo:
 * selection by LOCAL day-of-week, the time box shipping as DATA, one ordered step set per
 * child out of one shared routine, and an icon that can never be empty — because for the
 * pre-reader a missing icon IS a blank screen.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { todaysRoutines, todaysRoutinesWithStatus } from '../src/domain/routines/index.ts';
import type { LocalDate, RoutineRunView } from '../src/types.ts';

const TUESDAY = '2026-09-01' as LocalDate;
const SATURDAY = '2026-09-05' as LocalDate;

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

function view(views: RoutineRunView[], routineId: string, childId: string): RoutineRunView {
  const hit = views.find((v) => v.routineId === routineId && v.childId === childId);
  assert.ok(hit, `expected a view for ${routineId}/${childId}`);
  return hit;
}

test('one view per (routine, child), ordered by routine then child', () => {
  const db = fresh();
  const views = todaysRoutines(db, TUESDAY);

  assert.deepEqual(
    views.map((v) => `${v.routineId}/${v.childId}`),
    [
      'rt-morning/child-a',
      'rt-morning/child-b',
      'rt-morning/child-c',
      'rt-bed/child-a',
      'rt-bed/child-c',
    ],
    'child-b has no bedtime assignment, so she gets no bedtime card — not an empty one',
  );
  db.close();
});

test('Saturday does not receive a weekday-only routine', () => {
  const db = fresh();
  const views = todaysRoutines(db, SATURDAY);

  assert.equal(
    views.filter((v) => v.routineId === 'rt-morning').length,
    0,
    'rt-morning is MO-FR; 2026-09-05 is a Saturday',
  );
  assert.deepEqual(
    views.map((v) => `${v.routineId}/${v.childId}`),
    ['rt-bed/child-a', 'rt-bed/child-c'],
  );

  // And nothing was materialized for it either — selection happens before the write.
  const runs = db
    .prepare(`SELECT COUNT(*) AS n FROM routine_run WHERE routine_id='rt-morning' AND local_date=?`)
    .get(SATURDAY) as { n: number };
  assert.equal(runs.n, 0);
  db.close();
});

test('the pre-reader gets her own shorter ordered step set from the shared routine', () => {
  const db = fresh();
  const views = todaysRoutines(db, TUESDAY);

  const band = db.prepare(`SELECT reading_band AS b FROM child WHERE id='child-c'`).get() as {
    b: string;
  };
  assert.equal(band.b, 'picture', 'precondition: child-c is the pre-reader');

  const preReader = view(views, 'rt-morning', 'child-c');
  assert.deepEqual(
    preReader.steps.map((s) => [s.position, s.labelShort]),
    [
      [1, 'Dressed'],
      [2, 'Teeth'],
    ],
    'child-c gets two steps, in her assigned order',
  );

  const fluent = view(views, 'rt-morning', 'child-a');
  assert.deepEqual(
    fluent.steps.map((s) => [s.position, s.labelShort]),
    [
      [1, 'Dressed'],
      [2, 'Teeth'],
      [3, 'Shoes'],
      [4, 'Bag'],
    ],
    'the same routine gives the fluent reader four steps',
  );

  assert.equal(fluent.runId, preReader.runId, 'one run per routine per day, shared by siblings');
  db.close();
});

test('no step ever carries an empty icon url, even after its asset is un-validated', () => {
  const db = fresh();
  const before = todaysRoutines(db, TUESDAY);
  assert.ok(before.every((v) => v.steps.length > 0));
  for (const v of before) {
    assert.ok(v.icon.url.length > 0, `routine ${v.routineId} icon`);
    for (const s of v.steps) assert.ok(s.icon.url.length > 0, `step ${s.labelShort} icon`);
  }
  const shoes = view(before, 'rt-morning', 'child-a').steps[2];
  assert.ok(shoes);
  assert.equal(shoes.icon.assetId, 'ico-shoes');
  assert.equal(shoes.icon.isFallback, false);

  // The file is withdrawn AFTER materialization. The snapshot still points at it, so a
  // reader that trusted the stored id would ship a URL to something no longer known-good.
  db.prepare(`UPDATE asset SET validated_at_utc = NULL WHERE id = 'ico-shoes'`).run();

  const after = todaysRoutines(db, TUESDAY);
  const repaired = view(after, 'rt-morning', 'child-a').steps[2];
  assert.ok(repaired);
  assert.equal(repaired.labelShort, 'Shoes', 'the same step, not a different one');
  assert.equal(repaired.icon.assetId, 'ico-dress', "falls back within the step's own category");
  assert.equal(repaired.icon.isFallback, true, 'the authoring gap stays visible to adults');
  assert.ok(repaired.icon.url.length > 0);

  // Re-resolution happens on the way out; it does not rewrite the snapshot.
  const stored = db
    .prepare(`SELECT icon_asset_id AS a FROM routine_run_step WHERE id = ?`)
    .get(repaired.runStepId) as { a: string };
  assert.equal(stored.a, 'ico-shoes');
  db.close();
});

test('a step whose definition was deleted still renders an icon', () => {
  const db = fresh();
  const views = todaysRoutines(db, TUESDAY);
  const step = view(views, 'rt-morning', 'child-c').steps[0];
  assert.ok(step);

  // ON DELETE SET NULL: the run keeps the step, but its authoring category is gone.
  db.prepare(`DELETE FROM routine_step_assignment WHERE routine_step_id = 'st-dress'`).run();
  db.prepare(`UPDATE routine_run_step SET source_step_id = NULL WHERE source_step_id = 'st-dress'`).run();
  db.prepare(`DELETE FROM routine_step WHERE id = 'st-dress'`).run();
  db.prepare(`UPDATE asset SET validated_at_utc = NULL WHERE id = 'ico-shoes'`).run();

  const after = todaysRoutines(db, TUESDAY);
  const orphan = after.find((v) => v.childId === 'child-c' && v.routineId === 'rt-morning')?.steps[0];
  assert.ok(orphan);
  assert.equal(orphan.labelShort, 'Dressed', 'the snapshot survives its definition');
  assert.ok(orphan.icon.url.length > 0);
  db.close();
});

test('the time box ships as DATA — no server-evaluated open/locked/closed flag', () => {
  const db = fresh();
  const morning = view(todaysRoutines(db, TUESDAY), 'rt-morning', 'child-c');

  assert.equal(morning.opensAtLocal, '06:00');
  assert.equal(morning.closesAtLocal, '08:00');

  // The structural guard. A snapshot built at 00:00 that carried `locked` would never open
  // at 06:00 — the wall only refetches on SSE open and at the date boundary (H2 Q1). If a
  // later change adds an evaluated flag, this fails loudly rather than at 6am in March.
  assert.deepEqual(
    Object.keys(morning).sort(),
    [
      'childId',
      'closesAtLocal',
      'icon',
      'labelFull',
      'labelShort',
      'localDate',
      'opensAtLocal',
      'routineId',
      'runId',
      'steps',
    ],
    'RoutineRunView must carry exactly the frozen keys',
  );
  const step = morning.steps[0];
  assert.ok(step);
  assert.deepEqual(Object.keys(step).sort(), [
    'completedAtUtc',
    'icon',
    'labelFull',
    'labelShort',
    'position',
    'runStepId',
  ]);
  db.close();
});

test('the box comes from the run snapshot, so a mid-day edit cannot move it', () => {
  const db = fresh();
  todaysRoutines(db, TUESDAY);
  db.prepare(`UPDATE routine SET opens_at_local='17:00', closes_at_local='17:30' WHERE id='rt-morning'`).run();

  const morning = view(todaysRoutines(db, TUESDAY), 'rt-morning', 'child-a');
  assert.equal(morning.opensAtLocal, '06:00', "today reads its own snapshot, not tomorrow's rule");

  // Tomorrow, of course, does move.
  const wednesday = view(todaysRoutines(db, '2026-09-02' as LocalDate), 'rt-morning', 'child-a');
  assert.equal(wednesday.opensAtLocal, '17:00');
  db.close();
});

test('an unparseable stored box degrades to always-open, never to hidden', () => {
  const db = fresh();
  todaysRoutines(db, TUESDAY);
  db.prepare(`UPDATE routine_run SET opens_at_local='six oclock' WHERE routine_id='rt-morning'`).run();

  const morning = view(todaysRoutines(db, TUESDAY), 'rt-morning', 'child-c');
  assert.equal(morning.opensAtLocal, '00:00');
  assert.equal(morning.closesAtLocal, '23:59');
  assert.equal(morning.steps.length, 2, 'an authoring typo must not lock a child out');
  db.close();
});

test('an inactive child drops out of the views at read time', () => {
  const db = fresh();
  assert.equal(todaysRoutines(db, TUESDAY).length, 5);

  db.prepare(`UPDATE child SET active = 0 WHERE id = 'child-b'`).run();
  const after = todaysRoutines(db, TUESDAY);
  assert.equal(after.length, 4);
  assert.ok(!after.some((v) => v.childId === 'child-b'));

  // Her snapshot rows are untouched — deactivation is not deletion.
  const rows = db
    .prepare(`SELECT COUNT(*) AS n FROM routine_run_step WHERE child_id='child-b'`)
    .get() as { n: number };
  assert.equal(rows.n, 3);
  db.close();
});

test('materialization status is ok on a clean day and carries no failures', () => {
  const db = fresh();
  const result = todaysRoutinesWithStatus(db, TUESDAY);
  assert.equal(result.status, 'ok');
  assert.deepEqual(result.failures, []);
  assert.equal(result.routines.length, 5);

  // A day with no scheduled routine is 'ok', not 'error' — nothing failed.
  const noneDay = todaysRoutinesWithStatus(db, SATURDAY);
  assert.equal(noneDay.status, 'ok');
  db.close();
});

test('a read-only database renders an already-materialized morning cleanly', () => {
  // Originally written against a workaround: materializeRoutineRun opened an IMMEDIATE
  // transaction unconditionally, so a read-only db (full disk, ro remount) threw for every
  // routine — including ones already complete on disk — and this unit salvaged them and
  // reported 'stale'. Unit A has since taken a read-only fast path, so the day is genuinely
  // OK rather than salvaged. Asserting 'ok' here is the point: the workaround's behaviour
  // was never the desired behaviour, and this test should track the fix, not the scar.
  const dir = mkdtempSync(join(tmpdir(), 'fc-unit-e-ro-'));
  const path = join(dir, 'wall.db');
  try {
    const rw = openDatabase({ path });
    migrate(rw);
    seedDev(rw);
    assert.equal(todaysRoutinesWithStatus(rw, TUESDAY).status, 'ok');
    rw.close();

    const ro = openDatabase({ path, readonly: true });
    const result = todaysRoutinesWithStatus(ro, TUESDAY);

    assert.equal(result.routines.length, 5, 'the wall is NOT blank');
    assert.equal(result.status, 'ok', 'a complete run on disk is not stale');
    assert.equal(result.failures.length, 0, 'nothing needed salvaging');

    const preReader = view(result.routines, 'rt-morning', 'child-c');
    assert.equal(preReader.steps.length, 2);
    assert.ok(preReader.steps.every((s) => s.icon.url.length > 0));
    ro.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the salvage path still covers a run whose snapshot is incomplete on a read-only db', () => {
  // The fast path deliberately does NOT cover this: repairing a missing snapshot needs a
  // write. So the salvage path Unit E built is still load-bearing — it is what stops an
  // interrupted materialization becoming a blank wall.
  const dir = mkdtempSync(join(tmpdir(), 'fc-unit-e-ro2-'));
  const path = join(dir, 'wall.db');
  try {
    const rw = openDatabase({ path });
    migrate(rw);
    seedDev(rw);
    todaysRoutinesWithStatus(rw, TUESDAY);
    rw.prepare(`DELETE FROM routine_run_step WHERE child_id = 'child-a'`).run();
    rw.close();

    const ro = openDatabase({ path, readonly: true });
    const result = todaysRoutinesWithStatus(ro, TUESDAY);
    assert.notEqual(result.status, 'error', 'something must still render');
    assert.ok(result.routines.length > 0, 'the wall is NOT blank');
    ro.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a routine with nothing materializable and nothing on disk reports error', () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-unit-e-err-'));
  const path = join(dir, 'wall.db');
  try {
    const rw = openDatabase({ path });
    migrate(rw);
    seedDev(rw);
    rw.close();

    const ro = openDatabase({ path, readonly: true });
    const result = todaysRoutinesWithStatus(ro, TUESDAY);
    assert.equal(result.routines.length, 0);
    assert.equal(result.status, 'error', 'nothing renders, and that is not "stale"');
    assert.ok(result.failures.every((f) => f.salvaged === false));
    ro.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
