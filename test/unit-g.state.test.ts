/**
 * Unit G acceptance, part 3: state is carried by FORM first and colour second.
 *
 * Colour is the weakest channel a 225-nit anti-glare panel has, and the two
 * states a child most needs to tell apart — "waiting for a grown-up" and "done" —
 * are amber and green, which is exactly the pair a deuteranope cannot separate.
 * So every state also carries a distinct glyph and a distinct fill treatment, and
 * that redundancy is asserted here rather than trusted.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { WALL_THEMES, type ChoreState, type MaterializationStatus } from '../src/types.ts';
import {
  freshnessColour,
  freshnessColourFor,
  MIN,
  stateTreatments,
  stateTreatmentsFor,
  type StateTreatment,
} from '../web/src/design/tokens.ts';

const ALL_STATES: readonly ChoreState[] = ['pending', 'claimed', 'approved', 'superseded'];
const ALL_FRESHNESS: readonly MaterializationStatus[] = ['ok', 'stale', 'error'];

function lookup(state: ChoreState): StateTreatment {
  switch (state) {
    case 'pending':
      return stateTreatments.pending;
    case 'claimed':
      return stateTreatments.claimed;
    case 'approved':
      return stateTreatments.approved;
    case 'superseded':
      return stateTreatments.superseded;
    default: {
      const unreachable: never = state;
      throw new Error(`no treatment for chore state ${String(unreachable)}`);
    }
  }
}

test('every ChoreState has a treatment', () => {
  assert.deepEqual(Object.keys(stateTreatments).sort(), [...ALL_STATES].sort());
  for (const s of ALL_STATES) assert.equal(lookup(s).state, s);
});

test('no state is signalled by colour alone', () => {
  const glyphs = new Set(ALL_STATES.map((s) => lookup(s).glyph));
  assert.equal(glyphs.size, ALL_STATES.length, 'each state needs its own glyph');

  for (const s of ALL_STATES) {
    assert.equal(lookup(s).requiresIcon, true, `${s} must force its renderer to draw a glyph`);
  }

  // Redundancy check: for every pair, at least one NON-colour channel differs.
  for (const a of ALL_STATES) {
    for (const b of ALL_STATES) {
      if (a >= b) continue;
      const x = lookup(a);
      const y = lookup(b);
      const differs =
        x.glyph !== y.glyph || x.fillRole !== y.fillRole || x.opacity !== y.opacity;
      assert.ok(differs, `${a} and ${b} differ only in hue — a dichromat sees one state`);
    }
  }
});

test('done is the loudest thing on the wall', () => {
  // A light green tint beside a light amber tint is the deuteranope trap; the
  // approved card is a solid fill with inverse ink instead.
  assert.equal(stateTreatments.approved.fillRole, 'solid');
  assert.equal(stateTreatments.approved.glyph, 'check');
  assert.notEqual(stateTreatments.approved.ink, stateTreatments.claimed.ink);
  // The renderer holds var() strings, which differ by NAME; the hex is what reaches the glass.
  for (const theme of WALL_THEMES) {
    const t = stateTreatmentsFor(theme);
    assert.notEqual(t.approved.ink, t.claimed.ink, `${theme}: done and waiting share an ink`);
  }
});

test('superseded recedes by opacity, not by an ambiguous fifth hue', () => {
  const v = stateTreatments.superseded;
  assert.ok(v.opacity < 1, 'superseded must dim');
  assert.ok(v.opacity >= 0.6, `composited ink at ${v.opacity} would drop below readable`);
  for (const s of ['pending', 'claimed', 'approved'] as const) {
    assert.equal(stateTreatments[s].opacity, 1, `${s} must not be dimmed`);
  }
});

test('every state edge is at least the minimum stroke weight', () => {
  for (const s of ALL_STATES) {
    const t = lookup(s);
    assert.ok(t.edgeWidthPx >= MIN.strokePx, `${s} edge is ${t.edgeWidthPx}px logical`);
    assert.ok(t.opacity > 0 && t.opacity <= 1, `${s} opacity out of range`);
  }
});

test('freshness maps onto the state ladder for every MaterializationStatus', () => {
  assert.deepEqual(Object.keys(freshnessColour).sort(), [...ALL_FRESHNESS].sort());
  const distinct = new Set(ALL_FRESHNESS.map((f) => freshnessColour[f]));
  assert.equal(distinct.size, ALL_FRESHNESS.length, 'stale must not look like ok');
  // Distinct token NAMES can still resolve to one hex in a theme; check what is painted.
  for (const theme of WALL_THEMES) {
    const painted = freshnessColourFor(theme);
    const hexes = new Set(ALL_FRESHNESS.map((f) => painted[f]));
    assert.equal(hexes.size, ALL_FRESHNESS.length, `${theme}: stale must not look like ok`);
  }
});

test('a theme changes colours, never the form that carries a state', () => {
  // Glyph, fill role, opacity and edge weight are the channels a dichromat reads; a theme that
  // moved any of them would make "done" a different SHAPE on Tuesday than on Monday.
  for (const theme of WALL_THEMES) {
    const t = stateTreatmentsFor(theme);
    for (const s of ALL_STATES) {
      const base = lookup(s);
      assert.equal(t[s].glyph, base.glyph, `${theme} ${s} glyph`);
      assert.equal(t[s].fillRole, base.fillRole, `${theme} ${s} fill role`);
      assert.equal(t[s].opacity, base.opacity, `${theme} ${s} opacity`);
      assert.equal(t[s].edgeWidthPx, base.edgeWidthPx, `${theme} ${s} edge width`);
    }
  }
});
