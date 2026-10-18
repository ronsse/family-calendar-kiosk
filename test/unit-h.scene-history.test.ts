/**
 * Unit H — scene history: which pictures were up, and for how long (v11, 2026-10-18).
 *
 * Asked for in so many words: "track what pictures are up on the board the longest, so you can
 * see over time what the favorites are." `scene.decided_at_utc` could never answer that — every
 * approval overwrites it — so the answer is an append-only log, replayed with `activeScene`'s
 * own rule. These tests pin the replay against the cases where the rule is not obvious: a
 * re-approval, a retire of the picture that is up, and a decision stamped in the future.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, TARGET_VERSION } from '../src/db/migrate.ts';
import {
  approveScene,
  logSceneDecision,
  registerScene,
  retireScene,
  sceneHistory,
} from '../src/domain/scenes/library.ts';
import { sceneHistoryWords } from '../web/src/app/adminActions.ts';
import type { Utc } from '../src/types.ts';

const at = (iso: string): Utc => iso as Utc;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

const candidate = (db: ReturnType<typeof fresh>, id: string, when = '2026-10-01T00:00:00Z') =>
  registerScene(db, { id, relPath: `scenes/${id}.jpg`, state: 'candidate', source: 'generated', nowUtc: at(when) });

const decisions = (db: ReturnType<typeof fresh>) =>
  db.prepare('SELECT scene_id, kind, at_utc FROM scene_decision ORDER BY at_utc, scene_id').all();

test('every approve and retire is LOGGED, and a candidate registration is not', () => {
  const db = fresh();
  candidate(db, 'a');
  assert.equal(decisions(db).length, 0, 'nobody has decided anything about a candidate');
  approveScene(db, 'a', at('2026-10-02T00:00:00Z'));
  approveScene(db, 'a', at('2026-10-03T00:00:00Z'));
  retireScene(db, 'a', at('2026-10-04T00:00:00Z'));
  assert.deepEqual(decisions(db), [
    { scene_id: 'a', kind: 'approved', at_utc: '2026-10-02T00:00:00Z' },
    { scene_id: 'a', kind: 'approved', at_utc: '2026-10-03T00:00:00Z' },
    { scene_id: 'a', kind: 'retired', at_utc: '2026-10-04T00:00:00Z' },
  ]);
  // An id that is not in the library changes no row, so it logs nothing either.
  assert.equal(approveScene(db, 'ghost', at('2026-10-05T00:00:00Z')), false);
  assert.equal(decisions(db).length, 3);
});

test('time goes to the picture that was CHOSEN, and a re-approval puts an old one back', () => {
  const db = fresh();
  candidate(db, 'a');
  candidate(db, 'b');
  approveScene(db, 'a', at('2026-10-01T00:00:00Z')); // a up
  approveScene(db, 'b', at('2026-10-03T00:00:00Z')); // b up after 2 days of a
  approveScene(db, 'a', at('2026-10-04T00:00:00Z')); // a back after 1 day of b
  const h = sceneHistory(db, at('2026-10-08T00:00:00Z')); // a for 4 more days
  assert.equal(h.get('a')?.upMs, 6 * DAY);
  assert.equal(h.get('a')?.timesChosen, 2);
  assert.equal(h.get('b')?.upMs, 1 * DAY);
  assert.equal(h.get('b')?.timesChosen, 1);
});

test('retiring the picture that is up FALLS THROUGH to the one approved before it, as the wall does', () => {
  const db = fresh();
  candidate(db, 'a');
  candidate(db, 'b');
  approveScene(db, 'a', at('2026-10-01T00:00:00Z'));
  approveScene(db, 'b', at('2026-10-02T00:00:00Z'));
  retireScene(db, 'b', at('2026-10-02T12:00:00Z'));
  const h = sceneHistory(db, at('2026-10-03T12:00:00Z'));
  assert.equal(h.get('b')?.upMs, 12 * HOUR);
  assert.equal(h.get('a')?.upMs, 1 * DAY + 1 * DAY, 'a was up before b and again after b went');
});

test('retiring a picture that is NOT up moves no time', () => {
  const db = fresh();
  candidate(db, 'a');
  candidate(db, 'b');
  approveScene(db, 'b', at('2026-10-01T00:00:00Z'));
  approveScene(db, 'a', at('2026-10-02T00:00:00Z'));
  retireScene(db, 'b', at('2026-10-03T00:00:00Z'));
  const h = sceneHistory(db, at('2026-10-04T00:00:00Z'));
  assert.equal(h.get('a')?.upMs, 2 * DAY);
  assert.equal(h.get('b')?.upMs, 1 * DAY);
});

test('a decision stamped in the FUTURE borrows no time, and an undecided scene is absent', () => {
  const db = fresh();
  candidate(db, 'a');
  candidate(db, 'b');
  candidate(db, 'never');
  approveScene(db, 'a', at('2026-10-01T00:00:00Z'));
  approveScene(db, 'b', at('2026-10-09T00:00:00Z'));
  const h = sceneHistory(db, at('2026-10-02T00:00:00Z'));
  assert.equal(h.get('a')?.upMs, 1 * DAY);
  assert.equal(h.get('b')?.upMs, 0);
  assert.equal(h.has('never'), false);
});

test('backfilled decisions are insert-if-absent, so replaying a backup twice adds nothing', () => {
  const db = fresh();
  candidate(db, 'a');
  assert.equal(logSceneDecision(db, 'a', 'approved', '2026-09-20T00:00:00Z'), true);
  assert.equal(logSceneDecision(db, 'a', 'approved', '2026-09-20T00:00:00Z'), false);
  assert.throws(() => db.prepare(`INSERT INTO scene_decision VALUES ('a','pinned','2026-09-21T00:00:00Z')`).run());
});

test('the v11 upgrade seeds the log from each scene\'s LATEST decision, the one fact the old table kept', () => {
  const db = fresh();
  candidate(db, 'up');
  candidate(db, 'gone');
  candidate(db, 'waiting');
  approveScene(db, 'up', at('2026-10-10T00:00:00Z'));
  retireScene(db, 'gone', at('2026-10-11T00:00:00Z'));
  // Back to v10, as the household's database was before this step existed.
  db.exec('DROP TABLE scene_decision; DELETE FROM schema_migration WHERE version = 11;');
  const r = migrate(db);
  assert.equal(r.version, TARGET_VERSION);
  assert.deepEqual(decisions(db), [
    { scene_id: 'up', kind: 'approved', at_utc: '2026-10-10T00:00:00Z' },
    { scene_id: 'gone', kind: 'retired', at_utc: '2026-10-11T00:00:00Z' },
  ]);
});

test('the words: days once it is a day, nothing at all for a picture never up', () => {
  assert.equal(sceneHistoryWords({}), '');
  assert.equal(sceneHistoryWords({ upMs: 0, timesChosen: 0 }), '');
  assert.equal(sceneHistoryWords({ upMs: 20 * 60_000, timesChosen: 1 }), 'Up under an hour · chosen once');
  assert.equal(sceneHistoryWords({ upMs: 5 * HOUR, timesChosen: 1 }), 'Up 5 hours · chosen once');
  assert.equal(sceneHistoryWords({ upMs: 1 * DAY, timesChosen: 3 }), 'Up 1 day · chosen 3 times');
  assert.equal(sceneHistoryWords({ upMs: 9.4 * DAY, timesChosen: 2 }), 'Up 9 days · chosen 2 times');
});

test('the catalog route carries each picture\'s time up and times chosen, on the wall surface', async () => {
  const { startWall, wall } = await import('./e2e/harness.ts');
  const h = await startWall({ clock: '2026-10-05T00:00:00Z' });
  try {
    candidate(h.db, 'a');
    candidate(h.db, 'b');
    approveScene(h.db, 'a', at('2026-10-02T00:00:00Z'));
    approveScene(h.db, 'b', at('2026-10-04T00:00:00Z'));
    const r = await wall(h, 'GET', '/api/wall/v1/scenes');
    assert.equal(r.status, 200);
    const scenes = r.body['scenes'] as { id: string; upMs: number; timesChosen: number }[];
    const byId = new Map(scenes.map((s) => [s.id, s]));
    assert.equal(byId.get('a')?.upMs, 2 * DAY);
    assert.equal(byId.get('b')?.upMs, 1 * DAY);
    assert.equal(byId.get('b')?.timesChosen, 1);
  } finally {
    await h.stop();
  }
});
