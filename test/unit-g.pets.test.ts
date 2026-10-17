/**
 * Unit G — pets are optional (2026-10-12).
 *
 * The dog's week used to be on every snapshot. It now hangs off `household.pets`: with none (the
 * default) the snapshot says `dog: null` and the deeds route refuses, in the same child-safe words
 * as any card that cannot change; with one, everything is exactly as it was.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { issueDeviceToken } from '../src/http/auth.ts';
import { createWallServer } from '../src/http/server.ts';
import { buildSnapshot } from '../src/http/snapshot.ts';
import { DEFAULT_HOUSEHOLD, writeHousehold } from '../src/config/household.ts';
import { DEEDS_PER_WEEK, dogWeek, petEnabled, petName, weekDeeds } from '../src/domain/dog/index.ts';
import type { LocalDate } from '../src/types.ts';

const TUESDAY = '2026-09-15' as LocalDate;
const WEEK = '2026-W38';
const ONE_DOG = { ...DEFAULT_HOUSEHOLD, pets: [{ id: 'dog', kind: 'dog' as const, name: 'Biscuit' }] };

function seeded() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

async function startServer(db: ReturnType<typeof openDatabase>) {
  const device = issueDeviceToken(db, 'test-kiosk');
  const wall = createWallServer({
    db,
    logger: () => {},
    heartbeatMs: 60_000,
    clock: () => new Date('2026-09-15T20:00:00Z'),
  });
  const addr = await wall.listen(0);
  const base = `http://127.0.0.1:${String(addr.port)}`;
  return {
    post: (deedId: string, body: unknown) =>
      fetch(`${base}/api/wall/v1/dog/deeds/${deedId}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Device ${device.token}` },
        body: JSON.stringify(body),
      }),
    stop: async () => {
      await wall.close();
    },
  };
}

const ticks = (db: ReturnType<typeof openDatabase>) =>
  (db.prepare(`SELECT COUNT(*) AS n FROM dog_deed_done`).get() as { n: number }).n;

test('no pets row: no pet, no name, and the snapshot carries dog: null', () => {
  const db = seeded();
  assert.equal(petEnabled(db), false);
  assert.equal(petName(db), null);
  const snap = buildSnapshot(db, TUESDAY, {});
  assert.equal(snap.dog, null);
  assert.deepEqual(snap.household.pets, []);
  db.close();
});

test('one pet: the snapshot carries the week exactly as before, and the name rides in household', () => {
  const db = seeded();
  writeHousehold(db, ONE_DOG);
  assert.equal(petEnabled(db), true);
  assert.equal(petName(db), 'Biscuit');
  const snap = buildSnapshot(db, TUESDAY, {});
  assert.deepEqual(snap.dog, dogWeek(db, TUESDAY), 'byte-identical to the unconditional week');
  assert.equal(snap.dog?.deeds.length, DEEDS_PER_WEEK);
  assert.deepEqual(snap.household.pets, [{ id: 'dog', name: 'Biscuit' }]);
  db.close();
});

test('no pet: ticking a deed is refused as not_claimable and writes nothing', async () => {
  const db = seeded();
  const h = await startServer(db);
  try {
    const deed = weekDeeds(WEEK)[0]!;
    const res = await h.post(deed.id, { week: WEEK, done: true });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, 'not_claimable');
    // Refused before the body is read: even a malformed body gets the same child-safe answer.
    const bad = await h.post(deed.id, { done: true });
    assert.equal(bad.status, 409);
    assert.equal(((await bad.json()) as { error: string }).error, 'not_claimable');
    assert.equal(ticks(db), 0);
  } finally {
    await h.stop();
    db.close();
  }
});

test('a pet added at runtime reaches the route on the next request, and the tick lands', async () => {
  const db = seeded();
  const h = await startServer(db);
  try {
    const deed = weekDeeds(WEEK)[0]!;
    assert.equal((await h.post(deed.id, { week: WEEK, done: true })).status, 409);
    writeHousehold(db, ONE_DOG);
    const res = await h.post(deed.id, { week: WEEK, done: true });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true, changed: true });
    assert.equal(ticks(db), 1);
    assert.equal(buildSnapshot(db, TUESDAY, {}).dog?.deeds.find((d) => d.id === deed.id)?.done, true);
  } finally {
    await h.stop();
    db.close();
  }
});
