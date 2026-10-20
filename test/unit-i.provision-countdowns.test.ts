/**
 * `provision.ts --countdowns`: an additive path for countdowns, so a grown-up's birthday never
 * needs `--household --force` (which deletes children, and with them the ledger).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { applyCountdowns, parseCountdownFile } from '../src/domain/countdowns/author.ts';

function freshDb() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  db.prepare(`INSERT INTO asset (id, kind, category, rel_path) VALUES ('ico-cake','icon','countdown','icons/cake.svg')`).run();
  return db;
}

test('the committed example parses and applies', () => {
  const raw = JSON.parse(readFileSync(new URL('../db/countdowns.example.json', import.meta.url), 'utf8'));
  const parsed = parseCountdownFile(raw);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const db = freshDb();
  const r = applyCountdowns(db, parsed.entries);
  assert.deepEqual(r, { added: 2, updated: 0, unchanged: 0, errors: [] });
  const row = db.prepare(`SELECT horizon_days, annual_md, child_id, active FROM countdown WHERE id='cd-bday-grandma'`).get() as Record<string, unknown>;
  assert.deepEqual({ ...row }, { horizon_days: 14, annual_md: '11-09', child_id: null, active: 1 });
});

test('re-applying is idempotent, an edit is an update, and nothing is ever deleted', () => {
  const db = freshDb();
  const one = { id: 'cd-bday-x', labelShort: 'X', annual: '01-02', horizonDays: 14 };
  const keep = { id: 'cd-keep', labelShort: 'Keep', date: '2030-01-01' };
  const p1 = parseCountdownFile([one, keep]);
  assert.ok(p1.ok);
  applyCountdowns(db, p1.entries);
  const again = applyCountdowns(db, p1.entries);
  assert.deepEqual([again.added, again.updated, again.unchanged], [0, 0, 2]);

  const p2 = parseCountdownFile([{ ...one, horizonDays: 21 }]);
  assert.ok(p2.ok);
  const r = applyCountdowns(db, p2.entries);
  assert.deepEqual([r.added, r.updated, r.unchanged], [0, 1, 0]);
  assert.ok(db.prepare(`SELECT 1 FROM countdown WHERE id='cd-keep'`).get(), 'a row left out of the file stays');

  const off = parseCountdownFile([{ ...one, active: false }]);
  assert.ok(off.ok);
  applyCountdowns(db, off.entries);
  assert.equal((db.prepare(`SELECT active FROM countdown WHERE id='cd-bday-x'`).get() as { active: number }).active, 0);
});

test('one malformed entry refuses the whole file', () => {
  const p = parseCountdownFile([
    { id: 'cd-ok', labelShort: 'Ok', annual: '02-03' },
    { id: 'cd-both', labelShort: 'Both', annual: '02-03', date: '2030-01-01' },
    { id: 'cd-month', labelShort: 'Month', annual: '13-01' },
    { id: 'cd-long', labelShort: 'Fifteen letters', annual: '02-03' },
    { id: 'cd-far', labelShort: 'Far', annual: '02-03', horizonDays: 400 },
    { id: 'bad id', labelShort: 'Bad', annual: '02-03' },
  ]);
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.errors.length, 5);
  assert.equal(parseCountdownFile({}).ok, false);
});

test('a dangling icon or child writes nothing', () => {
  const db = freshDb();
  const p = parseCountdownFile([
    { id: 'cd-a', labelShort: 'A', annual: '02-03' },
    { id: 'cd-b', labelShort: 'B', annual: '02-03', childId: 'child-nobody' },
  ]);
  assert.ok(p.ok);
  const r = applyCountdowns(db, p.entries);
  assert.equal(r.errors.length, 1);
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM countdown').get() as { n: number }).n, 0);
});
