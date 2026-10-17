/**
 * Unit I acceptance, part 1: the data layer.
 *
 * The kiosk holds this bundle in one Chromium tab for months without a reload. That single
 * fact is what every test below is really about — nothing may depend on a page load happening,
 * because one will not, and every recovery path has to work while the wall is already up and a
 * child is standing in front of it.
 *
 * Four failures these tests exist to prevent, all of them "alive, structurally valid, wrong":
 *
 *   - a local date derived from UTC, which rolls the wall over during dinner;
 *   - a date boundary nobody notices, so Tuesday at 06:00 renders Monday;
 *   - a bundle too old to parse today's shapes, rendering a blank wall inside a throw;
 *   - a dead stream with nothing else scheduled, so the wall is simply never told anything
 *     changed again.
 *
 * There is no DOM here and none is needed: `controller.ts` takes its clock, its `fetch`, its
 * timer and its reload as parameters, precisely so the whole thing can be driven from Node.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocalDate, Utc, WallSnapshot } from '../src/types.ts';
import {
  MISMATCH_MAX_RETRIES,
  POLL_DEGRADED_MS,
  POLL_HEALTHY_MS,
  SSE_BACKOFF_MAX_MS,
  SSE_DEAD_AFTER_FAILURES,
  fetchRetryMs,
  mismatchRetryMs,
  pollIntervalMs,
  sseDelayMs,
} from '../web/src/data/backoff.ts';
import {
  createWallDataController,
  type RefreshReason,
  type WallDataDeps,
  type WallDataLog,
} from '../web/src/data/controller.ts';
import {
  hashWithoutToken,
  resolveDeviceToken,
  tokenFromHash,
  wallHeaders,
  type KeyValueStore,
} from '../web/src/data/device.ts';
import { initialDateWatch, observeDate, wallLocalDate } from '../web/src/data/localDate.ts';
import {
  CLIENT_BUILD,
  RELOAD_COOLDOWN_MS,
  RELOAD_STAMP_KEY,
  isStaleBuild,
  minBuildFromHeader,
  shouldHardReload,
} from '../web/src/data/protocol.ts';
import { classifyResponse, evaluateSnapshot, isRenderableSnapshot } from '../web/src/data/snapshot.ts';
import { createSseDecoder, parseWallEvent } from '../web/src/data/sse.ts';

const at = (iso: string): number => Date.parse(iso);

// ---------------------------------------------------------------------------
// 1. "Today" comes from Intl, never from UTC
// ---------------------------------------------------------------------------

test('the local date at dinner is still today — Intl, not toISOString', () => {
  // 19:30 America/Denver on the 24th is 01:30Z on the 25th. The UTC date is a whole day out,
  // and a wall that used it would roll over to "tomorrow" in the middle of dinner.
  const dinner = at('2026-08-25T01:30:00Z');
  assert.equal(wallLocalDate(dinner), '2026-08-24');
  assert.equal(new Date(dinner).toISOString().slice(0, 10), '2026-08-25');
  assert.notEqual(wallLocalDate(dinner), new Date(dinner).toISOString().slice(0, 10));
});

test('the local date rolls at LOCAL midnight, not at 00:00Z', () => {
  assert.equal(wallLocalDate(at('2026-08-25T05:59:00Z')), '2026-08-24'); // 23:59 MDT
  assert.equal(wallLocalDate(at('2026-08-25T06:01:00Z')), '2026-08-25'); // 00:01 MDT
});

test('winter and summer both roll at local midnight — the offset is not hardcoded', () => {
  assert.equal(wallLocalDate(at('2026-01-15T06:59:00Z')), '2026-01-14'); // 23:59 MST
  assert.equal(wallLocalDate(at('2026-01-15T07:01:00Z')), '2026-01-15'); // 00:01 MST
});

test('the module under test is the only producer — it agrees with src/time.ts exactly', async () => {
  const { localDate } = await import('../src/time.ts');
  for (const iso of ['2026-03-08T09:00:00Z', '2026-11-01T08:30:00Z', '2026-06-30T23:59:59Z']) {
    assert.equal(wallLocalDate(at(iso)), localDate(new Date(at(iso))));
  }
});

// ---------------------------------------------------------------------------
// 2. The boundary fires exactly once, including across DST
// ---------------------------------------------------------------------------

/** Walks a window minute-by-minute and counts how many rollovers the watcher reports. */
function countRollovers(fromIso: string, toIso: string, stepMs: number): number {
  let watch = initialDateWatch();
  let fired = 0;
  for (let t = at(fromIso); t <= at(toIso); t += stepMs) {
    const observed = observeDate(watch, wallLocalDate(t));
    watch = observed.watch;
    if (observed.rolledOver) fired += 1;
  }
  return fired;
}

