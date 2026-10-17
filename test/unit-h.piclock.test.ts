/**
 * Unit H — clock evidence from the Pi's own timesyncd, and refusing it when it is not real.
 *
 * This is the source that closes the two holes `serverClock.ts` documents in its own header: it
 * knows when the Pi actually last synced, and it keeps answering with the network down, which
 * is the post-power-cut case the whole time box exists for.
 *
 * The tests are almost all about refusing. The gate this evidence feeds decides whether a
 * playful picture may cover the morning routine, so evidence that is invented, partial, or
 * fetched from somewhere untrustworthy is worse than no evidence at all — no evidence closes
 * the gate and shows the board, which is the screen the prime invariant is about.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  gateOriginFromHash,
  parsePiClock,
  readPiClock,
} from '../web/src/views/logic/piClock.ts';
import { preferPiEvidence } from '../web/src/app/usePiClock.ts';
import { evaluateClockEvidence } from '../web/src/views/logic/timeTrust.ts';
import type { ClockEvidence } from '../web/src/views/logic/timeTrust.ts';

// The gate's real answer, captured off the panel 2026-08-27.
const REAL = {
  osSynchronised: true,
  syncedSinceBoot: true,
  lastSyncAtMs: 1787844797793,
  nowMs: 1787845436767,
  lastShutdownAtMs: 1787845416232,
};

// ---------------------------------------------------------------------------
// Where we are willing to fetch from
// ---------------------------------------------------------------------------

test('a loopback gate origin is accepted', () => {
  assert.equal(
    gateOriginFromHash('#gate=http%3A%2F%2F127.0.0.1%3A18765'),
    'http://127.0.0.1:18765',
  );
  assert.equal(
    gateOriginFromHash('#dt=abc&gate=http%3A%2F%2Flocalhost%3A18765'),
    'http://localhost:18765',
  );
});

test('a NON-loopback origin is refused', () => {
  // `gate=` arrives in a URL fragment, which anything that can put a URL in front of this kiosk
  // can write. Accepting an arbitrary host would let a passer-by choose who answers the
  // question "is this wall's clock right", and that answer decides whether a picture is allowed
  // to cover the morning routine.
  for (const bad of [
    'http://example.com',
    'http://192.168.1.50:18765',
    'http://homeserver:18765',
    'https://127.0.0.1:18765',
    'file:///etc/passwd',
    'javascript:alert(1)',
    'http://127.0.0.1.evil.com',
  ]) {
    assert.equal(
      gateOriginFromHash(`#gate=${encodeURIComponent(bad)}`),
      null,
      `${bad} must be refused`,
    );
  }
});

test('a missing, empty or malformed fragment yields no origin', () => {
  for (const h of [undefined, '', '#', '#dt=abc', '#gate=', '#gate=not a url', 'nonsense']) {
    assert.equal(gateOriginFromHash(h), null);
  }
});

// ---------------------------------------------------------------------------
// Parsing — a Python producer and a TypeScript consumer
// ---------------------------------------------------------------------------

test('the gate’s real payload parses', () => {
  assert.deepEqual(parsePiClock(REAL), REAL);
});

test('a null lastSyncAtMs or lastShutdownAtMs is legal — a fresh box has neither', () => {
  const fresh = { ...REAL, lastSyncAtMs: null, lastShutdownAtMs: null };
  assert.deepEqual(parsePiClock(fresh), fresh);
});

test('a MISSING field refuses the whole payload rather than filling a default', () => {
  // The producer is Python. A rename on that side arrives here as `undefined`, and a default
  // would let it be graded as if it were real — in a direction nobody chose.
  for (const key of ['osSynchronised', 'syncedSinceBoot', 'lastSyncAtMs', 'nowMs', 'lastShutdownAtMs']) {
    const partial: Record<string, unknown> = { ...REAL };
    delete partial[key];
    assert.equal(parsePiClock(partial), null, `missing ${key} must refuse`);
  }
});

test('a field of the wrong type refuses', () => {
  assert.equal(parsePiClock({ ...REAL, osSynchronised: 'yes' }), null);
  assert.equal(parsePiClock({ ...REAL, syncedSinceBoot: 1 }), null);
  assert.equal(parsePiClock({ ...REAL, nowMs: '1787845436767' }), null);
  assert.equal(parsePiClock({ ...REAL, nowMs: Number.NaN }), null);
  assert.equal(parsePiClock({ ...REAL, lastSyncAtMs: 'never' }), null);
});

test('anything that is not an object at all refuses', () => {
  for (const junk of [null, undefined, 42, 'ok', [], true]) {
    assert.equal(parsePiClock(junk), null);
  }
});

// ---------------------------------------------------------------------------
// Fetching — every failure is null, and it never rejects
// ---------------------------------------------------------------------------

test('no origin means no request and no evidence', async () => {
  let called = false;
  const spy = (() => {
    called = true;
    throw new Error('must not be called');
  }) as unknown as typeof fetch;
  assert.equal(await readPiClock(null, spy), null);
  assert.equal(called, false);
});

test('a good response becomes evidence', async () => {
  const ok = (() =>
    Promise.resolve({ ok: true, json: () => Promise.resolve(REAL) })) as unknown as typeof fetch;
  assert.deepEqual(await readPiClock('http://127.0.0.1:18765', ok), REAL);
});

test('a non-2xx, a network error, or unreadable JSON all become null', async () => {
  const notOk = (() => Promise.resolve({ ok: false })) as unknown as typeof fetch;
  assert.equal(await readPiClock('http://127.0.0.1:18765', notOk), null);

  const boom = (() => Promise.reject(new Error('ECONNREFUSED'))) as unknown as typeof fetch;
  assert.equal(await readPiClock('http://127.0.0.1:18765', boom), null);

  const badJson = (() =>
    Promise.resolve({ ok: true, json: () => Promise.reject(new Error('not json')) })) as unknown as typeof fetch;
  assert.equal(await readPiClock('http://127.0.0.1:18765', badJson), null);
});

test('the request carries no custom headers, so no CORS preflight is provoked', async () => {
  // The gate is a stdlib handler with no OPTIONS route: a preflight would fail the whole thing.
  let init: RequestInit | undefined;
  const spy = ((_url: string, i: RequestInit) => {
    init = i;
    return Promise.resolve({ ok: true, json: () => Promise.resolve(REAL) });
  }) as unknown as typeof fetch;
  await readPiClock('http://127.0.0.1:18765', spy);
  assert.equal(init?.headers, undefined, 'a header here would turn this into a preflighted request');
  assert.equal(init?.method ?? 'GET', 'GET');
});

// ---------------------------------------------------------------------------
// Preferring it — and the `nowMs` substitution, which is the subtle part
// ---------------------------------------------------------------------------

const SERVER: ClockEvidence = {
  osSynchronised: true,
  syncedSinceBoot: true,
  lastSyncAtMs: 1787845436767,
  nowMs: 1787845436767,
  lastShutdownAtMs: 1787845316767,
};

test('with no Pi evidence, the server stamp is used unchanged', () => {
  assert.deepEqual(preferPiEvidence(null, SERVER, 999), SERVER);
});

test('Pi evidence wins, but takes the CURRENT now rather than the polled one', () => {
  // The payload's `nowMs` is as old as the last poll — up to a minute. Left alone it would
  // understate the sync age by that much, which fails OPEN on a gate whose whole purpose is to
  // fail closed. Same physical clock, read at the more recent moment.
  const now = REAL.nowMs + 55_000;
  const merged = preferPiEvidence(REAL, SERVER, now);
  assert.equal(merged.nowMs, now, 'now comes from the render, not the payload');
  assert.equal(merged.lastSyncAtMs, REAL.lastSyncAtMs, 'the sync time comes from the Pi');
  assert.equal(merged.lastShutdownAtMs, REAL.lastShutdownAtMs);
});

// ---------------------------------------------------------------------------
// End to end through the gate it feeds
// ---------------------------------------------------------------------------

test('the panel’s real evidence is TRUSTED', () => {
  const verdict = evaluateClockEvidence(preferPiEvidence(REAL, SERVER, REAL.nowMs));
  assert.equal(verdict.trusted, true, verdict.trusted ? '' : verdict.detail);
});

test('a Pi that has not synced this boot is NOT trusted, which is the whole point', () => {
  // The post-power-cut case. The old server-stamp evidence could not see this at all: a
  // snapshot would arrive from homeserver and the wall would believe its own wrong clock.
  const justBooted: ClockEvidence = {
    osSynchronised: false,
    syncedSinceBoot: false,
    lastSyncAtMs: null,
    nowMs: REAL.nowMs,
    lastShutdownAtMs: null,
  };
  const verdict = evaluateClockEvidence(preferPiEvidence(justBooted, SERVER, REAL.nowMs));
  assert.equal(verdict.trusted, false);
  assert.ok(verdict.failures.includes('not-synchronised'));
  assert.ok(verdict.failures.includes('no-sync-this-boot'));
});

test('a clock that drifted AFTER a good sync is caught — the hole serverClock could not see', () => {
  // serverClock.ts says outright that it cannot speak to sync recency: a build stamp says when
  // homeserver made a snapshot, not when this device last heard a trustworthy time. Four hours past
  // the last sync, the three-hour ceiling finally has something real to measure.
  const stale = { ...REAL, nowMs: REAL.lastSyncAtMs + 4 * 60 * 60 * 1000 };
  const verdict = evaluateClockEvidence(preferPiEvidence(stale, SERVER, stale.nowMs));
  assert.equal(verdict.trusted, false);
  assert.ok(verdict.failures.includes('sync-too-old'), verdict.detail);
});

test('a clock standing behind its own persistent floor is caught', () => {
  const backwards = { ...REAL, nowMs: REAL.lastShutdownAtMs - 60_000 };
  const verdict = evaluateClockEvidence(preferPiEvidence(backwards, SERVER, backwards.nowMs));
  assert.equal(verdict.trusted, false);
  assert.ok(verdict.failures.includes('clock-behind-floor'), verdict.detail);
});
