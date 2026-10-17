/**
 * Unit I — a fresh database works in either order: provision first, or start first.
 *
 * Before this, `provision.ts --household` on a bare database failed with `FOREIGN KEY
 * constraint failed` (the `asset` rows for av-a/b/c were written only by `main.ts` at boot),
 * and a wall started BEFORE its household was applied left the drawn baseline a candidate
 * forever (the child count was read once, at first insert, on an empty roster).
 *
 * The scene properties use a synthetic three-door scene, never the repo's drawn one: which
 * drawn scene ships differs between trees.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { listActiveChildren } from '../src/db/repo.ts';
import { activeScene, listScenes, registerBaselineScenes, registerScene } from '../src/domain/scenes/library.ts';
import { registerBaselineAssets } from '../stacks/wall/entry/baseline.ts';
import type { Utc } from '../src/types.ts';

const REPO = fileURLToPath(new URL('..', import.meta.url));
const ASSETS = join(REPO, 'assets');
const EPOCH = '2026-09-08T00:00:00.000Z';
const DRAWN = 'three-door';
const THREE = [
  { slot: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.2 },
  { slot: 1, x: 0.4, y: 0.2, w: 0.1, h: 0.2 },
  { slot: 2, x: 0.7, y: 0.2, w: 0.1, h: 0.2 },
];

/** The real committed backdrop plus the synthetic three-door scene (as unit-g.backdrop). */
function shippedRoot(extra: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'p1-shipped-'));
  mkdirSync(join(root, 'scenes'));
  mkdirSync(join(root, 'backgrounds'));
  writeFileSync(join(root, 'scenes', 'backdrop.json'), readFileSync(join(ASSETS, 'scenes', 'backdrop.json')));
  writeFileSync(join(root, 'backgrounds', 'household.jpg'), readFileSync(join(ASSETS, 'backgrounds', 'household.jpg')));
  const manifest = { id: DRAWN, image: `scenes/${DRAWN}.jpg`, aspect: 1.7778, regions: THREE };
  writeFileSync(join(root, 'scenes', `${DRAWN}.json`), JSON.stringify(manifest));
  writeFileSync(join(root, 'scenes', `${DRAWN}.jpg`), 'JPEGBYTES');
  for (const [id, m] of Object.entries(extra)) {
    writeFileSync(join(root, 'scenes', `${id}.json`), JSON.stringify(m));
  }
  return root;
}
const scenesOf = (root: string) => join(root, 'scenes');
const shipped = () => [`${DRAWN}.json`, 'backdrop.json'];

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}
type Db = ReturnType<typeof fresh>;

const sql = (name: string) => readFileSync(join(REPO, 'db', name), 'utf8');
const rowOf = (db: Db, id: string) => listScenes(db).find((s) => s.id === id);
const allSceneRows = (db: Db) => db.prepare(`SELECT * FROM scene ORDER BY id`).all();

