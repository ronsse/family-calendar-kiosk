/**
 * Unit F — the leave-by rules: stored as one JSON row, read back with defaults, patched from
 * the wall.
 *
 * The properties here are about what a bad row or a bad request must NOT do: a hand-edited
 * row with one wrong field must not turn the alerts off, and a patch with one wrong field must
 * not land the rest of it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import {
  DEFAULT_DEPARTURE_RULES,
  DEPARTURES_KEY,
  MAX_LEAD_MINUTES,
  parseDepartureRules,
  readDepartureRules,
  updateDepartureRules,
} from '../src/domain/departures/index.ts';
import { readSettings } from '../src/domain/settings/index.ts';
import { buildSnapshot } from '../src/http/snapshot.ts';
import { adminRoutes } from '../src/http/routes.admin.ts';
import type { LocalDate } from '../src/types.ts';

function openTestDb(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

test('no row means the household’s defaults, and the feature is on', () => {
  const db = openTestDb();
  assert.deepEqual(readDepartureRules(db), DEFAULT_DEPARTURE_RULES);
  assert.equal(DEFAULT_DEPARTURE_RULES.enabled, true);
  assert.equal(DEFAULT_DEPARTURE_RULES.school.leaveAt, '07:35');
  assert.deepEqual(DEFAULT_DEPARTURE_RULES.school.days, ['MO', 'TU', 'WE', 'TH', 'FR']);
  assert.deepEqual(DEFAULT_DEPARTURE_RULES.eventCategories, ['dance', 'sport']);
});

test('a row with one bad field falls back for THAT field, never to no alerts', () => {
  const rules = parseDepartureRules(
    JSON.stringify({
      enabled: 'yes',
      readyMinutes: 30,
      travelMinutes: 999,
      school: { leaveAt: '7:35', days: ['MO', 'XX', 'MO', 'FR'], label: '  ' },
      eventCategories: ['dance', 'lottery', 'dance'],
    }),
  );
  assert.equal(rules.enabled, true);
  assert.equal(rules.readyMinutes, 30);
  assert.equal(rules.travelMinutes, DEFAULT_DEPARTURE_RULES.travelMinutes);
  assert.equal(rules.school.leaveAt, '07:35');
  assert.deepEqual(rules.school.days, ['MO', 'FR']);
  assert.equal(rules.school.label, 'School');
  assert.deepEqual(rules.eventCategories, ['dance']);
  // Not JSON at all, or JSON of the wrong shape: the defaults entire.
  assert.deepEqual(parseDepartureRules('{nope'), DEFAULT_DEPARTURE_RULES);
  assert.deepEqual(parseDepartureRules('[1,2]'), DEFAULT_DEPARTURE_RULES);
  assert.deepEqual(parseDepartureRules(null), DEFAULT_DEPARTURE_RULES);
});

test('a patch lands whole or not at all', () => {
  const db = openTestDb();
  const ok = updateDepartureRules(db, { enabled: false, readyMinutes: 25, schoolLeaveAt: '07:40' });
  assert.equal(ok.ok, true);
  const stored = readDepartureRules(db);
  assert.equal(stored.enabled, false);
  assert.equal(stored.readyMinutes, 25);
  assert.equal(stored.school.leaveAt, '07:40');
  assert.equal(stored.travelMinutes, DEFAULT_DEPARTURE_RULES.travelMinutes);

  assert.deepEqual(updateDepartureRules(db, { enabled: true, travelMinutes: MAX_LEAD_MINUTES + 1 }), {
    ok: false,
    reason: 'out_of_range',
  });
  assert.deepEqual(updateDepartureRules(db, { enabled: true, schoolLeaveAt: '25:00' }), {
    ok: false,
    reason: 'bad_value',
  });
  assert.deepEqual(updateDepartureRules(db, { readyMinutes: 2.5 }), { ok: false, reason: 'bad_value' });
  // Neither refusal wrote the `enabled: true` beside the bad field.
  assert.equal(readDepartureRules(db).enabled, false);
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM household_config WHERE key = ?`).get(DEPARTURES_KEY) as { n: number }).n,
    1,
  );
});

test('the rules ride in the snapshot and in the settings, and the route is admin-only', () => {
  const db = openTestDb();
  updateDepartureRules(db, { readyMinutes: 15 });
  const snap = buildSnapshot(db, '2026-09-15' as LocalDate);
  assert.equal(snap.departures.readyMinutes, 15);
  assert.equal(readSettings(db).departures.readyMinutes, 15);
  const route = adminRoutes.find((r) => r.pattern === '/api/admin/v1/settings/departures');
  assert.ok(route);
  assert.equal(route.surface, 'admin');
  assert.equal(route.method, 'POST');
});
