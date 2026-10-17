/**
 * Unit H acceptance, part 3: the shell's memory and the tap gate.
 *
 * Both are pure reducers precisely so they can be tested here, without a DOM.
 * Between them they own the two behaviours that decide whether the wall is right
 * when nobody is looking at it:
 *
 *   - the selected child DECAYS.  A persisted selection is what leaves the wrong
 *     child's screen up all night (H2 Q3 graft #3).
 *   - a tap is undoable locally for two seconds and cannot be double-fired.  A
 *     three-year-old on capacitive glass produces both of those events daily.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReadingBand } from '../src/types.ts';
import {
  AMBIENT_BAND,
  FALLBACK_BAND,
  IDLE_DECAY_MS,
  effectiveBand,
  initialShellState,
  isAmbient,
  msUntilDecay,
  wallShell,
  type WallShellState,
} from '../web/src/views/logic/idle.ts';
import {
  DEBOUNCE_MS,
  IDLE_TAP_GATE,
  OPTIMISTIC_MAX_MS,
  UNDO_MS,
  choreKey,
  isUndoable,
  redemptionKey,
  stepKey,
  tapGate,
  tapValue,
  type TapGateState,
} from '../web/src/views/logic/tap.ts';

const T0 = 1_800_000_000_000;

const CHILDREN: readonly { id: string; readingBand: ReadingBand }[] = [
  { id: 'ada', readingBand: 'fluent' },
  { id: 'bea', readingBand: 'emergent' },
  { id: 'cleo', readingBand: 'picture' },
];

// ---------------------------------------------------------------------------
// The shell decays
// ---------------------------------------------------------------------------

test('the wall starts ambient — nothing is selected until a finger says so', () => {
  const s = initialShellState(T0);
  assert.equal(s.activeChildId, null);
  assert.equal(s.bandOverride, null);
  assert.ok(isAmbient(s));
  assert.equal(msUntilDecay(s, T0), Infinity, 'nothing to decay from');
});

test('a selection survives 89 seconds and dies at 90', () => {
  let s = wallShell(initialShellState(T0), { type: 'selectChild', childId: 'cleo', atMs: T0 });
  assert.equal(s.activeChildId, 'cleo');
  assert.equal(IDLE_DECAY_MS, 90_000, 'the decay is the --dur-idle-decay token');

  s = wallShell(s, { type: 'tick', atMs: T0 + IDLE_DECAY_MS - 1 });
  assert.equal(s.activeChildId, 'cleo', 'one millisecond early is still her screen');

  s = wallShell(s, { type: 'tick', atMs: T0 + IDLE_DECAY_MS });
  assert.equal(s.activeChildId, null, 'and then the wall belongs to the household again');
});

test('every touch restarts the 90 seconds', () => {
  let s = wallShell(initialShellState(T0), { type: 'selectChild', childId: 'ada', atMs: T0 });
  s = wallShell(s, { type: 'interaction', atMs: T0 + 80_000 });
  s = wallShell(s, { type: 'tick', atMs: T0 + 100_000 });
  assert.equal(s.activeChildId, 'ada', 'she was still using it at 80 s');
  assert.equal(msUntilDecay(s, T0 + 100_000), 70_000);
  s = wallShell(s, { type: 'tick', atMs: T0 + 170_001 });
  assert.equal(s.activeChildId, null);
});

test('a backwards clock step does not freeze the wall on one child', () => {
  // The Pi has no RTC.  It boots with a wrong clock and NTP steps it, sometimes
  // backwards by hours — which, naively, makes "now - lastInteraction" negative
  // forever and pins the wrong child's screen up all night.
  let s = wallShell(initialShellState(T0), { type: 'selectChild', childId: 'bea', atMs: T0 });
  s = wallShell(s, { type: 'tick', atMs: T0 - 3_600_000 });
  assert.equal(s.activeChildId, 'bea');
  assert.equal(s.lastInteractionAtMs, T0 - 3_600_000, 're-anchored to the new clock');
  s = wallShell(s, { type: 'tick', atMs: T0 - 3_600_000 + IDLE_DECAY_MS });
  assert.equal(s.activeChildId, null, 'and it still decays afterwards');
});

test('a forwards clock jump decays immediately rather than skipping the decay', () => {
  let s = wallShell(initialShellState(T0), { type: 'selectChild', childId: 'bea', atMs: T0 });
  s = wallShell(s, { type: 'tick', atMs: T0 + 86_400_000 });
  assert.equal(s.activeChildId, null);
});

test('a child who leaves the roster cannot stay selected', () => {
  let s = wallShell(initialShellState(T0), { type: 'selectChild', childId: 'cleo', atMs: T0 });
  s = wallShell(s, { type: 'children', childIds: ['ada', 'bea'], atMs: T0 + 1000 });
  assert.equal(s.activeChildId, null);
});

test('an adult band override is memory-only and decays with everything else', () => {
  let s = wallShell(initialShellState(T0), { type: 'setBand', band: 'picture', atMs: T0 });
  assert.equal(s.bandOverride, 'picture');
  assert.equal(effectiveBand(s, CHILDREN), 'picture');
  s = wallShell(s, { type: 'tick', atMs: T0 + IDLE_DECAY_MS });
  assert.equal(s.bandOverride, null);
});

test('a calendar opened from the idle wall closes after 90 seconds — nobody selected or not', () => {
  // THE REGRESSION. `destination` lived beside the reducer and was closed off the back of its
  // decay, and the decay only ran while a child was selected. So the week opened from the idle
  // board with nobody selected stayed up until somebody touched the wall — the household
  // reported it as "stuck on the calendar days".
  let s = wallShell(initialShellState(T0), { type: 'openDestination', destination: 'week', atMs: T0 });
  assert.equal(s.destination, 'week');
  assert.equal(s.activeChildId, null);
  assert.equal(msUntilDecay(s, T0), IDLE_DECAY_MS, 'an open screen is something to decay from');
  s = wallShell(s, { type: 'tick', atMs: T0 + IDLE_DECAY_MS - 1 });
  assert.equal(s.destination, 'week');
  s = wallShell(s, { type: 'tick', atMs: T0 + IDLE_DECAY_MS });
  assert.equal(s.destination, null, 'and then the wall belongs to the household again');
});

test('selecting a child keeps the calendar open — the week filtered to her is a real screen', () => {
  let s = wallShell(initialShellState(T0), { type: 'openDestination', destination: 'week', atMs: T0 });
  s = wallShell(s, { type: 'selectChild', childId: 'ada', atMs: T0 + 1 });
  assert.equal(s.destination, 'week');
  assert.equal(s.activeChildId, 'ada');
  s = wallShell(s, { type: 'openDestination', destination: null, atMs: T0 + 2 });
  assert.equal(s.destination, null, 'closing the screen leaves the selection alone');
  assert.equal(s.activeChildId, 'ada');
});

test('the house button goes to the picture from anywhere, and undoes everything on the way', () => {
  let s = wallShell(initialShellState(T0), { type: 'selectChild', childId: 'bea', atMs: T0 });
  s = wallShell(s, { type: 'setBand', band: 'picture', atMs: T0 });
  s = wallShell(s, { type: 'openDestination', destination: 'approvals', atMs: T0 });
  s = wallShell(s, { type: 'home', atMs: T0 + 5 });
  assert.equal(s.activeChildId, null);
  assert.equal(s.bandOverride, null);
  assert.equal(s.destination, null);
  assert.equal(s.sceneRequested, true, 'the household asked for the picture, not for whatever the gate says');
  assert.ok(isAmbient(s));
});

test('a requested picture is a memory like any other: it decays, and any move forgets it', () => {
  let s = wallShell(initialShellState(T0), { type: 'home', atMs: T0 });
  assert.equal(msUntilDecay(s, T0), IDLE_DECAY_MS, 'inside a board window the board comes back after 90 s');
  s = wallShell(s, { type: 'tick', atMs: T0 + IDLE_DECAY_MS });
  assert.equal(s.sceneRequested, false);

  s = wallShell(initialShellState(T0), { type: 'home', atMs: T0 });
  s = wallShell(s, { type: 'selectChild', childId: 'ada', atMs: T0 + 1 });
  assert.equal(s.sceneRequested, false, 'tapping a child is a new request, not the old one');
  s = wallShell(initialShellState(T0), { type: 'home', atMs: T0 });
  s = wallShell(s, { type: 'openDestination', destination: 'week', atMs: T0 + 1 });
  assert.equal(s.sceneRequested, false);
});

test('the band is the active child’s, the ambient band, or the fallback — never a guess', () => {
  const ambient: WallShellState = initialShellState(T0);
  assert.equal(effectiveBand(ambient, CHILDREN), AMBIENT_BAND);

  for (const child of CHILDREN) {
    const s = wallShell(ambient, { type: 'selectChild', childId: child.id, atMs: T0 });
    assert.equal(effectiveBand(s, CHILDREN), child.readingBand);
  }

  const ghost = wallShell(ambient, { type: 'selectChild', childId: 'nobody', atMs: T0 });
  assert.equal(effectiveBand(ghost, CHILDREN), FALLBACK_BAND, 'an unknown child degrades to pictures');
  assert.equal(FALLBACK_BAND, 'picture');
});

// ---------------------------------------------------------------------------
// The tap gate
// ---------------------------------------------------------------------------

const tap = (s: TapGateState, atMs: number, next = true): TapGateState =>
  tapGate(s, { type: 'tap', atMs, next });

test('a tap arms an optimistic value and sends nothing yet', () => {
  const s = tap(IDLE_TAP_GATE, T0);
  assert.equal(s.phase, 'armed');
  assert.equal(s.optimistic, true);
  assert.ok(isUndoable(s));
  assert.equal(tapValue(s, false), true, 'the wall shows the tap immediately');
});

test('a bounce is one tap, not two', () => {
  const first = tap(IDLE_TAP_GATE, T0);
  const bounced = tap(first, T0 + DEBOUNCE_MS - 1);
  assert.deepEqual(bounced, first, 'contact chatter inside the debounce window is ignored');
});

test('a deliberate second tap inside the undo window cancels it, and nothing is sent', () => {
  const armed = tap(IDLE_TAP_GATE, T0);
  const undone = tap(armed, T0 + DEBOUNCE_MS + 1);
  assert.equal(undone.phase, 'idle');
  assert.equal(undone.optimistic, null);
  const committed = tapGate(undone, { type: 'commit', atMs: T0 + UNDO_MS + 10 });
  assert.equal(committed.phase, 'idle', 'a cancelled tap can never reach the server');
});

test('the request goes out only after the whole undo window', () => {
  const armed = tap(IDLE_TAP_GATE, T0);
  assert.equal(tapGate(armed, { type: 'commit', atMs: T0 + UNDO_MS - 1 }).phase, 'armed');
  assert.equal(tapGate(armed, { type: 'commit', atMs: T0 + UNDO_MS }).phase, 'sending');
  assert.equal(UNDO_MS, 2000, 'the --dur-undo token, adopted in H2 Q1');
});

test('taps during an in-flight request are swallowed', () => {
  const sending = tapGate(tap(IDLE_TAP_GATE, T0), { type: 'commit', atMs: T0 + UNDO_MS });
  const again = tap(sending, T0 + UNDO_MS + 5000);
  assert.deepEqual(again, sending, 'an impatient child cannot fire five claims at a race');
});

test('a failed write reverts the wall rather than lying about it', () => {
  const sending = tapGate(tap(IDLE_TAP_GATE, T0), { type: 'commit', atMs: T0 + UNDO_MS });
  const failed = tapGate(sending, { type: 'failed', atMs: T0 + UNDO_MS + 100 });
  assert.equal(failed.optimistic, null);
  assert.equal(tapValue(failed, false), false);
  const retry = tap(failed, T0 + UNDO_MS + 5000);
  assert.equal(retry.phase, 'armed', 'and she can try again');
});

test('the optimistic value is retired when the snapshot agrees', () => {
  const settled = tapGate(
    tapGate(tap(IDLE_TAP_GATE, T0), { type: 'commit', atMs: T0 + UNDO_MS }),
    { type: 'settled', atMs: T0 + UNDO_MS + 200 },
  );
  assert.equal(settled.optimistic, true, 'held until the snapshot catches up');
  const synced = tapGate(settled, { type: 'sync', atMs: T0 + UNDO_MS + 400, value: true });
  assert.equal(synced.optimistic, null);
});

test('an optimistic value that the server never confirms expires', () => {
  const settled = tapGate(
    tapGate(tap(IDLE_TAP_GATE, T0), { type: 'commit', atMs: T0 + UNDO_MS }),
    { type: 'settled', atMs: T0 + UNDO_MS },
  );
  const early = tapGate(settled, { type: 'sync', atMs: T0 + UNDO_MS + 1000, value: false });
  assert.equal(early.optimistic, true, 'a slow snapshot is not a disagreement yet');
  const late = tapGate(settled, { type: 'sync', atMs: T0 + UNDO_MS + OPTIMISTIC_MAX_MS, value: false });
  assert.equal(late.optimistic, null, 'a wall that lies quietly is worse than one that flickers');
});

test('a sync during the undo window never steals the tap back', () => {
  const armed = tap(IDLE_TAP_GATE, T0);
  const synced = tapGate(armed, { type: 'sync', atMs: T0 + 100, value: false });
  assert.deepEqual(synced, armed);
});

test('gate keys are namespaced so two surfaces cannot collide', () => {
  assert.equal(stepKey(7), 'step:7');
  assert.equal(choreKey(7), 'chore:7');
  assert.equal(redemptionKey('7'), 'cash:7');
  assert.notEqual(stepKey(7), choreKey(7));
});
