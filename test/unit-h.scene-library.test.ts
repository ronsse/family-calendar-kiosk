/**
 * Unit H — the scene library.
 *
 * The properties under test are the ones that decide whether the wall has a picture at 6:00 AM,
 * and the ones that decide whether a parent's choice survives the next deploy. Both have
 * already gone wrong once in this project in the same shape — a decision quietly undone by a
 * restart, presenting as output that looks completely fine.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import {
  activeScene,
  approveScene,
  approvedScenes,
  listScenes,
  readSceneDog,
  readSceneManifest,
  registerBaselineScenes,
  registerScene,
  retireScene,
} from '../src/domain/scenes/library.ts';
import type { Utc } from '../src/types.ts';

const at = (iso: string): Utc => iso as Utc;

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

/**
 * The synthetic three-child household. A baseline with tap targets is approved only when the
 * household has as many children as the picture has doors (2026-10-12), so every baseline test
 * that expects `approved` runs here, against three-door manifests.
 */
function seeded() {
  const db = fresh();
  db.exec(readFileSync(new URL('../db/seed.dev.sql', import.meta.url), 'utf8'));
  return db;
}

const THREE = [
  { slot: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.2 },
  { slot: 1, x: 0.4, y: 0.2, w: 0.1, h: 0.2 },
  { slot: 2, x: 0.7, y: 0.2, w: 0.1, h: 0.2 },
];

/** An asset root holding real files, because half of this module's job is asking the disk. */
function volume(
  scenes: Record<
    string,
    { regions?: unknown; dog?: unknown; noJpg?: boolean; raw?: string; static?: boolean }
  >,
) {
  const root = mkdtempSync(join(tmpdir(), 'scenelib-'));
  mkdirSync(join(root, 'scenes'), { recursive: true });
  for (const [id, spec] of Object.entries(scenes)) {
    if (spec.noJpg !== true) writeFileSync(join(root, 'scenes', `${id}.jpg`), 'JPEGBYTES');
    writeFileSync(
      join(root, 'scenes', `${id}.json`),
      spec.raw ??
        JSON.stringify({
          id,
          image: `scenes/${id}.jpg`,
          regions: spec.regions ?? [{ slot: 0, x: 0.1, y: 0.2, w: 0.1, h: 0.2 }],
          ...(spec.dog === undefined ? {} : { dog: spec.dog }),
          ...(spec.static === undefined ? {} : { static: spec.static }),
        }),
    );
  }
  return root;
}

const register = (db: ReturnType<typeof fresh>, id: string, state: 'candidate' | 'approved', when: string) =>
  registerScene(db, {
    id,
    relPath: `scenes/${id}.jpg`,
    state,
    source: 'generated',
    nowUtc: at(when),
  });

test('the newest APPROVED scene is the one on the wall', () => {
  const db = fresh();
  const root = volume({ old: {}, recent: {} });
  register(db, 'old', 'approved', '2026-09-01T00:00:00Z');
  register(db, 'recent', 'approved', '2026-09-07T00:00:00Z');
  assert.equal(activeScene(db, root)?.id, 'recent');
  db.close();
});

test('approving an old scene again is how you go back — there is no second mechanism', () => {
  const db = fresh();
  const root = volume({ old: {}, recent: {} });
  register(db, 'old', 'approved', '2026-09-01T00:00:00Z');
  register(db, 'recent', 'approved', '2026-09-07T00:00:00Z');
  assert.equal(activeScene(db, root)?.id, 'recent');

  assert.equal(approveScene(db, 'old', at('2026-09-08T00:00:00Z')), true);
  assert.equal(activeScene(db, root)?.id, 'old', 're-approval must re-promote, not no-op');
  db.close();
});

test('a candidate is NEVER on the wall, however new it is', () => {
  const db = fresh();
  const root = volume({ approved: {}, brandnew: {} });
  register(db, 'approved', 'approved', '2026-09-01T00:00:00Z');
  register(db, 'brandnew', 'candidate', '2026-09-08T00:00:00Z');
  assert.equal(activeScene(db, root)?.id, 'approved');
  db.close();
});

test('an approved scene that lost its picture costs itself, not the feature', () => {
  const db = fresh();
  // `newest` has a manifest but no jpg — a half-restored volume, or a delete.
  const root = volume({ fallback: {}, newest: { noJpg: true } });
  register(db, 'fallback', 'approved', '2026-09-01T00:00:00Z');
  register(db, 'newest', 'approved', '2026-09-07T00:00:00Z');
  assert.equal(activeScene(db, root)?.id, 'fallback', 'must fall THROUGH, not return null');
  db.close();
});

