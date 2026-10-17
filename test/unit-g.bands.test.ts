/**
 * Unit G acceptance, part 2: "one state, three renderers" (PRD §4) has to be
 * expressible in tokens before unit H can build on it.
 *
 * The load-bearing assertion in this file is the picture band showing no text at
 * all.  A three-year-old who sees a word has been failed by the design, and that
 * is a product failure, not a polish item — so it is a test, not a comment.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ReadingBand } from '../src/types.ts';
import {
  BAND_ORDER,
  bandTypography,
  childAccentForSlot,
  childAccents,
  MAX_DISTINCT_CHILDREN,
  deskTypography,
  MIN,
  nearTypography,
  type BandTypography,
} from '../web/src/design/tokens.ts';

/**
 * Compile-time exhaustiveness: adding a fourth ReadingBand to the frozen types
 * makes this stop compiling (`never` check) before it can reach the wall, and the
 * runtime call below makes a band that is declared but unmapped fail here.
 */
function lookup(band: ReadingBand): BandTypography {
  switch (band) {
    case 'picture':
      return bandTypography.picture;
    case 'emergent':
      return bandTypography.emergent;
    case 'fluent':
      return bandTypography.fluent;
    default: {
      const unreachable: never = band;
      throw new Error(`no typography for reading band ${String(unreachable)}`);
    }
  }
}

const ALL_BANDS: readonly ReadingBand[] = ['picture', 'emergent', 'fluent'];

test('every ReadingBand has a typography entry — a missing band fails here', () => {
  assert.deepEqual([...BAND_ORDER].sort(), [...ALL_BANDS].sort());
  assert.deepEqual(Object.keys(bandTypography).sort(), [...ALL_BANDS].sort());
  for (const band of ALL_BANDS) {
    const cfg = lookup(band);
    assert.equal(cfg.band, band, 'the entry must name the band it is keyed by');
  }
});

test('the picture band shows NO text — not small text, none', () => {
  const p = bandTypography.picture;
  assert.equal(p.showsText, false);
  assert.equal(p.labelField, 'none', 'the pre-reader renderer may read no label field');
  assert.equal(p.maxLabelWords, 0);
  assert.equal(p.primaryTextPx, null, 'null, not 0 — a size invites someone to use it');
  assert.equal(p.secondaryTextPx, null);
  assert.equal(p.numeralTextPx, null, 'a pre-reader cannot read "7" either');
  assert.equal(p.quantity, 'pips', 'quantity must be countable marks, never a numeral');
  assert.ok(p.maxPips > 0, 'pips are the only way this band can show a count');
});

test('showsText and the text sizes cannot disagree', () => {
  for (const band of ALL_BANDS) {
    const cfg = lookup(band);
    const sizes = [cfg.primaryTextPx, cfg.secondaryTextPx, cfg.numeralTextPx, cfg.statusTextPx];
    if (cfg.showsText) {
      assert.notEqual(cfg.labelField, 'none', `${band} shows text so it must name a label field`);
      assert.ok(cfg.maxLabelWords > 0, `${band} shows text so it needs a word budget`);
      for (const s of sizes) {
        assert.notEqual(s, null, `${band} shows text but has a null size`);
      }
    } else {
      assert.equal(cfg.labelField, 'none');
      assert.equal(cfg.maxLabelWords, 0);
      for (const s of sizes) {
        assert.equal(s, null, `${band} shows no text but declares a text size`);
      }
    }
  }
});

test('no band renders text below the 14px logical floor', () => {
  for (const band of ALL_BANDS) {
    const cfg = lookup(band);
    for (const s of [cfg.primaryTextPx, cfg.secondaryTextPx, cfg.numeralTextPx, cfg.statusTextPx]) {
      if (s === null) continue;
      assert.ok(s >= MIN.fontSizePx, `${band} renders ${s}px logical; floor is ${MIN.fontSizePx}`);
    }
  }
});

