/**
 * Unit F acceptance: what a point is worth, and what each chore pays.
 *
 * Two numbers that lived in tables and could not be changed without a shell.  The routes are
 * small; the properties are not, and all three below are about what an edit must NOT do.
 *
 *   1. Changing the rate cannot change what a redemption already asked for will pay.
 *   2. Changing a chore's points cannot change what today's chores pay.
 *   3. Neither can be reached from the wall surface, whatever a client sends.
 *
 * The first two are not implemented by these routes at all — they fall out of two snapshots
 * that were designed months earlier — which is exactly why they are worth a test here.  A
 * property nobody re-derives is a property somebody optimises away.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_CENTS_PER_POINT,
  MAX_CHORE_POINTS,
  MIN_CENTS_PER_POINT,
  MIN_CHORE_POINTS,
  readSettings,
  setCentsPerPoint,
  setChorePoints,
} from '../src/domain/settings/index.ts';
import { adminRoutes } from '../src/http/routes.admin.ts';
import { wallRoutes } from '../src/http/routes.wall.ts';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import type { Database as Db } from 'better-sqlite3';

function openTestDb(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

function seed(db: Db): void {
  db.prepare(
    `INSERT INTO household_config (key, value_text) VALUES ('cents_per_point', '25')`,
  ).run();
  db.prepare(
    `INSERT INTO asset (id, kind, category, rel_path, validated_at_utc)
     VALUES ('ic', 'icon', 'chore', 'icons/a.svg', '2026-01-01T00:00:00.000Z')`,
  ).run();
  const chore = db.prepare(
    `INSERT INTO chore (id, label_short, label_full, icon_asset_id, category, assignment_model,
                        base_points, rrule, active, kind)
     VALUES (?, ?, ?, 'ic', 'home', 'individual', ?, 'FREQ=DAILY', ?, ?)`,
  );
  chore.run('ch-bin', 'Bin', 'Take the bin out', 6, 1, 'extra');
  chore.run('ch-bed', 'Bed', 'Make your bed', 0, 1, 'duty');
  chore.run('ch-old', 'Old', 'A retired chore', 3, 0, 'duty');
}

test('the settings read back what the tables hold, active chores first', () => {
  const db = openTestDb();
  seed(db);
  const got = readSettings(db);
  assert.equal(got.centsPerPoint, 25);
  assert.equal(got.chores.length, 3);
  // ORDER IS LOAD-BEARING: the panel shows the first N and counts the rest, so an inactive
  // chore must never push an earnable one off the bottom.
  assert.deepEqual(
    got.chores.map((c) => [c.choreId, c.active]),
    [
      ['ch-bin', true],
      ['ch-bed', true],
      ['ch-old', false],
    ],
  );
  assert.equal(got.chores[0]?.kind, 'extra');
  assert.equal(got.chores[0]?.basePoints, 6);
});

test('an unset rate reads as 0 here and as null everywhere else', () => {
  // This route is how an adult FIXES the unset case, so it is the one caller that must survive
  // it. `getCentsPerPoint` still returns null, which makes a redemption refuse rather than pay
  // out a guessed amount — a difference worth keeping and therefore worth asserting.
  const db = openTestDb();
  assert.equal(readSettings(db).centsPerPoint, 0);
  db.prepare(`INSERT INTO household_config (key, value_text) VALUES ('cents_per_point', 'x')`).run();
  assert.equal(readSettings(db).centsPerPoint, 0, 'unparseable reads the same as missing');
});

test('both numbers refuse anything outside their rails', () => {
  const db = openTestDb();
  seed(db);
  for (const bad of [0, -5, MAX_CENTS_PER_POINT + 1, 12.5, Number.NaN]) {
    assert.equal(setCentsPerPoint(db, bad), 'out_of_range', `accepted ${String(bad)}`);
  }
  assert.equal(readSettings(db).centsPerPoint, 25, 'and nothing was written');
  assert.equal(setCentsPerPoint(db, MIN_CENTS_PER_POINT), null);
  assert.equal(setCentsPerPoint(db, MAX_CENTS_PER_POINT), null);

  for (const bad of [-1, MAX_CHORE_POINTS + 1, 1.5]) {
    assert.equal(setChorePoints(db, 'ch-bin', bad), 'out_of_range', `accepted ${String(bad)}`);
  }
  assert.equal(setChorePoints(db, 'ch-bin', MIN_CHORE_POINTS), null, 'a chore may be worth zero');
  assert.equal(setChorePoints(db, 'nope', 5), 'not_found');
});

test('CHANGING THE RATE CANNOT CHANGE WHAT A PENDING REDEMPTION PAYS', () => {
  // The property, and it is not implemented by the route: `redemption_request` snapshots the
  // rate when the child ASKS, so she is paid what she was shown. Re-derived here because a
  // property nobody re-derives is a property somebody optimises away.
  const db = openTestDb();
  seed(db);
  db.prepare(
    `INSERT INTO child (id, display_name, reading_band, ledger_enabled, avatar_asset_id, sort_order, active)
     VALUES ('c1', 'A', 'fluent', 1, 'ic', 1, 1)`,
  ).run();
  db.prepare(
    `INSERT INTO redemption_request
       (child_id, points_requested, cents_per_point, cash_cents, state, requested_at_utc)
     VALUES ('c1', 40, 25, 1000, 'pending', '2026-09-10T01:00:00.000Z')`,
  ).run();

  assert.equal(setCentsPerPoint(db, 5), null);

  const row = db
    .prepare(`SELECT cents_per_point, cash_cents FROM redemption_request WHERE child_id = 'c1'`)
    .get() as { cents_per_point: number; cash_cents: number };
  assert.equal(row.cents_per_point, 25, 'the request keeps the rate it was made at');
  assert.equal(row.cash_cents, 1000, 'and the money it was shown');
});

test("CHANGING A CHORE'S POINTS CANNOT CHANGE WHAT TODAY PAYS", () => {
  // Same shape: `chore_day.points_each` is snapshotted at materialization, so an edit lands on
  // the next day materialized. That is why the route deliberately invalidates nothing.
  const db = openTestDb();
  seed(db);
  db.prepare(
    `INSERT INTO chore_day (chore_id, local_date, points_each, model, created_at_utc)
     VALUES ('ch-bin', '2026-09-10', 6, 'individual', '2026-09-10T00:00:00.000Z')`,
  ).run();

  assert.equal(setChorePoints(db, 'ch-bin', 20), null);

  const today = db
    .prepare(`SELECT points_each FROM chore_day WHERE chore_id = 'ch-bin'`)
    .get() as { points_each: number };
  assert.equal(today.points_each, 6, "today pays what it was worth this morning");
  assert.equal(readSettings(db).chores.find((c) => c.choreId === 'ch-bin')?.basePoints, 20);
});

test('the settings routes are on the ADMIN surface and nowhere else', () => {
  // The exchange rate of the whole economy. A child who could raise her own chore from 2 points
  // to 99 has been handed the ledger, so this is a route her screen cannot call rather than a
  // control it politely does not draw (CLAUDE.md: guardrails are architectural).
  const patterns = ['/api/admin/v1/settings', '/api/admin/v1/settings/cents-per-point',
                    '/api/admin/v1/settings/chores/:choreId', '/api/admin/v1/settings/departures'];
  for (const pattern of patterns) {
    const route = adminRoutes.find((r) => r.pattern === pattern);
    assert.ok(route, `${pattern} is missing from the admin table`);
    assert.equal(route.surface, 'admin', `${pattern} must demand the PIN`);
  }
  for (const route of wallRoutes) {
    assert.ok(
      !route.pattern.includes('/settings'),
      `the wall surface reaches settings at ${route.pattern}`,
    );
  }
});
