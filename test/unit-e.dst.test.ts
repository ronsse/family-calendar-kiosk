/**
 * Unit E acceptance (build-plan.md §4): "lazy daily materialization verified across a DST
 * boundary".
 *
 * America/Denver, 2026:
 *   spring forward — Sun 2026-03-08, 02:00 MST becomes 03:00 MDT. The hour 02:00-02:59
 *                    does not exist and the local day is 23 hours long.
 *   fall back      — Sun 2026-11-01, 02:00 MDT becomes 01:00 MST. The hour 01:00-01:59
 *                    happens twice and the local day is 25 hours long.
 *
 * The failure being tested for is not abstract. Step a day by 86,400,000 milliseconds from
 * local midnight on 2026-11-01 and you land at 23:00 on 2026-11-01 — the SAME local date.
 * A walker built that way materializes Sunday twice and never reaches Monday, so on Monday
 * 2026-11-02 the wall opens on Sunday's routine: alive, structurally valid, throwing no
 * error, and completely wrong for a school morning (H3 finding #6).
 *
 * Every date here is a floating LocalDate stepped with `addDays`, and every routine is
 * selected by `dayCode`. Neither touches an instant.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { addDays, daysBetween, localDate } from '../src/time.ts';
import { completeStep, todaysRoutines } from '../src/domain/routines/index.ts';
import type { LocalDate } from '../src/types.ts';

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

/** Walks local dates inclusively, materializing each day exactly as the wall would. */
function walk(db: ReturnType<typeof fresh>, from: LocalDate, to: LocalDate): LocalDate[] {
  const visited: LocalDate[] = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) {
    todaysRoutines(db, d);
    visited.push(d);
  }
  return visited;
}

interface RunRow {
  routine_id: string;
  local_date: string;
  n: number;
}

function runs(db: ReturnType<typeof fresh>): RunRow[] {
  return db
    .prepare(
      `SELECT routine_id, local_date, COUNT(*) AS n
         FROM routine_run GROUP BY routine_id, local_date
         ORDER BY local_date, routine_id`,
    )
    .all() as RunRow[];
}

test('spring forward: the 23-hour day is materialized exactly once and is not skipped', () => {
  const db = fresh();

  // The precondition, stated in instants so the test is checkable against a calendar.
  const midnight = Date.parse('2026-03-08T07:00:00Z'); // 00:00 MST
  const nextMidnight = Date.parse('2026-03-09T06:00:00Z'); // 00:00 MDT
  assert.equal((nextMidnight - midnight) / 3_600_000, 23, '2026-03-08 is 23 hours long');
  assert.equal(localDate(new Date('2026-03-08T08:59:00Z')), '2026-03-08'); // 01:59 MST
  assert.equal(localDate(new Date('2026-03-08T09:00:00Z')), '2026-03-08'); // 03:00 MDT

  const visited = walk(db, '2026-03-06' as LocalDate, '2026-03-10' as LocalDate);
  assert.deepEqual(visited, [
    '2026-03-06',
    '2026-03-07',
    '2026-03-08',
    '2026-03-09',
    '2026-03-10',
  ]);

  const materialized = runs(db);
  assert.ok(
    materialized.every((r) => r.n === 1),
    'exactly one run per routine per local date — no duplicates',
  );
  assert.deepEqual(
    materialized.filter((r) => r.routine_id === 'rt-bed').map((r) => r.local_date),
    ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09', '2026-03-10'],
    'the every-day routine gets every day, including the short one',
  );
  assert.deepEqual(
    materialized.filter((r) => r.routine_id === 'rt-morning').map((r) => r.local_date),
    ['2026-03-06', '2026-03-09', '2026-03-10'],
    'MO-FR: Saturday the 7th and Sunday the 8th are correctly absent',
  );

  const ids = materialized.map((r) => `${r.routine_id}@${r.local_date}`);
  assert.equal(new Set(ids).size, ids.length);
  db.close();
});

