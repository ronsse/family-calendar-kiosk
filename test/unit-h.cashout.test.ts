/**
 * Unit H — the denominations a child may ask to cash out.
 *
 * The decision (panel, 2026-09-07, unanimous): fixed money buttons, unaffordable ones ABSENT
 * rather than present-and-refused. The arithmetic lives in a `.ts` module and is tested here
 * because "can a five-year-old ask for two dollars" is not something to leave to a component.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cashOutOptions, CASH_OUT_DOLLARS } from '../web/src/views/logic/balances.ts';

const RATE = 25; // cents per point, as the household set it 2026-09-06

test('a balance below the cheapest denomination offers only ALL', () => {
  // 3 points is 75c — not a dollar, so no denomination is affordable.
  const opts = cashOutOptions(3, RATE);
  assert.deepEqual(opts.map((o) => o.label), ['$0.75']);
  assert.equal(opts[0]?.isAll, true);
});

test('denominations appear only once the balance covers them', () => {
  assert.deepEqual(cashOutOptions(4, RATE).map((o) => o.label), ['$1']); // exactly a dollar
  assert.deepEqual(cashOutOptions(8, RATE).map((o) => o.label), ['$1', '$2']);
  assert.deepEqual(cashOutOptions(20, RATE).map((o) => o.label), ['$1', '$2', '$5']);
});

test('an unaffordable denomination is ABSENT, never shown and refused', () => {
  const opts = cashOutOptions(7, RATE); // $1.75
  assert.ok(!opts.some((o) => o.label === '$2'), '$2 must not be offered on $1.75');
  assert.ok(!opts.some((o) => o.label === '$5'));
});

/**
 * The stranded-remainder case grok-4.5 named. A balance that is not a round number of dollars
 * must still be fully requestable, or the odd points can never be asked for at all.
 */
test('a balance that is not round dollars still offers all of it', () => {
  const opts = cashOutOptions(10, RATE); // $2.50
  assert.deepEqual(opts.map((o) => o.label), ['$1', '$2', '$2.50']);
  assert.equal(opts.at(-1)?.points, 10);
  assert.equal(opts.at(-1)?.isAll, true);
});

test('when the balance IS a round denomination, ALL is not duplicated', () => {
  const opts = cashOutOptions(8, RATE); // exactly $2
  assert.equal(opts.filter((o) => o.isAll).length, 1);
  assert.equal(opts.filter((o) => o.points === 8).length, 1, '$2 and "all" are the same button');
});

test('every option is affordable, a whole number of points, and positive', () => {
  for (const points of [1, 3, 4, 7, 8, 13, 20, 41, 97]) {
    for (const o of cashOutOptions(points, RATE)) {
      assert.ok(Number.isInteger(o.points) && o.points > 0, `${o.label} -> ${String(o.points)}`);
      assert.ok(o.points <= points, `${o.label} asks for more than the balance`);
    }
  }
});

/**
 * The rate is household config and has already moved once (10 -> 25). Hardcoding it in the
 * component would mislabel every button the day it moves again.
 */
test('the labels follow the household rate, not a constant', () => {
  // At 10c a point, a dollar is 10 points rather than 4.
  const opts = cashOutOptions(10, 10);
  assert.deepEqual(opts.map((o) => o.label), ['$1']);
  assert.equal(opts[0]?.points, 10);
});

test('a rate that cannot make whole points drops that denomination, never rounds it', () => {
  // 30c a point: $1 is 3.33 points. Offering 3 would quietly short-change her.
  const opts = cashOutOptions(100, 30);
  assert.ok(!opts.some((o) => o.label === '$1'), 'a fractional denomination must be dropped');
});

test('nothing is offered on an empty, negative or unpriced balance', () => {
  for (const [pts, rate] of [[0, RATE], [-5, RATE], [10, 0], [10, null]] as const) {
    assert.deepEqual(cashOutOptions(pts, rate), [], `${String(pts)} @ ${String(rate)}`);
  }
});

test('the denomination ladder is the one the panel chose', () => {
  assert.deepEqual([...CASH_OUT_DOLLARS], [1, 2, 5]);
});