test('the first observation is NOT a rollover — the boot fetch already happened', () => {
  const first = observeDate(initialDateWatch(), '2026-08-25' as LocalDate);
  assert.equal(first.rolledOver, false);
  assert.equal(first.watch.lastDate, '2026-08-25');
});

test('a quiet day fires nothing — 96 ticks across one day, zero boundaries', () => {
  assert.equal(countRollovers('2026-08-24T06:30:00Z', '2026-08-25T05:00:00Z', 15 * 60_000), 0);
});

test('an ordinary midnight fires exactly once', () => {
  assert.equal(countRollovers('2026-08-24T20:00:00Z', '2026-08-25T12:00:00Z', 60_000), 1);
});

test('DST ENDS: 01:00–02:00 local happens twice and still fires exactly once', () => {
  // 2026-11-01, America/Denver: 02:00 MDT becomes 01:00 MST. Every wall-clock minute between
  // 01:00 and 02:00 occurs twice. A watcher keyed on anything but the formatted local DATE
  // would either fire twice or miss the real boundary at midnight.
  assert.equal(wallLocalDate(at('2026-11-01T07:30:00Z')), '2026-11-01'); // 01:30 MDT
  assert.equal(wallLocalDate(at('2026-11-01T08:30:00Z')), '2026-11-01'); // 01:30 MST, again
  assert.equal(countRollovers('2026-10-31T18:00:00Z', '2026-11-02T00:00:00Z', 60_000), 1);
});

test('DST STARTS: the hour that never happens still fires exactly once', () => {
  // 2026-03-08: 02:00 MST jumps to 03:00 MDT. There is no 02:30 local at all that day.
  assert.equal(wallLocalDate(at('2026-03-08T08:59:00Z')), '2026-03-08'); // 01:59 MST
  assert.equal(wallLocalDate(at('2026-03-08T09:01:00Z')), '2026-03-08'); // 03:01 MDT
  assert.equal(countRollovers('2026-03-07T18:00:00Z', '2026-03-09T00:00:00Z', 60_000), 1);
});

test('a clock STEPPED BACKWARDS over the boundary also fires — the wall is showing tomorrow', () => {
  // The Pi has no RTC. NTP can land after boot and move the clock back across midnight; the
  // wall is then displaying a day that is not today, which is the same failure mirrored.
  let watch = observeDate(initialDateWatch(), '2026-08-25' as LocalDate).watch;
  const stepped = observeDate(watch, '2026-08-24' as LocalDate);
  watch = stepped.watch;
  assert.equal(stepped.rolledOver, true);
  assert.equal(observeDate(watch, '2026-08-24' as LocalDate).rolledOver, false, 'and only once');
});

// ---------------------------------------------------------------------------
// 3. minClientBuild — reload only when GENUINELY older
// ---------------------------------------------------------------------------

test('a bundle at or above the minimum never reloads', () => {
  assert.equal(isStaleBuild(1, 1), false, 'equal is not older');
  assert.equal(isStaleBuild(7, 3), false, 'newer is not older');
  assert.equal(isStaleBuild(1, 2), true);
});

test('a missing or nonsense minimum is never a reason to reload', () => {
  for (const min of [undefined, null, 'soon', Number.NaN, Number.POSITIVE_INFINITY * 0]) {
    assert.equal(isStaleBuild(1, min), false, `min=${String(min)}`);
  }
  assert.equal(minBuildFromHeader(null), null);
  assert.equal(minBuildFromHeader(''), null);
  assert.equal(minBuildFromHeader('nope'), null);
  assert.equal(minBuildFromHeader('4'), 4);
});

test('the reload is rate limited, so a cached stale bundle cannot become a reload loop', () => {
  const now = at('2026-08-25T12:00:00Z');
  assert.deepEqual(shouldHardReload(1, 2, null, now), { reload: true, suppressed: null });
  assert.deepEqual(shouldHardReload(1, 2, now - 1_000, now), { reload: false, suppressed: 'cooldown' });
  assert.deepEqual(
    shouldHardReload(1, 2, now - RELOAD_COOLDOWN_MS - 1, now),
    { reload: true, suppressed: null },
  );
});

test('a clock that jumped backwards does not unlock the cooldown', () => {
  const now = at('2026-08-25T12:00:00Z');
  // Stamp "in the future" — what a backwards NTP step looks like from here.
  assert.equal(shouldHardReload(1, 2, now + 60 * 60_000, now).reload, false);
});

// ---------------------------------------------------------------------------
// 4. A snapshot for the wrong day is refetched, never rendered
// ---------------------------------------------------------------------------

