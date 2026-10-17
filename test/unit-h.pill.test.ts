/**
 * Unit H — is a pill a button?
 *
 * The one case that matters is the last one: a filled primary action must still fire.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pillState } from '../web/src/views/logic/pill.ts';

test('the chosen one of a set is filled and not a button', () => {
  assert.deepEqual(pillState({ on: true, solid: false, live: true }), {
    enabled: false,
    filled: true,
    muted: false,
  });
});

test('an unchosen live pill is a plain button', () => {
  assert.deepEqual(pillState({ on: false, solid: false, live: true }), {
    enabled: true,
    filled: false,
    muted: false,
  });
});

test('an inert pill is muted and not a button, unless it is the chosen one', () => {
  assert.deepEqual(pillState({ on: false, solid: false, live: false }), {
    enabled: false,
    filled: false,
    muted: true,
  });
  assert.deepEqual(pillState({ on: true, solid: false, live: false }), {
    enabled: false,
    filled: true,
    muted: false,
  });
});

test('a solid primary action is filled AND a button — Next was drawn dead once', () => {
  assert.deepEqual(pillState({ on: false, solid: true, live: true }), {
    enabled: true,
    filled: true,
    muted: false,
  });
  // Not ready yet: the sheet passes solid only while live, so this is the muted face.
  assert.deepEqual(pillState({ on: false, solid: false, live: false }).enabled, false);
});
