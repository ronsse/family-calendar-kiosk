/**
 * Unit H — nothing with a word or a glyph stands on the week's picture bare.
 *
 * The picture is behind every page now (WallBackdrop), and three controls designed before that
 * — the section doors, storybook's running head, felt's house key on a floating rail — were left
 * floating on it. logic/plate.ts says what each one stands on, in token NAMES; this resolves
 * those names in every theme, the way the stylesheet will, and grades what the glass gets.
 *
 * The rendered half is rule 9 of tools/panel-audit.mjs ("floating"). This is the half that
 * needs no browser: that every plate the wall can draw is opaque, carries ink at the body-text
 * bar, and says "chosen" and "you are here" in something other than colour.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL_THEMES, type WallThemeId } from '../src/types.ts';
import { PANEL, themeTokens, type CssTokenName } from '../web/src/design/tokens.ts';
import {
  CARD_PLATE,
  doorPlate,
  headerPlate,
  railKeyPlate,
  type Plate,
} from '../web/src/views/logic/plate.ts';
import { WALL_LAYOUTS, shellGeometry, type RailDraw } from '../web/src/views/logic/theme.ts';

// --- resolving a token the way the browser will ------------------------------

/** A token's value in one theme, following `var(--x)` until it is a literal. */
function resolve(theme: WallThemeId, name: CssTokenName): string {
  const t = themeTokens(theme);
  let v: string = t[name];
  for (let i = 0; i < 8; i += 1) {
    const m = /^var\((--[a-z0-9-]+)\)$/.exec(v.trim());
    if (m === null) return v.trim();
    const next = m[1] as CssTokenName;
    assert.ok(Object.hasOwn(t, next), `${name} references undeclared ${next}`);
    v = t[next];
  }
  assert.fail(`${name} does not resolve in ${theme}`);
}

// Luminance written here from the WCAG definition, independently of tokens.ts, with the
// panel's own flare term — the same metric every other contrast figure in this repo uses.
function channel(eightBit: number): number {
  const c = eightBit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(hex: string): number {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  assert.ok(m !== null, `not an opaque colour: ${hex}`);
  const d = m[1] ?? '';
  const [r, g, b] = [0, 2, 4].map((i) => Number.parseInt(d.slice(i, i + 2), 16));
  return 0.2126 * channel(r ?? 0) + 0.7152 * channel(g ?? 0) + 0.0722 * channel(b ?? 0);
}
function contrast(a: string, b: string): number {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + PANEL.flare) / (Math.min(la, lb) + PANEL.flare);
}

const width = (theme: WallThemeId, plate: Plate): number =>
  Number.parseFloat(resolve(theme, plate.edgeWidth));
const raised = (theme: WallThemeId, plate: Plate): boolean => resolve(theme, plate.ledge) !== 'none';

/** Every plate the wall can draw, labelled. */
function everyPlate(): Array<[string, Plate]> {
  const plates: Array<[string, Plate]> = [
    ['card', CARD_PLATE],
    ['door, chosen', doorPlate(true)],
    ['door, unchosen', doorPlate(false)],
  ];
  for (const form of ['card', 'running-head'] as const) plates.push([`header ${form}`, headerPlate(form, 24).plate]);
  for (const form of ['row', 'column', 'plinth', 'spine'] as const) {
    for (const live of [true, false]) {
      const plate = railKeyPlate(form, live);
      if (plate !== null) plates.push([`house key on ${form}, ${live ? 'live' : 'home'}`, plate]);
    }
  }
  return plates;
}

// --- every plate is a plate ---------------------------------------------------