function snapshot(overrides: Partial<WallSnapshot> = {}): WallSnapshot {
  const date = (overrides.freshness?.snapshotLocalDate ?? '2026-08-25') as LocalDate;
  return {
    freshness: {
      snapshotLocalDate: date,
      generatedAtUtc: '2026-08-25T12:00:00.000Z' as Utc,
      calendarSyncAgeSeconds: 10,
      calendarConfigured: true,
      routineMaterialization: 'ok',
    },
    requestedLocalDate: date,
    children: [],
    routines: [],
    chores: [],
    events: [],
    countdowns: [],
    balances: [],
    redemptions: [],
    apiVersion: 1,
    minClientBuild: CLIENT_BUILD,
    ...overrides,
  } as WallSnapshot;
}

test('a snapshot built for a different day is a refetch, not a render', () => {
  const yesterday = snapshot({
    freshness: {
      snapshotLocalDate: '2026-08-24' as LocalDate,
      generatedAtUtc: '2026-08-25T06:00:00.000Z' as Utc,
      calendarSyncAgeSeconds: 5,
      calendarConfigured: true,
      routineMaterialization: 'ok',
    },
  });
  assert.deepEqual(evaluateSnapshot('2026-08-25' as LocalDate, yesterday), { kind: 'refetch' });
  assert.deepEqual(evaluateSnapshot('2026-08-24' as LocalDate, yesterday), {
    kind: 'accept',
    snapshot: yesterday,
  });
});

test('the comparison is against what the server BUILT, not against its own echo', () => {
  // `requestedLocalDate` agrees with itself even when the build did not. Only
  // `freshness.snapshotLocalDate` is evidence.
  const lying = snapshot({ requestedLocalDate: '2026-08-25' as LocalDate });
  const built = lying.freshness.snapshotLocalDate;
  assert.equal(built, '2026-08-25');
  const mismatched = { ...lying, freshness: { ...lying.freshness, snapshotLocalDate: '2026-08-24' as LocalDate } };
  assert.deepEqual(evaluateSnapshot('2026-08-25' as LocalDate, mismatched), { kind: 'refetch' });
});

test('a body that is not a snapshot degrades — it never renders and never throws', () => {
  for (const body of [null, 'nope', 42, [], {}, { freshness: {} }, { freshness: { snapshotLocalDate: 1 } }]) {
    assert.equal(isRenderableSnapshot(body), false, JSON.stringify(body));
    assert.deepEqual(evaluateSnapshot('2026-08-25' as LocalDate, body), {
      kind: 'degrade',
      reason: 'malformed',
    });
  }
});

test('a snapshot carrying fields this bundle has never heard of is still rendered', () => {
  // Forward compatibility is not politeness — rejecting an unknown field is a blank wall the
  // next time somebody adds one to the contract.
  const future = { ...snapshot(), somethingNew: { deeply: ['nested'] } };
  assert.equal(isRenderableSnapshot(future), true);
});

test('every failure status maps to keep-the-last-good, and 426 maps to reload', () => {
  const d = '2026-08-25' as LocalDate;
  assert.deepEqual(classifyResponse(d, 426, { error: 'stale_client' }), { kind: 'reload' });
  assert.deepEqual(classifyResponse(d, 403, { error: 'device_revoked' }), {
    kind: 'degrade',
    reason: 'device_revoked',
  });
  assert.deepEqual(classifyResponse(d, 409, { error: 'date_mismatch' }), { kind: 'refetch' });
  for (const status of [0, 404, 500, 502, 503, 504]) {
    assert.deepEqual(
      classifyResponse(d, status, { error: 'unavailable' }),
      { kind: 'degrade', reason: 'unreachable' },
      `status ${String(status)}`,
    );
  }
});

// ---------------------------------------------------------------------------
// 5. Backoff is bounded and a refresh path always exists
// ---------------------------------------------------------------------------

test('the stream backoff is bounded at one minute, for any failure count and any jitter', () => {
  for (let failures = 0; failures <= 200; failures++) {
    for (const jitter of [0, 0.25, 0.5, 0.75, 1]) {
      const delay = sseDelayMs(failures, jitter);
      assert.ok(Number.isFinite(delay), `finite at ${String(failures)}`);
      assert.ok(delay >= 0, `non-negative at ${String(failures)}`);
      assert.ok(delay <= SSE_BACKOFF_MAX_MS, `bounded at ${String(failures)}/${String(jitter)}`);
    }
  }
});

test('the first reconnect after a healthy stream is immediate', () => {
  assert.equal(sseDelayMs(0), 0);
  assert.ok(sseDelayMs(1) > 0, 'and the second is not a hot loop');
});

test('the backoff actually grows before it saturates', () => {
  const flat = (n: number) => sseDelayMs(n, 0.5);
  assert.ok(flat(1) < flat(3));
  assert.ok(flat(3) < flat(5));
  assert.equal(flat(40), SSE_BACKOFF_MAX_MS);
});

