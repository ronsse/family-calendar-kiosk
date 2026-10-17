/**
 * Unit E — assigning steps from the wall, and today's run following the change.
 *
 * The fixture: child-c's morning is two steps (dress, teeth); child-a's is four; child-c's
 * bedtime is pyjamas only — the seed's "pre-reader gets a shorter sequence". The household's
 * ask was exactly this shape: *"The youngest doesn't have brushing his teeth as part of his bedtime
 * routine."*
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { materializeRoutineRun } from '../src/db/repo.ts';
import {
  assignStep,
  completeStep,
  moveStep,
  readRoutineCatalog,
  todaysRoutines,
} from '../src/domain/routines/index.ts';
import type { LocalDate } from '../src/types.ts';

const TUESDAY = '2026-09-01' as LocalDate;
const MONDAY = '2026-08-31' as LocalDate;

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

function definition(db: Db, routineId: string, childId: string): string[] {
  const routine = readRoutineCatalog(db).routines.find((r) => r.id === routineId);
  assert.ok(routine);
  return routine.assignments
    .filter((a) => a.childId === childId)
    .sort((a, b) => a.position - b.position)
    .map((a) => a.stepId);
}

function positions(db: Db, routineId: string, childId: string): number[] {
  return (
    db
      .prepare(
        `SELECT position FROM routine_step_assignment
          WHERE routine_id = ? AND child_id = ? ORDER BY position`,
      )
      .all(routineId, childId) as { position: number }[]
  ).map((r) => r.position);
}

function runSteps(db: Db, routineId: string, childId: string, date: LocalDate) {
  const view = todaysRoutines(db, date).find((v) => v.routineId === routineId && v.childId === childId);
  return view?.steps ?? [];
}

test('the catalog carries every routine, its step pool and every assignment', () => {
  const db = fresh();
  const catalog = readRoutineCatalog(db);
  assert.deepEqual(
    catalog.routines.map((r) => r.id),
    ['rt-morning', 'rt-bed'],
  );
  const bed = catalog.routines[1]!;
  assert.deepEqual(
    bed.steps.map((s) => s.id),
    ['st-pj', 'st-teeth-pm'],
  );
  assert.ok(bed.steps.every((s) => s.icon.url.length > 0), 'icons resolve to a url');
  assert.deepEqual(definition(db, 'rt-bed', 'child-c'), ['st-pj']);
  assert.deepEqual(definition(db, 'rt-bed', 'child-b'), []);
});

test('assigning a step appends it, and tonight’s already-snapshotted run gains it', () => {
  const db = fresh();
  // Tonight was snapshotted this morning — the case the household actually hit.
  materializeRoutineRun(db, 'rt-bed', TUESDAY);
  assert.deepEqual(
    runSteps(db, 'rt-bed', 'child-c', TUESDAY).map((s) => s.labelFull),
    ['Put on pyjamas'],
  );

  const result = assignStep(
    db,
    { routineId: 'rt-bed', stepId: 'st-teeth-pm', childId: 'child-c', assigned: true },
    TUESDAY,
  );
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.changed, true);
  assert.equal(result.ok && result.todayTouched, 1);

  assert.deepEqual(definition(db, 'rt-bed', 'child-c'), ['st-pj', 'st-teeth-pm']);
  assert.deepEqual(positions(db, 'rt-bed', 'child-c'), [1, 2]);
  const tonight = runSteps(db, 'rt-bed', 'child-c', TUESDAY);
  assert.deepEqual(
    tonight.map((s) => [s.position, s.labelFull]),
    [
      [1, 'Put on pyjamas'],
      [2, 'Brush your teeth'],
    ],
  );
});

test('assigning what is already assigned writes nothing', () => {
  const db = fresh();
  const result = assignStep(
    db,
    { routineId: 'rt-bed', stepId: 'st-pj', childId: 'child-c', assigned: true },
    TUESDAY,
  );
  assert.deepEqual(result, { ok: true, changed: false, todayTouched: 0 });
});

test('removing a step closes the gap, drops it from today, and keeps a sibling step’s completion', () => {
  const db = fresh();
  materializeRoutineRun(db, 'rt-morning', TUESDAY);
  const before = runSteps(db, 'rt-morning', 'child-a', TUESDAY);
  assert.deepEqual(
    before.map((s) => s.labelFull),
    ['Get dressed', 'Brush your teeth', 'Put your shoes on', 'Pack your bag'],
  );
  // Child-a has already brushed her teeth this morning.
  const teeth = before[1]!;
  const done = completeStep(db, { runStepId: teeth.runStepId, childId: 'child-a' });
  assert.equal(done.ok, true);

  const result = assignStep(
    db,
    { routineId: 'rt-morning', stepId: 'st-dress', childId: 'child-a', assigned: false },
    TUESDAY,
  );
  assert.equal(result.ok && result.changed, true);
  assert.deepEqual(definition(db, 'rt-morning', 'child-a'), ['st-teeth', 'st-shoes', 'st-bag']);
  assert.deepEqual(positions(db, 'rt-morning', 'child-a'), [1, 2, 3]);

  const after = runSteps(db, 'rt-morning', 'child-a', TUESDAY);
  assert.deepEqual(
    after.map((s) => [s.position, s.labelFull, s.completedAtUtc !== null]),
    [
      [1, 'Brush your teeth', true],
      [2, 'Put your shoes on', false],
      [3, 'Pack your bag', false],
    ],
  );
  // The SAME run row: the completion survived because the row did, not because it was copied.
  assert.equal(after[0]!.runStepId, teeth.runStepId);
});

test('moving a step swaps it with its neighbour in the definition and in today’s run', () => {
  const db = fresh();
  materializeRoutineRun(db, 'rt-morning', TUESDAY);
  const up = moveStep(
    db,
    { routineId: 'rt-morning', stepId: 'st-bag', childId: 'child-a', direction: 'up' },
    TUESDAY,
  );
  assert.equal(up.ok && up.changed, true);
  assert.deepEqual(definition(db, 'rt-morning', 'child-a'), ['st-dress', 'st-teeth', 'st-bag', 'st-shoes']);
  assert.deepEqual(
    runSteps(db, 'rt-morning', 'child-a', TUESDAY).map((s) => [s.position, s.labelShort]),
    [
      [1, 'Dressed'],
      [2, 'Teeth'],
      [3, 'Bag'],
      [4, 'Shoes'],
    ],
  );
  // Nothing was added or removed on the run, only re-ordered.
  assert.equal(up.ok && up.todayTouched, 0);
});

test('moving past either end, or moving an unassigned step, is a quiet no-op', () => {
  const db = fresh();
  const top = moveStep(
    db,
    { routineId: 'rt-morning', stepId: 'st-dress', childId: 'child-a', direction: 'up' },
    TUESDAY,
  );
  assert.deepEqual(top, { ok: true, changed: false, todayTouched: 0 });
  const bottom = moveStep(
    db,
    { routineId: 'rt-morning', stepId: 'st-bag', childId: 'child-a', direction: 'down' },
    TUESDAY,
  );
  assert.deepEqual(bottom, { ok: true, changed: false, todayTouched: 0 });
  const stranger = moveStep(
    db,
    { routineId: 'rt-bed', stepId: 'st-teeth-pm', childId: 'child-c', direction: 'up' },
    TUESDAY,
  );
  assert.deepEqual(stranger, { ok: true, changed: false, todayTouched: 0 });
  assert.deepEqual(definition(db, 'rt-morning', 'child-a'), ['st-dress', 'st-teeth', 'st-shoes', 'st-bag']);
});

test('a step from another routine, an unknown routine, or an inactive child is refused', () => {
  const db = fresh();
  // A bedtime step cannot be put into the morning — the composite FK's rule, said first here.
  const crossed = assignStep(
    db,
    { routineId: 'rt-morning', stepId: 'st-pj', childId: 'child-a', assigned: true },
    TUESDAY,
  );
  assert.deepEqual(crossed, { ok: false, reason: 'unknown_step' });
  const noRoutine = assignStep(
    db,
    { routineId: 'rt-nope', stepId: 'st-pj', childId: 'child-a', assigned: true },
    TUESDAY,
  );
  assert.deepEqual(noRoutine, { ok: false, reason: 'unknown_routine' });
  db.prepare(`UPDATE child SET active = 0 WHERE id = 'child-b'`).run();
  const gone = assignStep(
    db,
    { routineId: 'rt-bed', stepId: 'st-pj', childId: 'child-b', assigned: true },
    TUESDAY,
  );
  assert.deepEqual(gone, { ok: false, reason: 'unknown_child' });
});

test('yesterday’s run is a record and is never rewritten', () => {
  const db = fresh();
  materializeRoutineRun(db, 'rt-bed', MONDAY);
  materializeRoutineRun(db, 'rt-bed', TUESDAY);
  assignStep(
    db,
    { routineId: 'rt-bed', stepId: 'st-teeth-pm', childId: 'child-c', assigned: true },
    TUESDAY,
  );
  assert.equal(runSteps(db, 'rt-bed', 'child-c', MONDAY).length, 1);
  assert.equal(runSteps(db, 'rt-bed', 'child-c', TUESDAY).length, 2);
});

test('with no run yet today, the change simply shapes the run when it is first read', () => {
  const db = fresh();
  const result = assignStep(
    db,
    { routineId: 'rt-bed', stepId: 'st-teeth-pm', childId: 'child-c', assigned: true },
    TUESDAY,
  );
  assert.equal(result.ok && result.todayTouched, 0);
  assert.deepEqual(
    runSteps(db, 'rt-bed', 'child-c', TUESDAY).map((s) => s.labelShort),
    ['PJs', 'Teeth'],
  );
});