test('the status line is SMALLER than the secondary text, at every distance, and never under 14', () => {
  // The household's ask (2026-10): "that can just be smaller text ... so that it fits" — the
  // words stay, the size comes down one step. One step is `stepDown`, and the floor holds even
  // where secondary text is already AT the floor (fluent, near and desk), so there the status
  // is simply the same 14px rather than a size nobody can read.
  for (const [distance, scale] of [
    ['far', bandTypography],
    ['near', nearTypography],
    ['desk', deskTypography],
  ] as const) {
    for (const band of ALL_BANDS) {
      const cfg = scale[band];
      if (!cfg.showsText) {
        assert.equal(cfg.statusTextPx, null, `${distance} ${band}: no words, so no status size`);
        continue;
      }
      const status = cfg.statusTextPx;
      const secondary = cfg.secondaryTextPx;
      assert.ok(status !== null && secondary !== null, `${distance} ${band} reads words`);
      assert.ok(status >= MIN.fontSizePx, `${distance} ${band}: status ${status} under the floor`);
      assert.ok(
        status < secondary || secondary === MIN.fontSizePx,
        `${distance} ${band}: status ${status} must sit under secondary ${secondary}`,
      );
    }
  }
});

test('a routine step\'s natural picture and mark are never under the icon floor', () => {
  for (const band of ALL_BANDS) {
    const cfg = lookup(band);
    assert.ok(cfg.stepIconPx >= MIN.iconPx, `${band} step icon ${cfg.stepIconPx}`);
    assert.ok(cfg.stepMarkPx >= MIN.iconPx, `${band} step mark ${cfg.stepMarkPx}`);
  }
});

test('no band lowers the tap-target or icon floors', () => {
  for (const band of ALL_BANDS) {
    const cfg = lookup(band);
    assert.ok(cfg.minTapPx >= MIN.tapTargetPx, `${band} tap target ${cfg.minTapPx} < 64`);
    assert.ok(cfg.primaryIconPx >= MIN.iconPx, `${band} primary icon ${cfg.primaryIconPx} too small`);
    assert.ok(cfg.secondaryIconPx >= MIN.iconPx, `${band} secondary icon too small`);
    assert.ok(cfg.primaryIconPx >= cfg.secondaryIconPx, `${band} icon hierarchy inverted`);
  }
});

test('less literacy buys bigger targets and bigger pictures, not smaller ones', () => {
  // Fine motor control and reading arrive together, so the youngest band needs
  // BOTH the largest pictures and the most forgiving targets.  BAND_ORDER is
  // least-literate first; both scales must decrease along it.
  const tap = BAND_ORDER.map((b) => lookup(b).minTapPx);
  const icon = BAND_ORDER.map((b) => lookup(b).primaryIconPx);
  for (let i = 1; i < BAND_ORDER.length; i += 1) {
    const [pT, cT, pI, cI] = [tap[i - 1], tap[i], icon[i - 1], icon[i]];
    assert.ok(pT !== undefined && cT !== undefined && pI !== undefined && cI !== undefined);
    assert.ok(pT >= cT, `tap targets must not grow with literacy (rung ${i})`);
    assert.ok(pI >= cI, `icons must not grow with literacy (rung ${i})`);
  }
  assert.ok(
    bandTypography.picture.primaryIconPx > bandTypography.fluent.primaryIconPx,
    'the pre-reader must get the biggest picture on the wall',
  );
});

test('BAND_ORDER degrades toward pictures, matching the error boundary fallback', () => {
  // H2 Q3: RendererErrorBoundary falls back to the picture band, so a localised
  // crash degrades to something a pre-reader can still use.  Order encodes that.
  assert.equal(BAND_ORDER[0], 'picture');
});

test('child identity never rests on colour alone', () => {
  assert.equal(childAccents.length, MAX_DISTINCT_CHILDREN);
  const shapes = new Set(childAccents.map((a) => a.shape));
  const columns = new Set(childAccents.map((a) => a.column));
  const slots = new Set(childAccents.map((a) => a.slot));
  assert.equal(shapes.size, childAccents.length, 'each child needs a distinct shape');
  assert.equal(columns.size, childAccents.length, 'each child needs a distinct fixed column');
  assert.equal(slots.size, childAccents.length, 'slots must be unique');
  for (const a of childAccents) {
    assert.notEqual(a.solid, a.tint);
    assert.ok(a.minTextOnSolidPx >= 24, 'accent solids are ~4:1; only large type may sit on them');
  }
});

test('childAccentForSlot is total — a stray sortOrder never yields a blank card', () => {
  for (const slot of [-7, -1, 0, 1, 2, 3, 11, 4096]) {
    const accent = childAccentForSlot(slot);
    assert.ok(childAccents.includes(accent), `slot ${slot} resolved outside the ladder`);
  }
  assert.equal(childAccentForSlot(0), childAccents[0]);
  assert.equal(childAccentForSlot(MAX_DISTINCT_CHILDREN), childAccents[0], 'wraps, never throws');
});