test('the poll interval is FINITE for every input — there is always another chance', () => {
  for (const failures of [0, 1, 2, 5, 1_000, 1e9, Number.NaN, Number.POSITIVE_INFINITY, -1]) {
    const interval = pollIntervalMs(failures);
    assert.ok(Number.isFinite(interval), `finite for ${String(failures)}`);
    assert.ok(interval > 0 && interval <= POLL_HEALTHY_MS, `sane for ${String(failures)}`);
  }
});

test('a dead stream tightens the poll rather than abandoning it', () => {
  assert.equal(pollIntervalMs(0), POLL_HEALTHY_MS);
  assert.equal(pollIntervalMs(SSE_DEAD_AFTER_FAILURES - 1), POLL_HEALTHY_MS);
  assert.equal(pollIntervalMs(SSE_DEAD_AFTER_FAILURES), POLL_DEGRADED_MS);
  assert.equal(pollIntervalMs(10_000), POLL_DEGRADED_MS);
  assert.ok(POLL_DEGRADED_MS < POLL_HEALTHY_MS);
});

test('the retry schedules are bounded too', () => {
  for (let n = 0; n <= 100; n++) {
    assert.ok(mismatchRetryMs(n) <= 30_000, `mismatch ${String(n)}`);
    assert.ok(fetchRetryMs(n) <= 60_000, `fetch ${String(n)}`);
    assert.ok(mismatchRetryMs(n) > 0 && fetchRetryMs(n) > 0);
  }
});

// ---------------------------------------------------------------------------
// 6. The wire format, read by hand because EventSource cannot send a header
// ---------------------------------------------------------------------------

test('a message split across arbitrary chunk boundaries still arrives whole', () => {
  const wire = 'retry: 3000\n\nid: 1\ndata: {"type":"invalidate","scope":"chores"}\n\n';
  for (let cut = 1; cut < wire.length; cut++) {
    const decoder = createSseDecoder();
    const out = [...decoder.push(wire.slice(0, cut)), ...decoder.push(wire.slice(cut))];
    assert.deepEqual(out, ['{"type":"invalidate","scope":"chores"}'], `cut at ${String(cut)}`);
  }
});

test('CRLF, comments and multi-line data are all handled', () => {
  const decoder = createSseDecoder();
  assert.deepEqual(decoder.push(': keep-alive\r\n\r\n'), [], 'a comment dispatches nothing');
  assert.deepEqual(decoder.push('data: one\r\ndata: two\r\n\r\n'), ['one\ntwo']);
  assert.deepEqual(decoder.push('data:nospace\n\n'), ['nospace'], 'the space after the colon is optional');
});

test('the exact bytes Unit F writes decode to exactly one heartbeat', () => {
  // Captured from a live `curl -N` against the running server, byte for byte.
  const decoder = createSseDecoder();
  const payloads = decoder.push(
    'retry: 3000\n\nid: 2\ndata: {"type":"heartbeat","generatedAtUtc":"2026-08-25T01:13:59.166Z","minClientBuild":1}\n\n',
  );
  assert.equal(payloads.length, 1);
  assert.deepEqual(parseWallEvent(payloads[0] ?? ''), {
    type: 'heartbeat',
    generatedAtUtc: '2026-08-25T01:13:59.166Z',
    minClientBuild: 1,
  });
});

test('an unparseable or unknown event is dropped, never coerced into a fact', () => {
  assert.equal(parseWallEvent('not json'), null);
  assert.equal(parseWallEvent('[1,2,3]'), null);
  assert.equal(parseWallEvent('{"type":"something-new"}'), null);
  assert.equal(parseWallEvent('{"type":"heartbeat"}'), null, 'a heartbeat without a build says nothing');
});

test('an unknown invalidate scope widens to "all" rather than being dropped', () => {
  // The client refetches the whole snapshot for every scope, so widening is free — and losing
  // an invalidation is not.
  assert.deepEqual(parseWallEvent('{"type":"invalidate","scope":"pets"}'), {
    type: 'invalidate',
    scope: 'all',
  });
});

// ---------------------------------------------------------------------------
// 7. The device token, which comes from the Pi and not from the server
// ---------------------------------------------------------------------------

test('the token is lifted out of the fragment and the fragment is left clean', () => {
  assert.equal(tokenFromHash('#dt=abc123'), 'abc123');
  assert.equal(tokenFromHash('#a=1&dt=abc123&b=2'), 'abc123');
  assert.equal(tokenFromHash('#dt=a%2Fb'), 'a/b');
  assert.equal(tokenFromHash('#nope=1'), null);
  assert.equal(tokenFromHash(''), null);
  assert.equal(hashWithoutToken('#a=1&dt=abc&b=2'), '#a=1&b=2');
  assert.equal(hashWithoutToken('#dt=abc'), '');
});

test('a stored token survives the hard reload that strips the fragment', () => {
  const map = new Map<string, string>();
  const store: KeyValueStore = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
  assert.equal(resolveDeviceToken('#dt=fromgate', store), 'fromgate');
  // The reload lands on a URL with no fragment. Without the store the wall would come back
  // credential-less and render the offline card forever.
  assert.equal(resolveDeviceToken('', store), 'fromgate');
});

