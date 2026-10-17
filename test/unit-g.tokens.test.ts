/**
 * Unit G acceptance, part 1 (build-plan.md §4): "Tokens, type scale, tap targets
 * >=64px, nothing below 14px".
 *
 * Two jobs here.  First, the floors are real: every size token is parsed out of
 * the stylesheet and checked, so nobody can add a 12px "caption" or a 1px hairline
 * without the suite going red.  Second, tokens.css and tokens.ts are asserted
 * identical — they are two hand-maintained copies of the same truth, and the
 * failure mode of drift is a wall that renders one thing and tests another.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { WALL_THEMES, type WallThemeId } from '../src/types.ts';
import {
  cardEdge,
  cardShadow,
  colour,
  cssTokens,
  cssVar,
  font,
  ground,
  LOGICAL_PX_MM,
  MIN,
  PANEL,
  layoutPx,
  radius,
  spacePx,
  themeOverrides,
  themeTokens,
  type CssTokenName,
} from '../web/src/design/tokens.ts';

const DESIGN_DIR = join(import.meta.dirname, '..', 'web', 'src', 'design');
const CSS_PATH = join(DESIGN_DIR, 'tokens.css');
const CSS = readFileSync(CSS_PATH, 'utf8');

/**
 * Parse the FIRST block that opens with `opener` — by default `:root {`, which is
 * felt.  The stylesheet has another `:root` under prefers-reduced-motion whose job
 * is to override two durations; picking it up here would make the mirror test fail
 * for the wrong reason.  A theme block opens `:root[data-wall-theme="x"] {`.
 */
function parseRootBlock(css: string, opener = ':root {'): Record<string, string> {
  const open = css.indexOf(opener);
  assert.notEqual(open, -1, `tokens.css must declare a ${opener} block`);
  const close = css.indexOf('\n}', open);
  assert.notEqual(close, -1, `${opener} block must be closed by a } at column 0`);
  const body = css.slice(open, close);

  const out: Record<string, string> = {};
  for (const raw of body.split('\n')) {
    const line = raw.trim();
    if (!line.startsWith('--')) continue; // comment / blank / the block's opener
    const m = /^(--[a-z0-9-]+)\s*:\s*(.+);$/.exec(line);
    assert.ok(m, `unparseable declaration (one "--name: value;" per line): ${line}`);
    const [, name, value] = m;
    assert.ok(name !== undefined && value !== undefined);
    assert.equal(out[name], undefined, `${name} declared twice in :root`);
    out[name] = value.trim();
  }
  return out;
}

const parsed = parseRootBlock(CSS);

const themeOpener = (theme: WallThemeId): string => `:root[data-wall-theme="${theme}"] {`;

/**
 * Every theme's full token set: felt from the stylesheet itself, the others as felt with
 * their own block on top.  The floors below are checked against all three — a theme is a
 * palette and a face, and none of them gets to shrink a tap target or a type step.
 */
const THEME_SETS: readonly (readonly [WallThemeId, Record<string, string>])[] = WALL_THEMES.map(
  (theme) =>
    [
      theme,
      theme === 'felt' ? parsed : { ...parsed, ...parseRootBlock(CSS, themeOpener(theme)) },
    ] as const,
);

/** Tokens whose value is a bare length, e.g. "14px" -> 14. */
function lengthPx(name: string, set: Record<string, string> = parsed): number {
  const v = set[name];
  assert.ok(v !== undefined, `${name} missing from tokens.css`);
  assert.match(v, /^-?\d+(\.\d+)?px$/, `${name} must be an absolute px length, got "${v}"`);
  return Number.parseFloat(v);
}

function namesMatching(re: RegExp, set: Record<string, string> = parsed): string[] {
  const hits = Object.keys(set).filter((k) => re.test(k));
  assert.ok(hits.length > 0, `no tokens matched ${re}`);
  return hits;
}

test('tokens.css parses and is non-trivial', () => {
  assert.ok(Object.keys(parsed).length > 60, 'expected a full token set');
});

test('tokens.ts mirrors tokens.css exactly', () => {
  // Object.entries loses the readonly-ness but not the values; a plain deepEqual
  // catches an added, removed, renamed or retyped token in either direction.
  assert.deepEqual(parsed, { ...cssTokens });
});

// --- the themes ---------------------------------------------------------------

