/**
 * Unit B acceptance, part 2 (build-plan.md §4): staging, promotion, and the failure paths.
 *
 * The scenario being defended against is H3 finding #7, verbatim: sync deletes the live
 * rows, the upstream 429s halfway, the table is now empty or partial, and rendering - which
 * has no cloud dependency and therefore no reason to complain - faithfully displays the
 * poisoned local state as "no events today". No error, no log, nobody awake.
 *
 * So every test below asks the same question in a different way: after this failure, is
 * yesterday's good generation still on the wall, whole?
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as Db } from 'better-sqlite3';

import { openDatabase, assertIntegrity } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { createHomeAssistantCalendar } from '../src/calendar/homeassistant/index.ts';
import {
  calendarHealth,
  failSyncRun,
  listPromotedEvents,
  promotedSyncAgeSeconds,
  promotedSyncRunId,
  pruneSyncRuns,
  stageAndPromote,
  syncAllSources,
  syncSource,
  openSyncRun,
} from '../src/calendar/sync.ts';
import type { CalendarSource, FetchedEvent, FetchWindow } from '../src/calendar/CalendarSource.ts';
import type { LocalDate, Utc } from '../src/types.ts';
import { readSettings } from '../src/domain/settings/index.ts';
import {
  fixtureServer,
  json,
  loadFixture,
  TEST_BASE_URL,
  TEST_TOKEN,
  type FixtureHandler,
} from './fixtures/calendar/fixture-ha.ts';

const HOUSEHOLD = 'calendar.household';
const CHILD_A = 'calendar.child_a';
const WINDOW: FetchWindow = {
  fromDate: '2026-02-01' as LocalDate,
  toDate: '2026-08-01' as LocalDate,
};

/**
 * A seeded database whose sources point at the fixture entities.
 *
 * `external_ref` is opaque to everything outside `src/calendar/homeassistant/`, so a test
 * is free to write whatever the adapter under test understands - which is exactly the
 * property ADR-0004 is protecting.
 */
function freshDb(path = ':memory:'): Db {
  const db = openDatabase({ path });
  migrate(db);
  seedDev(db);
  const point = db.prepare(`UPDATE calendar_source SET external_ref = ? WHERE id = ?`);
  point.run(HOUSEHOLD, 'cs-family');
  point.run(CHILD_A, 'cs-a');
  return db;
}

function calendarServing(handlers: Record<string, FixtureHandler>): CalendarSource {
  const server = fixtureServer(handlers);
  return createHomeAssistantCalendar(
    { HA_BASE_URL: TEST_BASE_URL, HA_TOKEN: TEST_TOKEN },
    { fetchImpl: server.fetchImpl, retries: 0, backoffMs: 0 },
  );
}

/** The everyday adapter: both seeded calendars answer with their recorded fixture. */
function healthyCalendar(): CalendarSource {
  const household = loadFixture('events.household.json');
  const childA = loadFixture('events.utc-misconfigured.json');
  return calendarServing({
    [`/api/calendars/${HOUSEHOLD}`]: () => json(household),
    [`/api/calendars/${CHILD_A}`]: () => json(childA),
  });
}

function runState(db: Db, syncRunId: number) {
  return db
    .prepare(`SELECT state, event_count, error, promoted_at_utc FROM sync_run WHERE id = ?`)
    .get(syncRunId) as {
    state: string;
    event_count: number | null;
    error: string | null;
    promoted_at_utc: string | null;
  };
}

