/**
 * Households that are not three children with everything on (2026-10-12).
 *
 * Three shapes, each pinned at the snapshot because that is the one read the wall renders from:
 *   (a) a household that turned chores and money OFF ships those lists empty, and keeps routines;
 *   (b) one child — the committed solo example — gets one balance and one streak, not three;
 *   (c) no children at all — the committed nokids example — still answers the snapshot ROUTE
 *       with 200, so the wall draws a calendar instead of an error.
 *
 * The example files reference baseline asset ids (av-a, ico-cake…). On the real wall those rows
 * are registered from assets/manifest.json at boot, before any household file is applied; the
 * test does the same thing from the same manifest, so an id the manifest drops fails here.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { localDate } from '../src/time.ts';
import type { LocalDate, WallSnapshot } from '../src/types.ts';
import { DEFAULT_HOUSEHOLD, writeHousehold } from '../src/config/household.ts';
import { issueDeviceToken } from '../src/http/auth.ts';
import { createWallServer } from '../src/http/server.ts';
import { buildSnapshot } from '../src/http/snapshot.ts';

/** A Monday, so the weekday morning routine is on, and inside the horizon of both countdowns. */
const MONDAY = '2026-11-30' as LocalDate;

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

/** What entry/main.ts does at boot: every baseline asset id the manifest declares. */
function registerManifestAssets(db: Db): void {
  const manifest = JSON.parse(readFileSync('assets/manifest.json', 'utf8')) as {
    assets: { id: string; kind: string; category: string; rel_path: string; fallbackFor?: string }[];
  };
  const asset = db.prepare(
    `INSERT INTO asset (id, kind, category, rel_path, validated_at_utc)
     VALUES (?, ?, ?, ?, '2026-01-01T00:00:00Z') ON CONFLICT DO NOTHING`,
  );
  const fallback = db.prepare(
    `INSERT INTO asset_fallback (category, asset_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
  );
  for (const a of manifest.assets) {
    asset.run(a.id, a.kind, a.category, a.rel_path);
    if (a.fallbackFor) fallback.run(a.fallbackFor, a.id);
  }
}

function withExample(file: string): Db {
  const db = fresh();
  registerManifestAssets(db);
  db.exec(readFileSync(file, 'utf8'));
  return db;
}

test('(a) chores and money OFF: those lists ship empty, routines stay', () => {
  const db = fresh();
  try {
    seedDev(db);
    writeHousehold(db, {
      ...DEFAULT_HOUSEHOLD,
      features: { chores: false, money: false, routines: true, countdowns: true },
    });
    const snap = buildSnapshot(db, MONDAY);
    assert.deepEqual(snap.chores, []);
    assert.deepEqual(snap.streaks, []);
    assert.deepEqual(snap.balances, []);
    assert.deepEqual(snap.redemptions, []);
    assert.ok(snap.routines.length > 0, 'routines are still on');
    assert.ok(snap.children.length > 0, 'the children are still there');
    assert.equal(snap.household.features.chores, false);

    // Turning them back on loses nothing: the materializer ran while they were off.
    writeHousehold(db, DEFAULT_HOUSEHOLD);
    const back = buildSnapshot(db, MONDAY);
    assert.ok(back.chores.length > 0);
    assert.equal(back.balances.length, back.children.length);
  } finally {
    db.close();
  }
});

test('(a2) routines and countdowns OFF ship empty too', () => {
  const db = fresh();
  try {
    seedDev(db);
    writeHousehold(db, {
      ...DEFAULT_HOUSEHOLD,
      features: { chores: true, money: true, routines: false, countdowns: false },
    });
    const snap = buildSnapshot(db, MONDAY);
    assert.deepEqual(snap.routines, []);
    assert.deepEqual(snap.countdowns, []);
    assert.ok(snap.chores.length > 0);
  } finally {
    db.close();
  }
});

test('(b) the solo example: one child, one balance, one streak, no picture without an asset root', () => {
  const db = withExample('db/household.solo.example.sql');
  try {
    const snap = buildSnapshot(db, MONDAY, { assetRoot: undefined });
    assert.equal(snap.children.length, 1);
    assert.equal(snap.children[0]?.id, 'child-a');
    assert.equal(snap.balances.length, 1);
    assert.equal(snap.streaks.length, 1);
    assert.equal(snap.scene, null);
    assert.ok(snap.routines.length > 0);
    // No rotation roster: every chore is hers, and nothing is dealt to a child who is not there.
    assert.ok(snap.chores.length > 0);
    assert.ok(snap.chores.every((c) => c.childId === 'child-a'), 'every chore is the one child\'s');
  } finally {
    db.close();
  }
});

test('(c) the nokids example: no children, no balances, two countdowns, and the ROUTE answers 200', async () => {
  const db = withExample('db/household.nokids.example.sql');
  const snap = buildSnapshot(db, MONDAY);
  assert.deepEqual(snap.children, []);
  assert.deepEqual(snap.balances, []);
  assert.deepEqual(snap.streaks, []);
  assert.deepEqual(snap.routines, []);
  assert.deepEqual(snap.chores, []);
  assert.equal(snap.countdowns.length, 2);

  const { token } = issueDeviceToken(db, 'test-kiosk');
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs: 60_000 });
  const addr = await wall.listen(0);
  try {
    const res = await fetch(
      `http://127.0.0.1:${String(addr.port)}/api/wall/v1/snapshot?localDate=${localDate()}`,
      { headers: { Authorization: `Device ${token}` } },
    );
    assert.equal(res.status, 200);
    const body = (await res.json()) as WallSnapshot;
    assert.deepEqual(body.children, []);
    assert.deepEqual(body.balances, []);
  } finally {
    await wall.close();
    db.close();
  }
});