test('felt IS :root — it has no block of its own and overrides nothing', () => {
  assert.deepEqual(themeOverrides.felt, {});
  assert.ok(!CSS.includes(themeOpener('felt')), 'felt is the :root block, not a second copy of it');
  assert.deepEqual({ ...themeTokens('felt') }, { ...cssTokens });
});

test('each theme block in tokens.css mirrors themeOverrides exactly', () => {
  for (const theme of WALL_THEMES) {
    if (theme === 'felt') continue;
    assert.deepEqual(
      parseRootBlock(CSS, themeOpener(theme)),
      { ...themeOverrides[theme] },
      `${theme}: tokens.css and tokens.ts disagree`,
    );
  }
});

test('the stylesheet declares no theme the household cannot choose', () => {
  const declared = [...CSS.matchAll(/\[data-wall-theme="([^"]+)"\]/g)].map((m) => m[1]);
  assert.ok(declared.length > 0);
  for (const id of declared) {
    assert.ok((WALL_THEMES as readonly (string | undefined)[]).includes(id), `stray theme "${id}"`);
  }
});

test('a theme overrides only names felt declares, and only to something different', () => {
  // A name only one theme declares would render as its fallback in the other two; an override
  // equal to felt's value is noise that hides which names a theme really changes.
  for (const theme of WALL_THEMES) {
    for (const [name, value] of Object.entries(themeOverrides[theme])) {
      assert.ok(Object.hasOwn(cssTokens, name), `${theme} overrides ${name}, which felt does not declare`);
      assert.notEqual(value, cssTokens[name as CssTokenName], `${theme} re-declares ${name} unchanged`);
    }
  }
});

test('every var() in every theme names a declared token', () => {
  for (const theme of WALL_THEMES) {
    for (const [name, value] of Object.entries(themeTokens(theme))) {
      for (const m of value.matchAll(/var\((--[a-z0-9-]+)/g)) {
        assert.ok(Object.hasOwn(cssTokens, m[1] ?? ''), `${theme}: ${name} references ${m[1]}`);
      }
    }
  }
});

test('a renderer holds var() strings whose fallback is felt, fully resolved', () => {
  // The fallback is used exactly when tokens.css did not arrive, so it may not lean on a
  // custom property itself: felt's card edge is var(--c-border-strong) in the stylesheet
  // and must be the literal hex in the fallback.
  assert.equal(colour.bg, `var(--c-bg, ${cssTokens['--c-bg']})`);
  assert.equal(radius.lg, `var(--r-lg, ${cssTokens['--r-lg']})`);
  assert.equal(font.family, `var(--font-family, ${cssTokens['--font-family']})`);
  assert.equal(cardEdge, `var(--edge-card, ${cssTokens['--c-border-strong']})`);
  assert.equal(cardShadow, `var(--shadow-card, 5px 5px 0 0 ${cssTokens['--c-border-strong']})`);
  assert.equal(ground.texture, `var(--ground-texture, radial-gradient(${cssTokens['--c-border']} 1.2px, transparent 1.4px))`);
  for (const name of Object.keys(cssTokens) as CssTokenName[]) {
    const fallback = cssVar(name).slice(`var(${name}, `.length, -1);
    assert.ok(!fallback.includes('var('), `${name}'s fallback leans on a custom property: ${fallback}`);
  }
});

test('every face a theme names first is self-hosted, with its licence beside it', () => {
  // PRD §4 availability, again: a face the stylesheet names but does not ship falls back to
  // the next family silently, which is how the wall's font was named and never supplied
  // (b6efbb3). The first family of every --font-* in every theme must be an @font-face here,
  // its file must exist, and the OFL that licenses it must sit in the same folder.
  const faces = new Map<string, string>();
  for (const m of CSS.matchAll(/@font-face\s*{[^}]*font-family:\s*"([^"]+)";[^}]*src:\s*url\("\.\/([^"]+)"\)/g)) {
    faces.set(m[1] ?? '', m[2] ?? '');
  }
  for (const theme of WALL_THEMES) {
    const t = themeTokens(theme);
    for (const role of ['--font-family', '--font-numeric', '--font-display'] as const) {
      const first = /^"([^"]+)"/.exec(t[role])?.[1];
      assert.ok(first !== undefined, `${theme} ${role} must name a quoted family first`);
      const file = faces.get(first);
      assert.ok(file !== undefined, `${theme} ${role}: "${first}" has no @font-face in tokens.css`);
      assert.ok(existsSync(join(DESIGN_DIR, file)), `${theme} ${role}: ${file} is not in the repo`);
    }
  }
  for (const licence of ['OFL-Nunito.txt', 'OFL-Fredoka.txt', 'OFL-Fraunces.txt', 'OFL-Andika.txt']) {
    assert.ok(existsSync(join(DESIGN_DIR, 'fonts', licence)), `${licence} must ship with its font`);
  }
});

