/**
 * Unit H acceptance: the grown-up Theme picker.
 *
 * Three properties are on trial, and each one fails silently if it breaks.
 *
 * - **The picker offers exactly the wall's looks, and marks the right ones.** One default (the
 *   felt board), one selected (whatever the settings say, and felt for anything that is not a
 *   look), every option live unless a request is in flight. A picker that showed nothing as
 *   selected, or a fourth look the server refuses, would look finished.
 * - **A swatch shows ITS look, never the wall's.** The wall draws with `var(--x)`, which
 *   resolves against whatever the root wears; a swatch drawn that way would be three copies of
 *   the current look. So every swatch value is a literal from that look's own table, and a
 *   derived token is resolved in the same table — felt's card edge is felt's strong border,
 *   gallery's is gallery's plain one.
 * - **A pick reaches the wall.** The tap's request is the admin client's `setTheme`, and the
 *   test drives it twice: against a recorder for its exact shape, and against a real server to
 *   show that what the picker sends changes what the wall renders from.
 *
 * The component itself (`ThemePicker.tsx`) cannot be loaded here — the runner strips types and
 * does not transform `.tsx` — so its press is checked on a throwaway wall over CDP instead.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WALL_THEME, WALL_THEMES, type WallThemeId } from '../src/types.ts';
import { themeTokens, type CssTokenName } from '../web/src/design/tokens.ts';
import { PARENT_PIN_HEADER, createAdminActions, refusalCodeOf } from '../web/src/app/adminActions.ts';
import { layoutFor } from '../web/src/views/logic/theme.ts';
import {
  PICKER_ORDER,
  THEME_NAMES,
  themeLiteral,
  themeOptions,
  themeSwatch,
  type ThemeSwatch,
} from '../web/src/views/logic/themePicker.ts';
import { PARENT_PIN, snapshot, startWall } from './e2e/harness.ts';

const BAND_LITERALS = ['picture', 'emergent', 'fluent'];

function swatchStrings(swatch: ThemeSwatch): string[] {
  return [
    swatch.ground,
    swatch.groundTexture,
    swatch.groundTextureSize,
    swatch.card,
    swatch.cardEdge,
    swatch.cardEdgeWidth,
    swatch.cardCorner,
    swatch.cardShadow,
    ...(swatch.railFill === null ? [] : [swatch.railFill]),
    ...(swatch.railEdge === null ? [] : [swatch.railEdge]),
    ...swatch.accents,
  ];
}

// ---------------------------------------------------------------------------
// The options
// ---------------------------------------------------------------------------

test('the picker offers exactly the three looks, gallery / felt / storybook', () => {
  assert.deepEqual([...PICKER_ORDER].sort(), [...WALL_THEMES].sort());
  assert.deepEqual(PICKER_ORDER, ['gallery', 'felt', 'storybook']);
  const options = themeOptions('felt', false);
  assert.deepEqual(
    options.map((o) => o.theme),
    PICKER_ORDER,
  );
});

test('exactly one option is the default, and it is the felt board', () => {
  for (const current of [...WALL_THEMES, undefined]) {
    const defaults = themeOptions(current, false).filter((o) => o.isDefault);
    assert.equal(defaults.length, 1);
    assert.equal(defaults[0]?.theme, 'felt');
    assert.equal(defaults[0]?.theme, DEFAULT_WALL_THEME);
  }
});

test('exactly one option is selected, and it is the look the settings say', () => {
  for (const theme of WALL_THEMES) {
    const selected = themeOptions(theme, false).filter((o) => o.selected);
    assert.deepEqual(
      selected.map((o) => o.theme),
      [theme],
    );
  }
});

test('anything that is not a look selects the felt board, never nothing', () => {
  // An older server sends no `theme`; a hand-edited row can hold anything. The wall wears felt
  // for both, so the picker must say felt — a picker with no ring is a wall it cannot describe.
  for (const garbage of [undefined, null, '', 'picture', 'FELT', 42, {}]) {
    const selected = themeOptions(garbage, false).filter((o) => o.selected);
    assert.deepEqual(
      selected.map((o) => o.theme),
      ['felt'],
      `for ${JSON.stringify(garbage)}`,
    );
  }
});

test('every option is live when nothing is in flight — the selected one too', () => {
  for (const theme of WALL_THEMES) {
    for (const option of themeOptions(theme, false)) {
      assert.equal(option.live, true, `${option.theme} under ${theme}`);
    }
  }
});

test('while a request is in flight, all three are inert', () => {
  for (const theme of WALL_THEMES) {
    assert.deepEqual(
      themeOptions(theme, true).map((o) => o.live),
      [false, false, false],
    );
  }
});

test("the names are the household's, distinct, and never a band literal", () => {
  assert.deepEqual(THEME_NAMES, { felt: 'Felt board', gallery: 'Gallery', storybook: 'Storybook' });
  const names = themeOptions('felt', false).map((o) => o.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) {
    for (const band of BAND_LITERALS) assert.notEqual(name.toLowerCase(), band);
  }
});

// ---------------------------------------------------------------------------
// The swatches
// ---------------------------------------------------------------------------

test('every token in every look resolves inside its own table, with no var() left', () => {
  for (const theme of WALL_THEMES) {
    const table = themeTokens(theme);
    for (const name of Object.keys(table) as CssTokenName[]) {
      const literal = themeLiteral(theme, name);
      assert.doesNotMatch(literal, /var\(/, `${theme} ${name} = ${literal}`);
    }
  }
});

test('a swatch is literal values only — nothing in it can follow the wall', () => {
  for (const theme of WALL_THEMES) {
    for (const value of swatchStrings(themeSwatch(theme))) {
      assert.doesNotMatch(value, /var\(/, `${theme}: ${value}`);
    }
  }
});

test("a swatch's colours are its own look's tokens", () => {
  for (const theme of WALL_THEMES) {
    const t = themeTokens(theme);
    const swatch = themeSwatch(theme);
    assert.equal(swatch.ground, t['--c-bg'], `${theme} ground`);
    assert.equal(swatch.card, t['--c-surface'], `${theme} card`);
    assert.equal(swatch.cardCorner, t['--r-md'], `${theme} corner`);
    assert.equal(swatch.cardEdgeWidth, t['--stroke-card'], `${theme} edge width`);
    assert.deepEqual(swatch.accents, [t['--c-id-1'], t['--c-id-2'], t['--c-id-3']], `${theme} accents`);
  }
});

test('a DERIVED token is resolved in the look it belongs to, not in the page', () => {
  // Felt's card edge is var(--c-border-strong); gallery's is var(--c-border). Resolved against
  // the page, both would come back as whatever the wall wears — which is the bug this guards.
  const felt = themeTokens('felt');
  const gallery = themeTokens('gallery');
  const storybook = themeTokens('storybook');
  assert.equal(felt['--edge-card'], 'var(--c-border-strong)');
  assert.equal(gallery['--edge-card'], 'var(--c-border)');
  assert.equal(themeSwatch('felt').cardEdge, themeLiteral('felt', '--c-border-strong'));
  assert.equal(themeSwatch('gallery').cardEdge, themeLiteral('gallery', '--c-border'));
  assert.notEqual(themeSwatch('felt').cardEdge, themeSwatch('gallery').cardEdge);
  // Felt's ledge is drawn in felt's strong border, and nobody else's.
  assert.ok(themeSwatch('felt').cardShadow.includes(themeLiteral('felt', '--c-border-strong')));
  assert.equal(themeSwatch('storybook').cardShadow, storybook['--shadow-card']);
});

test('the three swatches are three different looks', () => {
  const swatches = WALL_THEMES.map((theme) => themeSwatch(theme));
  for (const key of ['ground', 'cardCorner', 'rail', 'cardShadow'] as const) {
    const values = swatches.map((s) => s[key]);
    assert.equal(new Set(values).size, WALL_THEMES.length, `${key}: ${values.join(' | ')}`);
  }
});

test("a swatch stands the faces where its look does, on the rail's own surface", () => {
  for (const theme of WALL_THEMES) {
    const swatch = themeSwatch(theme);
    const layout = layoutFor(theme);
    assert.equal(swatch.rail, layout.rail, theme);
    assert.equal(swatch.faceFrame, layout.faceFrame, theme);
  }
  // Felt's faces stand on the ground itself; the other two have a surface under them.
  assert.equal(themeSwatch('felt').railFill, null);
  assert.equal(themeSwatch('gallery').railFill, themeLiteral('gallery', '--c-surface-sunken'));
  assert.equal(themeSwatch('storybook').railFill, themeLiteral('storybook', '--c-surface-inverse'));
});

// ---------------------------------------------------------------------------
// The pick
// ---------------------------------------------------------------------------

interface Sent {
  url: string;
  init: RequestInit;
}

function recorder(reply: () => Response) {
  const sent: Sent[] = [];
  const fetchImpl = (url: string, init: RequestInit): Promise<Response> => {
    sent.push({ url, init });
    return Promise.resolve(reply());
  };
  return { sent, fetchImpl };
}

test("a pick is one POST carrying the look, the PIN and the device's token", async () => {
  const reply = { centsPerPoint: 10, chores: [], departures: {}, theme: 'storybook' };
  const { sent, fetchImpl } = recorder(() => new Response(JSON.stringify(reply), { status: 200 }));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  const got = await actions.setTheme('storybook', '1111');

  assert.equal(sent.length, 1);
  const [call] = sent as [Sent];
  assert.equal(call.url, '/api/admin/v1/settings/theme');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body, JSON.stringify({ theme: 'storybook' }));
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers[PARENT_PIN_HEADER], '1111');
  assert.equal(headers['authorization'], 'Device dev-token');
  assert.equal(headers['content-type'], 'application/json');
  // The answer is what the picker renders from next.
  assert.equal(got.theme, 'storybook');
  assert.equal(themeOptions(got.theme, false).find((o) => o.selected)?.theme, 'storybook');
});

test('a pick without a PIN never reaches the network', async () => {
  const { sent, fetchImpl } = recorder(() => new Response('{}', { status: 200 }));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });
  await assert.rejects(actions.setTheme('gallery', ''), (err: unknown) => refusalCodeOf(err) === 'bad_pin');
  assert.equal(sent.length, 0);
});

test('A PICK CHANGES WHAT THE WALL RENDERS FROM, end to end', async () => {
  const h = await startWall();
  try {
    const actions = createAdminActions({ baseUrl: h.base, deviceToken: h.token });
    assert.equal((await snapshot(h)).theme, 'felt');

    for (const theme of ['gallery', 'storybook', 'felt'] satisfies WallThemeId[]) {
      const settings = await actions.setTheme(theme, PARENT_PIN);
      assert.equal(settings.theme, theme);
      // The ring moves to what the server stored...
      assert.equal(themeOptions(settings.theme, false).find((o) => o.selected)?.theme, theme);
      // ...and the wall's snapshot follows.
      assert.equal((await snapshot(h)).theme, theme, `snapshot after picking ${theme}`);
    }
  } finally {
    await h.stop();
  }
});

test('a pick with the wrong PIN changes nothing', async () => {
  const h = await startWall();
  try {
    const actions = createAdminActions({ baseUrl: h.base, deviceToken: h.token });
    await assert.rejects(actions.setTheme('gallery', '0000'), (err: unknown) => refusalCodeOf(err) === 'bad_pin');
    assert.equal((await snapshot(h)).theme, 'felt');
  } finally {
    await h.stop();
  }
});
