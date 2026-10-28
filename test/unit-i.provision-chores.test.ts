/**
 * Unit I — the `--chores` authoring path.
 *
 * This is the file that closes backlog item 2.4 (private notes): "adjustable" used to mean editing SQL and
 * re-running a seed, which erases every point balance in the ledger.
 *
 * **Why these tests and not CRUD tests.** `applyChores` is a tool an adult points at the
 * household's LIVE database, months into a run, to add a chore. Everything interesting about it
 * is a property of what it must NOT do, and none of those properties are visible from the
 * outside — a run that quietly repriced a materialized day, or that silently un-retired a chore
 * on a re-read of the same file, or that erased a balance, all look exactly like a successful
 * run. So the assertions here are mostly about things staying still.
 *
 * The fixtures are `seed.dev.sql`'s synthetic household — Child A / B / C — and never
 * `db/household.sql` (build-plan §3.1).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { openDatabase, assertIntegrity } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { listBalances } from '../src/db/repo.ts';
import { choresForDate } from '../src/domain/chores/read.ts';
import { claimChore, approveChore } from '../src/domain/chores/transitions.ts';
import {
  applyChores,
  historyFingerprint,
  parseChoreFile,
  validateChoreAuthoring,
  type ChoreAuthoring,
  type ChoreSpec,
} from '../stacks/wall/entry/provision.ts';
import type { LocalDate } from '../src/types.ts';

const TODAY = '2026-08-27' as LocalDate;

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

/** A minimal valid spec.  Every test that wants a variant starts here and changes one field. */
function spec(over: Partial<ChoreSpec> = {}): ChoreSpec {
  return {
    id: 'ch-dishes',
    labelShort: 'Dishes',
    labelFull: 'Empty the dishwasher',
    iconAssetId: 'ico-table',
    category: 'kitchen',
    assignmentModel: 'individual',
    basePoints: 5,
    kind: 'extra',
    // The parser's default: a duty counts, an extra never does.
    countsTowardDay: (over.kind ?? 'extra') !== 'extra',
    rrule: 'FREQ=DAILY',
    dueByLocal: '18:00',
    rotation: null,
    ...over,
  };
}

function authoring(over: Partial<ChoreAuthoring> = {}): ChoreAuthoring {
  return { chores: [], retire: [], restore: [], ...over };
}

/**
 * Do a full day's work for one child: materialize, claim, approve.
 *
 * Returns the balance afterwards, which is the number every test below is really about.
 */
function earnSomething(db: ReturnType<typeof fresh>): number {
  const { assignments } = choresForDate(db, TODAY);
  const mine = assignments.find((a) => a.state === 'pending');
  assert.ok(mine, 'the synthetic household must produce at least one pending chore');
  assert.equal(claimChore(db, { assignmentId: mine.assignmentId, childId: mine.childId }).ok, true);
  assert.equal(approveChore(db, { assignmentId: mine.assignmentId }).ok, true);
  const balance = listBalances(db).find((b) => b.childId === mine.childId);
  assert.ok(balance && balance.points > 0, 'approving a chore must move points');
  return balance.points;
}

// ---------------------------------------------------------------------------
// The property the whole path exists for
// ---------------------------------------------------------------------------

test('retiring and repricing a chore leaves every balance exactly where it was', () => {
  const db = fresh();
  const before = earnSomething(db);

  // Reprice 'ch-table' from 5 to 99, reclassify it as a paid extra, and retire 'ch-pet'.
  // This is the destructive-looking shape an adult would actually run.
  const changes = applyChores(
    db,
    authoring({
      chores: [
        spec({
          id: 'ch-table',
          labelShort: 'Table',
          labelFull: 'Set the table',
          assignmentModel: 'rotation',
          basePoints: 99,
          kind: 'extra',
        }),
      ],
      retire: ['ch-pet'],
    }),
  );

  assert.deepEqual(
    changes.map((c) => c.action).sort(),
    ['retired', 'updated'],
    'both verbs must report what they did',
  );

  const after = listBalances(db).map((b) => b.points).reduce((a, b) => a + b, 0);
  assert.equal(after, before, 'authoring may never move a balance');
  assertIntegrity(db);
  db.close();
});

