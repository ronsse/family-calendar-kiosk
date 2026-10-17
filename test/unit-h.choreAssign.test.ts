/**
 * Unit H — the ways a chore is shared, as the wall offers them (web/src/views/logic/choreAssign.ts).
 *
 * The chore list's rows — turns, the last child, the worth stepper's rails — are tested where
 * they are built now, in unit-h.grownup.test.ts.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MODEL_WORDS, WALL_MODELS, modelChoices } from '../web/src/views/logic/choreAssign.ts';

test('the model pills are the wall’s three, plus a file-authored model only while it is current', () => {
  assert.deepEqual(modelChoices('rotation'), ['individual', 'rotation', 'first_complete']);
  assert.deepEqual(modelChoices('shared'), ['individual', 'rotation', 'first_complete', 'shared']);
});

test('every model has a word, so a file-authored one never draws a blank pill', () => {
  for (const model of [...WALL_MODELS, 'shared' as const]) {
    assert.ok(MODEL_WORDS[model].length > 0, model);
  }
});
