/**
 * Unit G acceptance, part 4: the palette actually separates on THIS panel.
 *
 * Nothing here is eyeballed.  Relative luminance is recomputed from the hex
 * values on every run, using an implementation written independently of
 * tokens.ts, and every rule in CONTRAST_RULES is checked against it.  Change a
 * colour and this file tells you what you broke.
 *
 * The metric is deliberately harsher than WCAG.  WCAG's (Y + 0.05) terms model
 * roughly 5% of peak white arriving as veiling glare.  The Elo 2270L runs at
 * ~225 nits behind anti-glare ETCHED glass in a daylit living room, which
 * diffuses ambient light back across the whole surface — so the flare term here
 * is PANEL.flare = 0.10.  Every ratio below is therefore lower than the WCAG
 * figure for the same pair, and the thresholds are set against that.
 *
 * THREE THEMES (2026-10-11).  Every rule, ladder and state check below runs once per
 * theme, against that theme's resolved hex — felt from :root, gallery and storybook
 * as felt with their own block on top.  A theme is a palette; it does not get its
 * own thresholds.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL_THEMES, type WallThemeId } from '../src/types.ts';
import {
  childAccentsFor,
  CONTRAST_RULES,
  cssTokens,
  PANEL,
  stateTreatmentsFor,
  themeTokens,
  type ColourTokenName,
} from '../web/src/design/tokens.ts';

// --- luminance, from first principles ---------------------------------------

function channel(eightBit: number): number {
  const c = eightBit / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/** WCAG 2.x relative luminance, 0 (black) to 1 (white). */
function relativeLuminance(hex: string): number {
  const m = /^#([0-9A-Fa-f]{6})$/.exec(hex);
  assert.ok(m, `not an opaque 6-digit hex: ${hex}`);
  const digits = m[1];
  assert.ok(digits !== undefined);
  const r = Number.parseInt(digits.slice(0, 2), 16);
  const g = Number.parseInt(digits.slice(2, 4), 16);
  const b = Number.parseInt(digits.slice(4, 6), 16);
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastWithFlare(a: string, b: string, flare: number): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  return (Math.max(la, lb) + flare) / (Math.min(la, lb) + flare);
}

const panelContrast = (a: string, b: string): number => contrastWithFlare(a, b, PANEL.flare);

function hexOf(theme: WallThemeId, token: ColourTokenName): string {
  const v = themeTokens(theme)[token];
  assert.ok(typeof v === 'string' && v.startsWith('#'), `${theme} ${token} is not a colour`);
  return v;
}

// --- the luminance implementation itself is checked before it is trusted -----

test('the luminance implementation reproduces known reference values', () => {
  assert.equal(relativeLuminance('#FFFFFF'), 1);
  assert.equal(relativeLuminance('#000000'), 0);
  assert.ok(Math.abs(relativeLuminance('#767676') - 0.181164) < 1e-5);
  // #767676 on white is the canonical 4.5:1 pair under WCAG's 0.05 flare.
  assert.ok(Math.abs(contrastWithFlare('#767676', '#FFFFFF', 0.05) - 4.5422) < 1e-3);
  assert.equal(contrastWithFlare('#000000', '#FFFFFF', 0.05), 21);
});

test('this panel is modelled as glarier than the WCAG reference display', () => {
  assert.ok(PANEL.flare > 0.05, 'a 225-nit etched panel must not be graded on WCAG flare');
  // Sanity: the harsher term must actually make a pair look worse, never better.
  const wcag = contrastWithFlare('#171310', '#FFFFFF', 0.05);
  const panel = contrastWithFlare('#171310', '#FFFFFF', PANEL.flare);
  assert.ok(panel < wcag);
});

// --- the declared rules -----------------------------------------------------

test('every declared contrast rule holds on the panel metric, in every theme', () => {
  assert.ok(CONTRAST_RULES.length >= 30, 'the palette contract must cover the whole system');
  const failures: string[] = [];
  for (const theme of WALL_THEMES) {
    for (const rule of CONTRAST_RULES) {
      const actual = panelContrast(hexOf(theme, rule.a), hexOf(theme, rule.b));
      if (actual < rule.min) {
        failures.push(
          `${theme}: ${rule.a} / ${rule.b}: ${actual.toFixed(3)} < ${rule.min}  (${rule.why})`,
        );
      }
    }
  }
  assert.deepEqual(failures, [], `contrast rules violated:\n  ${failures.join('\n  ')}`);
});