test('no token means no Authorization header — never a blank one', () => {
  assert.deepEqual(wallHeaders(null, 'x-client-build', 1), { 'x-client-build': '1' });
  assert.deepEqual(wallHeaders('', 'x-client-build', 1), { 'x-client-build': '1' });
  assert.deepEqual(wallHeaders('t', 'x-client-build', 1), {
    'x-client-build': '1',
    authorization: 'Device t',
  });
});

// ---------------------------------------------------------------------------
// 8. The controller, driven end to end with an injected clock and fetch
// ---------------------------------------------------------------------------

interface Harness {
  deps: WallDataDeps;
  advance(ms: number): void;
  reloads: number;
  snapshotCalls: number;
  streamCalls: number;
  store: KeyValueStore;
  logs: WallDataLog[];
  refreshes(reason: RefreshReason): number;
}

interface SseChannel {
  stream: ReadableStream<Uint8Array>;
  push(text: string): void;
  close(): void;
}

/** A real `ReadableStream` the test can write SSE frames into, one chunk at a time. */
function sseChannel(): SseChannel {
  let ctrl: ReadableStreamDefaultController<Uint8Array> | null = null;
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      ctrl = c;
    },
  });
  return {
    stream,
    push: (text) => {
      ctrl?.enqueue(encoder.encode(text));
    },
    close: () => {
      try {
        ctrl?.close();
      } catch {
        /* already closed */
      }
    },
  };
}

interface Reply {
  status: number;
  body?: unknown;
  minHeader?: string | null;
  /** Present for a stream reply that should actually stay open. */
  sse?: SseChannel;
}

function harness(
  reply: (url: string, call: number) => Reply | 'reject',
  startMs = at('2026-08-25T12:00:00Z'),
): Harness {
  const map = new Map<string, string>();
  const logs: WallDataLog[] = [];
  const state = {
    now: startMs,
    reloads: 0,
    snapshotCalls: 0,
    streamCalls: 0,
  };
  const store: KeyValueStore = {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };

  const fetchImpl = async (input: string): Promise<Response> => {
    const isStream = input.includes('/stream');
    const call = isStream ? (state.streamCalls += 1) : (state.snapshotCalls += 1);
    const r = reply(input, call);
    if (r === 'reject') throw new Error('network down');
    return {
      status: r.status,
      headers: { get: (name: string) => (name.toLowerCase() === 'x-min-client-build' ? (r.minHeader ?? null) : null) },
      json: async () => {
        if (r.body === undefined) throw new Error('not json');
        return r.body;
      },
      // A null body is what an injected non-streaming reply looks like, and the stream loop
      // treats it as a failure — which is exactly right.
      body: r.sse?.stream ?? null,
    } as unknown as Response;
  };

  const h: Harness = {
    deps: {
      fetchImpl,
      now: () => state.now,
      // No real timers anywhere: the tests drive `tick()` themselves.
      setTimer: () => 0,
      clearTimer: () => {},
      hardReload: () => {
        state.reloads += 1;
      },
      store,
      deviceToken: 'test-token',
      random: () => 0.5,
      tickMs: 15_000,
      onLog: (event) => logs.push(event),
    },
    advance(ms) {
      state.now += ms;
    },
    get reloads() {
      return state.reloads;
    },
    get snapshotCalls() {
      return state.snapshotCalls;
    },
    get streamCalls() {
      return state.streamCalls;
    },
    store,
    logs,
    refreshes: (reason) => logs.filter((l) => l.kind === 'refresh' && l.reason === reason).length,
  };
  return h;
}

async function settle(turns = 8): Promise<void> {
  for (let i = 0; i < turns; i++) await new Promise((resolve) => setImmediate(resolve));
}

test('the happy path: one fetch, one render, no reload', async () => {
  const good = snapshot();
  const h = harness((url) => (url.includes('/stream') ? { status: 200 } : { status: 200, body: good }));
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  assert.equal(controller.getState().snapshot, good);
  assert.equal(controller.getState().degraded, null);
  assert.equal(h.reloads, 0);
  controller.stop();
});

test('the request carries the CLIENT’s own local date, not the server’s idea of one', async () => {
  const urls: string[] = [];
  const good = snapshot({
    freshness: {
      snapshotLocalDate: '2026-08-24' as LocalDate,
      generatedAtUtc: '2026-08-25T01:30:00.000Z' as Utc,
      calendarSyncAgeSeconds: 1,
      calendarConfigured: true,
      routineMaterialization: 'ok',
    },
  });
  // 19:30 local on the 24th. A UTC-derived date would ask for the 25th.
  const h = harness((url) => {
    urls.push(url);
    return url.includes('/stream') ? { status: 200 } : { status: 200, body: good };
  }, at('2026-08-25T01:30:00Z'));

  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  assert.ok(urls.some((u) => u.includes('localDate=2026-08-24')), urls.join(' '));
  assert.ok(!urls.some((u) => u.includes('localDate=2026-08-25')), urls.join(' '));
  assert.equal(controller.getState().snapshot, good);
  controller.stop();
});

