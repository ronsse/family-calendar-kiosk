/**
 * The PIN change flow (pass 2, #9), driven entry by entry the way the pad drives it. The one
 * thing that must never happen is a send nobody meant: two entries that disagree, a PIN the
 * server would refuse, or the old PIN again.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_PARENT_PIN_LENGTH,
  PIN_CHANGE_WORDS,
  currentRefused,
  enterPin,
  pinShapeOk,
  startPinChange,
  type PinChangeState,
} from '../web/src/views/logic/pinChange.ts';

function drive(entries: readonly string[]): { state: PinChangeState; sends: { current: string; fresh: string }[] } {
  let state = startPinChange();
  const sends: { current: string; fresh: string }[] = [];
  for (const pin of entries) {
    const out = enterPin(state, pin);
    state = out.state;
    if (out.send !== undefined) sends.push(out.send);
  }
  return { state, sends };
}

test('current, new, again: one send carrying the PIN typed first and the new one', () => {
  const run = drive(['1234', '908172', '908172']);
  assert.deepEqual(run.sends, [{ current: '1234', fresh: '908172' }]);
});

test('each step asks in its own words, and the pad moves on only when an entry is taken', () => {
  const one = enterPin(startPinChange(), '1234').state;
  assert.equal(one.step, 'fresh');
  const two = enterPin(one, '5555').state;
  assert.equal(two.step, 'again');
  assert.equal(PIN_CHANGE_WORDS.headline[two.step], 'The new PIN again');
});

test('two entries that disagree send nothing and go back to the new PIN, saying so', () => {
  const run = drive(['1234', '5555', '5556']);
  assert.deepEqual(run.sends, []);
  assert.equal(run.state.step, 'fresh');
  assert.equal(run.state.fresh, null);
  assert.equal(run.state.said, PIN_CHANGE_WORDS.mismatch);
  // ...and the next pair through goes.
  assert.deepEqual(drive(['1234', '5555', '5556', '6666', '6666']).sends, [{ current: '1234', fresh: '6666' }]);
});

test('the old PIN again is refused before anything is sent', () => {
  const run = drive(['1234', '1234']);
  assert.equal(run.state.step, 'fresh');
  assert.equal(run.state.said, PIN_CHANGE_WORDS.same);
});

test('a new PIN longer than the server takes never reaches the second step', () => {
  const long = '1'.repeat(MAX_PARENT_PIN_LENGTH + 1);
  const run = drive(['1234', long, long]);
  assert.deepEqual(run.sends, []);
  assert.equal(run.state.step, 'fresh');
  assert.equal(pinShapeOk('1'.repeat(MAX_PARENT_PIN_LENGTH)), true);
  assert.equal(pinShapeOk('123'), false);
  assert.equal(pinShapeOk('12a4'), false);
});

test('the shape check is the server route\'s own pattern', async () => {
  const { readFile } = await import('node:fs/promises');
  const src = await readFile(new URL('../src/http/routes.admin.ts', import.meta.url), 'utf8');
  assert.ok(src.includes(`[0-9]{4,${String(MAX_PARENT_PIN_LENGTH)}}`), 'routes.admin.ts carries the same bounds');
});

test('a wrong current PIN starts over at step one with words', () => {
  const s = currentRefused();
  assert.equal(s.step, 'current');
  assert.equal(s.current, null);
  assert.equal(s.said, PIN_CHANGE_WORDS.wrongCurrent);
  assert.deepEqual(drive(['1234', '5678', '5678']).state.step, 'again', 'a sent state keeps its PINs until the answer');
});
