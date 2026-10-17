/**
 * Unit C — a chore made from the wall goes through the file's rules.
 *
 * `createChore` is the admin route's half of `--chores FILE`: same parser, same referential
 * checks, same writer, same history guard. What it adds is what the sheet cannot ask a parent
 * for — the id, the short label and the category — and what these tests pin is that those are
 * derived predictably and that every refusal the file would make, the wall makes too.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import {
  choreIdFor,
  createChore,
  historyFingerprint,
  materializeChoreDay,
  readChoreCatalog,
  shortLabelFor,
} from '../src/domain/chores/index.ts';
import type { LocalDate } from '../src/types.ts';

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

const BODY = {
  labelFull: 'Water the plants',
  iconAssetId: 'ico-table',
  kind: 'extra',
  basePoints: 2,
  assignmentModel: 'individual',
  rrule: 'FREQ=WEEKLY;BYDAY=SA',
  roster: ['child-b'],
};

test('a new chore lands active, on the roster it was given, with derived id, short label and category', () => {
  const db = fresh();
  const before = historyFingerprint(db);
  const result = createChore(db, BODY);
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.choreId, 'ch-water-the-plants');
  assert.deepEqual(result.changes, [{ id: 'ch-water-the-plants', action: 'added' }]);

  const chore = readChoreCatalog(db).chores.find((c) => c.id === result.choreId);
  assert.ok(chore);
  assert.equal(chore.active, true);
  assert.equal(chore.labelFull, 'Water the plants');
  assert.equal(chore.labelShort, 'Water the');
  assert.equal(chore.category, 'kitchen');
  assert.equal(chore.kind, 'extra');
  assert.equal(chore.basePoints, 2);
  assert.deepEqual(
    chore.roster.map((m) => m.childId),
    ['child-b'],
  );
  assert.equal(chore.rosterExplicit, true);
  assert.equal(historyFingerprint(db), before);

  // And it reaches a board: the next Saturday materializes one assignment for child-b.
  const day = materializeChoreDay(db, result.choreId, '2026-09-05' as LocalDate);
  assert.equal(day.assignmentsWritten, 1);
});

test('the name is trimmed and its double spaces collapsed before anything looks at it', () => {
  const db = fresh();
  const result = createChore(db, { ...BODY, labelFull: '  Sweep  the porch ' });
  assert.equal(result.ok, true);
  if (!result.ok) return;
  assert.equal(result.choreId, 'ch-sweep-the-porch');
  const chore = readChoreCatalog(db).chores.find((c) => c.id === result.choreId);
  assert.equal(chore?.labelFull, 'Sweep the porch');
  assert.equal(chore?.labelShort, 'Sweep the');
});

test('the same name twice is two chores, never a reuse of a retired id', () => {
  const db = fresh();
  assert.equal(createChore(db, BODY).ok, true);
  db.prepare(`UPDATE chore SET active = 0 WHERE id = 'ch-water-the-plants'`).run();
  const again = createChore(db, BODY);
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.choreId, 'ch-water-the-plants-2');
  assert.equal(choreIdFor(db, 'Water the plants'), 'ch-water-the-plants-3');
  assert.equal(choreIdFor(db, '¡¡¡'), 'ch-chore');
});

test('the short label is whole leading words when the name is long, and a hard cut only when one word is', () => {
  assert.equal(shortLabelFor('Feed the pet'), 'Feed the pet');
  assert.equal(shortLabelFor('Empty the dishwasher'), 'Empty the');
  assert.equal(shortLabelFor('Dishwasherunloadingtime'), 'Dishwasherunlo');
  assert.equal([...shortLabelFor('Dishwasherunloadingtime')].length, 14);
});

test('every refusal the file would make, the wall makes, with the file’s words', () => {
  const db = fresh();
  const refused = (body: unknown): string[] => {
    const r = createChore(db, body);
    assert.equal(r.ok, false);
    return r.ok ? [] : r.errors;
  };
  assert.match(refused({ ...BODY, roster: undefined }).join('\n'), /at least one child/);
  assert.match(refused({ ...BODY, roster: [] }).join('\n'), /at least one child/);
  assert.match(refused({ ...BODY, roster: ['child-z'] }).join('\n'), /no child "child-z"/);
  assert.match(refused({ ...BODY, iconAssetId: 'ico-nope' }).join('\n'), /no asset "ico-nope"/);
  assert.match(refused({ ...BODY, rrule: 'FREQ=MONTHLY' }).join('\n'), /not supported/);
  assert.match(refused({ ...BODY, labelFull: '   ' }).join('\n'), /labelFull must not be empty/);
  assert.match(refused({ ...BODY, basePoints: -1 }).join('\n'), /basePoints/);
  assert.match(refused({ ...BODY, kind: 'hobby' }).join('\n'), /kind must be one of/);
  assert.match(refused({ ...BODY, assignmentModel: 'lottery' }).join('\n'), /assignmentModel/);
  assert.match(refused({ ...BODY, dueByLocal: '25:00' }).join('\n'), /dueByLocal/);
  assert.match(refused('not even an object').join('\n'), /must be an object/);
  // One answer carries everything: a body with nothing right is refused once, with every reason.
  const all = refused({});
  assert.ok(all.length >= 5, all.join('\n'));
  assert.match(all.join('\n'), /at least one child/);
  // Nothing above wrote anything.
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM chore WHERE id LIKE 'ch-water%'`).get() as { n: number }).n,
    0,
  );
});
