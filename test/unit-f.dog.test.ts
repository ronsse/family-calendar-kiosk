/**
 * Unit F — the dog's week.  The Easter egg behind the dog in the picture.
 *
 * Small on purpose, and the tests pin the two things that make it safe to leave ungated: the
 * list is a pure function of the calendar (so no row anywhere can be corrupted into a wrong
 * list), and the only write is a tick that the same tap undoes.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { issueDeviceToken } from '../src/http/auth.ts';
import { createWallServer } from '../src/http/server.ts';
import { buildSnapshot } from '../src/http/snapshot.ts';
import { DEED_POOL, DEEDS_PER_WEEK, dogWeek, setDogDeed, weekDeeds } from '../src/domain/dog/index.ts';
import { isoWeekKey } from '../src/time.ts';
import { DEFAULT_HOUSEHOLD, writeHousehold } from '../src/config/household.ts';
import type { LocalDate, Utc } from '../src/types.ts';

const TUESDAY = '2026-09-15' as LocalDate;
const NOW = '2026-09-15T20:00:00Z' as Utc;

/** The dog's week exists only for a household with a pet (2026-10-12); these tests have one. */
function withPet(db: ReturnType<typeof openDatabase>): void {
  writeHousehold(db, { ...DEFAULT_HOUSEHOLD, pets: [{ id: 'dog', kind: 'dog', name: 'Biscuit' }] });
}

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

// ---------------------------------------------------------------------------
// The week key
// ---------------------------------------------------------------------------

test('ISO weeks: Monday starts them, and the year boundary follows the Thursday', () => {
  assert.equal(isoWeekKey('2026-09-14' as LocalDate), '2026-W38');
  assert.equal(isoWeekKey('2026-09-15' as LocalDate), '2026-W38');
  assert.equal(isoWeekKey('2026-09-20' as LocalDate), '2026-W38', 'Sunday closes the week');
  assert.equal(isoWeekKey('2026-09-21' as LocalDate), '2026-W39');
  assert.equal(isoWeekKey('2027-01-01' as LocalDate), '2026-W53', 'a Friday still in the old ISO year');
  assert.equal(isoWeekKey('2027-01-04' as LocalDate), '2027-W01');
  assert.equal(isoWeekKey('2024-12-30' as LocalDate), '2025-W01', 'a Monday already in the new one');
});

// ---------------------------------------------------------------------------
// The draw
// ---------------------------------------------------------------------------

test('the pool has distinct ids and enough deeds that a week is a real choice', () => {
  const ids = new Set(DEED_POOL.map((d) => d.id));
  assert.equal(ids.size, DEED_POOL.length);
  assert.ok(DEED_POOL.length >= DEEDS_PER_WEEK * 4, 'four weeks could each be fresh');
  for (const d of DEED_POOL) {
    assert.match(d.id, /^[a-z0-9-]{1,40}$/, `${d.id} must be a slug the route accepts`);
    assert.ok(d.label.length <= 24, `"${d.label}" is too long for a two-column sheet`);
  }
});

test('a week draws the same deeds every time, and two weeks differ', () => {
  const a = weekDeeds('2026-W38');
  const b = weekDeeds('2026-W38');
  const c = weekDeeds('2026-W39');
  assert.equal(a.length, DEEDS_PER_WEEK);
  assert.deepEqual(a.map((d) => d.id), b.map((d) => d.id));
  assert.equal(new Set(a.map((d) => d.id)).size, DEEDS_PER_WEEK, 'no deed twice in a week');
  assert.notDeepEqual(a.map((d) => d.id), c.map((d) => d.id));
});

test('the draw is well spread: over a year every deed comes up at least once', () => {
  const seen = new Set<string>();
  for (let w = 1; w <= 52; w++) {
    for (const d of weekDeeds(`2026-W${String(w).padStart(2, '0')}`)) seen.add(d.id);
  }
  assert.equal(seen.size, DEED_POOL.length, `${String(DEED_POOL.length - seen.size)} deeds never drawn`);
});

// ---------------------------------------------------------------------------
// Ticks
// ---------------------------------------------------------------------------

test('a fresh database has this week’s list with nothing ticked', () => {
  const db = fresh();
  const week = dogWeek(db, TUESDAY);
  assert.equal(week.week, '2026-W38');
  assert.equal(week.deeds.length, DEEDS_PER_WEEK);
  assert.ok(week.deeds.every((d) => d.done === false));
  assert.deepEqual(
    week.deeds.map((d) => d.id),
    weekDeeds('2026-W38').map((d) => d.id),
    'the same draw the client would compute',
  );
  db.close();
});

