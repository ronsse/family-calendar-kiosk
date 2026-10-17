/**
 * Unit H — confirm mode: the controls that ask twice.
 *
 * Decided 2026-09-07 (panel split, operator chose the stricter option): a routine step needs
 * two taps. The problem it answers is that this wall has no identity and cannot know who is
 * touching it, so a three-year-old can open his sister's screen and tick her morning steps —
 * and unlike a chore claim, which an adult approves, a routine tick is reviewed by nobody.
 *
 * The tax is real and is the reason this is opt-in per control: every step of every morning
 * routine now costs two taps. A chore claim deliberately does NOT use it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  tapGate,
  IDLE_TAP_GATE,
  CONFIRM_MS,
  UNDO_MS,
  DEBOUNCE_MS,
  type TapGateState,
} from '../web/src/views/logic/tap.ts';

const tap = (s: TapGateState, atMs: number, next = true, confirm = true) =>
  tapGate(s, { type: 'tap', atMs, next, confirm });

test('one tap on a confirm control changes NOTHING — a stray brush leaves no trace', () => {
  const s = tap(IDLE_TAP_GATE, 1000);
  assert.equal(s.phase, 'pending');
  assert.equal(s.optimistic, null, 'nothing may be shown as done on the strength of one tap');
});

test('a second tap inside the window applies it, with the normal undo window after', () => {
  const first = tap(IDLE_TAP_GATE, 1000);
  const second = tap(first, 1000 + DEBOUNCE_MS + 1);
  assert.equal(second.phase, 'armed');
  assert.equal(second.optimistic, true);
  // And it still is not sent until the undo window elapses.
  const tooEarly = tapGate(second, { type: 'commit', atMs: (second.armedAtMs ?? 0) + UNDO_MS - 1 });
  assert.equal(tooEarly.phase, 'armed', 'the undo window survives confirmation');
  const sent = tapGate(second, { type: 'commit', atMs: (second.armedAtMs ?? 0) + UNDO_MS });
  assert.equal(sent.phase, 'sending');
});

test('the ring decays: an unanswered first tap returns to idle and stays there', () => {
  const first = tap(IDLE_TAP_GATE, 1000);
  const tooSoon = tapGate(first, { type: 'expire', atMs: 1000 + CONFIRM_MS - 1 });
  assert.equal(tooSoon.phase, 'pending', 'it must not decay early');
  const decayed = tapGate(first, { type: 'expire', atMs: 1000 + CONFIRM_MS });
  assert.equal(decayed.phase, 'idle');
  assert.equal(decayed.optimistic, null);
});

/**
 * The case the whole mechanism exists for: two unrelated brushes, minutes apart, must not
 * pair into a completion. The second one re-arms the ring rather than confirming the first.
 */
test('two taps FAR apart do not pair — the late one starts over', () => {
  const first = tap(IDLE_TAP_GATE, 1000);
  const late = tap(first, 1000 + CONFIRM_MS + 1);
  assert.equal(late.phase, 'pending', 'a late tap re-arms rather than confirming');
  assert.equal(late.optimistic, null, 'and still nothing is applied');
});

test('a bounce is still one intent, even in confirm mode', () => {
  const first = tap(IDLE_TAP_GATE, 1000);
  const bounce = tap(first, 1000 + DEBOUNCE_MS - 1);
  assert.equal(bounce.phase, 'pending', 'a contact bounce must not confirm the tap it bounced from');
  assert.equal(bounce.optimistic, null);
});

test('confirm mode does not leak into ordinary controls', () => {
  // No `confirm` flag: one tap arms and applies, exactly as before.
  const s = tapGate(IDLE_TAP_GATE, { type: 'tap', atMs: 1000, next: true });
  assert.equal(s.phase, 'armed');
  assert.equal(s.optimistic, true);
});

test('an ordinary control still undoes on the second tap — the gesture did not invert', () => {
  const armed = tapGate(IDLE_TAP_GATE, { type: 'tap', atMs: 1000, next: true });
  const undone = tapGate(armed, { type: 'tap', atMs: 1000 + DEBOUNCE_MS + 1, next: true });
  assert.equal(undone.phase, 'idle');
  assert.equal(undone.optimistic, null, 'a second tap on a normal control cancels, as it always did');
});

test('expire is inert on every phase that is not pending', () => {
  const armed = tapGate(IDLE_TAP_GATE, { type: 'tap', atMs: 1000, next: true });
  assert.equal(tapGate(armed, { type: 'expire', atMs: 99_999 }), armed);
  assert.equal(tapGate(IDLE_TAP_GATE, { type: 'expire', atMs: 99_999 }), IDLE_TAP_GATE);
});

test('the confirm window is longer than the undo window, and both are derived', () => {
  assert.ok(CONFIRM_MS > UNDO_MS, 'a child must have longer to confirm than to change her mind');
  assert.equal(CONFIRM_MS % UNDO_MS, 0, 'derived from the undo window, not invented separately');
});
