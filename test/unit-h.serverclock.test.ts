/**
 * The regression that put the information board on the wall for a correct clock.
 *
 * The first version of `serverClockEvidence` compared `|now - stamped|` against a two-minute
 * tolerance. `generatedAtUtc` is a BUILD STAMP, not a heartbeat, so on a wall that holds one
 * snapshot the difference grows without bound — and the gate closed two minutes after every
 * page load, on a Pi whose clock was right. Measured on the panel: `data-idle-why` went
 * `not-synchronised`, then `no fresh server time`, thirty seconds apart.
 *
 * These tests are the shape of that bug, so it cannot come back.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Freshness } from '../src/types.ts';
import {
  CLOCK_AHEAD_LIMIT_MS,
  CLOCK_BEHIND_TOLERANCE_MS,
  serverClockEvidence,
} from '../web/src/views/logic/serverClock.ts';
import { evaluateClockEvidence } from '../web/src/views/logic/timeTrust.ts';

const STAMP = '2026-08-26T15:36:00.000Z';
const stampedMs = Date.parse(STAMP);
const freshness = { generatedAtUtc: STAMP } as unknown as Freshness;

const trustedAt = (nowMs: number): boolean =>
  evaluateClockEvidence(serverClockEvidence(freshness, nowMs)).trusted;

test('a wall that has been up for hours is still trusted — the bug', () => {
  // Every one of these is a correct clock holding an ageing snapshot. All were REFUSED by the
  // symmetric version, which is what put the board up.
  for (const minutes of [3, 10, 60, 60 * 5, 60 * 20]) {
    assert.equal(
      trustedAt(stampedMs + minutes * 60_000),
      true,
      `${String(minutes)} minutes after the stamp must still be trusted`,
    );
  }
});

test('a clock BEHIND the server is refused — the direction that means something', () => {
  assert.equal(trustedAt(stampedMs - CLOCK_BEHIND_TOLERANCE_MS - 1), false);
  // ...and the tolerance itself is allowed, so ordinary jitter does not close the gate.
  assert.equal(trustedAt(stampedMs - CLOCK_BEHIND_TOLERANCE_MS + 1), true);
});

test('a clock absurdly ahead is refused', () => {
  assert.equal(trustedAt(stampedMs + CLOCK_AHEAD_LIMIT_MS + 1), false);
  assert.equal(trustedAt(stampedMs + CLOCK_AHEAD_LIMIT_MS - 1), true);
});

test('the 1970 cold boot is refused', () => {
  assert.equal(trustedAt(0), false);
});

test('no snapshot, no evidence, no trust', () => {
  assert.equal(evaluateClockEvidence(serverClockEvidence(undefined, stampedMs)).trusted, false);
  const bad = { generatedAtUtc: 'not a date' } as unknown as Freshness;
  assert.equal(evaluateClockEvidence(serverClockEvidence(bad, stampedMs)).trusted, false);
});

test('it never throws, whatever it is handed', () => {
  const junk: unknown[] = [null, undefined, {}, { generatedAtUtc: '' }, { generatedAtUtc: 42 }];
  for (const f of junk) {
    for (const now of [0, Number.NaN, Number.POSITIVE_INFINITY, stampedMs]) {
      assert.doesNotThrow(() => serverClockEvidence(f as Freshness | undefined, now));
    }
  }
});
