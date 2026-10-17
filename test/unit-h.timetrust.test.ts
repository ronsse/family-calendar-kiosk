/**
 * Unit H acceptance, part 5: the clock gate in front of the playful screen.
 *
 * The failure being tested for is a single line of plausible code — `if (hour >= 6 && hour
 * < 8)` — on a box with no RTC.  After an overnight power cut the Pi comes up believing it
 * is 1970, or believing whatever the filesystem last wrote, and that line puts a full-bleed
 * illustration on the wall at 6:00 AM on a school day.  Every test below is a way the clock
 * can be wrong, and every one of them has to end at the information board.
 *
 * The scene is only ever reached by PROOF.  So the honest reading of this file is: one test
 * says yes, and the rest say no.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  IDLE_BOARD_WINDOWS,
  MAX_SYNC_AGE_MS,
  MIN_PLAUSIBLE_EPOCH_MS,
  boardWindowsCover,
  evaluateClockEvidence,
  idleMode,
  idleModeFromClock,
  type ClockEvidence,
} from '../web/src/views/logic/timeTrust.ts';

const at = (iso: string): number => Date.parse(iso);

/** 12:00Z on 2026-08-26 is 06:00 America/Denver — the hour the invariant is about. */
const NOW = at('2026-08-26T12:00:00Z');
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Everything a clock has to prove, all of it satisfied. */
const GOOD: ClockEvidence = {
  osSynchronised: true,
  syncedSinceBoot: true,
  lastSyncAtMs: NOW - MINUTE,
  nowMs: NOW,
  lastShutdownAtMs: NOW - 8 * HOUR,
};

const evidence = (patch: Partial<ClockEvidence>): ClockEvidence => ({ ...GOOD, ...patch });

// ---------------------------------------------------------------------------
// The one "yes"
// ---------------------------------------------------------------------------

test('a synchronised, freshly-synced, monotonic clock earns the scene', () => {
  const trust = evaluateClockEvidence(GOOD);
  assert.equal(trust.trusted, true);
  assert.equal(trust.reason, null);
  assert.deepEqual(trust.failures, []);
  assert.ok(trust.detail.length > 0, 'a verdict always says something out loud');
});

// ---------------------------------------------------------------------------
// The four conditions, each failing on its own
// ---------------------------------------------------------------------------

test('condition 1 alone: the OS does not claim synchronisation', () => {
  // Note everything else is perfect — a plausible date is not synchronisation, and this is
  // exactly the state of an RTC-less Pi that restored a sane-looking time from disk.
  const trust = evaluateClockEvidence(evidence({ osSynchronised: false }));
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'not-synchronised');
  assert.deepEqual(trust.failures, ['not-synchronised']);
});

test('condition 2 alone: nothing has synced since this boot', () => {
  const trust = evaluateClockEvidence(evidence({ syncedSinceBoot: false }));
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'no-sync-this-boot');
  assert.deepEqual(trust.failures, ['no-sync-this-boot']);
});

test('condition 2 alone: a sync claimed with no timestamp behind it', () => {
  const trust = evaluateClockEvidence(evidence({ lastSyncAtMs: null }));
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'no-sync-this-boot', 'a claim with no evidence is not evidence');
});

test('condition 3 alone: a sync four hours old', () => {
  const trust = evaluateClockEvidence(evidence({ lastSyncAtMs: NOW - 4 * HOUR }));
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'sync-too-old');
  assert.deepEqual(trust.failures, ['sync-too-old']);
});

test('exactly three hours old still counts; one millisecond more does not', () => {
  assert.equal(evaluateClockEvidence(evidence({ lastSyncAtMs: NOW - MAX_SYNC_AGE_MS })).trusted, true);
  assert.equal(
    evaluateClockEvidence(evidence({ lastSyncAtMs: NOW - MAX_SYNC_AGE_MS - 1 })).trusted,
    false,
  );
});

test('condition 3, the other half: a sync AHEAD of now is a backward step', () => {
  const trust = evaluateClockEvidence(evidence({ lastSyncAtMs: NOW + 30 * MINUTE }));
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'sync-in-future');
});

test('condition 4 alone: the clock jumped back past the last persisted shutdown', () => {
  // The box was running at 20:00 last night and now claims 06:00 this morning is earlier
  // than that.  Time does not do this; clocks do.
  const trust = evaluateClockEvidence(evidence({ lastShutdownAtMs: NOW + 10 * HOUR }));
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'clock-behind-floor');
  assert.deepEqual(trust.failures, ['clock-behind-floor']);
});

