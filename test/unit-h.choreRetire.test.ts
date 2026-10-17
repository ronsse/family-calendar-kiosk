/**
 * The retire key's two-tap confirm and the Retired fold (pass 2, #6), driven tap by tap.
 * A key that arms and never fires would be the signature dead control, so every test PRESSES
 * the key through `pressRetire` and asserts what it sends. Checking the words is not enough.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ChoreCatalog, ChoreCatalogEntry } from '../web/src/app/adminActions.ts';
import {
  RETIRE_ARM_MS,
  armExpiresAtMs,
  isArmed,
  pressRetire,
  retiredChoreRows,
  type RetireArm,
} from '../web/src/views/logic/choreRetire.ts';

/** Press the key at each time in turn; return how many presses SENT. */
function drive(choreIds: readonly string[], times: readonly number[]): { sends: string[]; arm: RetireArm | null } {
  let arm: RetireArm | null = null;
  const sends: string[] = [];
  times.forEach((t, i) => {
    const id = choreIds[i] ?? choreIds[0]!;
    const next = pressRetire(arm, id, t);
    if (next.fire) sends.push(id);
    arm = next.arm;
  });
  return { sends, arm };
}

test('one tap arms and sends nothing; a second inside the window sends once', () => {
  const first = pressRetire(null, 'fish', 1000);
  assert.equal(first.fire, false);
  assert.ok(isArmed(first.arm, 'fish', 1000));
  assert.deepEqual(drive(['fish'], [1000, 2000]).sends, ['fish']);
});

test('a third tap after a send arms again rather than sending twice', () => {
  const run = drive(['fish'], [0, 100, 200]);
  assert.deepEqual(run.sends, ['fish']);
  assert.ok(isArmed(run.arm, 'fish', 200));
});

test('the arm lapses: a second tap after the window only re-arms', () => {
  assert.deepEqual(drive(['fish'], [0, RETIRE_ARM_MS]).sends, []);
  assert.deepEqual(drive(['fish'], [0, RETIRE_ARM_MS - 1]).sends, ['fish']);
  assert.equal(armExpiresAtMs({ choreId: 'fish', atMs: 50 }), 50 + RETIRE_ARM_MS);
  assert.equal(armExpiresAtMs(null), null);
});

test('arming one chore never lets a tap on another send', () => {
  const run = drive(['fish', 'bins'], [0, 100]);
  assert.deepEqual(run.sends, []);
  assert.ok(isArmed(run.arm, 'bins', 100));
  assert.ok(!isArmed(run.arm, 'fish', 100));
});

function entry(id: string, labelFull: string, active: boolean): ChoreCatalogEntry {
  return {
    id,
    labelShort: labelFull,
    labelFull,
    icon: { assetId: `icon-${id}`, url: `/a/${id}.png`, isFallback: false },
    category: 'tidy',
    assignmentModel: 'individual',
    basePoints: 0,
    kind: 'duty',
    rrule: 'FREQ=DAILY',
    dueByLocal: null,
    active,
    roster: [],
    rosterExplicit: false,
  };
}

test('the Retired fold lists only inactive chores, by name', () => {
  const catalog: ChoreCatalog = {
    icons: [],
    chores: [entry('a', 'Water plants', false), entry('b', 'Feed fish', true), entry('c', 'Bins out', false)],
  };
  assert.deepEqual(
    retiredChoreRows(catalog).map((r) => r.choreId),
    ['c', 'a'],
  );
  assert.deepEqual(retiredChoreRows({ ...catalog, chores: [entry('b', 'x', true)] }), []);
});