test('no font-size token is below the 14px logical floor, in any theme', () => {
  assert.equal(MIN.fontSizePx, 14);
  for (const [theme, set] of THEME_SETS) {
    for (const name of namesMatching(/^--fs-\d+$/, set)) {
      const px = lengthPx(name, set);
      assert.ok(
        px >= MIN.fontSizePx,
        `${theme} ${name} is ${px}px logical (${px * PANEL.deviceScaleFactor}px physical); floor is ${MIN.fontSizePx}`,
      );
    }
  }
});

test('the type scale actually climbs, and its smallest step IS the floor, in every theme', () => {
  for (const [theme, set] of THEME_SETS) {
    const sizes = namesMatching(/^--fs-\d+$/, set)
      .sort((a, b) => Number.parseInt(a.slice(5), 10) - Number.parseInt(b.slice(5), 10))
      .map((name) => lengthPx(name, set));
    assert.equal(sizes[0], MIN.fontSizePx, `${theme}: the first rung must be the floor, not above it`);
    for (let i = 1; i < sizes.length; i += 1) {
      const prev = sizes[i - 1];
      const cur = sizes[i];
      assert.ok(prev !== undefined && cur !== undefined);
      assert.ok(cur > prev, `${theme}: type scale must be strictly increasing at rung ${i}`);
    }
  }
});

test('no tap-target token is below the 64px logical floor, in any theme', () => {
  assert.equal(MIN.tapTargetPx, 64);
  for (const [theme, set] of THEME_SETS) {
    for (const name of namesMatching(/^--tap-/, set)) {
      const px = lengthPx(name, set);
      assert.ok(px >= MIN.tapTargetPx, `${theme} ${name} is ${px}px logical; floor is ${MIN.tapTargetPx}`);
    }
  }
});

test('the tap ladder is what the panel decided, IN MILLIMETRES', () => {
  // The H9 panel revised the floors from 132/104/64 to 96/80/64 on an argument made entirely
  // in millimetres — child-touch literature puts the usable range at 20-30mm, 132px is 66mm
  // and nothing supports it. Every one of those figures was prose in a comment, and
  // `LOGICAL_PX_MM` existed to derive them and was referenced nowhere, so the arithmetic the
  // decision rests on was unverified. It is verified here: change `deviceScaleFactor` or
  // `physicalPixelsPerMm` and the claims fail instead of quietly becoming wrong.
  const mm = (px: number) => px * LOGICAL_PX_MM;
  assert.ok(Math.abs(LOGICAL_PX_MM - 0.496) < 0.005, `1 logical px is ${LOGICAL_PX_MM}mm`);

  // The absolute floor clears the top of the literature's usable range.
  assert.ok(mm(MIN.tapTargetPx) >= 30, `${MIN.tapTargetPx}px is ${mm(MIN.tapTargetPx)}mm`);
  assert.ok(mm(lengthPx('--tap-lg')) >= 45, 'the preferred 96px target is ~48mm');

  // And the rejected floor is still oversized, which is the whole reason it was rejected.
  assert.ok(mm(lengthPx('--tap-xl')) > 60, 'the old 132px floor is ~66mm — kept, but not a floor');

  // The mis-tap argument: a 20-25mm finger pad centred on the preferred target leaves
  // 11-14mm of slack per edge, which is what the inert gutter is sized against.
  const slack = (mm(lengthPx('--tap-lg')) - 25) / 2;
  assert.ok(slack >= 11, `only ${slack}mm of slack per edge on the preferred target`);
});

test('adjacent tap targets are forced apart by a dead-space token', () => {
  // Without this, a fat-finger miss lands on the neighbouring chore card.
  assert.ok(spacePx.tapGap >= MIN.tapGapPx);
  assert.equal(lengthPx('--sp-tap-gap'), spacePx.tapGap);
});