test('a clock reporting 2019 fails even with every other condition satisfied', () => {
  const y2019 = at('2019-06-01T12:00:00Z');
  const trust = evaluateClockEvidence({
    osSynchronised: true,
    syncedSinceBoot: true,
    lastSyncAtMs: y2019 - MINUTE,
    nowMs: y2019,
    // No marker has ever been written, so the floor is the absolute one — which is the half
    // of condition 4 that has to survive a box with no history at all.
    lastShutdownAtMs: null,
  });
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'clock-behind-floor');
  assert.ok(y2019 < MIN_PLAUSIBLE_EPOCH_MS);
});

test('a missing shutdown marker does not by itself cost the scene', () => {
  // A fresh box is not a lying clock, and conditions 1-3 have already demanded real NTP
  // evidence before we ever look at the floor.
  assert.equal(evaluateClockEvidence(evidence({ lastShutdownAtMs: null })).trusted, true);
});

// ---------------------------------------------------------------------------
// The boot this whole module exists for
// ---------------------------------------------------------------------------

test('a freshly-booted Pi with no NTP yet fails the gate and names every reason', () => {
  const trust = evaluateClockEvidence({
    osSynchronised: false,
    syncedSinceBoot: false,
    lastSyncAtMs: null,
    nowMs: 0, // 1970 — what the box says before anything has told it otherwise
    lastShutdownAtMs: at('2026-08-25T22:00:00Z'),
  });
  assert.equal(trust.trusted, false);
  assert.equal(trust.reason, 'not-synchronised');
  assert.deepEqual(trust.failures, ['not-synchronised', 'no-sync-this-boot', 'clock-behind-floor']);
});

test('and it shows the information board at what it thinks is 06:00', () => {
  const { decision } = idleModeFromClock(
    { osSynchronised: false, syncedSinceBoot: false, lastSyncAtMs: null, nowMs: 0, lastShutdownAtMs: null },
    '13:20', // the middle of the afternoon — the scene's own hours
  );
  assert.equal(decision.mode, 'board');
  assert.equal(decision.reason, 'time-untrusted');
  assert.equal(decision.insideBoardWindow, false, 'we did not ask a clock we do not trust');
});

// ---------------------------------------------------------------------------
// Fail closed on anything we cannot read
// ---------------------------------------------------------------------------

test('malformed evidence fails closed and says so', () => {
  const bad: unknown[] = [
    null,
    undefined,
    'ok',
    42,
    {},
    { ...GOOD, nowMs: Number.NaN },
    { ...GOOD, nowMs: Number.POSITIVE_INFINITY },
    { ...GOOD, nowMs: '2026-08-26T12:00:00Z' },
    { ...GOOD, osSynchronised: 'yes' },
    { ...GOOD, syncedSinceBoot: 1 },
    { ...GOOD, lastSyncAtMs: 'a minute ago' },
    { ...GOOD, lastSyncAtMs: Number.NaN },
    { ...GOOD, lastShutdownAtMs: {} },
  ];
  for (const input of bad) {
    const trust = evaluateClockEvidence(input as ClockEvidence);
    assert.equal(trust.trusted, false, `trusted a broken collector: ${JSON.stringify(input)}`);
    assert.equal(trust.reason, 'malformed-evidence');
  }
});

test('nothing in this module throws, whatever it is handed', () => {
  const junk: unknown[] = [null, undefined, [], Symbol('now'), () => NOW, { nowMs: -0 }, NaN, ''];
  for (const input of junk) {
    assert.doesNotThrow(() => evaluateClockEvidence(input as ClockEvidence));
    assert.doesNotThrow(() => idleMode(true, input as string));
    assert.doesNotThrow(() => idleMode(input as boolean, '06:00'));
    assert.doesNotThrow(() => boardWindowsCover('06:00', input as never));
    assert.doesNotThrow(() => idleModeFromClock(input as ClockEvidence, input as string));
  }
});

test('an unreadable clock string or an unreadable window list shows the board', () => {
  assert.equal(idleMode(true, 'half past six').mode, 'board');
  assert.equal(idleMode(true, '13:20', [{ opensAtLocal: '05:45' }] as never).mode, 'board');
  assert.equal(idleMode(true, '13:20', [null] as never).mode, 'board');
  assert.equal(idleMode(true, '13:20', 'nope' as never).mode, 'board');
  assert.equal(idleMode(true, '13:20', [{ opensAtLocal: 'x', closesAtLocal: 'y' }]).mode, 'board');
});