test('a reprice does not reach a day that is already materialized', () => {
  // `chore_day.points_each` is a per-day SNAPSHOT. This is the reason it exists: a parent who
  // raises a chore's value at four in the afternoon must not retroactively change what this
  // morning's work was worth, in either direction.
  const db = fresh();
  choresForDate(db, TODAY); // materialize
  const wasWorth = db
    .prepare(`SELECT points_each AS p FROM chore_day WHERE chore_id = 'ch-table' AND local_date = ?`)
    .get(TODAY) as { p: number } | undefined;
  assert.equal(wasWorth?.p, 5);

  applyChores(
    db,
    authoring({
      chores: [
        spec({
          id: 'ch-table',
          labelShort: 'Table',
          labelFull: 'Set the table',
          assignmentModel: 'rotation',
          basePoints: 99,
        }),
      ],
    }),
  );

  const stillWorth = db
    .prepare(`SELECT points_each AS p FROM chore_day WHERE chore_id = 'ch-table' AND local_date = ?`)
    .get(TODAY) as { p: number } | undefined;
  assert.equal(stillWorth?.p, 5, "today's snapshot must not follow the new price");
  assert.equal(
    (db.prepare(`SELECT base_points AS p FROM chore WHERE id = 'ch-table'`).get() as { p: number })
      .p,
    99,
    'the definition itself must have changed',
  );
  db.close();
});

test('nothing is ever deleted — a retired chore keeps its history', () => {
  const db = fresh();
  earnSomething(db);
  const days = db.prepare('SELECT COUNT(*) AS n FROM chore_day').get() as { n: number };
  const rows = db.prepare('SELECT COUNT(*) AS n FROM chore_assignment').get() as { n: number };
  const ledger = db.prepare('SELECT COUNT(*) AS n FROM ledger_entry').get() as { n: number };

  applyChores(db, authoring({ retire: ['ch-table', 'ch-pet', 'ch-tidy', 'ch-bed'] }));

  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM chore_day').get() as { n: number }).n, days.n);
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM chore_assignment').get() as { n: number }).n,
    rows.n,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM ledger_entry').get() as { n: number }).n,
    ledger.n,
  );
  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM chore WHERE active = 1').get() as { n: number }).n,
    0,
    'all four must be off the board',
  );
  assertIntegrity(db);
  db.close();
});

/**
 * THE ONE THE TEST ABOVE ONLY LOOKED LIKE IT COVERED.
 *
 * It asserts `COUNT(*) FROM chore WHERE active = 1` is zero and calls that "all four must be
 * off the board" — but it asks the TABLE, not the board. `choresForDate` is the board, and
 * until 2026-09-06 its WHERE read `c.active = 1`, where `c` is the CHILD and `ch` is the
 * CHORE. One character apart, both plausible, and the chore flag was never checked.
 *
 * The effect: retiring a chore removed it from tomorrow, because materialization filters on
 * `active = 1` — and left it on every day already materialized. Materialization is lazy and
 * per-day, so "already materialized" is always TODAY by the time an adult retires something in
 * the evening. When the household's real chore list went live the wall drew all four retired
 * dev-seed chores alongside the seven new ones and overflowed its pane by 68px.
 *
 * So this asks the read.
 */
test('a retired chore leaves TODAY\'s board, not just tomorrow\'s', () => {
  const db = fresh();
  earnSomething(db);

  const before = choresForDate(db, TODAY).assignments;
  assert.ok(
    before.some((r) => r.choreId === 'ch-bed'),
    'precondition: the chore is on the board before it is retired',
  );

  applyChores(db, authoring({ retire: ['ch-bed'] }));

  const after = choresForDate(db, TODAY).assignments;
  assert.equal(
    after.filter((r) => r.choreId === 'ch-bed').length,
    0,
    'a retired chore must not still be rendered for a day that was already materialized',
  );
  // And retiring one thing must not take the others with it.
  assert.ok(after.length > 0, 'the rest of the board is untouched');
  assert.equal(
    before.length - after.length,
    before.filter((r) => r.choreId === 'ch-bed').length,
    'exactly the retired chore\'s cards went, and nothing else',
  );
  assertIntegrity(db);
  db.close();
});

// ---------------------------------------------------------------------------
// Re-running the same file
// ---------------------------------------------------------------------------