test('a snapshot for the wrong day is NOT rendered, and is asked for again', async () => {
  const yesterday = snapshot({
    freshness: {
      snapshotLocalDate: '2026-08-24' as LocalDate,
      generatedAtUtc: '2026-08-25T12:00:00.000Z' as Utc,
      calendarSyncAgeSeconds: 1,
      calendarConfigured: true,
      routineMaterialization: 'ok',
    },
  });
  const today = snapshot();
  const h = harness((url, call) => {
    if (url.includes('/stream')) return { status: 200 };
    return { status: 200, body: call <= 2 ? yesterday : today };
  });

  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  assert.equal(controller.getState().snapshot, null, 'the wrong day never reaches the screen');

  // The retry is a deadline, not a timer: advance the clock and tick.
  h.advance(mismatchRetryMs(1) + 1);
  await controller.tick();
  await settle();
  assert.equal(controller.getState().snapshot, null, 'still the wrong day, still not rendered');

  h.advance(mismatchRetryMs(2) + 1);
  await controller.tick();
  await settle();
  assert.equal(controller.getState().snapshot, today, 'and the right day renders');
  controller.stop();
});

test('a server stuck on the wrong day gives up asking and degrades, keeping the last good wall', async () => {
  const today = snapshot();
  const yesterday = snapshot({
    freshness: {
      snapshotLocalDate: '2026-08-24' as LocalDate,
      generatedAtUtc: '2026-08-25T12:00:00.000Z' as Utc,
      calendarSyncAgeSeconds: 1,
      calendarConfigured: true,
      routineMaterialization: 'ok',
    },
  });
  let serveWrongDay = false;
  const h = harness((url) => {
    if (url.includes('/stream')) return { status: 200 };
    return { status: 200, body: serveWrongDay ? yesterday : today };
  });

  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  assert.equal(controller.getState().snapshot, today);

  serveWrongDay = true;
  for (let n = 1; n <= MISMATCH_MAX_RETRIES + 1; n++) {
    await controller.refresh('poll');
    await settle();
    h.advance(mismatchRetryMs(n) + 1);
  }

  assert.equal(controller.getState().snapshot, today, 'the good wall is still on screen');
  assert.equal(controller.getState().degraded, 'date_mismatch', 'and it is labelled');
  controller.stop();
});

test('a 503 keeps the last good snapshot on screen and never reloads', async () => {
  const good = snapshot();
  let fail = false;
  const h = harness((url) => {
    if (url.includes('/stream')) return { status: 200 };
    return fail ? { status: 503, body: { error: 'unavailable' } } : { status: 200, body: good };
  });

  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  assert.equal(controller.getState().snapshot, good);

  fail = true;
  await controller.refresh('poll');
  await settle();

  assert.equal(controller.getState().snapshot, good, 'yesterday’s wall, not a blank one');
  assert.equal(controller.getState().degraded, 'unreachable');
  assert.equal(h.reloads, 0, 'an error is NEVER a reason to reload');
  controller.stop();
});

test('a network that is simply gone never reloads and never throws', async () => {
  const h = harness(() => 'reject');
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  assert.equal(controller.getState().snapshot, null);
  assert.equal(controller.getState().degraded, 'unreachable');
  assert.equal(h.reloads, 0);
  controller.stop();
});

test('a revoked device degrades to the offline card, not to a login', async () => {
  const h = harness((url) =>
    url.includes('/stream')
      ? { status: 403, body: { error: 'device_revoked' } }
      : { status: 403, body: { error: 'device_revoked' } },
  );
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  assert.equal(controller.getState().degraded, 'device_revoked');
  assert.equal(h.reloads, 0);
  controller.stop();
});

test('a genuinely stale bundle reloads once, and the loop guard stops the second', async () => {
  const h = harness((url) =>
    url.includes('/stream')
      ? { status: 200, minHeader: String(CLIENT_BUILD + 1) }
      : { status: 200, minHeader: String(CLIENT_BUILD + 1), body: snapshot() },
  );
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  assert.equal(h.reloads, 1, 'the header alone is enough — it is on every response');
  assert.ok(h.store.getItem(RELOAD_STAMP_KEY) !== null, 'and the stamp survives the reload');

  await controller.refresh('poll');
  await settle();
  assert.equal(h.reloads, 1, 'a cached stale bundle must not flicker forever');

  h.advance(RELOAD_COOLDOWN_MS + 1);
  await controller.refresh('poll');
  await settle();
  assert.equal(h.reloads, 2, 'but a genuine second attempt is allowed later');
  controller.stop();
});

