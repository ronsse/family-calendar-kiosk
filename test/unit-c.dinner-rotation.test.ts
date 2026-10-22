/**
 * Unit C — the two properties of the household's real chore list that no type can express,
 * that no code change would break loudly, and that a child would notice on day one.
 *
 * Both are consequences of `rotation.ts` and `recurrence.ts` being PURE FUNCTIONS OF THE
 * DATA. That purity is deliberate and correct — a child must not be able to re-roll her turn
 * by pulling the refresh — but its cost is that the fairness of a roster is a property of the
 * exact strings in `db/chores.json`, decided by an FNV hash nobody looked at. This file is
 * where somebody looked.
 *
 * `db/chores.json` is gitignored, so the checks run against it only on the machine that has
 * it. The literal constants below are therefore the always-on half: they pin the ids and the
 * roster orders that were verified by hand on 2026-08-31, so the property is guarded on any
 * checkout even where the real file is absent.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { rotationAssignee } from '../src/domain/chores/rotation.ts';
import { occursOn } from '../src/domain/chores/recurrence.ts';
import type { LocalDate } from '../src/types.ts';

const KIDS = ['child-1', 'child-2', 'child-3'];

/**
 * The three dinner jobs, with the roster orders as `db/chores.json` writes them.
 *
 * `ch-dishwasher`'s list is rotated by two ON PURPOSE. `rotationAssignee` folds
 * `fnv1a(choreId) % memberCount` into the day index so that two rotations sharing a member
 * list do not land on the same child every day — but with three chores over three children
 * that only works if the three hashes are DISTINCT mod 3, and these are not:
 * `ch-set-table` and `ch-dishwasher` both land on 1. Unrotated, one child sets the table and
 * loads the dishwasher every single night forever while a third child is never assigned
 * either — which reads as the wall playing favourites, and would be blamed on the app.
 *
 * Rotating a roster by k is exactly "add k to the index", so the roster order is the one
 * lever that fixes this without a schema column or a change to a pure function three other
 * things depend on. It is invisible in the data, which is why it is tested here.
 */
const DINNER: readonly (readonly [string, readonly string[]])[] = [
  ['ch-set-table', KIDS],
  ['ch-clear-table', KIDS],
  ['ch-dishwasher', [KIDS[2]!, KIDS[0]!, KIDS[1]!]],
];

function members(order: readonly string[]) {
  return order.map((childId, i) => ({ childId, position: i + 1 }));
}

function dates(from: string, days: number): LocalDate[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from(
    { length: days },
    (_, i) => new Date(start + i * 86_400_000).toISOString().slice(0, 10) as LocalDate,
  );
}

test('the three dinner jobs never land on the same child on the same day', () => {
  for (const date of dates('2026-09-01', 400)) {
    const who = DINNER.map(([id, order]) => rotationAssignee(id, date, members(order)));
    assert.equal(
      new Set(who).size,
      3,
      `${date}: ${who.join(', ')} — two dinner jobs collided on one child`,
    );
  }
});

test('over three days each child does each of the three dinner jobs exactly once', () => {
  for (const [id, order] of DINNER) {
    const three = dates('2026-09-01', 3).map((d) => rotationAssignee(id, d, members(order)));
    assert.equal(new Set(three).size, 3, `${id} did not cycle all three children in 3 days`);
  }
});

/**
 * The collision this file exists to prevent, asserted directly so the reasoning above cannot
 * be dismissed as theoretical by someone "tidying" the roster orders to match.
 */
test('giving all three dinner jobs the same roster order reintroduces the collision', () => {
  const naive = DINNER.map(([id]) => [id, KIDS] as const);
  const date = '2026-09-01' as LocalDate;
  const who = naive.map(([id, order]) => rotationAssignee(id, date, members(order)));
  assert.equal(new Set(who).size, 2, 'expected the known 2-of-3 collision');
});

/**
 * Bin night. The household's requirement, in its own words: trash every Tuesday, recycling
 * every OTHER Tuesday, and "this coming week it's take out the trash only".
 *
 * `INTERVAL=2` week parity is anchored to the EPOCH Monday and NOT to `DTSTART` — which
 * `recurrence.ts` uses only as a lower bound, never as a phase anchor. So which fortnight is
 * "on" is not something the author chose; it is something the calendar handed us, and it
 * happens to be right. That makes it exactly the kind of fact that a well-meaning change to
 * the week arithmetic would silently invert, moving bin night by a week with nothing failing.
 */
test('recycling skips the first Tuesday and lands on the second', () => {
  const RRULE = 'FREQ=WEEKLY;BYDAY=TU;INTERVAL=2';
  assert.equal(occursOn(RRULE, '2026-09-01' as LocalDate), false, '2026-09-01: trash only');
  assert.equal(occursOn(RRULE, '2026-09-08' as LocalDate), true);
  assert.equal(occursOn(RRULE, '2026-09-15' as LocalDate), false);
  assert.equal(occursOn(RRULE, '2026-09-22' as LocalDate), true);
});

test('trash is every Tuesday and only Tuesday', () => {
  const RRULE = 'FREQ=WEEKLY;BYDAY=TU';
  for (const d of dates('2026-09-01', 21)) {
    const isTuesday = new Date(`${d}T00:00:00Z`).getUTCDay() === 2;
    assert.equal(occursOn(RRULE, d), isTuesday, d);
  }
});

/**
 * The half that guards the REAL file, on the one machine that has it. Absent — CI, a fresh
 * clone — this is a no-op rather than a failure: the constants above already carry the
 * property, and a gitignored file cannot be a test dependency.
 */
test('db/chores.json, where it exists, still satisfies both properties', (t) => {
  const path = new URL('../db/chores.json', import.meta.url);
  if (!existsSync(path)) return t.skip('db/chores.json not present (expected off the wall host)');

  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const chores = (parsed as { chores?: unknown }).chores;
  assert.ok(Array.isArray(chores), 'chores must be an array');

  // Only the dinner jobs must be pairwise distinct. Another rotation may share a child with
  // one of them on purpose (since 2026-10-22 the dog's walk follows whoever clears the table).
  const dinnerIds = new Set(DINNER.map(([id]) => id));
  const rotations = (chores as Record<string, unknown>[])
    .filter((c) => c['assignmentModel'] === 'rotation' && Array.isArray(c['rotation']))
    .filter((c) => dinnerIds.has(String(c['id'])))
    .map((c) => [String(c['id']), c['rotation'] as string[]] as const);

  assert.equal(rotations.length, 3, 'expected all three dinner rotations');
  for (const date of dates('2026-09-01', 400)) {
    const who = rotations.map(([id, order]) => rotationAssignee(id, date, members(order)));
    assert.equal(new Set(who).size, 3, `${date}: real roster collided — ${who.join(', ')}`);
  }
});
