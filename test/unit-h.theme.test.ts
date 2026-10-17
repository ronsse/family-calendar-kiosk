/**
 * The wall's theme reaches the glass through ONE attribute on the root element.
 *
 * `applyWallTheme` is the only DOM write the theme makes; everything else is the stylesheet
 * re-resolving `var(--x, <felt>)` strings. So these tests drive that function against a
 * recording root and check what it wrote — including the two ways a theme can arrive wrong
 * (an older server that sends no field, a value nobody declared) and land on a blank wall.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_WALL_THEME, WALL_THEMES } from '../src/types.ts';
import {
  applyWallTheme,
  countdownsThatFit,
  documentRoot,
  grownupGeometry,
  layoutFor,
  pagerPlace,
  resolveWallTheme,
  shellGeometry,
  WALL_LAYOUTS,
  WALL_THEME_ATTRIBUTE,
  type ShellGeometry,
  type ThemeRoot,
} from '../web/src/views/logic/theme.ts';
import { layoutPx, spacePx, tapPx } from '../web/src/design/tokens.ts';

/** A root element that remembers every write. */
function recordingRoot(initial: string | null = null): ThemeRoot & { writes: string[] } {
  let value = initial;
  const writes: string[] = [];
  return {
    writes,
    getAttribute(name: string) {
      return name === WALL_THEME_ATTRIBUTE ? value : null;
    },
    setAttribute(name: string, next: string) {
      assert.equal(name, WALL_THEME_ATTRIBUTE, 'the theme writes exactly one attribute');
      value = next;
      writes.push(next);
    },
  };
}

test('felt is the default the household gets without choosing', () => {
  assert.equal(DEFAULT_WALL_THEME, 'felt');
  assert.ok(WALL_THEMES.includes(DEFAULT_WALL_THEME));
});

test('every chosen theme passes through unchanged', () => {
  for (const theme of WALL_THEMES) assert.equal(resolveWallTheme(theme), theme);
});

test('anything that is not a theme is felt, never a blank wall', () => {
  // An older server sends no field; a band name is the nearest wrong string in this codebase;
  // ids are case-sensitive on the wire, as the route validates them.
  for (const garbage of [undefined, null, '', 'picture', 'FELT', 'Gallery', 42, {}, ['felt']]) {
    assert.equal(resolveWallTheme(garbage), 'felt', `resolveWallTheme(${JSON.stringify(garbage)})`);
  }
});

test('applying a theme writes it on the root and reports what it applied', () => {
  const root = recordingRoot();
  assert.equal(applyWallTheme(root, 'storybook'), 'storybook');
  assert.equal(root.getAttribute(WALL_THEME_ATTRIBUTE), 'storybook');
  assert.deepEqual(root.writes, ['storybook']);
});

test('a switch is a single write, and the same theme again writes nothing', () => {
  // The snapshot arrives every few seconds; the DOM must not be touched when nothing moved.
  const root = recordingRoot();
  applyWallTheme(root, 'felt');
  applyWallTheme(root, 'felt');
  applyWallTheme(root, 'gallery');
  applyWallTheme(root, 'gallery');
  applyWallTheme(root, 'storybook');
  assert.deepEqual(root.writes, ['felt', 'gallery', 'storybook']);
});

test('a garbage theme moves an un-themed root to felt, and leaves a felt root alone', () => {
  const bare = recordingRoot();
  assert.equal(applyWallTheme(bare, 'neon'), 'felt');
  assert.deepEqual(bare.writes, ['felt']);

  const felt = recordingRoot('felt');
  applyWallTheme(felt, undefined);
  assert.deepEqual(felt.writes, []);
});

test('a garbage theme after a real one goes back to felt rather than keeping the old one', () => {
  // Holding the last good theme would look harmless and would hide a server that stopped
  // sending the field; felt is what the household sees with no choice made.
  const root = recordingRoot();
  applyWallTheme(root, 'gallery');
  applyWallTheme(root, 'nope');
  assert.deepEqual(root.writes, ['gallery', 'felt']);
});

test('the root is the page\'s <html> element where there is one, and nothing in Node', () => {
  const g = globalThis as unknown as { document?: unknown };
  assert.equal(g.document, undefined, 'this test assumes Node has no document');
  assert.equal(documentRoot(), null);

  const html = recordingRoot();
  g.document = { documentElement: html };
  try {
    const root = documentRoot();
    assert.ok(root !== null);
    applyWallTheme(root, 'gallery');
    assert.deepEqual(html.writes, ['gallery'], 'the write lands on documentElement itself');
  } finally {
    delete g.document;
  }
});

