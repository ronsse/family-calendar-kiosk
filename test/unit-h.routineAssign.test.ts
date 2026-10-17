/**
 * Unit H — the Routines screen's rows, from the wire shape.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { RoutineCatalog } from '../web/src/app/adminActions.ts';
import {
  childRoutineRows,
  defaultRoutineId,
  routineById,
  stepHolders,
} from '../web/src/views/logic/routineAssign.ts';

const icon = { assetId: 'a', url: '/x.png', isFallback: false } as const;

const CATALOG: RoutineCatalog = {
  routines: [
    {
      id: 'rt-morning',
      labelShort: 'Morning',
      labelFull: 'Morning routine',
      opensAtLocal: '06:00',
      closesAtLocal: '08:00',
      daysOfWeek: 'MO,TU,WE,TH,FR',
      active: true,
      steps: [
        { id: 'st-dress', labelShort: 'Dressed', labelFull: 'Get dressed', icon, active: true },
        { id: 'st-teeth', labelShort: 'Teeth', labelFull: 'Brush your teeth', icon, active: true },
        { id: 'st-shoes', labelShort: 'Shoes', labelFull: 'Put your shoes on', icon, active: true },
        { id: 'st-old', labelShort: 'Old', labelFull: 'A retired step', icon, active: false },
      ],
      assignments: [
        { childId: 'child-a', stepId: 'st-teeth', position: 2 },
        { childId: 'child-a', stepId: 'st-dress', position: 1 },
        { childId: 'child-a', stepId: 'st-old', position: 3 },
        { childId: 'child-b', stepId: 'st-dress', position: 1 },
      ],
    },
  ],
};

test('assigned rows come first in position order, with arrows disabled at the ends', () => {
  const rows = childRoutineRows(routineById(CATALOG, 'rt-morning'), 'child-a');
  assert.deepEqual(
    rows.assigned.map((r) => [r.position, r.stepId, r.canMoveUp, r.canMoveDown]),
    [
      [1, 'st-dress', false, true],
      [2, 'st-teeth', true, true],
      [3, 'st-old', true, false],
    ],
  );
});

test('the pool below is every ACTIVE step she does not have, in catalog order', () => {
  const rows = childRoutineRows(routineById(CATALOG, 'rt-morning'), 'child-a');
  assert.deepEqual(rows.available.map((r) => r.stepId), ['st-shoes']);
  const b = childRoutineRows(routineById(CATALOG, 'rt-morning'), 'child-b');
  // st-old is retired: still on child-a who has it, never offered to child-b who does not.
  assert.deepEqual(b.available.map((r) => r.stepId), ['st-teeth', 'st-shoes']);
});

test('a child with nothing gets the whole active pool', () => {
  const rows = childRoutineRows(routineById(CATALOG, 'rt-morning'), 'child-c');
  assert.equal(rows.assigned.length, 0);
  assert.equal(rows.available.length, 3);
});

test('the faces beside a step are whoever has it in this routine, and nobody for no routine', () => {
  const morning = routineById(CATALOG, 'rt-morning');
  assert.deepEqual([...stepHolders(morning, 'st-dress')].sort(), ['child-a', 'child-b']);
  assert.deepEqual([...stepHolders(morning, 'st-teeth')], ['child-a']);
  assert.deepEqual([...stepHolders(morning, 'st-shoes')], [], 'a step nobody has');
  assert.deepEqual([...stepHolders(null, 'st-dress')], []);
});

test('an unknown routine is empty rows, and the default is the first active routine', () => {
  assert.deepEqual(childRoutineRows(routineById(CATALOG, 'rt-nope'), 'child-a'), {
    assigned: [],
    available: [],
  });
  assert.equal(defaultRoutineId(CATALOG), 'rt-morning');
  assert.equal(defaultRoutineId({ routines: [] }), null);
});
