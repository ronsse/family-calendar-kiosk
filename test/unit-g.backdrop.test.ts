/**
 * Unit G — scenes off / static / generated, and the baseline floor.
 *
 * Three properties, each of which fails silently if it breaks:
 *   - a STATIC manifest (a backdrop: no tap targets on purpose) is usable with `regions: []`,
 *     while the same empty list without the flag stays the dead end it always was;
 *   - a committed baseline with tap targets goes up only on a household with that many
 *     children, and the figure-free backdrop goes up on every household;
 *   - `scenes.mode = off` means no picture, whatever the library holds.
 * And the one that matters to the wall already on the wall: adding the backdrop under the old
 * floor must not change the picture a household with approved scenes is looking at.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import { DEFAULT_HOUSEHOLD, writeHousehold, type SceneMode } from '../src/config/household.ts';
import {
  activeScene,
  listScenes,
  readSceneManifest,
  registerBaselineScenes,
  registerScene,
} from '../src/domain/scenes/library.ts';
import type { Utc } from '../src/types.ts';

const ASSETS = fileURLToPath(new URL('../assets', import.meta.url));

/** A synthetic committed picture with three doors. Never read from the repo: which drawn
 * scene ships differs between trees, and these properties hold for any of them. */
const DRAWN = 'three-door';
const THREE = [
  { slot: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.2 },
  { slot: 1, x: 0.4, y: 0.2, w: 0.1, h: 0.2 },
  { slot: 2, x: 0.7, y: 0.2, w: 0.1, h: 0.2 },
];

/**
 * An asset root shaped like the shipped one: the REAL committed backdrop (its manifest and
 * the picture it points at) plus the synthetic three-door scene. Extra manifests by id.
 */
function shippedRoot(extra: Record<string, unknown> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'shipped-'));
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
// Deliberately listed newest-first: the ranking must come from the manifests, not this order.
const shipped = () => [`${DRAWN}.json`, 'backdrop.json'];

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

/** The synthetic three-child household. */
function seeded() {
  const db = fresh();
  db.exec(readFileSync(new URL('../db/seed.dev.sql', import.meta.url), 'utf8'));
  return db;
}

function setMode(db: ReturnType<typeof fresh>, mode: SceneMode) {
  writeHousehold(db, { ...DEFAULT_HOUSEHOLD, scenes: { ...DEFAULT_HOUSEHOLD.scenes, mode } });
}

const stateOf = (db: ReturnType<typeof fresh>, id: string) =>
  listScenes(db).find((s) => s.id === id)?.state;

test('(a) a static manifest with no regions is [], the same manifest without static is null', () => {
  const root = mkdtempSync(join(tmpdir(), 'backdrop-'));
  mkdirSync(join(root, 'scenes'));
  const manifest = { image: 'backgrounds/household.jpg', aspect: 3.3391, regions: [] };
  writeFileSync(join(root, 'scenes', 'still.json'), JSON.stringify({ id: 'still', static: true, ...manifest }));
  writeFileSync(join(root, 'scenes', 'plain.json'), JSON.stringify({ id: 'plain', ...manifest }));
  // Only literal `true` opts in: a stringly "true" is a typo, not a decision.
  writeFileSync(join(root, 'scenes', 'typo.json'), JSON.stringify({ id: 'typo', static: 'true', ...manifest }));
  assert.deepEqual(readSceneManifest(root, 'still'), []);
  assert.equal(readSceneManifest(root, 'plain'), null);
  assert.equal(readSceneManifest(root, 'typo'), null);
  // The committed one reads as a backdrop too.
  assert.deepEqual(readSceneManifest(ASSETS, 'backdrop'), []);
  rmSync(root, { recursive: true, force: true });
});