// ---------------------------------------------------------------------------
// The structure table and the two shells
// ---------------------------------------------------------------------------

/** Every pixel of the 960 across, in the order the shell lays them. */
function widthSum(g: ShellGeometry): number {
  return g.kind === 'side'
    ? g.railPx + g.pad.left + g.body.width + g.pad.right
    : g.pad.left + g.body.width + g.pad.right;
}

/** Every pixel of the 540 down, in the order the shell lays them. */
function heightSum(g: ShellGeometry): number {
  return g.kind === 'side'
    ? g.pad.top + g.headerPx + g.gutterPx + g.body.height + g.pad.bottom
    : g.pad.top + g.headerPx + g.gutterPx + g.body.height + g.gutterPx + g.railPx + g.pad.bottom;
}

test('every theme has a structure row, keyed by its own id', () => {
  for (const theme of WALL_THEMES) {
    assert.equal(WALL_LAYOUTS[theme].theme, theme);
    assert.equal(layoutFor(theme), WALL_LAYOUTS[theme]);
  }
});

test('the three themes really are three structures, not three paint jobs', () => {
  const rails = new Set(WALL_THEMES.map((t) => WALL_LAYOUTS[t].rail));
  const doors = new Set(WALL_THEMES.map((t) => WALL_LAYOUTS[t].doors));
  assert.equal(rails.size, 3, 'one rail form each');
  assert.equal(doors.size, 3, 'one door form each');
  assert.equal(WALL_LAYOUTS.felt.rail, 'bottom', 'felt puts the faces where the youngest can reach');
  assert.equal(WALL_LAYOUTS.storybook.numberedSteps, true, 'the book numbers its one sequence');
  assert.equal(WALL_LAYOUTS.felt.numberedSteps, false);
  assert.equal(WALL_LAYOUTS.gallery.numberedSteps, false);
  assert.equal(WALL_LAYOUTS.gallery.faceFrame, 'square', 'the gallery hangs portraits in square frames');
  assert.equal(WALL_LAYOUTS.storybook.faceFrame, 'round', 'storybook boxes its states, not its faces');
});

test('a theme that is not one gets felt\'s structure, never a blank wall', () => {
  for (const garbage of [undefined, null, '', 'picture', 'neon', 7]) {
    assert.equal(layoutFor(garbage), WALL_LAYOUTS.felt, `layoutFor(${JSON.stringify(garbage)})`);
  }
});

test('both shells add up to the glass on both axes, for every theme and screen', () => {
  for (const theme of WALL_THEMES) {
    for (const adult of [false, true]) {
      const g = shellGeometry(WALL_LAYOUTS[theme], adult);
      const label = `${theme}${adult ? ' (grown-up screen)' : ''}`;
      assert.equal(widthSum(g), layoutPx.wallWidth, `${label}: across`);
      assert.equal(heightSum(g), layoutPx.wallHeight, `${label}: down`);
    }
  }
});

test('the side shell keeps the 816x412 body every older screen was measured against', () => {
  for (const theme of ['gallery', 'storybook'] as const) {
    for (const adult of [false, true]) {
      const g = shellGeometry(WALL_LAYOUTS[theme], adult);
      assert.equal(g.kind, 'side');
      assert.deepEqual(g.body, { width: 816, height: 412 }, theme);
      assert.equal(g.rail, WALL_LAYOUTS[theme].rail, 'gallery\'s plinth and storybook\'s spine draw as themselves');
      assert.equal(g.railPx, layoutPx.sideWidth);
    }
  }
});

test('felt\'s face row is at the bottom on the children\'s screens, and its body is wider and shorter', () => {
  const g = shellGeometry(WALL_LAYOUTS.felt, false);
  assert.equal(g.kind, 'bottom');
  assert.equal(g.rail, 'row');
  assert.deepEqual(g.body, { width: 912, height: 348 });
  // The bar holds tap targets, so it is never thinner than the floor.
  assert.ok(g.railPx >= tapPx.min, `bottom rail ${g.railPx} >= ${tapPx.min}`);
});

