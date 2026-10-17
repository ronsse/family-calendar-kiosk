/**
 * Unit F — forcing a calendar sweep from a route.
 *
 * `syncNow()` existed from the day the scheduler was written and nothing called it, so the only
 * way to force a refresh was to restart the container — which drops every SSE client and takes
 * the wall dark, to do something the worker was already sitting there ready to do.
 *
 * The tests that matter here are the two guards: it must not start two sweeps, and it must not
 * be able to latch shut and refuse every future refresh for the life of the process.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  createCalendarRefresher,
  REFRESH_IN_FLIGHT_MS,
  type SyncTrigger,
} from '../src/http/calendar-refresh.ts';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { issueDeviceToken, setParentPin } from '../src/http/auth.ts';
import { createWallServer } from '../src/http/server.ts';

/** A scheduler stand-in that counts sweeps instead of spawning a worker thread. */
function fakeTrigger(started = true, reason: string | null = null) {
  let calls = 0;
  const trigger: SyncTrigger = {
    started,
    reason,
    syncNow: () => {
      calls += 1;
    },
  };
  return { trigger, calls: () => calls };
}

/** A clock the test moves by hand, so nothing here waits on a real two minutes. */
function fakeClock(start = 1_800_000_000_000) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

test('an unattached refresher refuses rather than pretending', () => {
  const r = createCalendarRefresher();
  const out = r.refresh();
  assert.equal(out.disposition, 'not-configured');
  assert.ok(out.reason && out.reason.length > 0, 'it must say why');
});

test('a scheduler that declined to start reports ITS reason, not a generic one', () => {
  // The scheduler already writes a sentence explaining why it declined — no adapter, or an
  // in-memory database. Replacing that with our own wording would lose the only diagnosis an
  // adult gets, and this exact condition is what a household with no calendar upstream sees.
  const { trigger } = fakeTrigger(false, 'no calendar adapter is configured');
  const r = createCalendarRefresher();
  r.attach(trigger);
  assert.equal(r.refresh().reason, 'no calendar adapter is configured');
});

test('a refresh starts exactly one sweep', () => {
  const { trigger, calls } = fakeTrigger();
  const r = createCalendarRefresher();
  r.attach(trigger);
  assert.equal(r.refresh().disposition, 'started');
  assert.equal(calls(), 1);
});

test('a second refresh while one is in flight starts NOTHING', () => {
  // Two taps a second apart. `syncNow()` is a fire-and-forget postMessage with no notion of
  // "already running", so without this guard both would queue a full sweep against the same
  // upstream.
  const { trigger, calls } = fakeTrigger();
  const clock = fakeClock();
  const r = createCalendarRefresher(clock.now);
  r.attach(trigger);

  assert.equal(r.refresh().disposition, 'started');
  clock.advance(1_000);
  assert.equal(r.refresh().disposition, 'already-running');
  clock.advance(1_000);
  assert.equal(r.refresh().disposition, 'already-running');
  assert.equal(calls(), 1, 'three requests, one sweep');
});

test('the worker reporting back reopens the door immediately', () => {
  const { trigger, calls } = fakeTrigger();
  const clock = fakeClock();
  const r = createCalendarRefresher(clock.now);
  r.attach(trigger);

  r.refresh();
  r.observe({ type: 'synced', ok: 3, failed: 0, events: 47 });
  clock.advance(100);
  assert.equal(r.refresh().disposition, 'started', 'a finished sweep must not block the next');
  assert.equal(calls(), 2);
});

test('an ERRORED sweep also reopens the door', () => {
  // An errored sweep is a finished sweep. Refusing the retry an adult obviously wants next is
  // exactly backwards, and "the calendar failed, and now I cannot retry it" is a worse state
  // than the double sweep the guard exists to prevent.
  const { trigger, calls } = fakeTrigger();
  const r = createCalendarRefresher();
  r.attach(trigger);
  r.refresh();
  r.observe({ type: 'error', message: 'upstream refused' });
  assert.equal(r.refresh().disposition, 'started');
  assert.equal(calls(), 2);
});

test('a LOST message cannot latch the guard shut forever', () => {
  // The failure this deadline exists for: a crashed worker, or a terminate mid-sweep, means no
  // terminal message ever arrives. A purely message-driven flag would then refuse every refresh
  // for the life of the process — silently, and permanently, which is worse than what it guards.
  const { trigger, calls } = fakeTrigger();
  const clock = fakeClock();
  const r = createCalendarRefresher(clock.now);
  r.attach(trigger);

  r.refresh();
  clock.advance(REFRESH_IN_FLIGHT_MS - 1);
  assert.equal(r.refresh().disposition, 'already-running', 'still guarded a millisecond before');
  clock.advance(2);
  assert.equal(r.refresh().disposition, 'started', 'the deadline must release it');
  assert.equal(calls(), 2);
});

test('an unrelated worker message does not clear the guard', () => {
  const { trigger, calls } = fakeTrigger();
  const r = createCalendarRefresher();
  r.attach(trigger);
  r.refresh();
  r.observe({ type: 'started' });
  r.observe({ type: 'heartbeat' });
  assert.equal(r.refresh().disposition, 'already-running');
  assert.equal(calls(), 1);
});

test('what the last sweep found is reported back', () => {
  // A refresh that acknowledges without saying anything is one an adult presses again, which
  // is how you get the double-call in the first place.
  const { trigger } = fakeTrigger();
  const clock = fakeClock();
  const r = createCalendarRefresher(clock.now);
  r.attach(trigger);

  const first = r.refresh();
  assert.equal(first.lastCompletedAtUtc, null, 'nothing has completed yet');
  assert.equal(first.lastEvents, null);

  r.observe({ type: 'synced', ok: 3, failed: 0, events: 47 });
  const second = r.refresh();
  assert.equal(second.lastEvents, 47);
  assert.equal(second.lastFailed, 0);
  assert.equal(second.lastCompletedAtUtc, new Date(clock.now()).toISOString());
});