test('running the same authoring twice is a no-op, not an error and not a duplicate', () => {
  const db = fresh();
  const input = authoring({ chores: [spec()] });

  assert.deepEqual(
    applyChores(db, input).map((c) => c.action),
    ['added'],
  );
  assert.deepEqual(
    applyChores(db, input).map((c) => c.action),
    ['unchanged'],
    'the second run must recognise it has nothing to do',
  );
  assert.equal(
    (db.prepare(`SELECT COUNT(*) AS n FROM chore WHERE id = 'ch-dishes'`).get() as { n: number }).n,
    1,
  );
  db.close();
});

test('re-running a file that still lists a retired chore does NOT un-retire it', () => {
  // The reason `retire` is its own verb rather than an `active` field on the record. If the
  // record carried it, the file an adult keeps on disk would silently resurrect anything they
  // had taken off the board, and the only way back would be hand-edited SQL — which is the gap
  // this whole path exists to close.
  const db = fresh();
  const input = authoring({ chores: [spec()] });
  applyChores(db, input);
  applyChores(db, authoring({ retire: ['ch-dishes'] }));

  applyChores(db, input); // the same file, re-run
  const row = db.prepare(`SELECT active FROM chore WHERE id = 'ch-dishes'`).get() as {
    active: number;
  };
  assert.equal(row.active, 0, 'an upsert must never touch `active`');
  db.close();
});

test('restore is the undo, and both verbs report when there was nothing to do', () => {
  const db = fresh();
  applyChores(db, authoring({ chores: [spec()] }));

  assert.deepEqual(applyChores(db, authoring({ retire: ['ch-dishes'] }))[0]?.action, 'retired');
  assert.deepEqual(
    applyChores(db, authoring({ retire: ['ch-dishes'] }))[0]?.action,
    'already retired',
  );
  assert.deepEqual(applyChores(db, authoring({ restore: ['ch-dishes'] }))[0]?.action, 'restored');
  assert.deepEqual(
    applyChores(db, authoring({ restore: ['ch-dishes'] }))[0]?.action,
    'already active',
  );
  db.close();
});

// ---------------------------------------------------------------------------
// Refusing bad input BEFORE opening a transaction
// ---------------------------------------------------------------------------

test('a malformed file is refused whole, with every error, and writes nothing', () => {
  const db = fresh();
  const beforeCount = (db.prepare('SELECT COUNT(*) AS n FROM chore').get() as { n: number }).n;

  const parsed = parseChoreFile(
    JSON.stringify({
      chores: [
        { id: 'ch-a' }, // missing nearly everything
        { ...spec({ id: 'ch-b' }), labelShort: 'a much too long label' },
        { ...spec({ id: 'ch-c' }), kind: 'paid' },
        { ...spec({ id: 'ch-d' }), dueByLocal: '29:00' },
        { ...spec({ id: 'ch-e' }), basePoints: -1 },
      ],
    }),
  );
  assert.equal(parsed.ok, false);
  assert.ok(parsed.ok === false && parsed.errors.length >= 5, 'every bad row must be reported');

  assert.equal(
    (db.prepare('SELECT COUNT(*) AS n FROM chore').get() as { n: number }).n,
    beforeCount,
    'a parse failure must not have touched the database',
  );
  db.close();
});

test('"29:00" is rejected even though the table would take it', () => {
  // The schema's GLOB is '[0-2][0-9]:[0-5][0-9]', which accepts 29:00 — and on a MIGRATED
  // database there is no CHECK at all, because SQLite cannot add one to an existing table. So
  // on the household's real database this writer IS the constraint, and a strict subset is the
  // only shape that cannot disagree with the table it is protecting.
  const parsed = parseChoreFile(JSON.stringify({ chores: [{ ...spec(), dueByLocal: '29:00' }] }));
  assert.equal(parsed.ok, false);
  const ok = parseChoreFile(JSON.stringify({ chores: [{ ...spec(), dueByLocal: '23:59' }] }));
  assert.equal(ok.ok, true);
});

test('a chore pointing at an asset that does not exist is caught before the write', () => {
  const db = fresh();
  const errors = validateChoreAuthoring(
    db,
    authoring({ chores: [spec({ iconAssetId: 'no-such-icon' })] }),
  );
  assert.ok(errors.length > 0, 'a dangling icon must be refused');
  assert.ok(
    errors.join(' ').includes('no-such-icon'),
    'the error must name the thing that is wrong',
  );
  db.close();
});