test('an approved scene with no usable region is skipped — the picture IS the navigation', () => {
  const db = fresh();
  // On the scene screen the rail is hidden, so a picture with no doors is a dead end that
  // looks exactly like a working screen. Worse than showing the older picture.
  const root = volume({ fallback: {}, doorless: { regions: [] } });
  register(db, 'fallback', 'approved', '2026-09-01T00:00:00Z');
  register(db, 'doorless', 'approved', '2026-09-07T00:00:00Z');
  assert.equal(activeScene(db, root)?.id, 'fallback');
  db.close();
});

test('one malformed rectangle drops that rectangle, not the scene', () => {
  const root = volume({
    mixed: {
      regions: [
        { slot: 0, x: 0.1, y: 0.1, w: 0.1, h: 0.1 },
        { slot: 1, x: 'nope', y: 0.1, w: 0.1, h: 0.1 },
        { slot: 2, x: 0.5, y: 1.5, w: 0.1, h: 0.1 },
      ],
    },
  });
  const regions = readSceneManifest(root, 'mixed');
  assert.equal(regions?.length, 1, 'the other two children can still find themselves');
  assert.equal(regions?.[0]?.slot, 0);
  rmSync(root, { recursive: true, force: true });
});

test('an unreadable manifest is null, never a throw', () => {
  const root = volume({ broken: { raw: '{not json' }, missing: {} });
  assert.equal(readSceneManifest(root, 'broken'), null);
  assert.equal(readSceneManifest(root, 'absent-entirely'), null);
  rmSync(root, { recursive: true, force: true });
});

test('nothing usable is null — the information board, not a dead-end picture', () => {
  const db = fresh();
  const root = volume({ doorless: { regions: [] } });
  register(db, 'doorless', 'approved', '2026-09-01T00:00:00Z');
  assert.equal(readSceneManifest(root, 'doorless'), null);
  assert.equal(activeScene(db, root), null);
  db.close();
});

test('an EMPTY region list is a dead end only when the manifest does not say static', () => {
  // The distinction, 2026-10-12: `regions: []` from the finder is a scene it failed on, and
  // stays null. The same list on a manifest marked `static` is a backdrop — no doors on
  // purpose, the rail navigates — and is usable.
  const db = fresh();
  const root = volume({ backdrop: { regions: [], static: true }, doorless: { regions: [] } });
  assert.deepEqual(readSceneManifest(root, 'backdrop'), []);
  assert.equal(readSceneManifest(root, 'doorless'), null);
  register(db, 'backdrop', 'approved', '2026-09-01T00:00:00Z');
  register(db, 'doorless', 'approved', '2026-09-07T00:00:00Z');
  assert.equal(activeScene(db, root)?.id, 'backdrop', 'falls through the dead end to the backdrop');
  assert.deepEqual(activeScene(db, root)?.regions, []);
  db.close();
});

test('a retired scene stays in the catalog but leaves the wall', () => {
  const db = fresh();
  const root = volume({ a: {}, b: {} });
  register(db, 'a', 'approved', '2026-09-01T00:00:00Z');
  register(db, 'b', 'approved', '2026-09-07T00:00:00Z');
  assert.equal(retireScene(db, 'b', at('2026-09-08T00:00:00Z')), true);
  assert.equal(activeScene(db, root)?.id, 'a');
  assert.equal(listScenes(db).length, 2, 'the catalog is a history, not a live set');
  db.close();
});

test('a decision is NOT undone by the next boot', () => {
  // The regression this exists for: registerBaselineScenes runs on every restart, and an
  // insert-if-absent that touched `state` would put a retired scene back on the wall — a
  // decision reversed by a deploy, which nobody ever connects to the deploy.
  const db = seeded();
  const dir = volume({ campsite: { regions: THREE }, 'autumn-forest': { regions: THREE } });
  const list = () => ['campsite.json', 'autumn-forest.json'];
  registerBaselineScenes(db, join(dir, 'scenes'), list);
  retireScene(db, 'autumn-forest', at('2026-09-09T00:00:00Z'));

  registerBaselineScenes(db, join(dir, 'scenes'), list); // the next boot
  const forest = listScenes(db).find((s) => s.id === 'autumn-forest');
  assert.equal(forest?.state, 'retired');
  assert.equal(activeScene(db, dir)?.id, 'campsite');
  db.close();
});

