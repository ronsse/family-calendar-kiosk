/**
 * Unit C acceptance — materialization, recurrence and rotation.
 *
 * The interesting cases are not CRUD. They are the three things the review program showed
 * are easy to get subtly wrong here: materialization being idempotent AND self-repairing
 * (H3 finding #1), the day's snapshot being immune to a mid-day edit (H2 Q1), and every
 * date computation staying in local-date space across a DST boundary (H3 finding #6).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { dayCode } from '../src/time.ts';
import type { LocalDate } from '../src/types.ts';
import {
  choresForDate,
  evaluateRrule,
  listChoreAssignments,
  materializeChoreDay,
  materializeChoresForDate,
  occursOn,
  rotationAssignee,
} from '../src/domain/chores/index.ts';

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

const d = (s: string) => s as LocalDate;

const MONDAY = d('2026-08-24');
const SATURDAY = d('2026-08-22');

function countDays(db: ReturnType<typeof fresh>, choreId: string, date: LocalDate): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM chore_day WHERE chore_id = ? AND local_date = ?`)
    .get(choreId, date) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// Idempotence — H3 finding #1
// ---------------------------------------------------------------------------

test('25 repeated materializations of one (chore, date) yield exactly one chore_day', () => {
  const db = fresh();
  const ids = new Set<number>();
  let created = 0;
  for (let i = 0; i < 25; i++) {
    const m = materializeChoreDay(db, 'ch-pet', MONDAY);
    ids.add(m.choreDayId);
    if (m.created) created++;
  }
  assert.equal(countDays(db, 'ch-pet', MONDAY), 1, 'exactly one chore_day row');
  assert.equal(ids.size, 1, 'every call agreed on the same canonical row');
  assert.equal(created, 1, 'exactly one caller inserted it; the other 24 saw the conflict');

  // And the assignments did not multiply either.
  const n = db
    .prepare(`SELECT COUNT(*) AS n FROM chore_assignment`)
    .get() as { n: number };
  assert.equal(n.n, 3, 'one row per eligible child, written once');
  db.close();
});

test('materialization adopts a row a competing writer inserted first', () => {
  const db = fresh();
  // Simulate the other half of the race: the row already exists, with a snapshot that
  // differs from what `chore` currently says. Re-SELECTing the canonical row is what
  // makes both writers agree; trusting the insert's return value is what does not.
  db.prepare(
    `INSERT INTO chore_day (chore_id, local_date, points_each, model, created_at_utc)
     VALUES ('ch-pet', ?, 99, 'shared', '2026-01-01T00:00:00Z')`,
  ).run(MONDAY);

  const m = materializeChoreDay(db, 'ch-pet', MONDAY);
  assert.equal(m.created, false, 'the conflict must not be reported as a creation');
  assert.equal(m.pointsEach, 99, 'the canonical snapshot wins, not the live chore');
  assert.equal(m.model, 'shared', 'the canonical snapshot wins, not the live chore');
  assert.equal(countDays(db, 'ch-pet', MONDAY), 1);
  db.close();
});

test('a missing assignment set self-repairs on the next read', () => {
  const db = fresh();
  const first = materializeChoreDay(db, 'ch-bed', MONDAY);
  assert.equal(first.assignmentsWritten, 3);

  // The crash-between-writes case: the day committed, the assignments did not.
  db.prepare(`DELETE FROM chore_assignment WHERE chore_day_id = ?`).run(first.choreDayId);
  assert.equal(listChoreAssignments(db, MONDAY).filter((a) => a.choreId === 'ch-bed').length, 0);

  const second = materializeChoreDay(db, 'ch-bed', MONDAY);
  assert.equal(second.choreDayId, first.choreDayId, 'same day, repaired in place');
  assert.equal(second.created, false);
  assert.equal(second.assignmentsWritten, 3, 'the board comes back rather than staying empty');

  const third = materializeChoreDay(db, 'ch-bed', MONDAY);
  assert.equal(third.assignmentsWritten, 0, 'a repaired day is not repaired again');
  db.close();
});

test("today's snapshot is immune to a mid-day edit of the chore", () => {
  const db = fresh();
  const before = materializeChoreDay(db, 'ch-pet', MONDAY);
  assert.equal(before.pointsEach, 3);
  assert.equal(before.model, 'first_complete');

  // A parent retunes the chore at lunchtime.
  db.prepare(
    `UPDATE chore SET base_points = 99, assignment_model = 'individual' WHERE id = 'ch-pet'`,
  ).run();

  const after = materializeChoreDay(db, 'ch-pet', MONDAY);
  assert.equal(after.choreDayId, before.choreDayId);
  assert.equal(after.pointsEach, 3, 'raising the price cannot retroactively repay this morning');
  assert.equal(after.model, 'first_complete', 'a resolved claim race cannot become something else');

  const view = listChoreAssignments(db, MONDAY).filter((a) => a.choreId === 'ch-pet');
  assert.ok(view.every((a) => a.points === 3), 'the wall renders the snapshot, not the definition');

  // Tomorrow, on the other hand, does pick the edit up.
  const tomorrow = materializeChoreDay(db, 'ch-pet', d('2026-08-25'));
  assert.equal(tomorrow.pointsEach, 99);
  assert.equal(tomorrow.model, 'individual');
  db.close();
});

// ---------------------------------------------------------------------------
// Expansion per assignment model
// ---------------------------------------------------------------------------

test('each assignment model expands to the right row set', () => {
  const db = fresh();
  // ch-bed individual, ch-pet first_complete, ch-table rotation all recur daily.
  materializeChoresForDate(db, MONDAY);
  const byChore = (id: string) => listChoreAssignments(db, MONDAY).filter((a) => a.choreId === id);

  assert.equal(byChore('ch-bed').length, 3, 'individual: one row per eligible child');
  assert.equal(byChore('ch-pet').length, 3, 'first_complete: everyone gets a row; the claim races');
  assert.equal(byChore('ch-table').length, 1, 'rotation: exactly one row, the day s assignee');
  assert.ok(
    byChore('ch-bed').concat(byChore('ch-pet')).every((a) => a.state === 'pending'),
    'every row starts pending',
  );

  // shared only recurs on Saturday.
  materializeChoresForDate(db, SATURDAY);
  const shared = listChoreAssignments(db, SATURDAY).filter((a) => a.choreId === 'ch-tidy');
  assert.equal(shared.length, 3, 'shared: one independently claimable row per eligible child');
  assert.ok(shared.every((a) => a.points === 2), 'shared pays points_each to each claimant');
  db.close();
});

test('an explicit member list scopes a non-rotation chore to those children', () => {
  const db = fresh();
  db.prepare(
    `INSERT INTO chore(id, label_short, label_full, icon_asset_id, category, assignment_model, base_points, rrule, active) VALUES
       ('ch-two','Two','A two-child chore','ico-table','kitchen','shared',2,'FREQ=DAILY',1)`,
  ).run();
  db.prepare(
    `INSERT INTO chore_rotation_member VALUES ('ch-two','child-a',1),('ch-two','child-b',2)`,
  ).run();

  materializeChoreDay(db, 'ch-two', MONDAY);
  const rows = listChoreAssignments(db, MONDAY).filter((a) => a.choreId === 'ch-two');
  assert.deepEqual(rows.map((r) => r.childId).sort(), ['child-a', 'child-b']);
  db.close();
});

test('an inactive child gets no card', () => {
  const db = fresh();
  db.prepare(`UPDATE child SET active = 0 WHERE id = 'child-b'`).run();
  materializeChoresForDate(db, MONDAY);
  const kids = new Set(listChoreAssignments(db, MONDAY).map((a) => a.childId));
  assert.ok(!kids.has('child-b'));
  assert.ok(kids.has('child-a') && kids.has('child-c'));
  db.close();
});

// ---------------------------------------------------------------------------
// Rotation — deterministic, and un-re-rollable
// ---------------------------------------------------------------------------

test('a rotation assignee is stable across 50 repeated reads', () => {
  const db = fresh();
  const first = materializeChoreDay(db, 'ch-table', MONDAY);
  const owner = () => {
    const rows = listChoreAssignments(db, MONDAY).filter((a) => a.choreId === 'ch-table');
    assert.equal(rows.length, 1);
    return rows[0]?.childId;
  };
  const expected = owner();
  for (let i = 0; i < 50; i++) {
    const m = materializeChoreDay(db, 'ch-table', MONDAY);
    assert.equal(m.choreDayId, first.choreDayId);
    assert.equal(owner(), expected, 'refreshing the kiosk must not re-roll whose turn it is');
  }
  assert.equal(countDays(db, 'ch-table', MONDAY), 1);
  db.close();
});

test('the rotation advances on the next occurrence and cycles over the member list', () => {
  const db = fresh();
  const assignee = (date: LocalDate) => {
    materializeChoreDay(db, 'ch-table', date);
    return listChoreAssignments(db, date).find((a) => a.choreId === 'ch-table')?.childId;
  };
  const day0 = assignee(d('2026-08-24'));
  const day1 = assignee(d('2026-08-25'));
  const day2 = assignee(d('2026-08-26'));
  assert.ok(day0 && day1);
  assert.notEqual(day1, day0, 'the next occurrence goes to the next child');
  assert.equal(day2, day0, 'two members, so it cycles with period 2');
  assert.deepEqual(new Set([day0, day1]), new Set(['child-a', 'child-b']));
  db.close();
});

test('the rotation is a pure function of (chore_id, local_date) — no clock, no db', () => {
  const members = [
    { childId: 'child-a', position: 1 },
    { childId: 'child-b', position: 2 },
    { childId: 'child-c', position: 3 },
  ];
  const first = rotationAssignee('ch-x', MONDAY, members);
  for (let i = 0; i < 100; i++) {
    assert.equal(rotationAssignee('ch-x', MONDAY, members), first);
  }
  // Order of the input must not matter; `position` does.
  assert.equal(rotationAssignee('ch-x', MONDAY, [...members].reverse()), first);
  // Two chores sharing a member list must not shadow each other every day.
  const a = Array.from({ length: 12 }, (_, i) => rotationAssignee('ch-x', d(`2026-08-${10 + i}`), members));
  const b = Array.from({ length: 12 }, (_, i) => rotationAssignee('ch-y', d(`2026-08-${10 + i}`), members));
  assert.notDeepEqual(a, b, 'the chore id is folded into the index');
  assert.equal(rotationAssignee('ch-x', MONDAY, []), null, 'an empty rotation has no assignee');
});

test('sparse positions rotate over every member rather than skipping one', () => {
  const members = [
    { childId: 'child-a', position: 1 },
    { childId: 'child-b', position: 2 },
    { childId: 'child-c', position: 7 },
  ];
  const seen = new Set<string | null>();
  for (let i = 0; i < 9; i++) seen.add(rotationAssignee('ch-x', d(`2026-08-${10 + i}`), members));
  assert.deepEqual(seen, new Set(['child-a', 'child-b', 'child-c']));
});

test('the rotation steps by LOCAL days across both DST boundaries', () => {
  const members = [
    { childId: 'child-a', position: 1 },
    { childId: 'child-b', position: 2 },
    { childId: 'child-c', position: 3 },
  ];
  // America/Denver 2026: spring forward 03-08, fall back 11-01. A rotation stepped by
  // 24h of UTC skips or repeats a child at each of these; a local-date index does not.
  for (const window of [
    ['2026-03-06', '2026-03-07', '2026-03-08', '2026-03-09'],
    ['2026-10-31', '2026-11-01', '2026-11-02', '2026-11-03'],
  ]) {
    const seq = window.map((s) => rotationAssignee('ch-table', d(s), members));
    assert.equal(new Set(seq.slice(0, 3)).size, 3, `${window[0]}: three consecutive days, three children`);
    assert.equal(seq[3], seq[0], `${window[0]}: period 3 holds across the transition`);
  }
});

test('materializing across a DST boundary produces one day per local date', () => {
  const db = fresh();
  const dates = [d('2026-03-07'), d('2026-03-08'), d('2026-03-09')];
  for (const date of dates) materializeChoreDay(db, 'ch-bed', date);
  const rows = db
    .prepare(`SELECT local_date FROM chore_day WHERE chore_id = 'ch-bed' ORDER BY local_date`)
    .all() as { local_date: string }[];
  assert.deepEqual(rows.map((r) => r.local_date), dates);
  db.close();
});

// ---------------------------------------------------------------------------
// Recurrence
// ---------------------------------------------------------------------------

test('the supported rrule subset is evaluated in local-date space', () => {
  assert.equal(occursOn('FREQ=DAILY', MONDAY), true);
  assert.equal(dayCode(SATURDAY), 'SA');
  assert.equal(occursOn('FREQ=WEEKLY;BYDAY=SA', SATURDAY), true);
  assert.equal(occursOn('FREQ=WEEKLY;BYDAY=SA', MONDAY), false);
  assert.equal(occursOn('FREQ=WEEKLY;BYDAY=MO,WE,FR', MONDAY), true);
  assert.equal(occursOn('FREQ=DAILY;UNTIL=20260823', MONDAY), false, 'past UNTIL');
  assert.equal(occursOn('FREQ=DAILY;UNTIL=20260824', MONDAY), true, 'UNTIL is inclusive');
  assert.equal(occursOn('FREQ=DAILY;DTSTART=20260825', MONDAY), false, 'before DTSTART');
  assert.equal(occursOn('RRULE:FREQ=DAILY', MONDAY), true, 'a RRULE: prefix is tolerated');

  // INTERVAL is epoch-anchored and must be self-consistent day to day.
  const every2 = [0, 1, 2, 3].map((i) => occursOn('FREQ=DAILY;INTERVAL=2', d(`2026-08-2${4 + i}`)));
  assert.deepEqual(every2, [every2[0], !every2[0], every2[0], !every2[0]]);
});

test('an unevaluable rrule removes only its own chore, and says so', () => {
  const db = fresh();
  for (const rule of ['FREQ=MONTHLY;BYMONTHDAY=1', 'FREQ=WEEKLY', 'every day', '', 'FREQ=DAILY;COUNT=3']) {
    const ev = evaluateRrule(rule, MONDAY);
    assert.equal(ev.supported, false, `"${rule}" must not be guessed at`);
    assert.equal(ev.occurs, false, `"${rule}" must not fall through to "occurs every day"`);
  }

  db.prepare(
    `INSERT INTO chore(id, label_short, label_full, icon_asset_id, category, assignment_model, base_points, rrule, active) VALUES ('ch-bad','Bad','Unparseable','ico-table','kitchen','individual',1,'FREQ=MONTHLY',1)`,
  ).run();
  const result = materializeChoresForDate(db, MONDAY);
  assert.deepEqual(result.failed, [], 'a bad rule is an authoring gap, not a crash');
  assert.equal(result.unsupported.length, 1);
  assert.equal(result.unsupported[0]?.choreId, 'ch-bad');
  assert.equal(result.status, 'error', 'a chore an adult authored is missing — say so');
  assert.deepEqual(
    result.days.map((x) => x.choreId).sort(),
    ['ch-bed', 'ch-pet', 'ch-table'],
    'every other chore still reaches the board',
  );
  db.close();
});

test('a chore that throws is isolated rather than blanking the board', () => {
  const db = fresh();
  // Stand in for whatever one chore can do to its own transaction at 06:00 — SQLITE_FULL
  // being the realistic one. The other chores must still reach the wall.
  db.prepare(
    `CREATE TRIGGER trg_test_break_pet BEFORE INSERT ON chore_day
       WHEN NEW.chore_id = 'ch-pet'
       BEGIN SELECT RAISE(ABORT, 'simulated write failure'); END`,
  ).run();

  const result = materializeChoresForDate(db, MONDAY);
  assert.equal(result.failed.length, 1);
  assert.equal(result.failed[0]?.choreId, 'ch-pet');
  assert.match(String(result.failed[0]?.error), /simulated write failure/);
  assert.equal(result.status, 'error', 'the missing chore is reported, not hidden');
  assert.deepEqual(
    result.days.map((x) => x.choreId).sort(),
    ['ch-bed', 'ch-table'],
    'one failing chore does not roll back the rest of the board',
  );
  assert.ok(listChoreAssignments(db, MONDAY).length > 0, 'the wall still has cards to render');

  db.prepare(`DROP TRIGGER trg_test_break_pet`).run();
  assert.equal(materializeChoresForDate(db, MONDAY).status, 'ok', 'and it recovers on the next read');

  assert.throws(
    () => materializeChoreDay(db, 'ch-nope', MONDAY),
    /no active chore ch-nope/,
    'a direct call on a missing chore is still loud',
  );
  db.close();
});

// ---------------------------------------------------------------------------
// The read
// ---------------------------------------------------------------------------

test('every card resolves an icon — no card can render blank', () => {
  const db = fresh();
  // Point a chore at an asset id that does not exist, and give it a category with no
  // fallback of its own, so resolution must walk all the way to '_default'.
  // 'ico-pet' is not a fallback target, so un-validating it is permitted by the schema
  // triggers — which is exactly the hole `resolveAsset` exists to cover.
  db.prepare(`UPDATE chore SET category = 'nonesuch' WHERE id = 'ch-pet'`).run();
  db.prepare(`UPDATE asset SET validated_at_utc = NULL WHERE id = 'ico-pet'`).run();

  const { assignments, materialization } = choresForDate(db, MONDAY);
  assert.equal(materialization.status, 'ok');
  assert.ok(assignments.length > 0);
  for (const a of assignments) {
    assert.ok(a.icon.url.length > 0, `${a.choreId} rendered an empty icon url`);
    assert.ok(a.labelShort.length > 0 && a.labelFull.length > 0);
  }
  const pet = assignments.find((a) => a.choreId === 'ch-pet');
  assert.equal(pet?.icon.assetId, 'ico-fallback');
  assert.equal(pet?.icon.isFallback, true, 'the authoring gap stays visible to adults');
  db.close();
});

test('choresForDate materializes before it reads', () => {
  const db = fresh();
  assert.deepEqual(listChoreAssignments(db, MONDAY), [], 'nothing exists before materialization');
  const { assignments } = choresForDate(db, MONDAY);
  assert.equal(assignments.length, 7, '3 individual + 3 first_complete + 1 rotation');
  assert.ok(assignments.every((a) => a.localDate === MONDAY));
  db.close();
});

// ---------------------------------------------------------------------------
// The read-only database — a full disk at 06:00
// ---------------------------------------------------------------------------

test('an already-materialized day still renders from a read-only database', () => {
  const dir = mkdtempSync(join(tmpdir(), 'unit-c-'));
  const path = join(dir, 'wall.db');
  try {
    const rw = openDatabase({ path });
    migrate(rw);
    seedDev(rw);
    choresForDate(rw, MONDAY);
    rw.close();

    // The disk fills, or the filesystem remounts ro. Everything needed to render today is
    // already committed; opening an IMMEDIATE transaction to re-derive it is not.
    const ro = openDatabase({ path, readonly: true });
    const { assignments, materialization } = choresForDate(ro, MONDAY);
    assert.equal(assignments.length, 7, 'the board renders anyway');
    assert.deepEqual(materialization.failed, [], 'and does not report itself broken');
    assert.equal(materialization.status, 'ok');
    assert.ok(assignments.every((a) => a.icon.url.length > 0));

    // A day that was never materialized cannot be built on a read-only database, and that
    // is reported rather than thrown.
    const unbuilt = choresForDate(ro, d('2026-08-26'));
    assert.deepEqual(unbuilt.assignments, []);
    assert.equal(unbuilt.materialization.status, 'error');
    assert.ok(unbuilt.materialization.failed.length > 0);
    ro.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
