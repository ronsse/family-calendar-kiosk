/**
 * Unit I — `--band` / `--ledger`: two columns on one child, in place.
 *
 * The property that matters is what does NOT happen: no ledger entry is touched, an unknown
 * child or value writes nothing, and a re-run is a no-op. Synthetic household only (§3.1).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { applyChildSettings, parseChildSettings } from '../stacks/wall/entry/provision.ts';

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

const row = (db: ReturnType<typeof fresh>, id: string) =>
  db.prepare('SELECT reading_band AS band, ledger_enabled AS ledger FROM child WHERE id = ?').get(id) as
    { band: string; ledger: number };

test('band and ledger change in place and leave the ledger rows alone', () => {
  const db = fresh();
  const ids = (db.prepare('SELECT id FROM child ORDER BY sort_order').all() as Array<{ id: string }>).map((r) => r.id);
  const target = ids[ids.length - 1]!;
  const entries = (db.prepare('SELECT COUNT(*) AS n FROM ledger_entry').get() as { n: number }).n;
  const other = row(db, ids[0]!);

  const changed = applyChildSettings(db, parseChildSettings(`${target}=emergent`, `${target}=off`));
  assert.ok(changed.length >= 1);
  assert.deepEqual(row(db, target), { band: 'emergent', ledger: 0 });
  applyChildSettings(db, parseChildSettings(`${target}=fluent`, `${target}=on`));
  assert.deepEqual(row(db, target), { band: 'fluent', ledger: 1 });
  assert.deepEqual(row(db, ids[0]!), other, 'another child is untouched');
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM ledger_entry').get() as { n: number }).n, entries);

  assert.deepEqual(applyChildSettings(db, parseChildSettings(`${target}=fluent`, `${target}=on`)), [],
    'a re-run reports nothing changed');
});

test('an unknown child refuses before anything is written', () => {
  const db = fresh();
  const ids = (db.prepare('SELECT id FROM child').all() as Array<{ id: string }>).map((r) => r.id);
  const before = ids.map((id) => row(db, id));
  const flip = before[0]!.band === 'fluent' ? 'emergent' : 'fluent';
  assert.throws(() => applyChildSettings(db, parseChildSettings(`${ids[0]}=${flip},no-such-child=fluent`, null)),
    /no child with id "no-such-child"/);
  assert.deepEqual(ids.map((id) => row(db, id)), before);
});

test('bad values and empty input are refused by the parser', () => {
  assert.throws(() => parseChildSettings('child-a=huge', null), /not a band/);
  assert.throws(() => parseChildSettings(null, 'child-a=yes'), /on or off/);
  assert.throws(() => parseChildSettings('child-a', null), /expected <child-id>=<value>/);
  assert.throws(() => parseChildSettings('', null), /nothing to change/);
});
