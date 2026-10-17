/**
 * Unit H — the dog's week, from the wire shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChoreAssignmentView, ChoreState, DogWeek, LocalDate } from '../src/types.ts';
import {
  DOG_ASKS_VISIBLE,
  DOG_SHEET_DECAY_MS,
  DOG_SHEET_EDGE_MIN_PX,
  DOG_SHEET_WIDTH_PX,
  askLine,
  deedKey,
  isDogAsk,
  dogAsks,
  dogDoorOpen,
  dogLine,
  dogSheetAfter,
  dogTitle,
  petNameOf,
} from '../web/src/views/logic/dog.ts';

function week(done: boolean[]): DogWeek {
  return {
    week: '2026-W38',
    deeds: done.map((d, i) => ({ id: `d${String(i)}`, label: `Deed ${String(i)}`, emoji: '🐾', done: d })),
  };
}

test('the line counts, the ends have their own words, and the dog is the one talking', () => {
  assert.equal(dogLine(week([false, false, false])), 'Tap what you saw me do.');
  assert.equal(dogLine(week([true, false, false])), '1 of 3 so far.');
  assert.equal(dogLine(week([true, true, true])), 'All 3 — what a week I had.');
  assert.equal(dogLine(week([])), 'Nothing on my list.');
});

const ICON = { assetId: 'ico', url: '/a.png', isFallback: false } as const;
const CHILDREN = [
  { id: 'child-c', sortOrder: 3 },
  { id: 'child-a', sortOrder: 1 },
  { id: 'child-b', sortOrder: 2 },
];

function row(
  assignmentId: number,
  choreId: string,
  childId: string,
  state: ChoreState,
  over: Partial<ChoreAssignmentView> = {},
): ChoreAssignmentView {
  return {
    assignmentId,
    choreId,
    childId,
    localDate: '2026-09-15' as LocalDate,
    state,
    kind: 'extra',
    dueByLocal: null,
    claimedAtUtc: null,
    points: 4,
    labelShort: choreId,
    labelFull: `Ask ${choreId}`,
    icon: ICON,
    category: 'pet',
    ...over,
  };
}

test('his asks are the pet extras and nothing else', () => {
  assert.equal(isDogAsk({ category: 'pet', kind: 'extra' }), true);
  assert.equal(isDogAsk({ category: 'pet', kind: 'duty' }), false, 'feeding him is a duty, not an ask');
  assert.equal(isDogAsk({ category: 'kitchen', kind: 'extra' }), false);
});

test('one ask per chore, EVERY eligible face in household order, spent asks sink', () => {
  const asks = dogAsks(
    [
      row(1, 'ch-fetch', 'child-c', 'pending'),
      row(2, 'ch-fetch', 'child-a', 'pending'),
      row(3, 'ch-fetch', 'child-b', 'pending'),
      row(4, 'ch-brush', 'child-a', 'superseded'),
      row(5, 'ch-brush', 'child-b', 'claimed'),
      row(6, 'ch-brush', 'child-c', 'superseded'),
      row(7, 'ch-fish', 'child-a', 'pending', { kind: 'duty' }),
      row(8, 'ch-trash', 'child-a', 'pending', { category: 'kitchen' }),
      row(9, 'ch-fetch', 'child-gone', 'pending'),
    ],
    CHILDREN,
  );
  assert.deepEqual(
    asks.map((a) => a.choreId),
    ['ch-fetch', 'ch-brush'],
  );
  // Every child who has a row is drawn, in household order — nobody vanishes because somebody
  // else went first. That disappearance WAS the bug.
  assert.deepEqual(
    asks[0]?.faces.map((f) => [f.childId, f.assignmentId, f.done, f.inert]),
    [
      ['child-a', 2, false, false],
      ['child-b', 3, false, false],
      ['child-c', 1, false, false],
    ],
  );
  assert.equal(asks[0]?.doneCount, 0);
  // A day materialized under the old first_complete model still has superseded rows. They are
  // drawn and they are inert: a face that is not there reads as "she is not allowed".
  assert.deepEqual(
    asks[1]?.faces.map((f) => [f.childId, f.done, f.inert]),
    [
      ['child-a', false, true],
      ['child-b', true, false],
      ['child-c', false, true],
    ],
  );
  assert.equal(asks[1]?.doneCount, 1);
});

test('all three can do the same ask, and each face answers only for that child', () => {
  const asks = dogAsks(
    [
      row(1, 'ch-walk', 'child-a', 'claimed'),
      row(2, 'ch-walk', 'child-b', 'pending'),
      row(3, 'ch-walk', 'child-c', 'approved'),
    ],
    CHILDREN,
  );
  const walk = asks[0];
  assert.equal(walk?.doneCount, 2, 'two of them walked him; that is not a conflict');
  assert.deepEqual(
    walk?.faces.map((f) => [f.childId, f.done, f.inert]),
    [
      ['child-a', true, false],
      ['child-b', false, false],
      ['child-c', true, true],
    ],
  );
  // The DOG's need is met the moment one of them walks him, so the line says so — but the row
  // is not closed: child-b is still open and still tappable, and may log a walk of her own.
  assert.equal(askLine(asks), 'All done. You are the best.');
  assert.equal(walk?.faces.filter((f) => !f.done && !f.inert).length, 1);
});

test('the words follow the count, and an ask nobody did is what is left', () => {
  const asks = dogAsks(
    [row(1, 'ch-ears', 'child-a', 'claimed'), row(2, 'ch-ears', 'child-b', 'approved')],
    CHILDREN,
  );
  assert.equal(asks[0]?.doneCount, 2);
  assert.equal(askLine([]), 'Nothing today. Just pet me.');
  assert.equal(askLine(asks), 'All done. You are the best.');
  assert.equal(
    askLine([...asks, ...dogAsks([row(3, 'ch-fetch', 'child-a', 'pending')], CHILDREN)]),
    'Tap the face of whoever did it.',
  );
  assert.ok(DOG_ASKS_VISIBLE >= 3, 'a Saturday has fetch, a walk and the scoop');
  assert.ok(DOG_SHEET_WIDTH_PX + 2 * DOG_SHEET_EDGE_MIN_PX <= 880, 'the picture shows either side');
});

test('the sheet lives on the picture only', () => {
  assert.equal(dogSheetAfter(true, true), true);
  assert.equal(dogSheetAfter(true, false), false, 'a child selected takes the sheet down');
  assert.equal(dogSheetAfter(false, true), false);
});

test('a deed key names the week, so a tick held across Sunday midnight is a different key', () => {
  assert.notEqual(deedKey('2026-W38', 'snore'), deedKey('2026-W39', 'snore'));
  assert.ok(DOG_SHEET_DECAY_MS < 90_000, 'shorter than the shell decay: the sheet covers home');
});

// ---------------------------------------------------------------------------
// Pets are optional (2026-10-12)
// ---------------------------------------------------------------------------

test('the dog in the picture is a door only when the household has a pet', () => {
  const box = { x: 0.1, y: 0.2, w: 0.1, h: 0.1 };
  assert.equal(dogDoorOpen(box, week([false])), true, 'a pet and a dog in the picture');
  assert.equal(dogDoorOpen(box, null), false, 'no pet: the dog in the art is just art');
  assert.equal(dogDoorOpen(box, undefined), false, 'an older server with no dog field');
  assert.equal(dogDoorOpen(null, week([false])), false, 'a pet, but the finder did not find him');
});

test('the sheet is titled with the pet’s own name, and still introduces itself without one', () => {
  assert.equal(petNameOf({ pets: [{ id: 'dog', name: 'Biscuit' }] }), 'Biscuit');
  assert.equal(petNameOf({ pets: [] }), '');
  assert.equal(petNameOf(undefined), '', 'a snapshot from before `household`');
  assert.equal(dogTitle('Biscuit'), 'It’s me, Biscuit');
  assert.equal(dogTitle(''), 'It’s me');
});