function eventRows(db: Db, syncRunId: number): number {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM calendar_event WHERE sync_run_id = ?`)
    .get(syncRunId) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// The happy path
// ---------------------------------------------------------------------------

test('a sync stages a generation, promotes it, and the wall reads it back', async () => {
  const db = freshDb();
  const result = await syncSource(db, healthyCalendar(), 'cs-family', { window: WINDOW });

  assert.equal(result.ok, true);
  assert.ok(result.ok);
  assert.equal(result.eventCount, 5);

  const run = runState(db, result.syncRunId);
  assert.equal(run.state, 'promoted');
  assert.equal(run.event_count, 5);
  assert.ok(run.promoted_at_utc, 'a promoted run records when it went live');
  assert.equal(promotedSyncRunId(db, 'cs-family'), result.syncRunId);

  const events = listPromotedEvents(db, { sourceId: 'cs-family' });
  assert.equal(events.length, 5);
  assert.ok(events.every((e) => e.sourceId === 'cs-family'));
  assert.ok(events.every((e) => e.colourToken === 'blue'));
  assert.ok(events.every((e) => e.childId === null), 'the household calendar belongs to nobody');
  // For a pre-reader a missing icon IS a blank screen, so the URL is resolved at sync time.
  assert.ok(events.every((e) => e.icon.url.length > 0));

  assertIntegrity(db);
  db.close();
});

test('recorded fixtures land in the local tables with the right column set', async () => {
  const db = freshDb();
  await syncSource(db, healthyCalendar(), 'cs-family', { window: WINDOW });

  const allDay = db
    .prepare(
      `SELECT starts_at_utc, ends_at_utc, all_day_start_date, all_day_end_date
         FROM calendar_event WHERE title = 'Class photo'`,
    )
    .get() as Record<string, string | null>;
  assert.deepEqual(allDay, {
    starts_at_utc: null,
    ends_at_utc: null,
    all_day_start_date: '2026-02-12',
    all_day_end_date: '2026-02-13',
  });

  const timed = db
    .prepare(
      `SELECT starts_at_utc, ends_at_utc, all_day_start_date, all_day_end_date
         FROM calendar_event WHERE title = 'Practice'`,
    )
    .get() as Record<string, string | null>;
  assert.deepEqual(timed, {
    starts_at_utc: '2026-02-10T21:00:00.000Z',
    ends_at_utc: '2026-02-10T22:00:00.000Z',
    all_day_start_date: null,
    all_day_end_date: null,
  });

  db.close();
});

test('the UTC-misconfigured calendar occupies one local date per event once persisted', async () => {
  const db = freshDb();
  await syncSource(db, healthyCalendar(), 'cs-a', { window: WINDOW });

  const noSchool = db
    .prepare(
      `SELECT all_day_start_date AS s, all_day_end_date AS e, starts_at_utc AS t
         FROM calendar_event WHERE title = 'No school'`,
    )
    .get() as { s: string; e: string; t: string | null };

  assert.equal(noSchool.t, null, 'an all-day event carries no instant');
  assert.equal(noSchool.s, '2026-02-10');
  assert.equal(noSchool.e, '2026-02-11', 'the end is exclusive: exactly one local day');

  const view = listPromotedEvents(db, { sourceId: 'cs-a' }).find((e) => e.title === 'No school');
  assert.ok(view);
  assert.deepEqual(view.when, { kind: 'allDay', startDate: '2026-02-10', endDate: '2026-02-11' });
  assert.equal(view.childId, 'child-a');

  db.close();
});

test('an excluded source is neither synced nor read', async () => {
  const db = freshDb();
  db.prepare(`UPDATE calendar_source SET included = 0 WHERE id = 'cs-a'`).run();

  const results = await syncAllSources(db, healthyCalendar(), { window: WINDOW });
  assert.deepEqual(
    results.map((r) => r.sourceId),
    ['cs-family'],
  );

  // Even after a direct sync, an excluded source stays off the wall unless asked for.
  await syncSource(db, healthyCalendar(), 'cs-a', { window: WINDOW });
  assert.ok(listPromotedEvents(db).every((e) => e.sourceId === 'cs-family'));
  assert.ok(listPromotedEvents(db, { includeExcluded: true }).some((e) => e.sourceId === 'cs-a'));

  db.close();
});

// ---------------------------------------------------------------------------
// Failure - the previous generation must survive, whole
// ---------------------------------------------------------------------------

test('a fetch that fails midway leaves the previously promoted generation intact and readable', async () => {
  const db = freshDb();
  const household = loadFixture('events.household.json');

  // First call serves the recorded body; every call after it is a 502, which is exactly
  // what a Google-backed HA does when the upstream rate-limits mid-refresh.
  const flaky = calendarServing({
    [`/api/calendars/${HOUSEHOLD}`]: (_call, attempt) =>
      attempt === 1 ? json(household) : json({ message: 'Bad Gateway' }, 502),
  });

  const good = await syncSource(db, flaky, 'cs-family', { window: WINDOW });
  assert.ok(good.ok);

  const bad = await syncSource(db, flaky, 'cs-family', { window: WINDOW });
  assert.equal(bad.ok, false);
  assert.ok(!bad.ok);
  assert.match(bad.error, /HTTP 502/);

  // The failure is durable and legible...
  const failed = runState(db, bad.syncRunId);
  assert.equal(failed.state, 'failed');
  assert.match(failed.error ?? '', /HTTP 502/);
  assert.ok(!(failed.error ?? '').includes(TEST_TOKEN), 'the token never reaches the database');

  // ...and the wall is unchanged: same generation, same five events, still readable.
  assert.equal(promotedSyncRunId(db, 'cs-family'), good.syncRunId);
  assert.equal(listPromotedEvents(db, { sourceId: 'cs-family' }).length, 5);
  assert.equal(eventRows(db, good.syncRunId), 5, 'live rows are never deleted to make room');
  assertIntegrity(db);

  db.close();
});

test('a write that fails midway commits nothing and never moves the pointer', async () => {
  const db = freshDb();
  const first = await syncSource(db, healthyCalendar(), 'cs-family', { window: WINDOW });
  assert.ok(first.ok);

  // Fail on the THIRD row of the next generation: the interesting case is a generation
  // that is partly staged, not one that never started.
  db.exec(
    `CREATE TEMP TRIGGER trg_test_boom BEFORE INSERT ON calendar_event
       WHEN NEW.external_uid = 'evt-trip-0003'
     BEGIN SELECT RAISE(ABORT, 'simulated disk failure'); END;`,
  );

  const failed = await syncSource(db, healthyCalendar(), 'cs-family', { window: WINDOW });
  assert.equal(failed.ok, false);
  assert.ok(!failed.ok);
  assert.match(failed.error, /simulated disk failure/);

  assert.equal(eventRows(db, failed.syncRunId), 0, 'the partial generation rolled back in full');
  assert.equal(runState(db, failed.syncRunId).state, 'failed');
  assert.equal(promotedSyncRunId(db, 'cs-family'), first.syncRunId);
  assert.equal(listPromotedEvents(db, { sourceId: 'cs-family' }).length, 5);

  db.exec('DROP TRIGGER trg_test_boom');
  assertIntegrity(db);
  db.close();
});

test('a duplicate external_uid within one generation is rejected by the schema', async () => {
  const db = freshDb();
  const runId = openSyncRun(db, 'cs-family');

  const insert = db.prepare(
    `INSERT INTO calendar_event
       (sync_run_id, source_id, external_uid, title, all_day_start_date, all_day_end_date, icon_asset_id)
     VALUES (?, 'cs-family', 'dup-1', ?, '2026-02-12', '2026-02-13', 'ico-cal')`,
  );
  insert.run(runId, 'First');
  assert.throws(
    () => insert.run(runId, 'Second'),
    /UNIQUE/i,
    'one upstream event, one row per generation - a retried page once rendered a practice twice',
  );

  // And through the real path: a duplicated fetch result aborts the WHOLE generation
  // rather than promoting a list that renders one event twice.
  const clash: FetchedEvent[] = [
    { externalUid: 'x', title: 'One', when: { kind: 'timed', startsAtUtc: '2026-02-10T21:00:00.000Z' as Utc, endsAtUtc: '2026-02-10T22:00:00.000Z' as Utc } },
    { externalUid: 'x', title: 'Two', when: { kind: 'timed', startsAtUtc: '2026-02-11T21:00:00.000Z' as Utc, endsAtUtc: '2026-02-11T22:00:00.000Z' as Utc } },
  ];
  const secondRun = openSyncRun(db, 'cs-a');
  assert.throws(() => stageAndPromote(db, 'cs-a', secondRun, clash), /UNIQUE/i);
  assert.equal(eventRows(db, secondRun), 0);
  assert.equal(promotedSyncRunId(db, 'cs-a'), null, 'nothing was promoted');

  db.close();
});

test('syncAllSources keeps going when one calendar is down', async () => {
  const db = freshDb();
  const household = loadFixture('events.household.json');
  const partly = calendarServing({
    [`/api/calendars/${HOUSEHOLD}`]: () => json(household),
    [`/api/calendars/${CHILD_A}`]: () => json({ message: 'Internal Server Error' }, 500),
  });

  const results = await syncAllSources(db, partly, { window: WINDOW });
  assert.equal(results.length, 2);
  const bySource = new Map(results.map((r) => [r.sourceId, r]));
  assert.equal(bySource.get('cs-a')?.ok, false);
  assert.equal(bySource.get('cs-family')?.ok, true);

  // One unreachable calendar must not stop the other six from refreshing.
  assert.equal(listPromotedEvents(db, { sourceId: 'cs-family' }).length, 5);
  db.close();
});

// ---------------------------------------------------------------------------
// Health, for the grown-up Settings screen
// ---------------------------------------------------------------------------

test('calendar health says, per label, how the LATEST fetch went and when the wall last got a good one', async () => {
  const db = freshDb();
  assert.deepEqual(calendarHealth(db), [
    { label: 'Child A', last: 'never', triedAtUtc: null, goodAtUtc: null },
    { label: 'Household', last: 'never', triedAtUtc: null, goodAtUtc: null },
  ]);

  const good = await syncSource(db, healthyCalendar(), 'cs-family', { window: WINDOW });
  assert.ok(good.ok);
  const promotedAt = runState(db, good.syncRunId).promoted_at_utc;
  const afterGood = calendarHealth(db).find((h) => h.label === 'Household');
  assert.equal(afterGood?.last, 'ok');
  assert.equal(afterGood?.goodAtUtc, promotedAt);
  assert.ok(afterGood?.triedAtUtc);

  // A later attempt fails, quoting its upstream the way a real one can. The wall still shows the
  // good generation, and health says both halves: this fetch failed, the last good one was then.
  const leak = 'GET https://calendar.invalid/private/abc123/basic.ics returned 500';
  failSyncRun(db, openSyncRun(db, 'cs-family'), leak);
  const afterFail = calendarHealth(db).find((h) => h.label === 'Household');
  assert.equal(afterFail?.last, 'failed');
  assert.equal(afterFail?.goodAtUtc, promotedAt, 'the good generation is still the one on the wall');

  const running = openSyncRun(db, 'cs-a');
  assert.equal(calendarHealth(db).find((h) => h.label === 'Child A')?.last, 'running');
  failSyncRun(db, running, 'boom');

  // LABELS AND TIMES ONLY. Not the adapter's handle, not the upstream's words, not a title.
  const wire = JSON.stringify(readSettings(db).calendar);
  assert.deepEqual(readSettings(db).calendar.sources, calendarHealth(db));
  for (const secret of ['opaque-source-1', HOUSEHOLD, CHILD_A, 'https://', 'abc123', 'returned 500', 'boom']) {
    assert.equal(wire.includes(secret), false, `health leaked ${secret}`);
  }
  for (const event of listPromotedEvents(db, { sourceId: 'cs-family' })) {
    assert.equal(wire.includes(event.title), false, `health leaked an event title`);
  }

  // A calendar the household excluded is not the household's business on this screen.
  db.prepare(`UPDATE calendar_source SET included = 0 WHERE id = 'cs-a'`).run();
  assert.deepEqual(
    calendarHealth(db).map((h) => h.label),
    ['Household'],
  );
  db.close();
});

// ---------------------------------------------------------------------------
// Atomicity - a reader sees one generation or the other, never a mix
// ---------------------------------------------------------------------------

test('promotion is atomic: an independent reader sees the old generation whole, then the new one whole', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'fc-unit-b-'));
  const file = join(dir, 'wall.db');
  const writer = freshDb(file);

  const household = loadFixture('events.household.json');
  const shorter = (loadFixture('events.household.json') as unknown[]).slice(0, 2);
  const calls = { n: 0 };
  const calendar = calendarServing({
    [`/api/calendars/${HOUSEHOLD}`]: () => json(++calls.n === 1 ? household : shorter),
  });

  const first = await syncSource(writer, calendar, 'cs-family', { window: WINDOW });
  assert.ok(first.ok);

  // A second connection, on its own WAL snapshot - the wall's read path.
  const reader = openDatabase({ path: file, readonly: true });
  assert.equal(listPromotedEvents(reader, { sourceId: 'cs-family' }).length, 5);

  // Hold the commit open so the switch can be observed from outside while it is in flight.
  writer.exec('BEGIN IMMEDIATE');
  const second = await syncSource(writer, calendar, 'cs-family', { window: WINDOW });
  assert.ok(second.ok);
  assert.equal(second.eventCount, 2);

  assert.equal(
    listPromotedEvents(writer, { sourceId: 'cs-family' }).length,
    2,
    'precondition: the writer really has staged and switched, so the work is genuinely in flight',
  );
  const midFlight = listPromotedEvents(reader, { sourceId: 'cs-family' });
  assert.equal(midFlight.length, 5, 'the reader still sees the OLD generation');
  assert.deepEqual(
    new Set(midFlight.map((e) => e.title)).size,
    5,
    'and sees it whole - not five rows made of two generations',
  );

  writer.exec('COMMIT');

  const after = listPromotedEvents(reader, { sourceId: 'cs-family' });
  assert.equal(after.length, 2, 'and afterwards the NEW generation, also whole');
  assert.deepEqual(after.map((e) => e.title).sort(), ['Class photo', 'Practice']);

  reader.close();
  writer.close();
  rmSync(dir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Retention and freshness
// ---------------------------------------------------------------------------

test('retention prunes superseded generations and never the promoted one', async () => {
  const db = freshDb();
  const calendar = healthyCalendar();

  let last = await syncSource(db, calendar, 'cs-family', { window: WINDOW, retain: 2 });
  for (let i = 0; i < 5; i++) {
    last = await syncSource(db, calendar, 'cs-family', { window: WINDOW, retain: 2 });
  }
  assert.ok(last.ok);

  const runs = db
    .prepare(`SELECT id, state FROM sync_run WHERE source_id = 'cs-family' ORDER BY id`)
    .all() as { id: number; state: string }[];
  assert.equal(runs.length, 2, 'six syncs must not leave six generations on a filling disk');
  assert.ok(runs.some((r) => r.id === last.syncRunId && r.state === 'promoted'));

  // The wall still reads, and no orphaned events survived the cascade.
  assert.equal(listPromotedEvents(db, { sourceId: 'cs-family' }).length, 5);
  const orphans = db
    .prepare(
      `SELECT COUNT(*) AS n FROM calendar_event
        WHERE sync_run_id NOT IN (SELECT id FROM sync_run)`,
    )
    .get() as { n: number };
  assert.equal(orphans.n, 0);

  // The promoted generation is never a prune candidate, even at keep = 0.
  assert.equal(pruneSyncRuns(db, 'cs-family', 0), 1);
  assert.equal(promotedSyncRunId(db, 'cs-family'), last.syncRunId);
  assert.equal(listPromotedEvents(db, { sourceId: 'cs-family' }).length, 5);

  assertIntegrity(db);
  db.close();
});

test('freshness reports the STALEST included source, not the newest', async () => {
  const db = freshDb();
  assert.equal(promotedSyncAgeSeconds(db), null, 'nothing promoted yet');

  await syncAllSources(db, healthyCalendar(), { window: WINDOW });

  const now = new Date('2026-02-20T12:00:00.000Z');
  db.prepare(
    `UPDATE sync_run SET promoted_at_utc = '2026-02-20T11:59:00.000Z'
      WHERE id = (SELECT current_sync_run_id FROM calendar_source WHERE id = 'cs-family')`,
  ).run();
  db.prepare(
    `UPDATE sync_run SET promoted_at_utc = '2026-02-20T06:00:00.000Z'
      WHERE id = (SELECT current_sync_run_id FROM calendar_source WHERE id = 'cs-a')`,
  ).run();

  // Six fresh calendars and one frozen one is a stale wall. Reporting the newest would put
  // a green indicator on a calendar that has quietly stopped updating.
  assert.equal(promotedSyncAgeSeconds(db, now), 6 * 3600);

  db.prepare(`UPDATE calendar_source SET included = 0 WHERE id = 'cs-a'`).run();
  assert.equal(promotedSyncAgeSeconds(db, now), 60, 'an excluded source is not on the wall');

  db.close();
});