test('the contrast rules cover every colour token, so nothing ships ungraded', () => {
  const graded = new Set<string>();
  for (const rule of CONTRAST_RULES) {
    graded.add(rule.a);
    graded.add(rule.b);
  }
  const ungraded = Object.keys(cssTokens).filter((k) => k.startsWith('--c-') && !graded.has(k));
  assert.deepEqual(ungraded, [], 'these colour tokens have no contrast rule');
});

// --- the two ladders --------------------------------------------------------

test('child accents separate in greyscale, so a dichromat still tells them apart, in every theme', () => {
  const MIN_ACCENT_SEPARATION = 1.6;
  for (const theme of WALL_THEMES) {
    const accents = childAccentsFor(theme);
    for (let i = 0; i < accents.length; i += 1) {
      for (let j = i + 1; j < accents.length; j += 1) {
        const a = accents[i];
        const b = accents[j];
        assert.ok(a !== undefined && b !== undefined);
        const actual = panelContrast(a.solid, b.solid);
        assert.ok(
          actual >= MIN_ACCENT_SEPARATION,
          `${theme}: child ${i} (${a.solid}) vs child ${j} (${b.solid}): ${actual.toFixed(3)} < ${MIN_ACCENT_SEPARATION}`,
        );
      }
    }
  }
});

test('child accents are a strict lightness ladder, not three colours at one level, in every theme', () => {
  for (const theme of WALL_THEMES) {
    const ls = childAccentsFor(theme).map((a) => relativeLuminance(a.solid));
    for (let i = 1; i < ls.length; i += 1) {
      const prev = ls[i - 1];
      const cur = ls[i];
      assert.ok(prev !== undefined && cur !== undefined);
      assert.ok(cur > prev, `${theme}: accent ladder is not monotone at rung ${i}`);
    }
  }
});

test('the on-accent ink is the readable one, never assumed white, in every theme', () => {
  for (const theme of WALL_THEMES) {
    const accents = childAccentsFor(theme);
    for (const a of accents) {
      const actual = panelContrast(a.onSolid, a.solid);
      assert.ok(actual >= 4, `${theme}: ink ${a.onSolid} on ${a.solid} is ${actual.toFixed(3)}`);
      // The point of the token: at least one accent is too light for white ink.
    }
    const anyDarkInk = accents.some((a) => relativeLuminance(a.onSolid) < 0.5);
    const anyLightInk = accents.some((a) => relativeLuminance(a.onSolid) > 0.5);
    assert.ok(anyDarkInk && anyLightInk, `${theme}: if every accent took the same ink, the token is a lie`);
  }
});

test('state edges separate pairwise on the panel metric, in every theme', () => {
  const MIN_STATE_SEPARATION = 1.5;
  for (const theme of WALL_THEMES) {
    const edges = Object.values(stateTreatmentsFor(theme)).map((t) => ({ state: t.state, edge: t.edge }));
    for (let i = 0; i < edges.length; i += 1) {
      for (let j = i + 1; j < edges.length; j += 1) {
        const a = edges[i];
        const b = edges[j];
        assert.ok(a !== undefined && b !== undefined);
        const actual = panelContrast(a.edge, b.edge);
        assert.ok(
          actual >= MIN_STATE_SEPARATION,
          `${theme}: ${a.state} vs ${b.state}: ${actual.toFixed(3)} < ${MIN_STATE_SEPARATION}`,
        );
      }
    }
  }
});

test('each state edge is visible against the fill it outlines, in every theme', () => {
  for (const theme of WALL_THEMES) {
    for (const t of Object.values(stateTreatmentsFor(theme))) {
      const actual = panelContrast(t.edge, t.fill);
      assert.ok(actual >= 1.5, `${theme}: ${t.state} edge on its own fill is only ${actual.toFixed(3)}`);
    }
  }
});

test('each state ink is readable on its own fill, in every theme', () => {
  for (const theme of WALL_THEMES) {
    for (const t of Object.values(stateTreatmentsFor(theme))) {
      // A solid fill carries only large type (>=24px), so it is graded at 4:1;
      // outline and tint fills carry body text and are graded at 7:1.
      const min = t.fillRole === 'solid' ? 4 : 7;
      const actual = panelContrast(t.ink, t.fill);
      assert.ok(actual >= min, `${theme}: ${t.state}: ink on fill is ${actual.toFixed(3)}, need ${min}`);
    }
  }
});