test('a bundle that is NOT stale never reloads, however many responses it sees', async () => {
  const h = harness((url) =>
    url.includes('/stream')
      ? { status: 200, minHeader: String(CLIENT_BUILD) }
      : { status: 200, minHeader: String(CLIENT_BUILD), body: snapshot() },
  );
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  for (let i = 0; i < 5; i++) {
    await controller.refresh('poll');
    await settle();
  }
  assert.equal(h.reloads, 0);
  controller.stop();
});

test('a local date boundary refetches, exactly once, without any page load', async () => {
  const urls: string[] = [];
  const h = harness((url) => {
    urls.push(url);
    if (url.includes('/stream')) return { status: 200 };
    const date = new URL(url, 'http://x').searchParams.get('localDate') ?? '2026-08-25';
    return {
      status: 200,
      body: snapshot({
        freshness: {
          snapshotLocalDate: date as LocalDate,
          generatedAtUtc: '2026-08-25T12:00:00.000Z' as Utc,
          calendarSyncAgeSeconds: 1,
          calendarConfigured: true,
          routineMaterialization: 'ok',
        },
      }),
    };
  }, at('2026-08-26T05:59:00Z')); // 23:59 local

  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  assert.ok(urls.some((u) => u.includes('localDate=2026-08-25')));
  assert.equal(h.refreshes('date-boundary'), 0, 'booting is not a rollover');

  h.advance(2 * 60_000); // 00:01 local, the next day
  await controller.tick();
  await settle();
  assert.equal(h.refreshes('date-boundary'), 1, 'the rollover fetched');
  assert.ok(urls.some((u) => u.includes('localDate=2026-08-26')));

  // Keep ticking through the new day. Ordinary polling may fetch; the BOUNDARY must not fire
  // again, because the wall would otherwise re-ask on every tick for the rest of the day.
  for (let i = 0; i < 10; i++) {
    h.advance(60_000);
    await controller.tick();
    await settle();
  }
  assert.equal(h.refreshes('date-boundary'), 1, 'and it does not keep firing');
  controller.stop();
});

test('an open stream is itself a reason to refetch — SSE carries no state', async () => {
  const channel = sseChannel();
  const h = harness((url) =>
    url.includes('/stream') ? { status: 200, sse: channel } : { status: 200, body: snapshot() },
  );
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  assert.equal(controller.getState().streamConnected, true);
  assert.equal(h.refreshes('stream-open'), 1, 'whatever changed while it was down was never pushed');

  channel.push('id: 1\ndata: {"type":"invalidate","scope":"chores"}\n\n');
  await settle();
  assert.equal(h.refreshes('invalidate'), 1);

  // A frame split across two chunks must still land.
  channel.push('id: 2\ndata: {"type":"invalid');
  await settle();
  assert.equal(h.refreshes('invalidate'), 1, 'a half-arrived frame does nothing yet');
  channel.push('ate","scope":"routines"}\n\n');
  await settle();
  assert.equal(h.refreshes('invalidate'), 2);

  controller.stop();
  channel.close();
});

test('a heartbeat carrying a higher minimum reloads before anything is parsed', async () => {
  const channel = sseChannel();
  const h = harness((url) =>
    url.includes('/stream') ? { status: 200, sse: channel } : { status: 200, body: snapshot() },
  );
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  assert.equal(h.reloads, 0);

  channel.push(
    `id: 3\ndata: {"type":"heartbeat","generatedAtUtc":"2026-08-25T12:00:00.000Z","minClientBuild":${String(CLIENT_BUILD + 1)}}\n\n`,
  );
  await settle();
  assert.equal(h.reloads, 1);

  controller.stop();
  channel.close();
});

test('a stream that drops is reconnected, and the wall is refetched when it comes back', async () => {
  const first = sseChannel();
  const second = sseChannel();
  const h = harness((url, call) => {
    if (!url.includes('/stream')) return { status: 200, body: snapshot() };
    return { status: 200, sse: call === 1 ? first : second };
  });
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  assert.equal(controller.getState().streamConnected, true);

  first.close();
  await settle();
  assert.equal(controller.getState().streamConnected, false);

  h.advance(SSE_BACKOFF_MAX_MS + 1);
  await controller.tick();
  await settle();
  assert.equal(controller.getState().streamConnected, true, 'reconnected');
  assert.equal(h.refreshes('stream-open'), 2, 'and refetched, because nothing was pushed meanwhile');

  controller.stop();
  second.close();
});

