/**
 * Unit F acceptance — the two surfaces, and the refusals that must stay distinguishable.
 *
 * Four properties carry this file, and each one is a failure someone already argued about:
 *
 *  - `401 bad_pin` and `403 device_revoked` are different answers, because the wall renders
 *    "ask a grown-up" for one and the offline card for the other. Collapsing them makes a
 *    revoked panel show a login form nobody is standing at.
 *  - A mismatched `childId` is `403 wrong_child` AND MUTATES NOTHING. Three children's cards
 *    sit on one panel with adjacent 64px targets; without the predicate a tap a centimetre
 *    off pays a sibling, permanently and append-only.
 *  - `wrong_child` never falls through to `not_claimable`, which reads to a child as "the
 *    button is broken" rather than "that is not your card".
 *  - Double-approving over HTTP writes ONE ledger entry. A double tap or a browser retry
 *    silently doubling a balance is invisible until "why does she have $40?".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { localDate } from '../src/time.ts';
import type { WallSnapshot } from '../src/types.ts';
import { issueDeviceToken, revokeDevice, setParentPin } from '../src/http/auth.ts';
import { createWallServer, type WallServer } from '../src/http/server.ts';

const PIN = '1111';

interface Harness {
  db: Db;
  wall: WallServer;
  base: string;
  token: string;
  deviceId: string;
  stop: () => Promise<void>;
}

async function start(): Promise<Harness> {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const device = issueDeviceToken(db, 'test-kiosk');
  await setParentPin(db, PIN);
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs: 60_000 });
  const addr = await wall.listen(0);
  return {
    db,
    wall,
    base: `http://127.0.0.1:${addr.port}`,
    token: device.token,
    deviceId: device.id,
    stop: async () => {
      await wall.close();
      db.close();
    },
  };
}

interface Reply {
  status: number;
  body: Record<string, unknown>;
}

async function call(
  h: Harness,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string | null; pin?: string | null; headers?: Record<string, string> } = {},
): Promise<Reply> {
  const headers: Record<string, string> = { ...opts.headers };
  const token = opts.token === undefined ? h.token : opts.token;
  if (token !== null) headers['Authorization'] = `Device ${token}`;
  if (opts.pin != null) headers['X-Parent-Pin'] = opts.pin;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`${h.base}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  return { status: res.status, body: text.length > 0 ? JSON.parse(text) : {} };
}

async function snapshot(h: Harness): Promise<WallSnapshot> {
  const res = await call(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate()}`);
  return res.body as unknown as WallSnapshot;
}

function assignmentFor(snap: WallSnapshot, childId: string, choreId: string): number {
  const hit = snap.chores.find((c) => c.childId === childId && c.choreId === choreId);
  assert.ok(hit, `expected a ${choreId} card for ${childId}`);
  return hit.assignmentId;
}

function state(h: Harness, assignmentId: number): string {
  const row = h.db
    .prepare(`SELECT state FROM chore_assignment WHERE id = ?`)
    .get(assignmentId) as { state: string };
  return row.state;
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

test('a wall route with no device token is device_revoked, not a login', async () => {
  const h = await start();
  try {
    const res = await call(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate()}`, {
      token: null,
    });
    assert.equal(res.status, 403);
    assert.equal(res.body['error'], 'device_revoked');
  } finally {
    await h.stop();
  }
});

test('an unknown or revoked device token is device_revoked', async () => {
  const h = await start();
  try {
    const unknown = await call(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate()}`, {
      token: 'not-a-real-token',
    });
    assert.equal(unknown.status, 403);
    assert.equal(unknown.body['error'], 'device_revoked');

    revokeDevice(h.db, h.deviceId);
    const revoked = await call(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate()}`);
    assert.equal(revoked.status, 403);
    assert.equal(revoked.body['error'], 'device_revoked');
  } finally {
    await h.stop();
  }
});

test('an admin route with a bad PIN is 401 bad_pin, distinct from 403', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const id = assignmentFor(snap, 'child-a', 'ch-bed');

    const missing = await call(h, 'POST', `/api/admin/v1/chores/${id}/approve`);
    assert.equal(missing.status, 401);
    assert.equal(missing.body['error'], 'bad_pin');

    const wrong = await call(h, 'POST', `/api/admin/v1/chores/${id}/approve`, { pin: '0000' });
    assert.equal(wrong.status, 401);
    assert.equal(wrong.body['error'], 'bad_pin');

    // And the two refusals are genuinely different codes on different statuses: the wall
    // renders "ask a grown-up" for one and the offline card for the other.
    const noDevice = await call(h, 'POST', `/api/admin/v1/chores/${id}/approve`, {
      token: null,
      pin: PIN,
    });
    assert.equal(noDevice.status, 403);
    assert.equal(noDevice.body['error'], 'device_revoked');
  } finally {
    await h.stop();
  }
});

test('a child can unclaim her own claim from the wall, and only her own', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const id = assignmentFor(snap, 'child-a', 'ch-bed');
    await call(h, 'POST', `/api/wall/v1/chores/${id}/claim`, { body: { childId: 'child-a' } });
    assert.equal(state(h, id), 'claimed');

    const wrong = await call(h, 'POST', `/api/wall/v1/chores/${id}/unclaim`, {
      body: { childId: 'child-b' },
    });
    assert.equal(wrong.status, 403);
    assert.equal(wrong.body['error'], 'wrong_child');
    assert.equal(state(h, id), 'claimed', "a sibling's tap changes nothing");

    const res = await call(h, 'POST', `/api/wall/v1/chores/${id}/unclaim`, {
      body: { childId: 'child-a' },
    });
    assert.equal(res.status, 200);
    assert.equal(res.body['state'], 'pending');
    assert.equal(state(h, id), 'pending');
  } finally {
    await h.stop();
  }
});

test('the wall surface can never approve, whatever it sends', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const id = assignmentFor(snap, 'child-a', 'ch-bed');
    await call(h, 'POST', `/api/wall/v1/chores/${id}/claim`, { body: { childId: 'child-a' } });

    // There is no approve route on the wall surface at all.
    const res = await call(h, 'POST', `/api/wall/v1/chores/${id}/approve`, {
      body: { childId: 'child-a' },
      headers: { 'X-Parent-Pin': PIN },
    });
    assert.equal(res.status, 404);
    assert.equal(state(h, id), 'claimed');
  } finally {
    await h.stop();
  }
});

test('an unconfigured PIN fails closed rather than opening the approvals', async () => {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const device = issueDeviceToken(db, 'kiosk');
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs: 60_000 });
  const addr = await wall.listen(0);
  try {
    const res = await fetch(`http://127.0.0.1:${addr.port}/api/admin/v1/chores/1/approve`, {
      method: 'POST',
      headers: { Authorization: `Device ${device.token}`, 'X-Parent-Pin': '1234' },
    });
    assert.equal(res.status, 401);
    assert.equal(((await res.json()) as { error: string }).error, 'bad_pin');
  } finally {
    await wall.close();
    db.close();
  }
});

// ---------------------------------------------------------------------------
// Ownership
// ---------------------------------------------------------------------------

test('a mismatched childId on claim is wrong_child and mutates nothing', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const id = assignmentFor(snap, 'child-a', 'ch-bed');
    assert.equal(state(h, id), 'pending');

    const res = await call(h, 'POST', `/api/wall/v1/chores/${id}/claim`, {
      body: { childId: 'child-b' },
    });

    assert.equal(res.status, 403);
    assert.equal(res.body['error'], 'wrong_child');
    assert.notEqual(res.body['error'], 'not_claimable', 'never a fallthrough: that reads as "broken button"');
    assert.equal(state(h, id), 'pending', 'the sibling row must be untouched');
    // Nothing about the real owner leaked back to the tapping child.
    assert.equal('childId' in res.body, false);
  } finally {
    await h.stop();
  }
});

test('a missing childId on a wall mutation is a silent no-op, not a validation error', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const id = assignmentFor(snap, 'child-a', 'ch-bed');
    const res = await call(h, 'POST', `/api/wall/v1/chores/${id}/claim`, { body: {} });
    assert.equal(res.status, 403);
    assert.equal(res.body['error'], 'wrong_child');
    assert.equal(state(h, id), 'pending');
  } finally {
    await h.stop();
  }
});

test('a mismatched childId on step complete and revoke is wrong_child and writes nothing', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const run = snap.routines.find((r) => r.childId === 'child-a');
    assert.ok(run);
    const step = run.steps[0];
    assert.ok(step);

    const completed = await call(
      h,
      'POST',
      `/api/wall/v1/routines/steps/${step.runStepId}/complete`,
      { body: { childId: 'child-b' } },
    );
    assert.equal(completed.status, 403);
    assert.equal(completed.body['error'], 'wrong_child');

    const rows = h.db
      .prepare(`SELECT COUNT(*) AS n FROM routine_step_completion WHERE run_step_id = ?`)
      .get(step.runStepId) as { n: number };
    assert.equal(rows.n, 0, 'a sibling tap must not complete a step');

    // The owner completes it; a sibling then tries to undo it.
    const mine = await call(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
      body: { childId: 'child-a' },
    });
    assert.equal(mine.status, 200);
    assert.ok(typeof mine.body['completedAtUtc'] === 'string');

    const revoked = await call(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/revoke`, {
      body: { childId: 'child-b' },
    });
    assert.equal(revoked.status, 403);
    assert.equal(revoked.body['error'], 'wrong_child');

    const live = h.db
      .prepare(
        `SELECT COUNT(*) AS n FROM routine_step_completion
          WHERE run_step_id = ? AND revoked_at_utc IS NULL`,
      )
      .get(step.runStepId) as { n: number };
    assert.equal(live.n, 1, "a sibling must not undo another child's step");
  } finally {
    await h.stop();
  }
});

test('the owner can undo her own step without an adult', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const run = snap.routines.find((r) => r.childId === 'child-a');
    const step = run?.steps[0];
    assert.ok(step);

    await call(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
      body: { childId: 'child-a' },
    });
    // No PIN. A three-year-old mis-tapping is certain; PIN-gating the undo bricks the
    // routine until an adult intervenes (H2 Q1 fatal flaw).
    const res = await call(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/revoke`, {
      body: { childId: 'child-a' },
    });
    assert.equal(res.status, 200);
    assert.ok(typeof res.body['revokedAtUtc'] === 'string');
  } finally {
    await h.stop();
  }
});

// ---------------------------------------------------------------------------
// Idempotency
// ---------------------------------------------------------------------------

test('double-approving a chore over HTTP writes exactly one ledger entry', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const id = assignmentFor(snap, 'child-a', 'ch-bed');

    await call(h, 'POST', `/api/wall/v1/chores/${id}/claim`, { body: { childId: 'child-a' } });

    const first = await call(h, 'POST', `/api/admin/v1/chores/${id}/approve`, { pin: PIN });
    assert.equal(first.status, 200);
    assert.equal(first.body['state'], 'approved');
    assert.ok(typeof first.body['ledgerEntryId'] === 'number');

    // The double tap, or the browser retrying a slow request.
    const second = await call(h, 'POST', `/api/admin/v1/chores/${id}/approve`, { pin: PIN });
    assert.equal(second.status, 200, 'a retry is not an error');
    assert.equal(second.body['state'], 'approved');

    const entries = h.db
      .prepare(
        `SELECT COUNT(*) AS n FROM ledger_entry
          WHERE ref_type = 'chore_assignment' AND ref_id = ? AND reason = 'chore_approved'`,
      )
      .get(String(id)) as { n: number };
    assert.equal(entries.n, 1, 'a second entry here is a silently doubled balance');

    const balance = h.db
      .prepare(`SELECT COALESCE(SUM(delta),0) AS p FROM ledger_entry WHERE child_id = 'child-a'`)
      .get() as { p: number };
    assert.equal(balance.p, 1, 'ch-bed is worth one point, once');
  } finally {
    await h.stop();
  }
});

test('a manual adjustment is idempotent on requestId, and refuses without one', async () => {
  const h = await start();
  try {
    const missing = await call(h, 'POST', '/api/admin/v1/ledger/adjust', {
      pin: PIN,
      body: { childId: 'child-a', delta: 5, note: 'bonus' },
    });
    assert.equal(missing.status, 400);
    assert.equal(missing.body['error'], 'bad_request');

    const body = { childId: 'child-a', delta: 5, note: 'bonus', requestId: 'uuid-1' };
    const first = await call(h, 'POST', '/api/admin/v1/ledger/adjust', { pin: PIN, body });
    const retry = await call(h, 'POST', '/api/admin/v1/ledger/adjust', { pin: PIN, body });
    assert.equal(first.status, 200);
    assert.equal(retry.status, 200);
    assert.equal(first.body['id'], retry.body['id'], 'a retry returns the original entry');

    const rows = h.db
      .prepare(`SELECT COUNT(*) AS n FROM ledger_entry WHERE child_id = 'child-a'`)
      .get() as { n: number };
    assert.equal(rows.n, 1, 'a double tap must not pay twice');
  } finally {
    await h.stop();
  }
});

test('losing a first_complete race is already_claimed, not a failure', async () => {
  const h = await start();
  try {
    const snap = await snapshot(h);
    const mine = assignmentFor(snap, 'child-a', 'ch-pet');
    const sibling = assignmentFor(snap, 'child-b', 'ch-pet');

    const won = await call(h, 'POST', `/api/wall/v1/chores/${mine}/claim`, {
      body: { childId: 'child-a' },
    });
    assert.equal(won.status, 200);
    assert.equal(won.body['state'], 'claimed');

    const lost = await call(h, 'POST', `/api/wall/v1/chores/${sibling}/claim`, {
      body: { childId: 'child-b' },
    });
    assert.equal(lost.status, 409);
    assert.equal(lost.body['error'], 'already_claimed');
    assert.equal(state(h, sibling), 'superseded');
  } finally {
    await h.stop();
  }
});

// ---------------------------------------------------------------------------
// Redemption
// ---------------------------------------------------------------------------

test('a redemption above the balance is refused before it can occupy the pending slot', async () => {
  const h = await start();
  try {
    const res = await call(h, 'POST', '/api/wall/v1/redemptions', {
      body: { childId: 'child-a', pointsRequested: 500 },
    });
    assert.equal(res.status, 409);
    assert.equal(res.body['error'], 'insufficient_points');

    const rows = h.db.prepare(`SELECT COUNT(*) AS n FROM redemption_request`).get() as { n: number };
    assert.equal(rows.n, 0, 'an impossible ask must never take the one-pending slot');
  } finally {
    await h.stop();
  }
});

test('a child may cancel her own request, and may not cancel a sibling’s', async () => {
  const h = await start();
  try {
    h.db
      .prepare(
        `INSERT INTO ledger_entry (child_id, delta, reason, ref_type, ref_id, note, created_at_utc)
         VALUES ('child-a', 20, 'adjustment', 'manual', 'seed-1', NULL, '2026-08-01T00:00:00Z')`,
      )
      .run();

    const made = await call(h, 'POST', '/api/wall/v1/redemptions', {
      body: { childId: 'child-a', pointsRequested: 5 },
    });
    assert.equal(made.status, 200);
    const id = made.body['id'] as number;

    const sibling = await call(h, 'POST', `/api/wall/v1/redemptions/${id}/cancel`, {
      body: { childId: 'child-b' },
    });
    assert.equal(sibling.status, 403);
    assert.equal(sibling.body['error'], 'wrong_child');

    const own = await call(h, 'POST', `/api/wall/v1/redemptions/${id}/cancel`, {
      body: { childId: 'child-a' },
    });
    assert.equal(own.status, 200);
    assert.equal(own.body['state'], 'cancelled');
  } finally {
    await h.stop();
  }
});

test('the wall redemptions read exposes pending only', async () => {
  const h = await start();
  try {
    const ok = await call(h, 'GET', '/api/wall/v1/redemptions?state=pending');
    assert.equal(ok.status, 200);
    assert.ok(Array.isArray(ok.body));

    const decided = await call(h, 'GET', '/api/wall/v1/redemptions?state=approved');
    assert.equal(decided.status, 400, 'decided requests are history, not wall state');
  } finally {
    await h.stop();
  }
});

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------

test('an obsolete bundle is told to reload before it parses anything', async () => {
  const h = await start();
  try {
    const res = await call(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate()}`, {
      headers: { 'x-client-build': '0' },
    });
    assert.equal(res.status, 426);
    assert.equal(res.body['error'], 'stale_client');
  } finally {
    await h.stop();
  }
});

test('every response carries minClientBuild, not only the snapshot', async () => {
  const h = await start();
  try {
    const res = await fetch(`${h.base}/api/wall/v1/snapshot?localDate=${localDate()}`, {
      headers: { Authorization: `Device ${h.token}` },
    });
    assert.equal(res.headers.get('x-min-client-build'), '1');
    assert.equal(res.headers.get('x-api-version'), '1');

    const refused = await fetch(`${h.base}/api/wall/v1/snapshot?localDate=${localDate()}`);
    assert.equal(refused.status, 403);
    assert.equal(refused.headers.get('x-min-client-build'), '1');
  } finally {
    await h.stop();
  }
});

test('an unrouted path is a JSON refusal, never an HTML error page', async () => {
  const h = await start();
  try {
    const res = await call(h, 'GET', '/api/wall/v1/nothing');
    assert.equal(res.status, 404);
    assert.equal(res.body['error'], 'not_found');
    assert.ok(typeof res.body['message'] === 'string');
  } finally {
    await h.stop();
  }
});

test('an unexpected failure is a parseable refusal a child never sees, not a 5xx page', async () => {
  const h = await start();
  try {
    // A database yanked out from under a live server is the shape of every unexpected
    // failure: the handler throws something that is not an ApiError.
    h.db.close();
    const res = await call(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate()}`);
    assert.equal(res.status, 503);
    assert.equal(res.body['error'], 'unavailable');
    assert.ok(typeof res.body['message'] === 'string');
    // Nothing internal reaches a screen a guest can read.
    assert.equal(/SQLITE|stack|\.ts:/.test(String(res.body['message'])), false);
  } finally {
    await h.wall.close();
  }
});

test('a device can be provisioned and revoked through the admin surface', async () => {
  const h = await start();
  try {
    const made = await call(h, 'POST', '/api/admin/v1/devices', {
      pin: PIN,
      body: { label: 'hall panel' },
    });
    assert.equal(made.status, 200);
    const token = made.body['token'];
    assert.ok(typeof token === 'string' && token.length > 20);

    // The plaintext is never stored.
    const stored = h.db
      .prepare(`SELECT COUNT(*) AS n FROM device_token WHERE token_hash = ?`)
      .get(token) as { n: number };
    assert.equal(stored.n, 0);

    const usable = await call(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate()}`, {
      token: token as string,
    });
    assert.equal(usable.status, 200);

    const gone = await call(h, 'DELETE', `/api/admin/v1/devices/${made.body['id'] as string}`, {
      pin: PIN,
    });
    assert.equal(gone.status, 204);

    const after = await call(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate()}`, {
      token: token as string,
    });
    assert.equal(after.status, 403);
  } finally {
    await h.stop();
  }
});

test('the admin ledger view returns entries with a running total', async () => {
  const h = await start();
  try {
    for (const [i, delta] of [5, -2, 7].entries()) {
      await call(h, 'POST', '/api/admin/v1/ledger/adjust', {
        pin: PIN,
        body: { childId: 'child-a', delta, note: null, requestId: `uuid-${i}` },
      });
    }
    const res = await call(h, 'GET', '/api/admin/v1/children/child-a/ledger', { pin: PIN });
    assert.equal(res.status, 200);
    const entries = res.body['entries'] as { runningTotal: number }[];
    assert.deepEqual(entries.map((e) => e.runningTotal), [5, 3, 10]);
    assert.equal(res.body['total'], 10);
  } finally {
    await h.stop();
  }
});

// ---------------------------------------------------------------------------
// Routine authoring — assignment from behind the PIN
// ---------------------------------------------------------------------------

test('the routine catalog is behind the PIN, and an assignment answers with the new catalog', async () => {
  const h = await start();
  try {
    const bare = await call(h, 'GET', '/api/admin/v1/routines');
    assert.equal(bare.status, 401);
    assert.equal(bare.body['error'], 'bad_pin');

    const before = await call(h, 'GET', '/api/admin/v1/routines', { pin: PIN });
    assert.equal(before.status, 200);
    const routines = before.body['routines'] as { id: string; assignments: { childId: string; stepId: string }[] }[];
    const bed = routines.find((r) => r.id === 'rt-bed');
    assert.ok(bed);
    assert.deepEqual(
      bed.assignments.filter((a) => a.childId === 'child-c').map((a) => a.stepId),
      ['st-pj'],
    );

    const assigned = await call(h, 'POST', '/api/admin/v1/routines/rt-bed/steps/st-teeth-pm/assign', {
      pin: PIN,
      body: { childId: 'child-c', assigned: true },
    });
    assert.equal(assigned.status, 200);
    const after = (assigned.body['routines'] as typeof routines).find((r) => r.id === 'rt-bed');
    assert.ok(after);
    assert.deepEqual(
      after.assignments.filter((a) => a.childId === 'child-c').map((a) => a.stepId),
      ['st-pj', 'st-teeth-pm'],
    );

    const moved = await call(h, 'POST', '/api/admin/v1/routines/rt-bed/steps/st-teeth-pm/move', {
      pin: PIN,
      body: { childId: 'child-c', direction: 'up' },
    });
    assert.equal(moved.status, 200);
    const swapped = (moved.body['routines'] as typeof routines).find((r) => r.id === 'rt-bed');
    assert.deepEqual(
      swapped?.assignments.filter((a) => a.childId === 'child-c').map((a) => a.stepId),
      ['st-teeth-pm', 'st-pj'],
    );
  } finally {
    await h.stop();
  }
});

test('a routine assignment with a bad body or a foreign step is refused, and writes nothing', async () => {
  const h = await start();
  try {
    const noChild = await call(h, 'POST', '/api/admin/v1/routines/rt-bed/steps/st-teeth-pm/assign', {
      pin: PIN,
      body: { assigned: true },
    });
    assert.equal(noChild.status, 400);
    assert.equal(noChild.body['error'], 'bad_request');

    const badDirection = await call(h, 'POST', '/api/admin/v1/routines/rt-bed/steps/st-pj/move', {
      pin: PIN,
      body: { childId: 'child-c', direction: 'sideways' },
    });
    assert.equal(badDirection.status, 400);

    const foreign = await call(h, 'POST', '/api/admin/v1/routines/rt-morning/steps/st-pj/assign', {
      pin: PIN,
      body: { childId: 'child-a', assigned: true },
    });
    assert.equal(foreign.status, 404);
    assert.equal(foreign.body['error'], 'not_found');

    const rows = h.db
      .prepare(`SELECT count(*) AS n FROM routine_step_assignment WHERE routine_id = 'rt-morning' AND routine_step_id = 'st-pj'`)
      .get() as { n: number };
    assert.equal(rows.n, 0);

    // The wall surface has no such door at all.
    const fromWall = await call(h, 'POST', '/api/admin/v1/routines/rt-bed/steps/st-teeth-pm/assign', {
      body: { childId: 'child-c', assigned: true },
    });
    assert.equal(fromWall.status, 401);
  } finally {
    await h.stop();
  }
});

test('the chore catalog is behind the PIN, and roster and model writes answer with the new catalog', async () => {
  const h = await start();
  try {
    const bare = await call(h, 'GET', '/api/admin/v1/chores');
    assert.equal(bare.status, 401);
    assert.equal(bare.body['error'], 'bad_pin');

    type Entry = { id: string; assignmentModel: string; roster: { childId: string }[]; rosterExplicit: boolean };
    const before = await call(h, 'GET', '/api/admin/v1/chores', { pin: PIN });
    assert.equal(before.status, 200);
    const chores = before.body['chores'] as Entry[];
    const bed = chores.find((c) => c.id === 'ch-bed');
    assert.ok(bed);
    assert.equal(bed.rosterExplicit, false);
    assert.deepEqual(bed.roster.map((m) => m.childId), ['child-a', 'child-b', 'child-c']);

    const off = await call(h, 'POST', '/api/admin/v1/chores/ch-bed/roster', {
      pin: PIN,
      body: { childId: 'child-b', member: false },
    });
    assert.equal(off.status, 200);
    const afterOff = (off.body['chores'] as Entry[]).find((c) => c.id === 'ch-bed');
    assert.deepEqual(afterOff?.roster.map((m) => m.childId), ['child-a', 'child-c']);
    assert.equal(afterOff?.rosterExplicit, true);

    const moved = await call(h, 'POST', '/api/admin/v1/chores/ch-bed/roster/move', {
      pin: PIN,
      body: { childId: 'child-c', direction: 'up' },
    });
    assert.equal(moved.status, 200);
    assert.deepEqual(
      (moved.body['chores'] as Entry[]).find((c) => c.id === 'ch-bed')?.roster.map((m) => m.childId),
      ['child-c', 'child-a'],
    );

    const model = await call(h, 'POST', '/api/admin/v1/chores/ch-bed/model', {
      pin: PIN,
      body: { assignmentModel: 'rotation' },
    });
    assert.equal(model.status, 200);
    assert.equal(
      (model.body['chores'] as Entry[]).find((c) => c.id === 'ch-bed')?.assignmentModel,
      'rotation',
    );
  } finally {
    await h.stop();
  }
});

test('a chore edit with a bad body, an emptied roster or an unknown chore is refused', async () => {
  const h = await start();
  try {
    const noMember = await call(h, 'POST', '/api/admin/v1/chores/ch-bed/roster', {
      pin: PIN,
      body: { childId: 'child-a' },
    });
    assert.equal(noMember.status, 400);
    assert.equal(noMember.body['error'], 'bad_request');

    // ch-table's rotation is child-a and child-b; take both off and the second is refused.
    const first = await call(h, 'POST', '/api/admin/v1/chores/ch-table/roster', {
      pin: PIN,
      body: { childId: 'child-a', member: false },
    });
    assert.equal(first.status, 200);
    const last = await call(h, 'POST', '/api/admin/v1/chores/ch-table/roster', {
      pin: PIN,
      body: { childId: 'child-b', member: false },
    });
    assert.equal(last.status, 400);
    assert.equal(last.body['error'], 'bad_request');

    const badModel = await call(h, 'POST', '/api/admin/v1/chores/ch-bed/model', {
      pin: PIN,
      body: { assignmentModel: 'lottery' },
    });
    assert.equal(badModel.status, 400);

    const unknown = await call(h, 'POST', '/api/admin/v1/chores/ch-nope/model', {
      pin: PIN,
      body: { assignmentModel: 'rotation' },
    });
    assert.equal(unknown.status, 404);
    assert.equal(unknown.body['error'], 'not_found');

    const noPin = await call(h, 'POST', '/api/admin/v1/chores/ch-bed/model', {
      body: { assignmentModel: 'rotation' },
    });
    assert.equal(noPin.status, 401);
  } finally {
    await h.stop();
  }
});

test('a chore made on the wall answers with the catalog it now belongs to, and every refusal at once', async () => {
  const h = await start();
  try {
    const catalog = await call(h, 'GET', '/api/admin/v1/chores', { pin: PIN });
    const icons = catalog.body['icons'] as { assetId: string; url: string; category: string }[];
    assert.ok(icons.length >= 6, 'the picker has icons to offer');
    assert.ok(icons.every((i) => i.url.length > 0));
    const table = icons.find((i) => i.assetId === 'ico-table');
    assert.equal(table?.category, 'kitchen');

    const body = {
      labelFull: 'Water the plants',
      iconAssetId: 'ico-table',
      kind: 'extra',
      basePoints: 2,
      assignmentModel: 'individual',
      rrule: 'FREQ=DAILY',
      roster: ['child-b'],
    };
    const noPin = await call(h, 'POST', '/api/admin/v1/chores', { body });
    assert.equal(noPin.status, 401);

    const made = await call(h, 'POST', '/api/admin/v1/chores', { pin: PIN, body });
    assert.equal(made.status, 200);
    type Entry = { id: string; labelShort: string; roster: { childId: string }[]; active: boolean };
    const mine = (made.body['chores'] as Entry[]).find((c) => c.id === 'ch-water-the-plants');
    assert.ok(mine);
    assert.equal(mine.active, true);
    assert.equal(mine.labelShort, 'Water the');
    assert.deepEqual(mine.roster.map((m) => m.childId), ['child-b']);

    // Shape first (the file's parser), then references (the file's validator): each stage
    // reports everything it found, so two calls at most fix a sheet that is wrong twice over.
    const shape = await call(h, 'POST', '/api/admin/v1/chores', {
      pin: PIN,
      body: { ...body, labelFull: '', rrule: 'FREQ=MONTHLY' },
    });
    assert.equal(shape.status, 400);
    assert.equal(shape.body['error'], 'bad_request');
    assert.match(String(shape.body['message']), /labelFull/);
    assert.match(String(shape.body['message']), /rrule/);
    const refs = await call(h, 'POST', '/api/admin/v1/chores', {
      pin: PIN,
      body: { ...body, iconAssetId: 'ico-nope', roster: ['child-z'] },
    });
    assert.equal(refs.status, 400);
    assert.match(String(refs.body['message']), /ico-nope/);
    assert.match(String(refs.body['message']), /child-z/);
    const after = await call(h, 'GET', '/api/admin/v1/chores', { pin: PIN });
    assert.equal(
      (after.body['chores'] as Entry[]).filter((c) => c.id.startsWith('ch-water')).length,
      1,
    );
  } finally {
    await h.stop();
  }
});