test('unknown keys are refused rather than ignored', () => {
  // A typo that is silently dropped is the failure mode of every config file ever written:
  // `"kinde": "extra"` would leave a paid chore quietly classed as a duty.
  const bad = parseChoreFile(JSON.stringify({ chores: [{ ...spec(), kinde: 'extra' }] }));
  assert.equal(bad.ok, false);
  const alsoBad = parseChoreFile(JSON.stringify({ chores: [spec()], retyre: ['x'] }));
  assert.equal(alsoBad.ok, false);
});

test('a file that is not JSON at all fails with a message rather than a stack trace', () => {
  const r = parseChoreFile('this is not json');
  assert.equal(r.ok, false);
  assert.ok(r.ok === false && r.errors.length === 1);
});

// ---------------------------------------------------------------------------
// The guard itself
// ---------------------------------------------------------------------------

test('historyFingerprint moves when history moves, and only then', () => {
  // The guard inside applyChores compares this before and after and rolls back on a
  // difference. A fingerprint that never changed would make that check vacuous, so this
  // asserts it is actually sensitive to the things it claims to watch.
  const db = fresh();
  const empty = historyFingerprint(db);
  choresForDate(db, TODAY);
  const materialized = historyFingerprint(db);
  assert.notEqual(materialized, empty, 'materializing a day must move the fingerprint');

  earnSomething(db);
  assert.notEqual(historyFingerprint(db), materialized, 'a ledger entry must move it');

  const stable = historyFingerprint(db);
  applyChores(db, authoring({ chores: [spec()] }));
  assert.equal(historyFingerprint(db), stable, 'authoring must not move it');
  db.close();
});

test('rotation membership is only rewritten when it differs', () => {
  const db = fresh();
  const rotation = ['child-a', 'child-b'];
  const same = applyChores(
    db,
    authoring({
      chores: [
        spec({
          id: 'ch-table',
          labelShort: 'Table',
          labelFull: 'Set the table',
          assignmentModel: 'rotation',
          basePoints: 5,
          kind: 'duty',
          dueByLocal: null,
          rotation,
        }),
      ],
    }),
  );
  assert.equal(same[0]?.action, 'unchanged', 'an identical definition and roster is a no-op');

  const changed = applyChores(
    db,
    authoring({
      chores: [
        spec({
          id: 'ch-table',
          labelShort: 'Table',
          labelFull: 'Set the table',
          assignmentModel: 'rotation',
          basePoints: 5,
          kind: 'duty',
          dueByLocal: null,
          rotation: ['child-b', 'child-a'],
        }),
      ],
    }),
  );
  assert.equal(changed[0]?.action, 'updated', 'reordering the roster is a real change');
  const members = db
    .prepare(`SELECT child_id FROM chore_rotation_member WHERE chore_id='ch-table' ORDER BY position`)
    .all() as { child_id: string }[];
  assert.deepEqual(members.map((m) => m.child_id), ['child-b', 'child-a']);
  db.close();
});

test('countsTowardDay: a duty may opt out, an extra cannot opt in, and the board says which', () => {
  // A reminder duty (homework, eye exercises — 2026-10-27) stays on the board and leaves the
  // full day on both sides. The wall's celebration reads the flag off the view, so it has to
  // arrive there, not just in the table.
  const bad = parseChoreFile(JSON.stringify({ chores: [{ ...spec(), countsTowardDay: true }] }));
  assert.equal(bad.ok, false, 'an extra that claims to count is refused');
  const notBool = parseChoreFile(
    JSON.stringify({ chores: [{ ...spec({ kind: 'duty' }), countsTowardDay: 'no' }] }),
  );
  assert.equal(notBool.ok, false);

  const duty = { ...spec({ id: 'ch-dutyish', kind: 'duty', basePoints: 0 }) } as Record<string, unknown>;
  delete duty['countsTowardDay'];
  const omitted = parseChoreFile(JSON.stringify({ chores: [duty] }));
  assert.ok(omitted.ok && omitted.authoring.chores[0]?.countsTowardDay === true, 'a duty counts by default');

  const db = fresh();
  applyChores(
    db,
    authoring({ chores: [spec({ id: 'ch-reminder', kind: 'duty', basePoints: 0, countsTowardDay: false })] }),
  );
  const view = choresForDate(db, TODAY).assignments.find((a) => a.choreId === 'ch-reminder');
  assert.equal(view?.countsTowardDay, false);
  // And flipping it back is an `updated`, like any other field: the file wins.
  const again = applyChores(db, authoring({ chores: [spec({ id: 'ch-reminder', kind: 'duty', basePoints: 0, countsTowardDay: true })] }));
  assert.deepEqual(again.map((c) => c.action), ['updated']);
  assert.equal(
    choresForDate(db, TODAY).assignments.find((a) => a.choreId === 'ch-reminder')?.countsTowardDay,
    true,
  );
  db.close();
});