test('a tick is a row, the same tap undoes it, and repeating either is a quiet no-op', () => {
  const db = fresh();
  const first = dogWeek(db, TUESDAY).deeds[0]!;
  assert.deepEqual(setDogDeed(db, { week: '2026-W38', deedId: first.id, done: true }, TUESDAY, NOW), {
    ok: true,
    changed: true,
  });
  assert.equal(dogWeek(db, TUESDAY).deeds[0]?.done, true);
  assert.deepEqual(setDogDeed(db, { week: '2026-W38', deedId: first.id, done: true }, TUESDAY, NOW), {
    ok: true,
    changed: false,
  });
  assert.deepEqual(setDogDeed(db, { week: '2026-W38', deedId: first.id, done: false }, TUESDAY, NOW), {
    ok: true,
    changed: true,
  });
  assert.equal(dogWeek(db, TUESDAY).deeds[0]?.done, false);
  assert.deepEqual(setDogDeed(db, { week: '2026-W38', deedId: first.id, done: false }, TUESDAY, NOW), {
    ok: true,
    changed: false,
  });
  db.close();
});

test('a tick from a stale sheet, or for a deed not on this week’s list, is refused', () => {
  const db = fresh();
  const thisWeek = new Set(weekDeeds('2026-W38').map((d) => d.id));
  const absent = DEED_POOL.find((d) => !thisWeek.has(d.id))!;
  const present = weekDeeds('2026-W38')[0]!;
  assert.deepEqual(
    setDogDeed(db, { week: '2026-W37', deedId: present.id, done: true }, TUESDAY, NOW),
    { ok: false, reason: 'not_this_week' },
  );
  assert.deepEqual(setDogDeed(db, { week: '2026-W38', deedId: absent.id, done: true }, TUESDAY, NOW), {
    ok: false,
    reason: 'unknown_deed',
  });
  assert.deepEqual(setDogDeed(db, { week: '2026-W38', deedId: 'eat-the-cat', done: true }, TUESDAY, NOW), {
    ok: false,
    reason: 'unknown_deed',
  });
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM dog_deed_done`).get() as { n: number }).n, 0);
  db.close();
});

test('last week’s ticks stay in the table and out of this week’s list', () => {
  const db = fresh();
  const lastWeek = weekDeeds('2026-W37')[0]!;
  setDogDeed(db, { week: '2026-W37', deedId: lastWeek.id, done: true }, '2026-09-10' as LocalDate, NOW);
  const week = dogWeek(db, TUESDAY);
  assert.ok(week.deeds.every((d) => d.done === false));
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM dog_deed_done`).get() as { n: number }).n,
    1,
    'history is kept — nothing on the wall can delete it',
  );
  db.close();
});

test('the snapshot carries the dog’s week for the client’s date', () => {
  const db = fresh();
  seedDev(db);
  withPet(db);
  const snap = buildSnapshot(db, TUESDAY, {});
  assert.equal(snap.dog?.week, '2026-W38');
  assert.equal(snap.dog?.deeds.length, DEEDS_PER_WEEK);
  db.close();
});

// ---------------------------------------------------------------------------
// The route
// ---------------------------------------------------------------------------

async function startServer() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  withPet(db);
  const device = issueDeviceToken(db, 'test-kiosk');
  const invalidated: string[] = [];
  const wall = createWallServer({
    db,
    logger: () => {},
    heartbeatMs: 60_000,
    clock: () => new Date('2026-09-15T20:00:00Z'),
  });
  const addr = await wall.listen(0);
  const base = `http://127.0.0.1:${String(addr.port)}`;
  return {
    db,
    base,
    invalidated,
    post: (deedId: string, body: unknown, token: string | null = device.token) =>
      fetch(`${base}/api/wall/v1/dog/deeds/${deedId}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          ...(token === null ? {} : { authorization: `Device ${token}` }),
        },
        body: JSON.stringify(body),
      }),
    stop: async () => {
      await wall.close();
      db.close();
    },
  };
}

test('the wall can tick a deed with no child and no PIN, and untick it with the same route', async () => {
  const h = await startServer();
  const deed = weekDeeds('2026-W38')[0]!;
  let res = await h.post(deed.id, { week: '2026-W38', done: true });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, changed: true });
  assert.equal(dogWeek(h.db, TUESDAY).deeds[0]?.done, true);

  res = await h.post(deed.id, { week: '2026-W38', done: false });
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { ok: true, changed: true });
  assert.equal(dogWeek(h.db, TUESDAY).deeds[0]?.done, false);
  await h.stop();
});

test('a stale week, a made-up deed and a missing token are each refused with a child-safe code', async () => {
  const h = await startServer();
  const deed = weekDeeds('2026-W38')[0]!;
  let res = await h.post(deed.id, { week: '2026-W37', done: true });
  assert.equal(res.status, 409);
  assert.equal(((await res.json()) as { error: string }).error, 'not_claimable');

  res = await h.post('eat-the-cat', { week: '2026-W38', done: true });
  assert.equal(res.status, 409);

  res = await h.post('../../etc', { week: '2026-W38', done: true });
  assert.ok(res.status === 404 || res.status === 409, `got ${String(res.status)}`);

  res = await h.post(deed.id, { week: '2026-W38', done: true }, null);
  assert.ok(res.status === 401 || res.status === 403, `got ${String(res.status)}`);
  assert.equal(
    (h.db.prepare(`SELECT COUNT(*) AS n FROM dog_deed_done`).get() as { n: number }).n,
    0,
  );
  await h.stop();
});
