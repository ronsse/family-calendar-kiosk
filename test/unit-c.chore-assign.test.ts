/**
 * Unit C — the chore roster and model, edited from the wall.
 *
 * The fixture (`seed.dev.sql`): `ch-table` is a rotation over child-a and child-b; `ch-pet` is
 * first_complete with an IMPLICIT roster (everyone); `ch-bed` is individual, implicit.
 *
 * Most of what matters here is what a write must NOT do: empty a roster into "everyone", move a
 * rotation's turn today, or delete a claim. Those all look like success from the outside.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import {
  choresForDate,
  claimChore,
  materializeChoreDay,
  moveChoreMember,
  readChoreCatalog,
  setChoreMember,
  setChoreModel,
} from '../src/domain/chores/index.ts';
import type { LocalDate } from '../src/types.ts';

// A Tuesday: every daily chore occurs, the Saturday one does not.
const TUESDAY = '2026-09-01' as LocalDate;

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

function roster(db: Db, choreId: string): { ids: string[]; explicit: boolean } {
  const chore = readChoreCatalog(db).chores.find((c) => c.id === choreId);
  assert.ok(chore);
  return { ids: chore.roster.map((m) => m.childId), explicit: chore.rosterExplicit };
}

function stored(db: Db, choreId: string): [string, number][] {
  return (
    db
      .prepare(
        `SELECT child_id, position FROM chore_rotation_member WHERE chore_id = ? ORDER BY position`,
      )
      .all(choreId) as { child_id: string; position: number }[]
  ).map((r) => [r.child_id, r.position]);
}

function today(db: Db, choreId: string): [string, string][] {
  return choresForDate(db, TUESDAY)
    .assignments.filter((a) => a.choreId === choreId)
    .map((a) => [a.childId, a.state] as [string, string])
    .sort();
}

test('the catalog spells out the implicit roster and says that it did', () => {
  const db = fresh();
  assert.deepEqual(roster(db, 'ch-table'), { ids: ['child-a', 'child-b'], explicit: true });
  assert.deepEqual(roster(db, 'ch-pet'), {
    ids: ['child-a', 'child-b', 'child-c'],
    explicit: false,
  });
  const pet = readChoreCatalog(db).chores.find((c) => c.id === 'ch-pet');
  assert.equal(pet?.assignmentModel, 'first_complete');
  assert.equal(pet?.basePoints, 3);
  assert.ok((pet?.icon.url ?? '').length > 0);
});

test('joining appends, and today’s already-materialized day gains a pending row', () => {
  const db = fresh();
  materializeChoreDay(db, 'ch-table', TUESDAY);
  const result = setChoreMember(db, { choreId: 'ch-bed', childId: 'child-c', member: true }, TUESDAY);
  // child-c is already on the implicit "everyone" roster: nothing to write.
  assert.deepEqual(result, { ok: true, changed: false, todayTouched: 0 });

  // Take child-c OFF bed first — that spells the roster out — then put them back.
  materializeChoreDay(db, 'ch-bed', TUESDAY);
  assert.deepEqual(today(db, 'ch-bed'), [
    ['child-a', 'pending'],
    ['child-b', 'pending'],
    ['child-c', 'pending'],
  ]);
  const off = setChoreMember(db, { choreId: 'ch-bed', childId: 'child-c', member: false }, TUESDAY);
  assert.deepEqual(off, { ok: true, changed: true, todayTouched: 1 });
  assert.deepEqual(stored(db, 'ch-bed'), [
    ['child-a', 1],
    ['child-b', 2],
  ]);
  assert.deepEqual(today(db, 'ch-bed'), [
    ['child-a', 'pending'],
    ['child-b', 'pending'],
  ]);

  const on = setChoreMember(db, { choreId: 'ch-bed', childId: 'child-c', member: true }, TUESDAY);
  assert.deepEqual(on, { ok: true, changed: true, todayTouched: 1 });
  assert.deepEqual(stored(db, 'ch-bed'), [
    ['child-a', 1],
    ['child-b', 2],
    ['child-c', 3],
  ]);
  assert.deepEqual(today(db, 'ch-bed'), [
    ['child-a', 'pending'],
    ['child-b', 'pending'],
    ['child-c', 'pending'],
  ]);
});

test('the last child cannot be taken off — that would mean everyone, not nobody', () => {
  const db = fresh();
  assert.deepEqual(
    setChoreMember(db, { choreId: 'ch-table', childId: 'child-a', member: false }, TUESDAY),
    { ok: true, changed: true, todayTouched: 0 },
  );
  assert.deepEqual(
    setChoreMember(db, { choreId: 'ch-table', childId: 'child-b', member: false }, TUESDAY),
    { ok: false, reason: 'roster_empty' },
  );
  assert.deepEqual(stored(db, 'ch-table'), [['child-b', 1]]);
});

test('leaving deletes today’s row only while it is still pending', () => {
  const db = fresh();
  materializeChoreDay(db, 'ch-bed', TUESDAY);
  const mine = choresForDate(db, TUESDAY).assignments.find(
    (a) => a.choreId === 'ch-bed' && a.childId === 'child-a',
  );
  assert.ok(mine);
  assert.equal(claimChore(db, { assignmentId: mine.assignmentId, childId: 'child-a' }).ok, true);

  const result = setChoreMember(db, { choreId: 'ch-bed', childId: 'child-a', member: false }, TUESDAY);
  assert.deepEqual(result, { ok: true, changed: true, todayTouched: 0 });
  assert.deepEqual(stored(db, 'ch-bed'), [
    ['child-b', 1],
    ['child-c', 2],
  ]);
  // The claim is work the child did. It stays on the board for the parent to approve.
  assert.deepEqual(today(db, 'ch-bed'), [
    ['child-a', 'claimed'],
    ['child-b', 'pending'],
    ['child-c', 'pending'],
  ]);
});

test('joining a first_complete day whose race is won lands as superseded, not pending', () => {
  const db = fresh();
  // Scope the pet to child-a only, then have them claim it.
  setChoreMember(db, { choreId: 'ch-pet', childId: 'child-b', member: false }, TUESDAY);
  setChoreMember(db, { choreId: 'ch-pet', childId: 'child-c', member: false }, TUESDAY);
  materializeChoreDay(db, 'ch-pet', TUESDAY);
  assert.deepEqual(today(db, 'ch-pet'), [['child-a', 'pending']]);
  const mine = choresForDate(db, TUESDAY).assignments.find((a) => a.choreId === 'ch-pet');
  assert.ok(mine);
  claimChore(db, { assignmentId: mine.assignmentId, childId: 'child-a' });

  const result = setChoreMember(db, { choreId: 'ch-pet', childId: 'child-b', member: true }, TUESDAY);
  assert.deepEqual(result, { ok: true, changed: true, todayTouched: 1 });
  assert.deepEqual(today(db, 'ch-pet'), [
    ['child-a', 'claimed'],
    ['child-b', 'superseded'],
  ]);
});

test('a rotation’s day is never touched by a roster change; the order is read tomorrow', () => {
  const db = fresh();
  materializeChoreDay(db, 'ch-table', TUESDAY);
  const before = today(db, 'ch-table');
  assert.equal(before.length, 1);

  const joined = setChoreMember(db, { choreId: 'ch-table', childId: 'child-c', member: true }, TUESDAY);
  assert.deepEqual(joined, { ok: true, changed: true, todayTouched: 0 });
  assert.deepEqual(stored(db, 'ch-table'), [
    ['child-a', 1],
    ['child-b', 2],
    ['child-c', 3],
  ]);
  assert.deepEqual(today(db, 'ch-table'), before);

  const moved = moveChoreMember(db, { choreId: 'ch-table', childId: 'child-c', direction: 'up' });
  assert.deepEqual(moved, { ok: true, changed: true, todayTouched: 0 });
  assert.deepEqual(stored(db, 'ch-table'), [
    ['child-a', 1],
    ['child-c', 2],
    ['child-b', 3],
  ]);
  assert.deepEqual(today(db, 'ch-table'), before);
});

test('moving past either end, or moving a child who is not on the roster, is a quiet no-op', () => {
  const db = fresh();
  assert.deepEqual(moveChoreMember(db, { choreId: 'ch-table', childId: 'child-a', direction: 'up' }), {
    ok: true,
    changed: false,
    todayTouched: 0,
  });
  assert.deepEqual(
    moveChoreMember(db, { choreId: 'ch-table', childId: 'child-b', direction: 'down' }),
    { ok: true, changed: false, todayTouched: 0 },
  );
  assert.deepEqual(moveChoreMember(db, { choreId: 'ch-table', childId: 'child-c', direction: 'up' }), {
    ok: true,
    changed: false,
    todayTouched: 0,
  });
  assert.deepEqual(stored(db, 'ch-table'), [
    ['child-a', 1],
    ['child-b', 2],
  ]);
});

test('moving on an implicit roster spells it out first', () => {
  const db = fresh();
  const moved = moveChoreMember(db, { choreId: 'ch-bed', childId: 'child-c', direction: 'up' });
  assert.deepEqual(moved, { ok: true, changed: true, todayTouched: 0 });
  assert.deepEqual(stored(db, 'ch-bed'), [
    ['child-a', 1],
    ['child-c', 2],
    ['child-b', 3],
  ]);
});

test('a model change starts tomorrow, and a new rotation is never over nobody', () => {
  const db = fresh();
  materializeChoreDay(db, 'ch-bed', TUESDAY);
  const result = setChoreModel(db, { choreId: 'ch-bed', assignmentModel: 'rotation' });
  assert.deepEqual(result, { ok: true, changed: true, todayTouched: 0 });
  assert.equal(
    readChoreCatalog(db).chores.find((c) => c.id === 'ch-bed')?.assignmentModel,
    'rotation',
  );
  // The implicit roster became a real one, so tomorrow's turn has someone to land on.
  assert.deepEqual(stored(db, 'ch-bed'), [
    ['child-a', 1],
    ['child-b', 2],
    ['child-c', 3],
  ]);
  // Today keeps its snapshot: three individual rows, all still pending.
  assert.equal(today(db, 'ch-bed').length, 3);
  assert.equal(
    (db.prepare(`SELECT model FROM chore_day WHERE chore_id = 'ch-bed'`).get() as { model: string })
      .model,
    'individual',
  );
  // Tomorrow is a rotation day with exactly one assignee.
  const tomorrow = materializeChoreDay(db, 'ch-bed', '2026-09-02' as LocalDate);
  assert.equal(tomorrow.model, 'rotation');
  assert.equal(tomorrow.assignmentsWritten, 1);

  assert.deepEqual(setChoreModel(db, { choreId: 'ch-bed', assignmentModel: 'rotation' }), {
    ok: true,
    changed: false,
    todayTouched: 0,
  });
});

test('unknown chores, unknown or inactive children, and unknown models are refused', () => {
  const db = fresh();
  assert.deepEqual(setChoreMember(db, { choreId: 'ch-nope', childId: 'child-a', member: true }, TUESDAY), {
    ok: false,
    reason: 'unknown_chore',
  });
  assert.deepEqual(setChoreMember(db, { choreId: 'ch-bed', childId: 'child-z', member: true }, TUESDAY), {
    ok: false,
    reason: 'unknown_child',
  });
  db.prepare(`UPDATE child SET active = 0 WHERE id = 'child-c'`).run();
  assert.deepEqual(setChoreMember(db, { choreId: 'ch-bed', childId: 'child-c', member: true }, TUESDAY), {
    ok: false,
    reason: 'unknown_child',
  });
  db.prepare(`UPDATE chore SET active = 0 WHERE id = 'ch-bed'`).run();
  assert.deepEqual(setChoreModel(db, { choreId: 'ch-bed', assignmentModel: 'rotation' }), {
    ok: false,
    reason: 'unknown_chore',
  });
  assert.deepEqual(
    setChoreModel(db, { choreId: 'ch-pet', assignmentModel: 'lottery' as 'rotation' }),
    { ok: false, reason: 'bad_model' },
  );
});
