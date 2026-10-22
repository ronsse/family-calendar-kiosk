/**
 * `provision.ts --routine-steps`: the only door for a NEW routine step that does not go
 * through `--household --force` (which deletes children, and with them the ledger).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { applyRoutineSteps, parseRoutineStepFile } from '../src/domain/routines/author.ts';
import type { LocalDate } from '../src/types.ts';

const TODAY = '2026-10-22' as LocalDate;

function freshDb() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  for (const [id, cat] of [['ico-moon', 'routine'], ['ico-dress', 'step'], ['ico-teeth', 'step'], ['ico-toybox', 'step']]) {
    db.prepare(`INSERT INTO asset (id, kind, category, rel_path, validated_at_utc) VALUES (?, 'icon', ?, ?, '2026-10-22T00:00:00Z')`)
      .run(id, cat, `icons/${id}.png`);
  }
  return db;
}

function seedBedtime(db: ReturnType<typeof freshDb>) {
  db.exec(`
    INSERT INTO routine VALUES ('rt-bed','Bedtime','Bedtime routine','ico-moon','19:00','20:30','SU,MO,TU,WE,TH,FR,SA',1,1);
    INSERT INTO routine_step VALUES
      ('st-pj','rt-bed','PJs','Put on pyjamas','ico-dress','dressing',1),
      ('st-teeth-pm','rt-bed','Teeth','Brush your teeth','ico-teeth','hygiene',1);
  `);
  for (const [i, c] of ['child-a', 'child-b', 'child-c'].entries()) {
    db.prepare(`INSERT INTO child (id, display_name, reading_band, ledger_enabled, avatar_asset_id, sort_order, active)
                VALUES (?, ?, 'fluent', 1, 'ico-moon', ?, 1)`).run(c, c, i + 1);
  }
  db.exec(`
    INSERT INTO routine_step_assignment VALUES
      ('rt-bed','child-a','st-pj',1), ('rt-bed','child-a','st-teeth-pm',2),
      ('rt-bed','child-b','st-pj',1), ('rt-bed','child-b','st-teeth-pm',2),
      ('rt-bed','child-c','st-pj',1);
  `);
}

const seq = (db: ReturnType<typeof freshDb>, child: string) =>
  (db.prepare(`SELECT routine_step_id AS s FROM routine_step_assignment WHERE routine_id='rt-bed' AND child_id=? ORDER BY position`)
    .all(child) as { s: string }[]).map((r) => r.s);

test('the committed example puts Toys away FIRST at bedtime for every child', () => {
  const raw = JSON.parse(readFileSync(new URL('../db/routine-steps.example.json', import.meta.url), 'utf8'));
  const parsed = parseRoutineStepFile(raw);
  assert.ok(parsed.ok, JSON.stringify(parsed));
  const db = freshDb();
  seedBedtime(db);
  const r = applyRoutineSteps(db, parsed.entries, TODAY);
  assert.deepEqual(r, { added: 1, updated: 0, unchanged: 0, sequencesChanged: 3, errors: [] });
  assert.deepEqual(seq(db, 'child-a'), ['st-toys', 'st-pj', 'st-teeth-pm']);
  assert.deepEqual(seq(db, 'child-c'), ['st-toys', 'st-pj']);

  const again = applyRoutineSteps(db, parsed.entries, TODAY);
  assert.deepEqual(again, { added: 0, updated: 0, unchanged: 1, sequencesChanged: 0, errors: [] }, 're-applying is a no-op');
});

test('a child the file does not name keeps their sequence, and nothing is deleted', () => {
  const db = freshDb();
  seedBedtime(db);
  const p = parseRoutineStepFile([
    { id: 'st-toys', routine: 'rt-bed', labelShort: 'Toys away', icon: 'ico-toybox', category: 'tidy', children: ['child-a'] },
  ]);
  assert.ok(p.ok);
  applyRoutineSteps(db, p.entries, TODAY);
  assert.deepEqual(seq(db, 'child-a'), ['st-pj', 'st-teeth-pm', 'st-toys'], 'no position appends');
  assert.deepEqual(seq(db, 'child-b'), ['st-pj', 'st-teeth-pm']);

  const none = parseRoutineStepFile([
    { id: 'st-toys', routine: 'rt-bed', labelShort: 'Toys away', icon: 'ico-toybox', category: 'tidy', children: [] },
  ]);
  assert.ok(none.ok);
  applyRoutineSteps(db, none.entries, TODAY);
  assert.deepEqual(seq(db, 'child-a'), ['st-pj', 'st-teeth-pm', 'st-toys'], 'leaving a child out never unassigns');
});

test("today's materialized run gets the new step, so it is on tonight's card", () => {
  const db = freshDb();
  seedBedtime(db);
  const run = db.prepare(
    `INSERT INTO routine_run (routine_id, local_date, opens_at_local, closes_at_local, created_at_utc)
     VALUES ('rt-bed', ?, '19:00', '20:30', '2026-10-22T12:00:00Z') RETURNING id`,
  ).get(TODAY) as { id: number };
  db.prepare(
    `INSERT INTO routine_run_step (run_id, child_id, source_step_id, position, label_short, label_full, icon_asset_id)
     VALUES (?, 'child-a', 'st-pj', 1, 'PJs', 'Put on pyjamas', 'ico-dress'),
            (?, 'child-a', 'st-teeth-pm', 2, 'Teeth', 'Brush your teeth', 'ico-teeth')`,
  ).run(run.id, run.id);
  const p = parseRoutineStepFile([
    { id: 'st-toys', routine: 'rt-bed', labelShort: 'Toys away', icon: 'ico-toybox', category: 'tidy', children: ['child-a'], position: 1 },
  ]);
  assert.ok(p.ok);
  applyRoutineSteps(db, p.entries, TODAY);
  const steps = (db.prepare(`SELECT source_step_id AS s FROM routine_run_step WHERE run_id=? AND child_id='child-a' ORDER BY position`)
    .all(run.id) as { s: string }[]).map((r) => r.s);
  assert.deepEqual(steps, ['st-toys', 'st-pj', 'st-teeth-pm']);
});

test('one malformed entry refuses the whole file, and a dangling id writes nothing', () => {
  const p = parseRoutineStepFile([
    { id: 'st-ok', routine: 'rt-bed', labelShort: 'Ok', icon: 'ico-toybox', category: 'tidy', children: [] },
    { id: 'bad', routine: 'rt-bed', labelShort: 'Bad', icon: 'ico-toybox', category: 'tidy', children: [] },
    { id: 'st-long', routine: 'rt-bed', labelShort: 'Fifteen letters', icon: 'ico-toybox', category: 'tidy', children: [] },
    { id: 'st-pos', routine: 'rt-bed', labelShort: 'Pos', icon: 'ico-toybox', category: 'tidy', children: [], position: 0 },
    { id: 'st-kids', routine: 'rt-bed', labelShort: 'Kids', icon: 'ico-toybox', category: 'tidy' },
  ]);
  assert.equal(p.ok, false);
  if (!p.ok) assert.equal(p.errors.length, 4);
  assert.equal(parseRoutineStepFile({}).ok, false);

  const db = freshDb();
  seedBedtime(db);
  const q = parseRoutineStepFile([
    { id: 'st-a', routine: 'rt-bed', labelShort: 'A', icon: 'ico-toybox', category: 'tidy', children: ['child-a'] },
    { id: 'st-b', routine: 'rt-bed', labelShort: 'B', icon: 'ico-nothing', category: 'tidy', children: ['child-nobody'] },
    { id: 'st-pj', routine: 'rt-morning', labelShort: 'PJs', icon: 'ico-dress', category: 'dressing', children: [] },
  ]);
  assert.ok(q.ok);
  const r = applyRoutineSteps(db, q.entries, TODAY);
  assert.equal(r.errors.length, 4, r.errors.join('\n'));
  assert.equal((db.prepare(`SELECT COUNT(*) AS n FROM routine_step`).get() as { n: number }).n, 2);
  assert.deepEqual(seq(db, 'child-a'), ['st-pj', 'st-teeth-pm']);
});
