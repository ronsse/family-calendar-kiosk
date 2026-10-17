/**
 * Unit F acceptance: which look the wall wears.
 *
 * Driven end to end over real HTTP, not read off the source: an adult sets the look through
 * the admin route, and the thing on trial is what the WALL then sees — the snapshot it renders
 * from and the push that tells it to refetch. A route that stored the id and never said so
 * would leave the panel in the old look until the next unrelated change, and every unit test
 * of the route alone would pass.
 *
 * Also on trial: the read is defensive and the write is strict. A hand-edited row cannot take
 * the wall down, and the route cannot store a fourth look — including a band literal, which is
 * the near-miss most likely to arrive here by mistake.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WALL_THEME, WALL_THEMES, isWallThemeId } from '../src/types.ts';
import { parseWallTheme, readWallTheme, setWallTheme, WALL_THEME_KEY } from '../src/domain/theme/index.ts';
import {
  PARENT_PIN,
  admin,
  adminWithoutPin,
  openStream,
  snapshot,
  startWall,
  wall,
} from './e2e/harness.ts';

const ROUTE = '/api/admin/v1/settings/theme';

test('a fresh wall wears the felt board, in the snapshot and in the settings', async () => {
  const h = await startWall();
  try {
    assert.equal(DEFAULT_WALL_THEME, 'felt');
    assert.equal((await snapshot(h)).theme, 'felt');
    const settings = await admin(h, 'GET', '/api/admin/v1/settings', PARENT_PIN);
    assert.equal(settings.status, 200);
    assert.equal(settings.body['theme'], 'felt');
  } finally {
    await h.stop();
  }
});

test('SETTING THE LOOK THROUGH THE ROUTE CHANGES WHAT THE WALL RENDERS FROM', async () => {
  const h = await startWall();
  try {
    for (const theme of ['gallery', 'storybook', 'felt'] as const) {
      const res = await admin(h, 'POST', ROUTE, PARENT_PIN, { body: { theme } });
      assert.equal(res.status, 200, res.text);
      // The answer is the whole settings object, like every settings write, so the picker
      // renders what the server stored rather than what it hoped.
      assert.equal(res.body['theme'], theme);
      assert.equal(typeof res.body['centsPerPoint'], 'number');
      assert.equal((await snapshot(h)).theme, theme, `snapshot did not follow ${theme}`);
    }
  } finally {
    await h.stop();
  }
});

test('a change PUSHES: the wall is told to refetch everything, once, and only on a change', async () => {
  const h = await startWall();
  const stream = await openStream(h);
  try {
    // Tapping the look that is already up is not news. Sent FIRST, so that if it pushed, its
    // frame would arrive before the real change's and the count below would be two.
    const same = await admin(h, 'POST', ROUTE, PARENT_PIN, { body: { theme: 'felt' } });
    assert.equal(same.status, 200);
    const changed = await admin(h, 'POST', ROUTE, PARENT_PIN, { body: { theme: 'storybook' } });
    assert.equal(changed.status, 200);
    // A SENTINEL with a scope of its own. Frames on one stream arrive in order, so once this
    // one is parsed every frame the two theme writes could have sent has been parsed too —
    // without it, counting straight after the first frame races the second.
    const sentinel = await admin(h, 'POST', '/api/admin/v1/settings/departures', PARENT_PIN, {
      body: { enabled: false },
    });
    assert.equal(sentinel.status, 200);
    await stream.waitFor((e) => e['type'] === 'invalidate' && e['scope'] === 'calendar');
    const invalidates = stream.events.filter((e) => e['type'] === 'invalidate');
    assert.deepEqual(
      invalidates,
      [
        { type: 'invalidate', scope: 'all' },
        { type: 'invalidate', scope: 'calendar' },
      ],
      'the theme change must push `all` exactly once, and the unchanged tap nothing',
    );
  } finally {
    stream.close();
    await h.stop();
  }
});

test('anything but the three ids is refused, and NOTHING is written', async () => {
  const h = await startWall();
  try {
    const set = await admin(h, 'POST', ROUTE, PARENT_PIN, { body: { theme: 'gallery' } });
    assert.equal(set.status, 200);
    // `picture` is a reading band, the near-miss most likely to arrive here by mistake.
    for (const bad of ['picture', 'fluent', 'Felt', 'felt ', '', 42, null, ['felt'], { id: 'felt' }]) {
      const res = await admin(h, 'POST', ROUTE, PARENT_PIN, { body: { theme: bad } });
      assert.equal(res.status, 400, `accepted ${JSON.stringify(bad)}`);
      // The wire shape is FLAT: { error: '<code>', message }.
      assert.equal(res.body['error'], 'bad_request');
      assert.match(String(res.body['message']), /felt, gallery, storybook/);
    }
    const missing = await admin(h, 'POST', ROUTE, PARENT_PIN, { body: {} });
    assert.equal(missing.status, 400);
    assert.equal((await snapshot(h)).theme, 'gallery', 'a refused request changed the look');
  } finally {
    await h.stop();
  }
});

test('the look is behind the PIN, and the wall surface cannot reach it', async () => {
  const h = await startWall();
  try {
    const noPin = await adminWithoutPin(h, 'POST', ROUTE, { body: { theme: 'gallery' } });
    assert.equal(noPin.status, 401);
    assert.equal(noPin.body['error'], 'bad_pin');
    const wrongPin = await admin(h, 'POST', ROUTE, '0000', { body: { theme: 'gallery' } });
    assert.equal(wrongPin.status, 401);
    assert.equal(wrongPin.body['error'], 'bad_pin');
    const fromWall = await wall(h, 'POST', '/api/wall/v1/settings/theme', { body: { theme: 'gallery' } });
    assert.equal(fromWall.status, 404);
    assert.equal((await snapshot(h)).theme, 'felt', 'a refused request changed the look');
  } finally {
    await h.stop();
  }
});

test('a hand-edited row the build does not know reads as the default, never as a crash', async () => {
  const h = await startWall();
  try {
    h.db
      .prepare(`INSERT INTO household_config (key, value_text) VALUES (?, ?)`)
      .run(WALL_THEME_KEY, 'chalkboard');
    assert.equal(readWallTheme(h.db), 'felt');
    assert.equal((await snapshot(h)).theme, 'felt');
    // And the route repairs it, which is the only way out that does not need a shell.
    const res = await admin(h, 'POST', ROUTE, PARENT_PIN, { body: { theme: 'storybook' } });
    assert.equal(res.status, 200);
    assert.equal((await snapshot(h)).theme, 'storybook');
  } finally {
    await h.stop();
  }
});

test('the guard and the parser are total, and agree with each other', () => {
  for (const id of WALL_THEMES) {
    assert.equal(isWallThemeId(id), true);
    assert.equal(parseWallTheme(id), id);
  }
  for (const junk of [undefined, null, '', 'picture', 'emergent', 'FELT', 'gallery\n']) {
    assert.equal(isWallThemeId(junk), false);
    assert.equal(parseWallTheme(junk), DEFAULT_WALL_THEME);
  }
  // No id may collide with a band literal: the band guard reads every string in web sources.
  for (const band of ['picture', 'fluent', 'emergent']) {
    assert.equal((WALL_THEMES as readonly string[]).includes(band), false);
  }
});

test('setWallTheme reports whether anything changed', async () => {
  const h = await startWall();
  try {
    assert.deepEqual(setWallTheme(h.db, 'felt'), { ok: true, theme: 'felt', changed: false });
    assert.deepEqual(setWallTheme(h.db, 'gallery'), { ok: true, theme: 'gallery', changed: true });
    assert.deepEqual(setWallTheme(h.db, 'nope'), { ok: false, reason: 'unknown_theme' });
    assert.equal(readWallTheme(h.db), 'gallery');
  } finally {
    await h.stop();
  }
});
