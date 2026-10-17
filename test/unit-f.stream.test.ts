/**
 * Unit F acceptance — SSE.
 *
 * The property under test is a negative one: this channel CARRIES NO STATE. It emits a
 * reason to refetch and nothing else, because a client that can learn a fact from a push has
 * a second source of truth to diverge from the snapshot — and the snapshot is the only read
 * that is ever authoritative (H3 finding #4).
 *
 * The heartbeat is not keepalive decoration either. It carries `minClientBuild`, and it is
 * sent immediately on connect, so a bundle that has been in memory for months hard-reloads
 * BEFORE it parses a shape it does not understand (H3 finding #9).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { localDate } from '../src/time.ts';
import type { WallEvent, WallSnapshot } from '../src/types.ts';
import { issueDeviceToken } from '../src/http/auth.ts';
import { createWallServer, type WallServer } from '../src/http/server.ts';

interface Harness {
  db: Db;
  wall: WallServer;
  base: string;
  token: string;
  stop: () => Promise<void>;
}

async function start(heartbeatMs = 60_000): Promise<Harness> {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const { token } = issueDeviceToken(db, 'test-kiosk');
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs });
  const addr = await wall.listen(0);
  return {
    db,
    wall,
    base: `http://127.0.0.1:${addr.port}`,
    token,
    stop: async () => {
      await wall.close();
      db.close();
    },
  };
}

/** Frames a `text/event-stream` body into the `WallEvent`s it carries. */
async function* events(body: ReadableStream<Uint8Array>): AsyncGenerator<WallEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) return;
    buffer += decoder.decode(value, { stream: true });
    let split = buffer.indexOf('\n\n');
    while (split !== -1) {
      const frame = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const data = frame
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).trim())
        .join('\n');
      if (data.length > 0) yield JSON.parse(data) as WallEvent;
      split = buffer.indexOf('\n\n');
    }
  }
}

async function connect(
  h: Harness,
  signal: AbortSignal,
): Promise<AsyncGenerator<WallEvent>> {
  const res = await fetch(`${h.base}/api/wall/v1/stream`, {
    headers: { Authorization: `Device ${h.token}` },
    signal,
  });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type') ?? '', /text\/event-stream/);
  assert.ok(res.body);
  return events(res.body);
}

async function next(stream: AsyncGenerator<WallEvent>): Promise<WallEvent> {
  const hit = await stream.next();
  assert.equal(hit.done, false, 'the stream ended before the expected event');
  return hit.value as WallEvent;
}

test('the stream requires a device token, like every other wall route', async () => {
  const h = await start();
  try {
    const res = await fetch(`${h.base}/api/wall/v1/stream`);
    assert.equal(res.status, 403);
    assert.equal(((await res.json()) as { error: string }).error, 'device_revoked');
  } finally {
    await h.stop();
  }
});

test('a heartbeat arrives immediately on connect, carrying minClientBuild', async () => {
  const h = await start();
  const ac = new AbortController();
  try {
    const stream = await connect(h, ac.signal);
    const beat = await next(stream);

    assert.equal(beat.type, 'heartbeat');
    assert.equal(beat.type === 'heartbeat' && beat.minClientBuild, 1);
    // Immediately, not after the first interval: an obsolete bundle must be told to reload
    // before it parses anything else.
    assert.deepEqual(Object.keys(beat).sort(), ['generatedAtUtc', 'minClientBuild', 'type']);
  } finally {
    ac.abort();
    await h.stop();
  }
});

test('heartbeats keep coming, so a dead stream is distinguishable from a quiet house', async () => {
  const h = await start(40);
  const ac = new AbortController();
  try {
    const stream = await connect(h, ac.signal);
    const first = await next(stream);
    const second = await next(stream);
    assert.equal(first.type, 'heartbeat');
    assert.equal(second.type, 'heartbeat');
  } finally {
    ac.abort();
    await h.stop();
  }
});

test('a mutation emits an invalidate that carries no domain state at all', async () => {
  const h = await start();
  const ac = new AbortController();
  try {
    const stream = await connect(h, ac.signal);
    await next(stream); // the connect heartbeat

    const snapRes = await fetch(`${h.base}/api/wall/v1/snapshot?localDate=${localDate()}`, {
      headers: { Authorization: `Device ${h.token}` },
    });
    const snap = (await snapRes.json()) as WallSnapshot;
    const card = snap.chores.find((c) => c.childId === 'child-a' && c.choreId === 'ch-bed');
    assert.ok(card);

    await fetch(`${h.base}/api/wall/v1/chores/${card.assignmentId}/claim`, {
      method: 'POST',
      headers: { Authorization: `Device ${h.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: 'child-a' }),
    });

    const event = await next(stream);
    assert.equal(event.type, 'invalidate');
    assert.deepEqual(Object.keys(event).sort(), ['scope', 'type']);
    assert.equal(event.type === 'invalidate' && event.scope, 'chores');

    // The whole point: nothing about the chore, the child or the new state is on this wire.
    const wire = JSON.stringify(event);
    for (const leak of ['child-a', 'ch-bed', 'claimed', String(card.assignmentId)]) {
      assert.equal(wire.includes(leak), false, `the stream leaked ${leak}`);
    }
  } finally {
    ac.abort();
    await h.stop();
  }
});

test('a refused mutation emits nothing: an invalidate means something actually moved', async () => {
  const h = await start(40);
  const ac = new AbortController();
  try {
    const stream = await connect(h, ac.signal);
    await next(stream);

    const snapRes = await fetch(`${h.base}/api/wall/v1/snapshot?localDate=${localDate()}`, {
      headers: { Authorization: `Device ${h.token}` },
    });
    const snap = (await snapRes.json()) as WallSnapshot;
    const card = snap.chores.find((c) => c.childId === 'child-a' && c.choreId === 'ch-bed');
    assert.ok(card);

    // A sibling's mis-tap. Silent no-op means silent on this channel too.
    const refused = await fetch(`${h.base}/api/wall/v1/chores/${card.assignmentId}/claim`, {
      method: 'POST',
      headers: { Authorization: `Device ${h.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ childId: 'child-b' }),
    });
    assert.equal(refused.status, 403);

    // Whatever comes next is a heartbeat, never an invalidate.
    const event = await next(stream);
    assert.equal(event.type, 'heartbeat');
  } finally {
    ac.abort();
    await h.stop();
  }
});

test('closing the server ends the stream instead of hanging the process', async () => {
  const h = await start();
  const ac = new AbortController();
  const stream = await connect(h, ac.signal);
  await next(stream);

  await h.wall.close();
  h.db.close();

  const after = await stream.next();
  assert.equal(after.done, true);
});