test('spring forward: instants either side of the missing hour resolve to one run', () => {
  const db = fresh();

  // 01:59 MST and 03:00 MDT are 60 seconds apart. 02:00 never happens.
  const beforeGap = localDate(new Date('2026-03-08T08:59:00Z'));
  const afterGap = localDate(new Date('2026-03-08T09:00:00Z'));
  assert.equal(beforeGap, afterGap);

  const first = todaysRoutines(db, beforeGap);
  const second = todaysRoutines(db, afterGap);
  assert.deepEqual(
    first.map((v) => v.runId),
    second.map((v) => v.runId),
    'the wall on both sides of the gap is looking at the same runs',
  );

  const n = db
    .prepare(`SELECT COUNT(*) AS n FROM routine_run WHERE local_date = '2026-03-08'`)
    .get() as { n: number };
  assert.equal(n.n, 1, 'one routine is scheduled on that Sunday, and it got one run');
  db.close();
});

test('fall back: the 25-hour day is materialized exactly once and is not repeated', () => {
  const db = fresh();

  const midnight = Date.parse('2026-11-01T06:00:00Z'); // 00:00 MDT
  const nextMidnight = Date.parse('2026-11-02T07:00:00Z'); // 00:00 MST
  assert.equal((nextMidnight - midnight) / 3_600_000, 25, '2026-11-01 is 25 hours long');

  // The hazard, made concrete. This is what a walker stepping the INSTANT would do.
  const naiveNextDay = new Date(midnight + 86_400_000);
  assert.equal(
    localDate(naiveNextDay),
    '2026-11-01',
    'precondition: +24h from local midnight is still the same local date',
  );

  const visited = walk(db, '2026-10-30' as LocalDate, '2026-11-03' as LocalDate);
  assert.deepEqual(visited, [
    '2026-10-30',
    '2026-10-31',
    '2026-11-01',
    '2026-11-02',
    '2026-11-03',
  ]);
  assert.equal(new Set(visited).size, 5, 'no local date is visited twice');

  const materialized = runs(db);
  assert.ok(materialized.every((r) => r.n === 1));
  assert.deepEqual(
    materialized.filter((r) => r.routine_id === 'rt-bed').map((r) => r.local_date),
    ['2026-10-30', '2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'],
  );
  assert.deepEqual(
    materialized.filter((r) => r.routine_id === 'rt-morning').map((r) => r.local_date),
    ['2026-10-30', '2026-11-02', '2026-11-03'],
    'the Monday after the boundary gets its own school morning, not Sunday’s',
  );
  db.close();
});

test('fall back: the hour that happens twice produces one run, not two', () => {
  const db = fresh();

  const firstPass = localDate(new Date('2026-11-01T07:30:00Z')); // 01:30 MDT
  const secondPass = localDate(new Date('2026-11-01T08:30:00Z')); // 01:30 MST, one hour later
  assert.equal(firstPass, '2026-11-01');
  assert.equal(secondPass, '2026-11-01');

  const a = todaysRoutines(db, firstPass);
  const b = todaysRoutines(db, secondPass);
  assert.deepEqual(
    a.map((v) => v.runId),
    b.map((v) => v.runId),
  );

  const n = db
    .prepare(`SELECT COUNT(*) AS n FROM routine_run WHERE local_date='2026-11-01'`)
    .get() as { n: number };
  assert.equal(n.n, 1);
  db.close();
});

test('completions do not leak across a DST boundary into the next local day', () => {
  const db = fresh();

  // Saturday 2026-10-31, the day before the boundary.
  const saturday = '2026-10-31' as LocalDate;
  const bedtime = todaysRoutines(db, saturday).find((v) => v.childId === 'child-c');
  assert.ok(bedtime);
  const step = bedtime.steps[0];
  assert.ok(step);
  const done = completeStep(db, { runStepId: step.runStepId, childId: 'child-c' });
  if (!done.ok) assert.fail(`complete was refused: ${done.reason}`);

  // Across the 25-hour Sunday and into Monday.
  for (const d of ['2026-11-01', '2026-11-02'] as LocalDate[]) todaysRoutines(db, d);

  const sunday = todaysRoutines(db, '2026-11-01' as LocalDate).find((v) => v.childId === 'child-c');
  assert.ok(sunday);
  assert.notEqual(sunday.runId, bedtime.runId, 'a new local day is a new run');
  assert.ok(
    sunday.steps.every((s) => s.completedAtUtc === null),
    'the new day starts empty — a routine does not inherit yesterday’s ticks',
  );

  const yesterday = todaysRoutines(db, saturday).find((v) => v.childId === 'child-c');
  assert.ok(yesterday);
  assert.equal(
    yesterday.steps[0]?.completedAtUtc,
    done.completedAtUtc,
    'and yesterday keeps its own history',
  );
  db.close();
});
