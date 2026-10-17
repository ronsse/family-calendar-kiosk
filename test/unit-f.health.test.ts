/**
 * Unit F acceptance — `/api/health`, and the one thing it must prove.
 *
 * The finding this file exists for (H1 lens 4): a TRIVIAL write still succeeds on a database
 * that has almost no room left, while the real 06:00 materialization hits `SQLITE_FULL`. A
 * probe that touches one row therefore reports green, `kiosk-gate.py` believes it, and the
 * gate keeps a doomed tab up until a child is standing in front of it.
 *
 * So the central test constrains the database with `PRAGMA max_page_count` until it is in
 * exactly that state, and asserts BOTH halves: the one-row touch still succeeds, and the
 * real probe still says no.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { probeDbWritable, probeHealth, probeReadable } from '../src/http/health.ts';
import { createWallServer } from '../src/http/server.ts';

function tempDb(): { path: string; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'unit-f-health-'));
  return { path: join(dir, 'wall.db'), cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test('a healthy database reports ok and writable', () => {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const report = probeHealth(db);
  assert.equal(report.ok, true);
  assert.equal(report.dbWritable, true);
  assert.match(report.generatedAtUtc, /^\d{4}-\d{2}-\d{2}T/);
  db.close();
});

test('the probe leaves nothing behind: every row it writes is rolled back', () => {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const before = db.prepare(`SELECT COUNT(*) AS n FROM household_config`).get() as { n: number };

  for (let i = 0; i < 5; i++) assert.equal(probeDbWritable(db), true);

  const after = db.prepare(`SELECT COUNT(*) AS n FROM household_config`).get() as { n: number };
  assert.equal(after.n, before.n);
  const leaked = db
    .prepare(`SELECT COUNT(*) AS n FROM household_config WHERE key LIKE '__health_probe%'`)
    .get() as { n: number };
  assert.equal(leaked.n, 0);
  db.close();
});

test('a trivial write succeeds where the real morning would not — and the probe says no', () => {
  const { path, cleanup } = tempDb();
  const db = openDatabase({ path });
  try {
    migrate(db);
    seedDev(db);

    // Squeeze the file down to almost no headroom. This is a 95%-full disk, made
    // deterministic: SQLite refuses to allocate past `max_page_count` with SQLITE_FULL,
    // which is the same error a full filesystem produces.
    const pages = db.pragma('page_count', { simple: true }) as number;
    db.pragma(`max_page_count = ${pages + 2}`);

    // The naive probe — a one-row touch. It still succeeds, which is precisely the trap:
    // green here, and a blank wall at 06:00.
    db.prepare(`INSERT INTO household_config (key, value_text) VALUES ('probe-naive','x')`).run();

    // The real probe allocates like first-materialization of the day does, and refuses.
    assert.equal(
      probeDbWritable(db),
      false,
      'a probe that reports green on a database this tight is the H1 lens 4 failure',
    );

    // And it is still READABLE, which is a different fact with a different consequence: an
    // already-materialized day renders from here, stale and labelled.
    assert.equal(probeReadable(db), true);
    const report = probeHealth(db);
    assert.equal(report.ok, true);
    assert.equal(report.dbWritable, false);
  } finally {
    db.close();
    cleanup();
  }
});

test('a read-only connection reports dbWritable false rather than throwing or lying', () => {
  const { path, cleanup } = tempDb();
  const writer = openDatabase({ path });
  migrate(writer);
  seedDev(writer);
  writer.close();

  const db = openDatabase({ path, readonly: true });
  try {
    // Never throws. A health endpoint that throws is a health endpoint the gate cannot read,
    // and an unreadable gate keeps whatever was on screen.
    const report = probeHealth(db);
    assert.equal(report.dbWritable, false);
    assert.equal(report.ok, true, 'read-only is degraded, not dead: today may still render');
  } finally {
    db.close();
    cleanup();
  }
});

test('a probe inside someone else’s transaction refuses rather than joining it', () => {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  db.transaction(() => {
    // A nested BEGIN would either fail or, far worse, commit the probe rows along with the
    // caller's work.
    assert.equal(probeDbWritable(db), false);
  }).immediate();
  db.close();
});

test('/api/health needs no credential, and is not on the wall surface', async () => {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs: 60_000 });
  const addr = await wall.listen(0);
  try {
    // `kiosk-gate.py` probes this path, not `/`, and it holds no device token.
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.deepEqual(Object.keys(body).sort(), ['dbWritable', 'generatedAtUtc', 'ok']);
    assert.equal(body['ok'], true);
    assert.equal(body['dbWritable'], true);

    const wrongMethod = await fetch(`http://127.0.0.1:${addr.port}/api/health`, { method: 'POST' });
    assert.equal(wrongMethod.status, 404);
  } finally {
    await wall.close();
    db.close();
  }
});

test('health still answers when the database has gone away', async () => {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs: 60_000 });
  const addr = await wall.listen(0);
  try {
    db.close();
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
    assert.equal(res.status, 200, 'the gate must always get a parseable answer');
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['ok'], false);
    assert.equal(body['dbWritable'], false);
  } finally {
    await wall.close();
  }
});