test('the committed set is the floor: an empty library refills itself', () => {
  // sceneCatalog.ts refused a runtime index because losing it loses every picture at once and
  // the wall's honest answer to an empty pool is a screen that looks completely fine. This is
  // the answer to that: the shipped set comes back.
  const db = seeded();
  const dir = volume({
    campsite: { regions: THREE },
    'trailer-camp': { regions: THREE },
    'autumn-forest': { regions: THREE },
  });
  const inserted = registerBaselineScenes(db, join(dir, 'scenes'), () => [
    'campsite.json',
    'trailer-camp.json',
    'autumn-forest.json',
    'not-a-scene.txt',
  ]);
  assert.equal(inserted, 3, '.txt is not a scene');
  assert.equal(approvedScenes(db).length, 3);
  db.close();
});

test('a drawn baseline outranks the static backdrop, whatever the listing order', () => {
  // Continuity: on a database that has never seen the committed set, the picture drawn for the
  // children is what goes up, and the backdrop waits underneath it. Synthetic manifests only:
  // which drawn scene ships differs between trees, and the rule must hold for any of them.
  const db = seeded();
  const dir = volume({ backdrop: { regions: [], static: true }, drawn: { regions: THREE } });
  registerBaselineScenes(db, join(dir, 'scenes'), () => ['drawn.json', 'backdrop.json']);
  assert.equal(activeScene(db, dir)?.id, 'drawn');
  assert.equal(approvedScenes(db).length, 2);
  db.close();
});

test("a household's own approval outranks any baseline, forever", () => {
  // BASELINE_EPOCH_MS is fixed and in the past precisely so a restart cannot re-promote the
  // shipped default over a picture a parent chose.
  const db = seeded();
  const dir = volume({
    campsite: { regions: THREE },
    'autumn-forest': { regions: THREE },
    homemade: { regions: THREE },
  });
  const list = () => ['campsite.json', 'autumn-forest.json'];
  registerBaselineScenes(db, join(dir, 'scenes'), list);
  register(db, 'homemade', 'candidate', '2026-09-08T12:00:00Z');
  approveScene(db, 'homemade', at('2026-09-08T12:30:00Z'));
  assert.equal(activeScene(db, dir)?.id, 'homemade');

  registerBaselineScenes(db, join(dir, 'scenes'), list); // many boots later
  assert.equal(activeScene(db, dir)?.id, 'homemade');
  db.close();
});

test('registering follows a moved file but never re-decides state', () => {
  const db = fresh();
  register(db, 's', 'candidate', '2026-09-01T00:00:00Z');
  assert.equal(
    registerScene(db, {
      id: 's',
      relPath: 'scenes/s.png',
      state: 'approved',
      source: 'generated',
      nowUtc: at('2026-09-02T00:00:00Z'),
    }),
    'relocated',
  );
  assert.equal(listScenes(db)[0]?.state, 'candidate', 'a re-register must not approve');
  assert.equal(listScenes(db)[0]?.relPath, 'scenes/s.png');
  db.close();
});

test('approving or retiring something that does not exist says so', () => {
  const db = fresh();
  assert.equal(approveScene(db, 'ghost', at('2026-09-08T00:00:00Z')), false);
  assert.equal(retireScene(db, 'ghost', at('2026-09-08T00:00:00Z')), false);
  db.close();
});

test('the image url is encoded — it ends up inside a CSS url("…")', () => {
  const db = fresh();
  const root = volume({ 'a scene': {} });
  registerScene(db, {
    id: 'a scene',
    relPath: 'scenes/a scene.jpg',
    state: 'approved',
    source: 'generated',
    nowUtc: at('2026-09-01T00:00:00Z'),
  });
  assert.equal(activeScene(db, root)?.image, '/scenes/a%20scene.jpg');
  db.close();
});

test('the dog is optional: a manifest without him is a scene with no Easter egg', () => {
  const root = volume({
    plain: {},
    hidden: { dog: { x: 0.7, y: 0.6, w: 0.1, h: 0.1 } },
    bad: { dog: { x: 0.7, y: 'nope', w: 0.1, h: 0.1 } },
  });
  assert.equal(readSceneDog(root, 'plain'), null);
  assert.deepEqual(readSceneDog(root, 'hidden'), { x: 0.7, y: 0.6, w: 0.1, h: 0.1 });
  assert.equal(readSceneDog(root, 'bad'), null, 'a malformed box is no box, not a throw');
  assert.equal(readSceneManifest(root, 'bad')?.length, 1, 'and the children are unaffected');

  const db = fresh();
  register(db, 'hidden', 'approved', '2026-09-15T00:00:00Z');
  assert.deepEqual(activeScene(db, root)?.dog, { x: 0.7, y: 0.6, w: 0.1, h: 0.1 });
  rmSync(root, { recursive: true, force: true });
});