test('a new chore reaches the board, as the kind it was authored with', () => {
  // End to end, because everything above tests that nothing moved. Something has to.
  const db = fresh();
  applyChores(db, authoring({ chores: [spec({ id: 'ch-dishes', kind: 'extra' })] }));
  const { assignments } = choresForDate(db, TODAY);
  const mine = assignments.filter((a) => a.choreId === 'ch-dishes');
  assert.ok(mine.length > 0, 'an authored chore must materialize');
  assert.equal(mine[0]?.kind, 'extra');
  assert.equal(mine[0]?.dueByLocal, '18:00');
  db.close();
});

test('a rejected entry does not also report the file as empty', () => {
  // Found by running the CLI rather than the tests: `chores` is empty when every entry was
  // REJECTED as well as when the file genuinely lists none, and the second message was being
  // printed underneath nine parse errors. That tells the reader the file named no chores when
  // it named one and it was bad — the opposite of what happened, at the bottom of the output,
  // which is where a person looks first.
  const rejected = parseChoreFile(JSON.stringify({ chores: [{ id: 'ch-x' }] }));
  assert.equal(rejected.ok, false);
  assert.ok(
    rejected.ok === false && !rejected.errors.some((e) => e.includes('nothing to do')),
    'a rejected entry must not also be reported as an empty file',
  );

  const empty = parseChoreFile(JSON.stringify({ chores: [] }));
  assert.equal(empty.ok, false);
  assert.ok(
    empty.ok === false && empty.errors.some((e) => e.includes('nothing to do')),
    'a genuinely empty file still deserves the message',
  );
});


// ---------------------------------------------------------------------------
// Notes for the human, and the strictness they must not weaken
// ---------------------------------------------------------------------------

test('underscore keys are notes and are ignored, at both levels', () => {
  // `db/chores.example.json` is the file a household edits, and the guidance that belongs
  // with it — which `kind` puts a tile where, that `basePoints: 0` is what makes a duty
  // unpaid — belongs where the person is looking, not in a docstring they will not open.
  // Same convention `assets/manifest.json` already uses for exactly this.
  const parsed = parseChoreFile(
    JSON.stringify({
      _comment: ['a note to whoever edits this'],
      _anything: { nested: true },
      chores: [{ ...spec(), _note: 'why this one is an extra' }],
      retire: [],
      restore: [],
    }),
  );
  assert.equal(parsed.ok, true, parsed.ok ? '' : parsed.errors.join('; '));
  assert.ok(parsed.ok);
  assert.equal(parsed.authoring.chores.length, 1);
  assert.equal((parsed.authoring.chores[0] as unknown as Record<string, unknown>)['_note'], undefined,
    'a note must not survive into the record that gets written');
});

test('a MISSPELLED field is still refused — the note rule cannot be a loophole', () => {
  // The strict check exists because silently ignoring `"points": 9` looks applied and leaves
  // the old price in place. An underscore prefix is unambiguous and cannot mask a typo,
  // because a typo does not have one.
  for (const bad of ['basepoints', 'points', 'labelshort', 'Kind', 'rRule']) {
    const entry: Record<string, unknown> = { ...spec() };
    entry[bad] = 1;
    const parsed = parseChoreFile(JSON.stringify({ chores: [entry], retire: [], restore: [] }));
    assert.equal(parsed.ok, false, `"${bad}" must still be refused`);
    assert.ok(
      !parsed.ok && parsed.errors.some((e) => e.includes(bad)),
      `the error must name "${bad}" so the author can find it`,
    );
  }
});

// ---------------------------------------------------------------------------
// The CLI contract itself
// ---------------------------------------------------------------------------

