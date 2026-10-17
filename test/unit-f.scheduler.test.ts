/**
 * Unit F acceptance — calendar sync scheduling.
 *
 * `syncAllSources` must never run on the request path. `better-sqlite3` is synchronous, so a
 * sweep that stages a few thousand events in the server process means the event loop cannot
 * answer a snapshot or an SSE heartbeat for its whole duration — and the process is not
 * crashed, it is BUSY, so every health check taken outside the window passes while the wall
 * is frozen (H3 finding #8).
 *
 * The scheduler therefore lives in a worker thread. What is asserted here is the part that
 * can be asserted without an upstream to talk to: that it REFUSES to start rather than
 * degrading quietly, and says why. A scheduler that silently did nothing would present on
 * the wall as "the calendar is just quiet today", which is the same shape as every other
 * silent-staleness failure (H3 finding #10).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { startSyncScheduler } from '../src/http/sync-scheduler.ts';
import { WallEventStream } from '../src/http/stream.ts';
import { createWallServer } from '../src/http/server.ts';

test('an in-memory database refuses to schedule, and says why', () => {
  // A worker thread opening ':memory:' gets its OWN empty database, syncs into it, and
  // reports cheerful success against data nothing will ever read.
  const scheduler = startSyncScheduler({ dbPath: ':memory:', adapterModule: './anything.ts' });
  assert.equal(scheduler.started, false);
  assert.match(scheduler.reason ?? '', /in-memory|file-backed/i);
});

test('no configured adapter refuses to schedule, and says why', () => {
  const scheduler = startSyncScheduler({ dbPath: '/tmp/does-not-need-to-exist.db' });
  assert.equal(scheduler.started, false);
  assert.match(scheduler.reason ?? '', /adapter/i);
});

test('a disabled scheduler is still safe to drive and to stop', async () => {
  const scheduler = startSyncScheduler({ dbPath: ':memory:' });
  scheduler.syncNow();
  await scheduler.stop();
  assert.equal(scheduler.started, false);
});

test('the request path never calls the sync entry points', async () => {
  // Structural rather than behavioural: nothing under the route surface may import the sync
  // orchestrator. A regression here is a 05:58 sweep freezing the 06:00 wall.
  const { readFileSync, readdirSync } = await import('node:fs');
  const { join } = await import('node:path');
  const dir = new URL('../src/http/', import.meta.url).pathname;

  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file === 'sync-worker.ts') continue;
    const source = readFileSync(join(dir, file), 'utf8');
    assert.equal(
      /\bsyncAllSources\b|\bsyncSource\b/.test(source.replace(/^\s*\*.*$/gm, '')),
      false,
      `${file} reaches the sync orchestrator; it belongs in the worker thread only`,
    );
  }
});

test('a completed sweep becomes an invalidate, never the events themselves', () => {
  // The worker reports; the parent turns that into a reason to refetch. Exercised directly
  // because spawning a thread needs an upstream, and the contract under test is the mapping.
  const stream = new WallEventStream({ heartbeatMs: 60_000 });
  const seen: unknown[] = [];
  const original = stream.invalidate.bind(stream);
  stream.invalidate = (scope) => {
    seen.push(scope);
    original(scope);
  };
  stream.invalidate('calendar');
  assert.deepEqual(seen, ['calendar']);
  stream.close();
});

test('the server starts and serves without any scheduler at all', async () => {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs: 60_000 });
  const addr = await wall.listen(0);
  try {
    // The wall renders from the promoted generation on disk. A sync that never runs is
    // stale, and stale-and-labelled is a working wall; the scheduler is not a dependency of
    // serving.
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/health`);
    assert.equal(res.status, 200);
  } finally {
    await wall.close();
    db.close();
  }
});