test('the picture library is always the side shell, so felt\'s rail moves aside for it', () => {
  const g = shellGeometry(WALL_LAYOUTS.felt, true);
  assert.equal(g.kind, 'side');
  assert.equal(g.rail, 'column', 'felt has no plinth or spine: its faces stand in a plain column');
  assert.deepEqual(g.body, { width: 816, height: 412 }, 'the pane adminActions.ts budgets its lists against');
});

test('the grown-up frame adds up to the glass in every theme, with a 412px body in all three', () => {
  for (const theme of WALL_THEMES) {
    const g = grownupGeometry(WALL_LAYOUTS[theme]);
    // The column is flush to the glass's left edge; `pad.left` is the gutter facing it.
    const across = (g.nav === 'column' ? g.navPx : 0) + g.pad.left + g.body.width + g.pad.right;
    const down = g.pad.top + (g.nav === 'tabs' ? g.navPx : g.headerPx) + g.gutterPx + g.body.height + g.pad.bottom;
    assert.equal(across, layoutPx.wallWidth, `${theme}: across`);
    assert.equal(down, layoutPx.wallHeight, `${theme}: down`);
    assert.equal(g.body.height, 412, `${theme}: the height every grown-up list was budgeted against`);
    assert.ok(g.navPx >= tapPx.min, `${theme}: the nav holds tap targets`);
  }
});

test('felt navigates by a tab row over a full-width body; gallery and storybook by a column', () => {
  const felt = grownupGeometry(WALL_LAYOUTS.felt);
  assert.equal(felt.nav, 'tabs');
  assert.equal(felt.headerPx, 0, 'the tab row IS the header');
  assert.deepEqual(felt.body, { width: 912, height: 412 });
  for (const theme of ['gallery', 'storybook'] as const) {
    const g = grownupGeometry(WALL_LAYOUTS[theme]);
    assert.equal(g.nav, 'column');
    assert.equal(g.navPx, layoutPx.sideWidth, 'the column stands where the rail stood');
    assert.deepEqual(g.body, shellGeometry(WALL_LAYOUTS[theme], true).body, 'one pane beside the picture library');
  }
});

test('the refusal key is solid in felt and outlined in the other two', () => {
  assert.equal(WALL_LAYOUTS.felt.rejectKey, 'solid');
  assert.equal(WALL_LAYOUTS.gallery.rejectKey, 'outline');
  assert.equal(WALL_LAYOUTS.storybook.rejectKey, 'outline');
});

test('countdowns: four fit beside the side rail, three above felt\'s bottom one', () => {
  const side = shellGeometry(WALL_LAYOUTS.gallery, false).body.height;
  const bottom = shellGeometry(WALL_LAYOUTS.felt, false).body.height;
  assert.equal(countdownsThatFit(side), 4);
  assert.equal(countdownsThatFit(bottom), 3);
  // The count is what the cards actually take: n cards and n-1 gaps.
  for (const pane of [side, bottom]) {
    const n = countdownsThatFit(pane);
    assert.ok(n * layoutPx.listCardHeight + (n - 1) * spacePx.tapGap <= pane, `${n} fit in ${pane}`);
    assert.ok((n + 1) * layoutPx.listCardHeight + n * spacePx.tapGap > pane, `${n + 1} do not`);
  }
  for (const bad of [0, -10, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(countdownsThatFit(bad), 0, String(bad));
  }
});

test('the calendar\'s pager stands in the header across felt\'s wall, and in the week card beside a rail', () => {
  // The week screen is a child-side screen, so its shell is the theme's own. Measured on a
  // throwaway wall 2026-10-11 with the status stale: the 816px side header gave the clock 29px
  // of the 122 it needs with the pager in it; felt's 912 lost 16. So the side shells move the
  // pager down into the card, where it costs the grid height (logic/week.ts `weekPanePx`).
  for (const theme of WALL_THEMES) {
    for (const adult of [false, true]) {
      const g = shellGeometry(WALL_LAYOUTS[theme], adult);
      const label = `${theme}${adult ? ' (grown-up screen)' : ''}`;
      assert.equal(pagerPlace(g), g.kind === 'bottom' ? 'header' : 'week', label);
    }
  }
  assert.equal(pagerPlace(shellGeometry(WALL_LAYOUTS.felt, false)), 'header');
  assert.equal(pagerPlace(shellGeometry(WALL_LAYOUTS.gallery, false)), 'week');
  assert.equal(pagerPlace(shellGeometry(WALL_LAYOUTS.storybook, false)), 'week');
});