test('no border/stroke token is below the 2px minimum weight, in any theme', () => {
  assert.equal(MIN.strokePx, 2);
  for (const [theme, set] of THEME_SETS) {
    for (const name of namesMatching(/^--stroke-/, set)) {
      const px = lengthPx(name, set);
      assert.ok(px >= MIN.strokePx, `${theme} ${name} is ${px}px logical; 1px logical smears behind the etch`);
    }
  }
});

test('no icon token is below the icon floor, in any theme', () => {
  for (const [theme, set] of THEME_SETS) {
    for (const name of namesMatching(/^--icon-/, set)) {
      const px = lengthPx(name, set);
      assert.ok(px >= MIN.iconPx, `${theme} ${name} is ${px}px logical; floor is ${MIN.iconPx}`);
    }
  }
});

test('no font-weight token is below 600, in any theme', () => {
  for (const [theme, set] of THEME_SETS) {
    for (const name of namesMatching(/^--fw-/, set)) {
      const v = set[name];
      assert.ok(v !== undefined);
      const w = Number.parseInt(v, 10);
      assert.ok(w >= MIN.fontWeight, `${theme} ${name} is ${w}; lighter stems read as hairlines`);
    }
  }
});

test('the background is explicitly light and the page is not transparent, in every theme', () => {
  // The room is a living room in daylight; a dark theme turns 225 nits of
  // backlight behind etched glass into a mirror.
  for (const [theme, set] of THEME_SETS) {
    const bg = set['--c-bg'];
    assert.ok(bg !== undefined, '--c-bg must be declared');
    assert.match(bg, /^#[0-9A-F]{6}$/, `${theme}: --c-bg must be an explicit opaque hex`);
  }
});

test('the brown ground is gone from every theme', () => {
  // The parent's complaint about the old look was this sand, #E7DCC9: a warm, mid-value ground
  // that made every white card read as yellowed paper on cardboard (design review, 2026-10).
  // Lightness alone cannot fix it — the ink and card rules pin a ground below about Y .74 — so
  // a ground is graded by how TINTED it is as well: no channel more than 0x18 from another.
  for (const [theme, set] of THEME_SETS) {
    const bg = set['--c-bg'] ?? '';
    assert.notEqual(bg, '#E7DCC9', `${theme} still paints the old sand`);
    const [r, g, b] = [1, 3, 5].map((i) => Number.parseInt(bg.slice(i, i + 2), 16));
    assert.ok(r !== undefined && g !== undefined && b !== undefined);
    const spread = Math.max(r, g, b) - Math.min(r, g, b);
    assert.ok(spread <= 0x18, `${theme} --c-bg ${bg} is tinted ${spread}, which the etch reads as a colour`);
  }
});

test('every colour token is an opaque 6-digit hex, in every theme', () => {
  // No rgba(), no colour-mix(), no currentColor: alpha over an unknown ground has
  // an unknown contrast, and unknown contrast on this panel means unreadable.
  for (const [theme, set] of THEME_SETS) {
    for (const name of namesMatching(/^--c-/, set)) {
      const v = set[name];
      assert.ok(v !== undefined);
      assert.match(v, /^#[0-9A-F]{6}$/, `${theme} ${name} = "${v}" must be an opaque uppercase hex`);
    }
  }
});

test('the layout tokens agree with the panel geometry', () => {
  assert.equal(PANEL.logicalWidthPx, PANEL.physicalWidthPx / PANEL.deviceScaleFactor);
  assert.equal(PANEL.logicalHeightPx, PANEL.physicalHeightPx / PANEL.deviceScaleFactor);
  assert.equal(layoutPx.wallWidth, PANEL.logicalWidthPx);
  assert.equal(layoutPx.wallHeight, PANEL.logicalHeightPx);
});

test('no webfont is fetched from a third party at display time', () => {
  // PRD §4 availability test: nothing 6:00 AM depends on may leave the house.
  // DinkyDash links fonts.googleapis.com; that part is deliberately not lifted.
  for (const forbidden of ['@import', 'fonts.googleapis.com', 'fonts.gstatic.com', 'url(http']) {
    assert.ok(!CSS.includes(forbidden), `tokens.css must not reference ${forbidden}`);
  }
});