// ---------------------------------------------------------------------------
// The windows themselves
// ---------------------------------------------------------------------------

test('an EMPTY window list is a household choice: the picture is never replaced', () => {
  // `boardWindows: []` in the household config. It is not a broken schedule — that is a
  // non-list or a malformed window, both still the board above.
  assert.equal(boardWindowsCover('06:00', []), false);
  assert.equal(boardWindowsCover('19:30', []), false);
  assert.equal(idleMode(true, '06:00', []).mode, 'scene');
  assert.equal(idleMode(true, '06:00', []).reason, 'idle-hours');
  // The clock still outranks the household: an untrusted clock is the board regardless.
  assert.equal(idleMode(false, '13:20', []).mode, 'board');
  // Missing (an older server) is the default windows, not the empty list.
  assert.equal(idleMode(true, '06:00', undefined).mode, 'board');
});

test('the board windows are the panel’s numbers, wider than the routines', () => {
  assert.deepEqual(IDLE_BOARD_WINDOWS, [
    { opensAtLocal: '05:45', closesAtLocal: '08:30' },
    { opensAtLocal: '18:45', closesAtLocal: '20:45' },
  ]);
});

test('the morning board is up from 05:45 and the scene returns at 08:30', () => {
  const mode = (now: string) => idleMode(true, now).mode;
  assert.equal(mode('05:44'), 'scene');
  assert.equal(mode('05:45'), 'board', 'the board is up before the routine opens, not with it');
  assert.equal(mode('06:00'), 'board');
  assert.equal(mode('08:29'), 'board');
  assert.equal(mode('08:30'), 'scene');
});

test('the evening board is up from 18:45 and the scene returns at 20:45', () => {
  const mode = (now: string) => idleMode(true, now).mode;
  assert.equal(mode('18:44'), 'scene');
  assert.equal(mode('18:45'), 'board');
  assert.equal(mode('19:30'), 'board');
  assert.equal(mode('20:44'), 'board');
  assert.equal(mode('20:45'), 'scene');
});

test('boardWindowsCover agrees with the decision, and midnight is not a window', () => {
  assert.equal(boardWindowsCover('06:00'), true);
  assert.equal(boardWindowsCover('12:00'), false);
  assert.equal(boardWindowsCover('00:00'), false);
  assert.equal(boardWindowsCover('23:59'), false);
});

// ---------------------------------------------------------------------------
// Nothing but the clock and the hour decides this
// ---------------------------------------------------------------------------

/**
 * THE REGRESSION, twice over. "Something is overdue" used to be a third reason for the board.
 * In August it was fed the approval queue and the household reported the home button broken;
 * in September it was fed the real thing — a 17:00 duty nobody had touched — and the household
 * reported the wall stuck on the calendar. Either way the picture was gone every evening the
 * family was in the room. The gate now takes exactly two inputs, and this pins the arity so a
 * third cannot be threaded back in quietly.
 */
test('the gate takes a verdict and a time, and nothing else', () => {
  assert.equal(idleMode.length, 2, 'trust, now — the windows default; there is no third input');
  assert.equal(idleModeFromClock.length, 2);
});

test('a trusted clock on a quiet afternoon: the scene, which is the point', () => {
  const d = idleMode(true, '13:20');
  assert.equal(d.mode, 'scene');
  assert.equal(d.reason, 'idle-hours');
  assert.equal(d.timeTrusted, true);
  assert.equal(d.insideBoardWindow, false);
});

test('inside a window the window is the reason', () => {
  assert.equal(idleMode(true, '06:00').reason, 'board-window');
  assert.equal(idleMode(true, '19:00').reason, 'board-window');
});

// ---------------------------------------------------------------------------
// Composition — one value answers "why is the board up?"
// ---------------------------------------------------------------------------

test('the composed decision carries the clock’s own reason with it', () => {
  const { decision, trust } = idleModeFromClock(evidence({ lastSyncAtMs: NOW - 4 * HOUR }), '13:20');
  assert.equal(decision.mode, 'board');
  assert.equal(decision.reason, 'time-untrusted');
  assert.equal(trust.reason, 'sync-too-old');
  assert.match(trust.detail, /\d+m/, 'the age is in the line an adult reads at 06:05');
});

test('a good clock composes straight through to the scene', () => {
  const { decision, trust } = idleModeFromClock(GOOD, '13:20');
  assert.equal(trust.trusted, true);
  assert.equal(decision.mode, 'scene');
});
