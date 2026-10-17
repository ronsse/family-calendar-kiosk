/**
 * Unit H — the picture library on the grown-up screen.
 *
 * The logic worth testing here is the part that decides what a reviewer SEES, because the
 * screen cannot scroll: what does not fit is not drawn, so the order is the difference between
 * "the picture generated on Sunday is the first thing you see" and "it is below the fold".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { wallActionPaths } from '../web/src/app/actions.ts';
import { layoutPx, spacePx } from '../web/src/design/tokens.ts';
import { backdropUrl } from '../web/src/views/logic/backdrop.ts';
import {
  SCENES_PATH,
  SCENE_LIST_GAP_PX,
  SCENE_ROW_HEIGHT_PX,
  sceneRowsThatFit,
  adminActionPaths,
  catalogGroups,
  fetchSceneCatalog,
  reviewOrder,
  sceneDecisions,
  sceneLabel,
  type SceneCatalog,
  type SceneCatalogEntry,
} from '../web/src/app/adminActions.ts';

const entry = (over: Partial<SceneCatalogEntry> & { id: string }): SceneCatalogEntry => ({
  state: 'approved',
  source: 'generated',
  styleId: null,
  createdAtUtc: '2026-09-01T00:00:00Z',
  decidedAtUtc: null,
  image: `/scenes/${over.id}.jpg`,
  regionCount: 3,
  usable: true,
  ...over,
});

test('candidates come first — they are the only rows that represent work', () => {
  // The screen cannot scroll and the pane holds a handful of rows. A newly generated picture
  // sorted by date alone would fall below the fold the moment the library has a few weeks in
  // it, and the one thing this screen exists for would be invisible.
  const catalog: SceneCatalog = {
    activeSceneId: 'old-approved',
    scenes: [
      entry({ id: 'old-approved', createdAtUtc: '2026-09-07T00:00:00Z' }),
      entry({ id: 'retired-one', state: 'retired', createdAtUtc: '2026-09-06T00:00:00Z' }),
      entry({ id: 'fresh', state: 'candidate', createdAtUtc: '2026-09-01T00:00:00Z' }),
    ],
  };
  assert.deepEqual(reviewOrder(catalog).map((s) => s.id), ['fresh', 'old-approved', 'retired-one']);
});

test('the picture that is UP is not hoisted — it is marked where it sits', () => {
  // Moving the one row that must be unambiguous, depending on its state, is how a reviewer
  // ends up approving the row that was under their finger a moment ago.
  const catalog: SceneCatalog = {
    activeSceneId: 'b',
    scenes: [
      entry({ id: 'a', createdAtUtc: '2026-09-03T00:00:00Z' }),
      entry({ id: 'b', createdAtUtc: '2026-09-01T00:00:00Z' }),
      entry({ id: 'c', createdAtUtc: '2026-09-02T00:00:00Z' }),
    ],
  };
  assert.deepEqual(reviewOrder(catalog).map((s) => s.id), ['a', 'c', 'b']);
});

test('within a state it is newest first, and ties break by id rather than by luck', () => {
  const catalog: SceneCatalog = {
    activeSceneId: null,
    scenes: [
      entry({ id: 'zebra', createdAtUtc: '2026-09-01T00:00:00Z' }),
      entry({ id: 'apple', createdAtUtc: '2026-09-01T00:00:00Z' }),
    ],
  };
  assert.deepEqual(reviewOrder(catalog).map((s) => s.id), ['apple', 'zebra']);
});

test('reviewOrder does not mutate what it is handed', () => {
  const scenes = [entry({ id: 'b' }), entry({ id: 'a', state: 'candidate' })];
  const before = scenes.map((s) => s.id);
  reviewOrder({ activeSceneId: null, scenes });
  assert.deepEqual(scenes.map((s) => s.id), before);
});

// ---------------------------------------------------------------------------
// The fetch is TOTAL, and that is a safety property rather than tidiness
// ---------------------------------------------------------------------------
//
// This screen shares a door with the approval queue. An exception here would take out the
// grown-up destination behind a door a child has already opened, so every failure has to land
// on "an empty catalog" — wrong, but inert and legible.

const catalogFetch = (impl: () => unknown) =>
  fetchSceneCatalog({ fetchImpl: () => Promise.resolve(impl() as Response) });

test('a failed request is an empty catalog, never a throw', async () => {
  assert.deepEqual(
    await catalogFetch(() => ({ ok: false, status: 500, json: () => Promise.resolve({}) })),
    { activeSceneId: null, scenes: [] },
  );
});

test('a network error is an empty catalog', async () => {
  const got = await fetchSceneCatalog({
    fetchImpl: () => Promise.reject(new Error('offline')),
  });
  assert.deepEqual(got, { activeSceneId: null, scenes: [] });
});

test('a body that is not a catalog is an empty catalog', async () => {
  for (const body of [null, 42, 'nope', [], { scenes: 'not an array' }]) {
    const got = await catalogFetch(() => ({ ok: true, json: () => Promise.resolve(body) }));
    assert.deepEqual(got.scenes, [], `body ${JSON.stringify(body)}`);
  }
});

test('a real body comes through, active id and all', async () => {
  const got = await catalogFetch(() => ({
    ok: true,
    json: () => Promise.resolve({ activeSceneId: 'x', scenes: [entry({ id: 'x' })] }),
  }));
  assert.equal(got.activeSceneId, 'x');
  assert.equal(got.scenes.length, 1);
});

test('the catalog is read on the WALL surface — no PIN to look at pictures', () => {
  // Looking needs nothing. The portal's door (ApprovalsView) guards the screens that change the
  // household; behind it, this list would cost a PIN entry to look at data that is picture ids.
  assert.match(SCENES_PATH, /^\/api\/wall\/v1\//);
});

test('PUTTING a picture up is on the wall surface; TAKING one out is on admin', () => {
  // The split, 2026-09-16. Approving is also selecting and every outcome is another picture
  // on the wall, each undone by choosing a different one — so it asks for nothing, and the
  // household can stop handing the children the PIN that also opens the ledger. Retire is the
  // one control here that REMOVES rather than chooses, and it stayed behind the door.
  assert.match(
    wallActionPaths().approveScene('a b'),
    /^\/api\/wall\/v1\/scenes\/a%20b\/approve$/,
  );
  assert.match(adminActionPaths().retireScene('a/b'), /^\/api\/admin\/v1\/scenes\/a%2Fb\/retire$/);
});

// ---------------------------------------------------------------------------
// Geometry — the two floors this screen has to clear
// ---------------------------------------------------------------------------

test('the list gap is the inert gutter, and the row count agrees with it', () => {
  // Found on the panel, not in review: the rows were 8px apart, half the mandatory gutter.
  // Two 328px-wide rows that close together are one mis-tap between putting up the wrong
  // picture and retiring the right one.
  //
  assert.equal(SCENE_LIST_GAP_PX >= spacePx.tapGap, true, 'the gutter is a floor, not a preference');

  // And the count of rows drawn must be computed with the SAME gap that separates them, or the
  // screen draws one more row than it has room for and the last one is clipped.
  const paneH =
    layoutPx.wallHeight - layoutPx.wallPad * 2 - layoutPx.wallHeaderHeight - layoutPx.wallGutter;
  const available = paneH - layoutPx.agendaRowHeight - layoutPx.wallGutter;
  const rows = sceneRowsThatFit();
  const H = SCENE_ROW_HEIGHT_PX;
  assert.equal(rows * H + (rows - 1) * SCENE_LIST_GAP_PX <= available, true, 'the rows must fit');
  assert.equal(
    (rows + 1) * H + rows * SCENE_LIST_GAP_PX > available,
    true,
    'and one more must not — otherwise the arithmetic is not the binding constraint',
  );
  // The floor is motor skill, not eyesight, and holds on every screen (CLAUDE.md, H8).
  assert.equal(SCENE_ROW_HEIGHT_PX >= 64, true);
});

test('the list is grouped by what a reviewer scans for, the picture on the wall in its own group', () => {
  // "they should be organized" (2026-09-13). The state word used to sit on every row; now it is
  // a heading, and the one picture that is UP is a group of one rather than a "Ready" row that
  // happens to say otherwise. Newest first inside each group, empty groups absent.
  const catalog: SceneCatalog = {
    activeSceneId: 'up',
    scenes: [
      entry({ id: 'up', createdAtUtc: '2026-09-07T00:00:00Z' }),
      entry({ id: 'older-ready', createdAtUtc: '2026-08-30T00:00:00Z' }),
      entry({ id: 'newer-ready', createdAtUtc: '2026-09-06T00:00:00Z' }),
      entry({ id: 'gone', state: 'retired', createdAtUtc: '2026-09-06T00:00:00Z' }),
      entry({ id: 'fresh', state: 'candidate', createdAtUtc: '2026-09-13T00:00:00Z' }),
    ],
  };
  const groups = catalogGroups(catalog);
  assert.deepEqual(
    groups.map((g) => [g.key, g.scenes.map((s) => s.id)]),
    [
      ['new', ['fresh']],
      ['onWall', ['up']],
      ['ready', ['newer-ready', 'older-ready']],
      ['retired', ['gone']],
    ],
  );
  // Flattened, it is `reviewOrder` — the two must never disagree about what comes first.
  assert.deepEqual(
    groups.flatMap((g) => g.scenes.map((s) => s.id)),
    reviewOrder(catalog).map((s) => s.id),
  );
  assert.deepEqual(
    catalogGroups({ activeSceneId: null, scenes: [entry({ id: 'only' })] }).map((g) => g.key),
    ['ready'],
    'no empty groups, and nothing on the wall means no "on the wall" group',
  );
});

test('a picture is named for a person, not for the file system', () => {
  // "2026w38-lante…" was the whole of what a 220px column showed of the id. The setting is the
  // name; the week and the model are the detail, because the two candidates a week differ by
  // model alone and the approver must be able to say which she put up.
  assert.deepEqual(sceneLabel({ id: '2026w38-lantern-night-market-nb2', source: 'generated' }), {
    title: 'Lantern night market',
    detail: 'Week 38 · Banana',
  });
  assert.deepEqual(sceneLabel({ id: '2026w37-harvest-fair-gpt', source: 'generated' }), {
    title: 'Harvest fair',
    detail: 'Week 37 · GPT',
  });
  assert.deepEqual(sceneLabel({ id: '2026w05-beach', source: 'generated' }), {
    title: 'Beach',
    detail: 'Week 5',
  });
  assert.deepEqual(sceneLabel({ id: 'trailer-camp', source: 'baseline' }), {
    title: 'Trailer camp',
    detail: 'House picture',
  });
  // An id the pattern does not know is still shown, readably, and never as an empty string.
  assert.deepEqual(sceneLabel({ id: 'odd_thing', source: 'generated' }), {
    title: 'Odd thing',
    detail: '',
  });
});

// ---------------------------------------------------------------------------
// The backdrop, which was silently absent for a day
// ---------------------------------------------------------------------------

test('the backdrop url has exactly one leading slash, however it arrives', () => {
  // The bug: WallBackdrop added a leading slash to a value that used to lack one. When scene
  // selection moved to the server the value arrived already rooted, so every page asked for
  // `//scenes/…` — a PROTOCOL-RELATIVE url the browser resolved to `http://scenes/…` and tried
  // to fetch from a host called `scenes`.
  //
  // It failed the way background images always fail: no error, no broken-image icon, no layout
  // change. What remained was the plain ground this component is designed to fall back to, so
  // the wall looked like a deliberate design decision and survived a deploy, a panel audit and
  // a screenshot review. Found only because the operator said the picture was not on every page.
  assert.equal(backdropUrl('/scenes/autumn-forest.jpg'), '/scenes/autumn-forest.jpg');
  assert.equal(backdropUrl('scenes/autumn-forest.jpg'), '/scenes/autumn-forest.jpg');
  assert.equal(backdropUrl('///scenes/x.jpg'), '/scenes/x.jpg');
  // Whatever it is handed, it can never begin a protocol-relative url.
  for (const input of ['/a.jpg', 'a.jpg', '//a.jpg', '////a.jpg']) {
    assert.doesNotMatch(backdropUrl(input), /^\/\//, `${input} must not stay protocol-relative`);
  }
});

test('what activeScene produces is exactly what the backdrop consumes', () => {
  // The two halves that drifted apart. Asserting the CONTRACT between them rather than each
  // side separately is the thing that would have caught it: both were individually correct.
  const fromServer = encodeURI(`/${'scenes/autumn-forest.jpg'.replace(/^\/+/, '')}`);
  assert.equal(backdropUrl(fromServer), fromServer, 'the server output must survive untouched');
});

// ---------------------------------------------------------------------------
// The agenda's height budget — DELETED 2026-09-10 with the panel it measured
// ---------------------------------------------------------------------------
//
// Four tests stood here, and they were good ones: the cost model was READ OFF THE PANEL after
// a derived-from-tokens version came to 372px for a layout that measured 428, and the rule they
// proved — drop whole day GROUPS, never part of one — is the rule this wall keeps relearning.
//
// They are gone because `UpcomingPanel` is gone. The idle board is `WeekView` at two days now
// (BACKLOG 6.10), which has its own budget in `logic/week.ts` and an axis that coarsens rather
// than overflows. Keeping tests alive for a component nothing renders would be proving a screen
// nobody can reach — and the height-budget lesson did not die with them: it is the reason
// `chipPxFor` and `headingPxFor` exist, and both were found the same way, by measuring the
// panel rather than by trusting the tokens.
//
// git show 104661b -- test/unit-h.scene-review.test.ts, if the shape is ever wanted back.

test('the picture ON the wall can be neither put up nor retired from its own row', () => {
  const up = entry({ id: 'up', state: 'approved' });
  assert.deepEqual(sceneDecisions(up, 'up'), { putUp: false, retire: false });
  // The same picture once another is up: it can be chosen again, or retired.
  assert.deepEqual(sceneDecisions(up, 'other'), { putUp: true, retire: true });
});

test('a candidate can go up or be retired; a retired one can only come back', () => {
  assert.deepEqual(sceneDecisions(entry({ id: 'c', state: 'candidate' }), 'up'), { putUp: true, retire: true });
  assert.deepEqual(sceneDecisions(entry({ id: 'r', state: 'retired' }), 'up'), { putUp: true, retire: false });
});

test('a picture whose tap regions do not parse never goes up, whatever its state', () => {
  const broken = entry({ id: 'b', state: 'candidate', usable: false, regionCount: 0 });
  assert.deepEqual(sceneDecisions(broken, 'up'), { putUp: false, retire: true });
  assert.deepEqual(sceneDecisions(null, 'up'), { putUp: false, retire: false });
  // No picture up at all (a fresh database): nothing is "the one on the wall".
  assert.deepEqual(sceneDecisions(entry({ id: 'a' }), null), { putUp: true, retire: true });
});