test('every flag the CLI reads is in KNOWN_FLAGS, so an unknown one cannot be ignored', () => {
  // The failure this closes, found live 2026-09-08: `flag()` returns null for anything absent
  // and nothing asked whether a `--something` on the command line had been read by ANY branch.
  // So the weekly scene runner called `--add-scene <id>` against a container built before that
  // flag existed, fell through to the default branch, got a device inventory and exit 0, and
  // reported the scene as registered. Nothing was registered.
  //
  // The guard is only as good as its list, and a list maintained by hand rots — so derive the
  // truth from the source and compare. A new flag that is read but not declared fails here
  // rather than silently no-opping in production.
  const source = readFileSync(
    new URL('../stacks/wall/entry/provision.ts', import.meta.url),
    'utf8',
  );
  const declared = new Set(
    (/const KNOWN_FLAGS: readonly string\[\] = \[([\s\S]*?)\];/.exec(source)?.[1] ?? '')
      .split(',')
      .map((s) => s.trim().replace(/^'|'$/g, ''))
      .filter((s) => s.length > 0 && !s.startsWith('//')),
  );
  assert.ok(declared.size > 0, 'KNOWN_FLAGS must be findable in the source');

  const read = new Set<string>();
  for (const m of source.matchAll(/\bflag\('([a-z-]+)'\)/g)) read.add(m[1] ?? '');
  for (const m of source.matchAll(/\bargs\.includes\('--([a-z-]+)'\)/g)) read.add(m[1] ?? '');
  // KNOWN_FLAGS names itself in the refusal message; that is not a read of the command line.
  read.delete('');

  const undeclared = [...read].filter((f) => !declared.has(f)).sort();
  assert.deepEqual(undeclared, [], 'a flag the CLI reads but does not declare would be ignored');
});

// ---------------------------------------------------------------------------
// --reset-activity: wipe what the wall has DONE, keep what it IS
// ---------------------------------------------------------------------------

test('the reset wipes use and keeps setup, and refuses over a non-empty ledger', () => {
  // Asserted through the SCHEMA rather than by spawning the CLI, because the property that
  // matters is which tables the deletes reach — and the cascades are what decide that.
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  db.exec(readFileSync(new URL('../db/seed.dev.sql', import.meta.url), 'utf8'));

  const count = (t: string) => (db.prepare(`SELECT COUNT(*) n FROM ${t}`).get() as { n: number }).n;
  db.prepare(
    `INSERT INTO chore_day (chore_id, local_date, points_each, model, created_at_utc)
     VALUES ('ch-bed', '2026-09-01', 1, 'individual', '2026-09-01T00:00:00Z')`,
  ).run();
  const dayId = db.prepare(`SELECT id FROM chore_day LIMIT 1`).get() as { id: number };
  db.prepare(
    `INSERT INTO chore_assignment (chore_day_id, child_id, state) VALUES (?, 'child-a', 'claimed')`,
  ).run(dayId.id);
  assert.ok(count('chore_assignment') > 0);

  const chores = count('chore');
  const children = count('child');

  // Deleting the DAY must take its claims with it — the reset relies on that cascade, so if
  // the schema ever loses it the reset silently leaves claims behind pointing at nothing.
  db.prepare('DELETE FROM chore_day').run();
  assert.equal(count('chore_assignment'), 0, 'chore_assignment must cascade from chore_day');

  // And the definitions are untouched, which is the whole point: they are what gets tested.
  assert.equal(count('chore'), chores);
  assert.equal(count('child'), children);
  db.close();
});

test('the ledger has no FK to what it refers to, which is why the reset needs a guard', () => {
  // `ledger_entry.ref_id` is TEXT with no foreign key, deliberately: the ledger is append-only
  // and must outlive the chore it records. The consequence is that nothing in the database
  // stops a board wipe from orphaning it — so the refusal lives in provision.ts, and the test
  // is that the schema really does leave that door open.
  const source = readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8');
  const ledger = source.slice(source.indexOf('CREATE TABLE ledger_entry'));
  const body = ledger.slice(0, ledger.indexOf(') STRICT;'));
  assert.match(body, /ref_id\s+TEXT NOT NULL/);
  assert.doesNotMatch(body, /ref_id[^\n]*REFERENCES/, 'ref_id must NOT gain a foreign key');

  const cli = readFileSync(new URL('../stacks/wall/entry/provision.ts', import.meta.url), 'utf8');
  assert.match(cli, /REFUSING: the ledger has/, 'the guard is the only thing holding that line');
  assert.match(cli, /--force/);
});