test('a malformed report does not poison the numbers', () => {
  const { trigger } = fakeTrigger();
  const r = createCalendarRefresher();
  r.attach(trigger);
  r.refresh();
  r.observe({ type: 'synced', events: undefined, failed: 'lots' as unknown as number });
  const out = r.refresh();
  assert.equal(out.lastEvents, null, 'a missing count is null, not NaN or a stale number');
  assert.equal(out.lastFailed, null);
});

test('re-attaching a scheduler does not resurrect a stale in-flight flag', () => {
  // A restarted scheduler is a new worker with no memory of the sweep we were waiting on.
  const clock = fakeClock();
  const r = createCalendarRefresher(clock.now);
  const first = fakeTrigger();
  r.attach(first.trigger);
  r.refresh();

  const second = fakeTrigger();
  r.attach(second.trigger);
  clock.advance(REFRESH_IN_FLIGHT_MS + 1);
  assert.equal(r.refresh().disposition, 'started');
  assert.equal(second.calls(), 1, 'the new scheduler gets the sweep');
  assert.equal(first.calls(), 1, 'the old one is never called again');
});

// ---------------------------------------------------------------------------
// Through the real HTTP surface
// ---------------------------------------------------------------------------

const PIN = '1111';

async function startServer(refresher: ReturnType<typeof createCalendarRefresher> | undefined) {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const device = issueDeviceToken(db, 'test-kiosk');
  await setParentPin(db, PIN);
  const wall = createWallServer({
    db,
    logger: () => {},
    heartbeatMs: 60_000,
    calendarRefresh: refresher,
  });
  const addr = await wall.listen(0);
  return {
    base: `http://127.0.0.1:${addr.port}`,
    token: device.token,
    stop: async () => {
      await wall.close();
      db.close();
    },
  };
}

const PATH = '/api/admin/v1/calendar/refresh';

test('the route is behind the parent PIN, like every other admin route', async () => {
  // The guardrail that matters on this wall: children and guests touch this screen, so a
  // mutation must never be reachable without the PIN — and never from a session, which is why
  // the admin surface checks it per request. This route gets that for free by BEING an admin
  // route, and this test is what proves it did not accidentally land on the wall surface.
  const r = createCalendarRefresher();
  const { trigger } = fakeTrigger();
  r.attach(trigger);
  const h = await startServer(r);
  try {
    const noPin = await fetch(`${h.base}${PATH}`, {
      method: 'POST',
      headers: { Authorization: `Device ${h.token}` },
    });
    assert.equal(noPin.status, 401, 'no PIN must be refused');

    const badPin = await fetch(`${h.base}${PATH}`, {
      method: 'POST',
      headers: { Authorization: `Device ${h.token}`, 'X-Parent-Pin': '0000' },
    });
    assert.equal(badPin.status, 401, 'a wrong PIN must be refused');

    const noDevice = await fetch(`${h.base}${PATH}`, {
      method: 'POST',
      headers: { 'X-Parent-Pin': PIN },
    });
    assert.equal(noDevice.status, 403, 'an unregistered device must be refused');
  } finally {
    await h.stop();
  }
});

test('GET is not a way in — this mutates', async () => {
  const r = createCalendarRefresher();
  r.attach(fakeTrigger().trigger);
  const h = await startServer(r);
  try {
    const res = await fetch(`${h.base}${PATH}`, {
      headers: { Authorization: `Device ${h.token}`, 'X-Parent-Pin': PIN },
    });
    assert.notEqual(res.status, 200, 'a GET must not trigger a sweep');
  } finally {
    await h.stop();
  }
});

test('a real POST starts one sweep and says what it did', async () => {
  const r = createCalendarRefresher();
  const { trigger, calls } = fakeTrigger();
  r.attach(trigger);
  const h = await startServer(r);
  try {
    const res = await fetch(`${h.base}${PATH}`, {
      method: 'POST',
      headers: { Authorization: `Device ${h.token}`, 'X-Parent-Pin': PIN },
    });
    assert.equal(res.status, 200);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['disposition'], 'started');
    assert.equal(calls(), 1);

    // Twice in a row, which is what an impatient adult actually does.
    const again = await fetch(`${h.base}${PATH}`, {
      method: 'POST',
      headers: { Authorization: `Device ${h.token}`, 'X-Parent-Pin': PIN },
    });
    assert.equal(((await again.json()) as Record<string, unknown>)['disposition'], 'already-running');
    assert.equal(calls(), 1, 'two POSTs, one sweep');
  } finally {
    await h.stop();
  }
});

test('a server built without a refresher refuses instead of throwing', async () => {
  // Every route test in this repo builds a server against `:memory:`, where calendar sync
  // deliberately refuses to start. A route that assumed a refresher was present would turn
  // that supported configuration into a 500.
  const h = await startServer(undefined);
  try {
    const res = await fetch(`${h.base}${PATH}`, {
      method: 'POST',
      headers: { Authorization: `Device ${h.token}`, 'X-Parent-Pin': PIN },
    });
    assert.equal(res.status, 503);
    const body = (await res.json()) as Record<string, unknown>;
    assert.equal(body['error'], 'unavailable');
    assert.ok(String(body['message']).length > 0, 'it must say why');
  } finally {
    await h.stop();
  }
});