for (const theme of WALL_THEMES) {
  test(`${theme}: every plate is opaque and carries ink at the body-text bar`, () => {
    const ink = resolve(theme, '--c-ink');
    for (const [label, plate] of everyPlate()) {
      const fill = resolve(theme, plate.fill);
      assert.match(fill, /^#[0-9A-Fa-f]{6}$/, `${theme} ${label}: fill ${fill} is not an opaque colour`);
      const ratio = contrast(ink, fill);
      assert.ok(ratio >= 7, `${theme} ${label}: ink on its plate is ${ratio.toFixed(2)}, under 7`);
    }
  });

  test(`${theme}: every plate has a real edge, and the edge separates from its fill`, () => {
    for (const [label, plate] of everyPlate()) {
      assert.ok(width(theme, plate) >= 2, `${theme} ${label}: a ${width(theme, plate)}px edge is under the 2px stroke floor`);
      const ratio = contrast(resolve(theme, plate.edge), resolve(theme, plate.fill));
      assert.ok(ratio >= 1.5, `${theme} ${label}: edge against fill is ${ratio.toFixed(2)}, under 1.5`);
    }
  });

  test(`${theme}: a chosen door and an unchosen one differ in WEIGHT and DEPTH, not colour`, () => {
    const on = doorPlate(true);
    const off = doorPlate(false);
    assert.ok(
      width(theme, on) - width(theme, off) >= 2,
      `${theme}: chosen ${width(theme, on)}px against unchosen ${width(theme, off)}px is not a visible step`,
    );
    assert.equal(raised(theme, off), true, `${theme}: an unchosen door must stand on a ledge — it is a key`);
    assert.equal(raised(theme, on), false, `${theme}: the chosen door is pressed in`);
    // Both on the same fill: the door's ring is drawn in the child's colour against it.
    assert.equal(resolve(theme, on.fill), resolve(theme, off.fill));
  });

  test(`${theme}: the house key says "you are here" by depth AND fill where the rail floats`, () => {
    for (const form of ['row', 'column'] as const) {
      const live = railKeyPlate(form, true);
      const home = railKeyPlate(form, false);
      assert.ok(live !== null && home !== null, `${theme} ${form}: a floating rail's key needs a plate`);
      assert.equal(raised(theme, live), true, `${theme} ${form}: a live key is raised`);
      assert.equal(raised(theme, home), false, `${theme} ${form}: the key you are on is not`);
      const step = contrast(resolve(theme, live.fill), resolve(theme, home.fill));
      assert.ok(step >= 1.2, `${theme} ${form}: live and home fills are ${step.toFixed(2)} apart`);
    }
  });
}

// --- which things get one ------------------------------------------------------

test('the rail key gets a plate exactly where the rail has no ground of its own', () => {
  const grounded: readonly RailDraw[] = ['plinth', 'spine'];
  for (const theme of WALL_THEMES) {
    for (const adult of [false, true]) {
      const { rail } = shellGeometry(WALL_LAYOUTS[theme], adult);
      for (const live of [true, false]) {
        const plate = railKeyPlate(rail, live);
        assert.equal(
          plate === null,
          grounded.includes(rail),
          `${theme} ${adult ? 'grown-up' : 'child'} screen: rail ${rail}, plate ${plate === null ? 'none' : 'drawn'}`,
        );
      }
    }
  }
});

test('the running head HANGS through the shell top, so the bar below it does not move', () => {
  for (const theme of WALL_THEMES) {
    const layout = WALL_LAYOUTS[theme];
    for (const adult of [false, true]) {
      const frame = shellGeometry(layout, adult);
      const head = headerPlate(layout.header, frame.pad.top);
      if (layout.header === 'running-head') {
        assert.equal(head.hangPx, frame.pad.top, `${theme}: the running head reaches the top edge of the glass`);
        assert.ok(head.hangPx > 0, `${theme}: a running head that does not hang is a rule on the art`);
      } else {
        assert.equal(head.hangPx, 0, `${theme}: a card header floats in its margin`);
      }
      // Never bare, in any theme: the header is the first thing on every page.
      assert.equal(head.plate.fill, '--c-surface');
    }
  }
  assert.equal(headerPlate('running-head', -5).hangPx, 0, 'a negative margin cannot hang anything');
});