test('(b) a household with no children gets the backdrop; the three-child picture waits', () => {
  const db = fresh();
  const root = shippedRoot();
  const logged: string[] = [];
  registerBaselineScenes(db, scenesOf(root), shipped, (m) => logged.push(m));

  assert.equal(stateOf(db, 'backdrop'), 'approved');
  assert.equal(stateOf(db, DRAWN), 'candidate', 'registered, so a parent can still approve it');
  assert.deepEqual(logged, [
    `baseline scene ${DRAWN} needs 3 children, household has 0: registered, not approved`,
  ]);
  const scene = activeScene(db, root);
  assert.equal(scene?.id, 'backdrop');
  assert.deepEqual(scene?.regions, []);
  assert.equal(scene?.image, '/backgrounds/household.jpg', "the manifest's image, not scenes/backdrop.jpg");

  // Rows already in the database are never changed: the next boot logs nothing and decides nothing.
  logged.length = 0;
  assert.equal(registerBaselineScenes(db, scenesOf(root), shipped, (m) => logged.push(m)), 0);
  assert.deepEqual(logged, []);
  assert.equal(stateOf(db, DRAWN), 'candidate');
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('(b) on the three-child dev seed both baselines are approved, and the picture with them wins', () => {
  const db = seeded();
  const root = shippedRoot();
  const logged: string[] = [];
  assert.equal(registerBaselineScenes(db, scenesOf(root), shipped, (m) => logged.push(m)), 2);
  assert.equal(stateOf(db, 'backdrop'), 'approved');
  assert.equal(stateOf(db, DRAWN), 'approved');
  assert.deepEqual(logged, []);
  assert.equal(activeScene(db, root)?.id, DRAWN);
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('(c) scenes.mode = off is no picture, even with approved scenes in the library', () => {
  const db = seeded();
  const root = shippedRoot();
  registerBaselineScenes(db, scenesOf(root), shipped, () => {});
  assert.equal(activeScene(db, root)?.id, DRAWN);
  setMode(db, 'off');
  assert.equal(activeScene(db, root), null);
  // A setting retires nothing: turning it back on restores the library exactly.
  setMode(db, 'static');
  assert.equal(activeScene(db, root)?.id, DRAWN);
  assert.equal(stateOf(db, DRAWN), 'approved');
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('THE LIVE WALL: a new floor never displaces the scene a household already has up', () => {
  // A database in the shape a live wall can have: a drawn baseline registered by older code
  // (alone, so at exactly the epoch), and a newer generated scene approved from the Pictures
  // screen. The new boot adds `backdrop` under it.
  const db = seeded();
  setMode(db, 'generated');
  const legacyAt = '2026-09-08T00:00:00.000Z';
  db.prepare(
    `INSERT INTO scene (id, rel_path, state, source, style_id, created_at_utc, decided_at_utc)
     VALUES (?, ?, 'approved', 'baseline', NULL, ?, ?)`,
  ).run(DRAWN, `scenes/${DRAWN}.jpg`, legacyAt, legacyAt);
  // The generated picture's file is the committed one; only its row and manifest are new.
  const generated = '2026-W41-harvest-gpt';
  registerScene(db, {
    id: generated,
    relPath: `scenes/${DRAWN}.jpg`,
    state: 'approved',
    source: 'generated',
    nowUtc: '2026-10-05T09:00:00.000Z' as Utc,
  });
  // activeScene reads the manifest by id, so give the generated row one in the asset root.
  const root = shippedRoot({ [generated]: { id: generated, image: `scenes/${DRAWN}.jpg`, regions: THREE } });
  // The boot's listing is the committed set only: the generated manifest is in the volume.
  const committed = () => ['backdrop.json', `${DRAWN}.json`];

  const before = activeScene(db, root);
  assert.equal(before?.id, generated);
  const rowsBefore = listScenes(db).filter((s) => s.id !== 'backdrop');

  assert.equal(registerBaselineScenes(db, scenesOf(root), committed, () => {}), 1, 'only backdrop is new');
  assert.deepEqual(activeScene(db, root), before, 'the picture on the wall did not change');
  assert.deepEqual(
    listScenes(db).filter((s) => s.id !== 'backdrop'),
    rowsBefore,
    'no existing row was touched',
  );

  // And with the household's own picture gone, the old floor still outranks the new one:
  // backdrop sits strictly before the drawn baseline, never tied with it.
  db.prepare(`UPDATE scene SET state = 'retired' WHERE id = ?`).run(generated);
  assert.equal(activeScene(db, root)?.id, DRAWN);
  const backdrop = listScenes(db).find((s) => s.id === 'backdrop');
  assert.equal(backdrop?.state, 'approved');
  assert.ok(backdrop !== undefined && backdrop.decidedAtUtc !== null && backdrop.decidedAtUtc < legacyAt);

  // Only when every picture above it is unusable does the backdrop go up.
  rmSync(join(root, 'scenes', `${DRAWN}.jpg`));
  assert.equal(activeScene(db, root)?.id, 'backdrop');
  rmSync(root, { recursive: true, force: true });
  db.close();
});

test('on a fresh database the drawn baseline sits ON the epoch and the backdrop below it', () => {
  // Static ranks oldest whatever the listing order or the ids say: a backdrop named to sort
  // last alphabetically still goes under a drawn scene named to sort first.
  const db = seeded();
  const root = shippedRoot({
    'zz-still': { id: 'zz-still', image: 'backgrounds/household.jpg', static: true, regions: [] },
    'aa-drawn': { id: 'aa-drawn', image: `scenes/${DRAWN}.jpg`, regions: THREE },
  });
  const all = () => ['zz-still.json', 'aa-drawn.json', `${DRAWN}.json`, 'backdrop.json'];
  assert.equal(registerBaselineScenes(db, scenesOf(root), all, () => {}), 4);
  const stamp = new Map(listScenes(db).map((s) => [s.id, s.decidedAtUtc]));
  assert.deepEqual(
    [...stamp.entries()].sort((a, b) => ((a[1] ?? '') < (b[1] ?? '') ? -1 : 1)).map(([id]) => id),
    ['backdrop', 'zz-still', 'aa-drawn', DRAWN],
    'statics first, then drawn scenes, ties by id',
  );
  assert.equal(stamp.get(DRAWN), '2026-09-08T00:00:00.000Z', 'the newest-ranked baseline is on the epoch');
  assert.equal(activeScene(db, root)?.id, DRAWN);
  rmSync(root, { recursive: true, force: true });
  db.close();
});