test('a permanently dead stream still leaves the wall a working refresh path', async () => {
  let snapshots = 0;
  const h = harness((url) => {
    if (url.includes('/stream')) return 'reject';
    snapshots += 1;
    return { status: 200, body: snapshot() };
  });

  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  const afterBoot = snapshots;
  assert.equal(controller.getState().streamConnected, false);

  // Let the stream fail enough times that the poll is allowed to tighten.
  for (let i = 0; i < 4; i++) {
    h.advance(SSE_BACKOFF_MAX_MS + 1);
    await controller.tick();
    await settle();
  }
  assert.ok(h.streamCalls > 1, 'it keeps trying to reconnect');

  const beforePoll = snapshots;
  h.advance(POLL_DEGRADED_MS + 1);
  await controller.tick();
  await settle();
  assert.ok(snapshots > beforePoll, 'and the poll fetched anyway');
  assert.ok(snapshots > afterBoot);
  assert.equal(h.reloads, 0);
  controller.stop();
});

test('concurrent refreshes coalesce into at most one extra fetch', async () => {
  const h = harness((url) => (url.includes('/stream') ? { status: 200 } : { status: 200, body: snapshot() }));
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  const before = h.snapshotCalls;

  await Promise.all([
    controller.refresh('invalidate'),
    controller.refresh('invalidate'),
    controller.refresh('invalidate'),
    controller.refresh('invalidate'),
  ]);
  await settle();

  const added = h.snapshotCalls - before;
  assert.ok(added >= 1 && added <= 2, `a burst of taps must not become a burst of fetches (got ${String(added)})`);
  controller.stop();
});

test('the shell reporting the SAME date a thousand times causes zero fetches', async () => {
  // Regression, and an expensive one. `WallApp` reports its own local date from an effect
  // whose dependency array includes the callback identity, so a callback rebuilt on every
  // state change closes a loop: report -> refetch -> new state -> new identity -> report.
  // MEASURED in headless Chromium against a real server before this was fixed: 2404 snapshot
  // requests in eight seconds, climbing, and invisible from the living room until the server
  // fell over. `reportShellDate` is idempotent by date so the loop cannot exist at all.
  const h = harness((url) => (url.includes('/stream') ? { status: 200 } : { status: 200, body: snapshot() }));
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  const before = h.snapshotCalls;
  const today = wallLocalDate(at('2026-08-25T12:00:00Z'));
  for (let i = 0; i < 1_000; i++) controller.reportShellDate(today);
  await settle();

  assert.equal(h.snapshotCalls, before, 'a date that has not changed is not news');
  assert.equal(h.refreshes('date-boundary'), 0);
  controller.stop();
});

test('but the shell reporting a NEW date does refetch — it is a real second clock', async () => {
  const h = harness((url) => (url.includes('/stream') ? { status: 200 } : { status: 200, body: snapshot() }));
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  controller.reportShellDate('2026-08-26' as LocalDate);
  await settle();
  assert.equal(h.refreshes('date-boundary'), 1);

  // …and having said it once, saying it again is not a second rollover.
  for (let i = 0; i < 50; i++) controller.reportShellDate('2026-08-26' as LocalDate);
  await settle();
  assert.equal(h.refreshes('date-boundary'), 1);
  controller.stop();
});

test('two clocks watching one midnight fire at most once EACH, and then stop', async () => {
  const h = harness(
    (url) => (url.includes('/stream') ? { status: 200 } : { status: 200, body: snapshot() }),
    at('2026-08-26T05:59:00Z'),
  );
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();

  h.advance(2 * 60_000); // past local midnight
  const shellDate = wallLocalDate(at('2026-08-26T06:01:00Z'));

  // The shell and the controller keep SEPARATE watches on purpose. Sharing one would let a
  // momentary disagreement between the two clocks flap the boundary back and forth — fire on
  // the shell's "tomorrow", fire again on the controller's lagging "today", and again — which
  // is a far worse failure than the thing sharing would save. What it costs is at most one
  // duplicate fetch per midnight, once a day, which is nothing.
  controller.reportShellDate(shellDate);
  await controller.tick();
  await settle();
  const afterBoundary = h.refreshes('date-boundary');
  assert.ok(afterBoundary >= 1 && afterBoundary <= 2, `bounded, got ${String(afterBoundary)}`);

  // The property that actually matters: it converges. Neither observer keeps firing.
  for (let i = 0; i < 20; i++) {
    controller.reportShellDate(shellDate);
    await controller.tick();
    await settle();
  }
  assert.equal(h.refreshes('date-boundary'), afterBoundary, 'and neither fires again');
  controller.stop();
});

test('stop() means stop — nothing is scheduled after it', async () => {
  const h = harness((url) => (url.includes('/stream') ? { status: 200 } : { status: 200, body: snapshot() }));
  const controller = createWallDataController(h.deps);
  controller.start();
  await settle();
  controller.stop();

  const before = h.snapshotCalls;
  h.advance(POLL_HEALTHY_MS * 4);
  await controller.tick();
  await controller.refresh('poll');
  await settle();
  assert.equal(h.snapshotCalls, before);
});
