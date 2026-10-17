/**
 * Household feature flags on the wall, and a rail with nobody on it (2026-10-12).
 *
 * `featureOn` is the client's half of the lock: a snapshot from a server older than the
 * household config carries no `features`, and that must read as ON — what every wall did before
 * the setting existed. The zero-child cases pin that a household with no children draws an
 * empty rail rather than throwing on a modulo or a division.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { featureOn } from '../web/src/views/logic/features.ts';
import { sceneFace, slotForChild } from '../web/src/views/logic/sceneFace.ts';
import { planRailNames } from '../web/src/views/logic/railNames.ts';
import { orderedChildren } from '../web/src/views/logic/summary.ts';

const ALL_ON = { chores: true, money: true, routines: true, countdowns: true };

test('featureOn: an older snapshot with no household reads every feature as ON', () => {
  assert.equal(featureOn(undefined, 'money'), true);
  assert.equal(featureOn(null, 'chores'), true);
  assert.equal(featureOn({} as never, 'routines'), true);
});

test('featureOn: a household that turned a feature off gets it off, and only that one', () => {
  const h = { features: { ...ALL_ON, money: false } };
  assert.equal(featureOn(h, 'money'), false);
  assert.equal(featureOn(h, 'chores'), true);
  assert.equal(featureOn(h, 'routines'), true);
  assert.equal(featureOn(h, 'countdowns'), true);
});

test('featureOn: a non-boolean value is not an off switch', () => {
  const h = { features: { ...ALL_ON, countdowns: 'no' as unknown as boolean } };
  assert.equal(featureOn(h, 'countdowns'), true);
});

test('zero children: the slot wrap, the scene face and the rail plan do not throw', () => {
  assert.equal(slotForChild(0, 0), 0);
  assert.ok(Number.isFinite(slotForChild(3, 0)));
  assert.equal(sceneFace(null, 0, 0), null);
  assert.deepEqual(orderedChildren([]), []);
  for (const form of ['row', 'column', 'plinth', 'spine'] as const) {
    assert.doesNotThrow(() => planRailNames(form, [], 800, true), form);
  }
});

test('one child: every sort order lands on slot 0', () => {
  for (const sortOrder of [0, 1, 2, 7]) assert.equal(slotForChild(sortOrder, 1), 0);
});
