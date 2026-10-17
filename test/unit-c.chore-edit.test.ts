/**
 * Unit C — a chore changed or retired from the wall.
 *
 * `editChore` folds a NAME, PICTURE or DAYS over the chore as it stands and hands the result to
 * the same parser, checks and writer as the file; `retireChore` is the file's soft retire behind
 * one extra refusal — a claim still waiting. What these pin: nothing not sent is touched, history
 * is never rewritten, and the refusal names its reason.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import {
  claimChore,
  createChore,
  editChore,
  historyFingerprint,
  materializeChoreDay,
  readChoreCatalog,
  restoreChore,
  retireChore,
  shortLabelFor,
} from '../src/domain/chores/index.ts';
import type { LocalDate } from '../src/types.ts';

function fresh(): { db: Db; id: string } {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const made = createChore(db, {
    labelFull: 'Water the plants',
    iconAssetId: 'ico-table',
    kind: 'extra',
    basePoints: 2,
    assignmentModel: 'individual',
    rrule: 'FREQ=WEEKLY;BYDAY=SA',
    roster: ['child-b'],
  });
  assert.equal(made.ok, true);
  if (!made.ok) throw new Error('seed chore refused');
  return { db, id: made.choreId };
}

const chore = (db: Db, id: string) => readChoreCatalog(db).chores.find((c) => c.id === id);

test('a rename re-derives the short label and moves nothing else', () => {
  const { db, id } = fresh();
  const before = chore(db, id);
  const out = editChore(db, id, { labelFull: '  Feed   the fish ' });
  assert.deepEqual(out, { ok: true, choreId: id, changed: true });
  const after = chore(db, id);
  assert.equal(after?.id, id, 'the id never moves — ledger rows point at it');
  assert.equal(after?.labelFull, 'Feed the fish');
  assert.equal(after?.labelShort, shortLabelFor('Feed the fish'));
  assert.notEqual(after?.labelShort, before?.labelShort);
  assert.equal(after?.rrule, before?.rrule);
  assert.equal(after?.basePoints, before?.basePoints);
  assert.deepEqual(after?.roster, before?.roster);
});

test('changing only the days keeps the hand-written short label and the roster', () => {
  const { db, id } = fresh();
  db.prepare('UPDATE chore SET label_short = ? WHERE id = ?').run('Plants', id);
  const out = editChore(db, id, { rrule: 'FREQ=WEEKLY;BYDAY=MO,WE,FR' });
  assert.equal(out.ok, true);
  const after = chore(db, id);
  assert.equal(after?.labelShort, 'Plants');
  assert.equal(after?.rrule, 'FREQ=WEEKLY;BYDAY=MO,WE,FR');
  assert.deepEqual(after?.roster.map((m) => m.childId), ['child-b']);
});

test('the same values again are not a change', () => {
  const { db, id } = fresh();
  assert.deepEqual(editChore(db, id, { labelFull: 'Water the plants' }), {
    ok: true,
    choreId: id,
    changed: false,
  });
});

test('worth, model, roster and unknown keys are refused here — they have their own doors', () => {
  const { db, id } = fresh();
  for (const body of [{ basePoints: 9 }, { assignmentModel: 'shared' }, { roster: [] }, {}]) {
    const out = editChore(db, id, body);
    assert.equal(out.ok, false);
    if (out.ok || out.missing) continue;
    assert.ok(out.errors.length > 0);
  }
  assert.equal(chore(db, id)?.basePoints, 2);
});

test('a bad rrule, an unknown picture or an empty name is refused with the file’s words', () => {
  const { db, id } = fresh();
  for (const body of [{ rrule: 'FREQ=HOURLY' }, { iconAssetId: 'ico-nope' }, { labelFull: '   ' }]) {
    const out = editChore(db, id, body);
    assert.equal(out.ok, false, JSON.stringify(body));
  }
  assert.equal(chore(db, id)?.labelFull, 'Water the plants');
});

test('an unknown or retired chore is missing, not an error', () => {
  const { db, id } = fresh();
  assert.deepEqual(editChore(db, 'ch-nope', { labelFull: 'x' }), { ok: false, missing: true });
  retireChore(db, id);
  assert.deepEqual(editChore(db, id, { labelFull: 'x' }), { ok: false, missing: true });
});

test('retire is soft, keeps history, and restore puts it back', () => {
  const { db, id } = fresh();
  materializeChoreDay(db, id, '2026-09-05' as LocalDate);
  const before = historyFingerprint(db);
  assert.deepEqual(retireChore(db, id), { ok: true, changed: true });
  assert.equal(chore(db, id)?.active, false);
  assert.equal(historyFingerprint(db), before, 'retire never deletes a day, claim or ledger row');
  assert.deepEqual(retireChore(db, id), { ok: true, changed: false }, 'idempotent');
  assert.deepEqual(restoreChore(db, id), { ok: true, changed: true });
  assert.equal(chore(db, id)?.active, true);
  assert.deepEqual(restoreChore(db, id), { ok: true, changed: false });
});

test('retire is refused while a claim is waiting, and says how many', () => {
  const { db, id } = fresh();
  materializeChoreDay(db, id, '2026-09-05' as LocalDate);
  const row = db
    .prepare(
      `SELECT a.id FROM chore_assignment a JOIN chore_day d ON d.id = a.chore_day_id
        WHERE d.chore_id = ?`,
    )
    .get(id) as { id: number };
  assert.equal(claimChore(db, { assignmentId: row.id, childId: 'child-b' }).ok, true);
  assert.deepEqual(retireChore(db, id), { ok: false, reason: 'claims_waiting', waiting: 1 });
  assert.equal(chore(db, id)?.active, true);
  assert.deepEqual(retireChore(db, 'ch-nope'), { ok: false, reason: 'unknown_chore' });
});