test('(i) provision first: assets registered, household applies, the three-child picture is up', () => {
  const db = fresh();
  registerBaselineAssets(db, ASSETS, REPO, () => {});
  assert.doesNotThrow(() => db.exec(sql('household.example.sql')), 'no FOREIGN KEY failure on av-a/b/c');
  assert.equal(listActiveChildren(db).length, 3);
  const root = shippedRoot();
  registerBaselineScenes(db, scenesOf(root), shipped, () => {});
  assert.equal(activeScene(db, root)?.id, DRAWN);
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('(ii) start first: the waiting baseline is approved once the roster fits, on the epoch', () => {
  const db = fresh();
  registerBaselineAssets(db, ASSETS, REPO, () => {});
  const root = shippedRoot();
  registerBaselineScenes(db, scenesOf(root), shipped, () => {});
  assert.equal(rowOf(db, DRAWN)?.state, 'candidate');
  assert.equal(rowOf(db, DRAWN)?.decidedAtUtc, null);
  const backdropBefore = rowOf(db, 'backdrop');

  db.exec(sql('household.example.sql'));
  const logged: string[] = [];
  assert.equal(registerBaselineScenes(db, scenesOf(root), shipped, (m) => logged.push(m)), 0, 'nothing new inserted');
  assert.equal(rowOf(db, DRAWN)?.state, 'approved');
  assert.equal(rowOf(db, DRAWN)?.decidedAtUtc, EPOCH);
  assert.deepEqual(logged, [`scene ${DRAWN}: baseline fits 3 children now, approved`]);
  assert.deepEqual(rowOf(db, 'backdrop'), backdropBefore, 'backdrop unchanged');
  assert.equal(activeScene(db, root)?.id, DRAWN);

  // And it is idempotent: the next run logs nothing and changes nothing.
  const after = allSceneRows(db);
  logged.length = 0;
  registerBaselineScenes(db, scenesOf(root), shipped, (m) => logged.push(m));
  assert.deepEqual(logged, []);
  assert.deepEqual(allSceneRows(db), after);
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('(iii) a household with no children keeps the three-child picture waiting', () => {
  const db = fresh();
  registerBaselineAssets(db, ASSETS, REPO, () => {});
  db.exec(sql('household.nokids.example.sql'));
  assert.equal(listActiveChildren(db).length, 0);
  const root = shippedRoot();
  registerBaselineScenes(db, scenesOf(root), shipped, () => {});
  registerBaselineScenes(db, scenesOf(root), shipped, () => {});
  assert.equal(rowOf(db, DRAWN)?.state, 'candidate');
  assert.equal(activeScene(db, root)?.id, 'backdrop');
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('(iv) a decided baseline and every generated row are never promoted', () => {
  const db = fresh();
  registerBaselineAssets(db, ASSETS, REPO, () => {});
  db.exec(sql('household.example.sql'));
  const insert = db.prepare(
    `INSERT INTO scene (id, rel_path, state, source, style_id, created_at_utc, decided_at_utc)
     VALUES (?, ?, ?, ?, NULL, ?, ?)`,
  );
  // A drawn baseline an adult retired, one that is a candidate yet carries a decision stamp,
  // and a generated candidate whose regions fit the roster exactly.
  insert.run('retired-door', `scenes/${DRAWN}.jpg`, 'retired', 'baseline', EPOCH, '2026-10-01T08:00:00.000Z');
  insert.run('decided-door', `scenes/${DRAWN}.jpg`, 'candidate', 'baseline', EPOCH, '2026-10-02T08:00:00.000Z');
  insert.run('gen-door', `scenes/${DRAWN}.jpg`, 'candidate', 'generated', '2026-10-03T08:00:00.000Z', null);
  const drawn = (id: string) => ({ id, image: `scenes/${DRAWN}.jpg`, regions: THREE });
  const root = shippedRoot({
    'retired-door': drawn('retired-door'),
    'decided-door': drawn('decided-door'),
    'gen-door': drawn('gen-door'),
  });
  const listing = () => ['retired-door.json', 'decided-door.json', 'gen-door.json', 'backdrop.json'];
  const before = allSceneRows(db);
  const logged: string[] = [];
  assert.equal(registerBaselineScenes(db, scenesOf(root), listing, (m) => logged.push(m)), 1, 'only backdrop is new');
  assert.deepEqual(
    allSceneRows(db).filter((r) => (r as { id: string }).id !== 'backdrop'),
    before,
    'no existing row was touched',
  );
  assert.deepEqual(logged, []);
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('(iv) THE LIVE WALL: baseline already approved, adult-approved generated scenes — no row changes', () => {
  // A production database: the drawn baseline approved long ago (on the epoch), re-chosen once
  // by an adult, the backdrop under it, two generated scenes an adult approved, one retired and
  // one candidate waiting for review.
  const db = fresh();
  registerBaselineAssets(db, ASSETS, REPO, () => {});
  db.exec(sql('household.example.sql'));
  const root0 = shippedRoot();
  registerBaselineScenes(db, scenesOf(root0), shipped, () => {});
  rmSync(root0, { recursive: true, force: true });
  assert.equal(rowOf(db, DRAWN)?.state, 'approved');
  const gen = (id: string, state: 'approved' | 'retired' | 'candidate', at: string) =>
    registerScene(db, { id, relPath: `scenes/${DRAWN}.jpg`, state, source: 'generated', nowUtc: at as Utc });
  gen('2026-W40-market-gpt', 'approved', '2026-09-28T09:00:00.000Z');
  gen('2026-W41-harvest-gpt', 'approved', '2026-10-05T09:00:00.000Z');
  gen('2026-W41-harvest-nb2', 'retired', '2026-10-05T09:01:00.000Z');
  gen('2026-W42-fair-gpt', 'candidate', '2026-10-12T09:00:00.000Z');
  // A second drawn baseline that an adult approved by hand after first boot.
  db.prepare(
    `INSERT INTO scene (id, rel_path, state, source, style_id, created_at_utc, decided_at_utc)
     VALUES ('chosen-door', ?, 'approved', 'baseline', NULL, ?, '2026-10-10T19:00:00.000Z')`,
  ).run(`scenes/${DRAWN}.jpg`, EPOCH);

  const root = shippedRoot({
    'chosen-door': { id: 'chosen-door', image: `scenes/${DRAWN}.jpg`, regions: THREE },
    '2026-W41-harvest-gpt': { id: '2026-W41-harvest-gpt', image: `scenes/${DRAWN}.jpg`, regions: THREE },
  });
  const committed = () => ['backdrop.json', `${DRAWN}.json`, 'chosen-door.json'];
  const before = allSceneRows(db);
  const sceneBefore = activeScene(db, root);
  assert.equal(sceneBefore?.id, 'chosen-door', 'the most recent adult choice is up');

  const logged: string[] = [];
  for (let run = 0; run < 2; run += 1) {
    assert.equal(registerBaselineScenes(db, scenesOf(root), committed, (m) => logged.push(m)), 0);
  }
  assert.deepEqual(allSceneRows(db), before, 'no row changed');
  assert.deepEqual(logged, []);
  assert.deepEqual(activeScene(db, root), sceneBefore, 'the picture on the wall did not change');
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('(v) the CLI provisions a bare database: art seeded, household applied, exit 0', () => {
  const tmp = mkdtempSync(join(tmpdir(), 'p1-cli-'));
  const dbPath = join(tmp, 'wall.db');
  const assetRoot = join(tmp, 'assets');
  const r = spawnSync(
    process.execPath,
    [
      '--experimental-strip-types',
      join(REPO, 'stacks/wall/entry/provision.ts'),
      '--db', dbPath,
      '--household', join(REPO, 'db/household.example.sql'),
    ],
    { cwd: REPO, encoding: 'utf8', env: { ...process.env, WALL_ASSET_ROOT: assetRoot } },
  );
  assert.equal(r.status, 0, `provision failed:\n${r.stdout}\n${r.stderr}`);
  assert.doesNotMatch(r.stderr, /FOREIGN KEY/);
  assert.ok(existsSync(join(assetRoot, '.seeded.json')), 'the bundled art was seeded');
  const db = openDatabase({ path: dbPath });
  assert.ok(db.prepare(`SELECT 1 FROM asset WHERE id = 'av-a'`).get() !== undefined);
  assert.equal(listActiveChildren(db).length, 3);
  // Every committed scene is registered; the drawn one(s) for three children are approved.
  const approvedDrawn = listScenes(db).filter((s) => s.state === 'approved' && s.id !== 'backdrop');
  assert.ok(approvedDrawn.length > 0, 'a drawn baseline is approved after provision');
  db.close();
  rmSync(tmp, { recursive: true, force: true });
});

test('(vi) the example calendars file the setup guide tells you to copy applies cleanly', () => {
  // docs/setup.md has a newcomer copy db/calendars.example.sql and apply it. A row with the
  // wrong number of terms made that step exit 1 until 2026-10-17, and nothing ran it.
  const tmp = mkdtempSync(join(tmpdir(), 'p1-cal-'));
  const dbPath = join(tmp, 'wall.db');
  const env = { ...process.env, WALL_ASSET_ROOT: join(tmp, 'assets') };
  const run = (flag: string, file: string) =>
    spawnSync(
      process.execPath,
      ['--experimental-strip-types', join(REPO, 'stacks/wall/entry/provision.ts'), '--db', dbPath, flag, join(REPO, file)],
      { cwd: REPO, encoding: 'utf8', env },
    );
  const hh = run('--household', 'db/household.example.sql');
  assert.equal(hh.status, 0, `household failed:\n${hh.stdout}\n${hh.stderr}`);
  const cal = run('--calendars', 'db/calendars.example.sql');
  assert.equal(cal.status, 0, `calendars failed:\n${cal.stdout}\n${cal.stderr}`);
  rmSync(tmp, { recursive: true, force: true });
});
