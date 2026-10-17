/**
 * Unit H — routine auto-fit: N steps and a pane in, step metrics (and a column count) out.
 *
 * The pane a routine sits in is fixed: whatever the child's screen leaves under the section
 * switch. So the steps fit by SHRINKING — padding, picture, type, a little each — and only past
 * the floors does the pane scroll. The floors are the two this wall never trades: a step is a
 * tap target (`tapPx.min`), and type is 14px or more.
 *
 * One column first, wherever one column holds the routine. Where it does not — felt's short
 * pane, where a four-step morning scrolled (2026-10-11) — the steps go into the fewest columns
 * that hold them, never narrower than a label's longest line (`fitRoutineGrid`, the second half
 * of this file).
 *
 * What the old step-grid test kept fixed still holds, by different means: in August the emergent
 * reader's fourth step was entirely invisible in a 312px pane, and in September three columns
 * cut her labels to five letters. Here a step is never narrower than the pane, and when the
 * steps cannot all fit at their floors the panel SAYS so (`scrolls`), draws the fold and keeps
 * the next step in view — nothing is cut silently.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  fitRoutineGrid,
  fitRoutineSteps,
  gridColumnPx,
  labelBlockPx,
  naturalRowPx,
  numeralThatFits,
  routinePanePx,
  sectionSwitchMetrics,
  STEP_EDGE_PX,
  STEP_GAP_PX,
  STEP_PAD_MAX_PX,
  STEP_PAD_MIN_PX,
  stepOrderPx,
  stepTimeFits,
  stepWidthPx,
  type RoutineGridFit,
  type RoutinePane,
  type RoutineStepFit,
  type StepNaturals,
  type StepOrder,
} from '../web/src/views/logic/routineFit.ts';
import { shellGeometry, WALL_LAYOUTS } from '../web/src/views/logic/theme.ts';
import {
  fontSizePx,
  iconPx,
  MIN,
  nearTypography,
  spacePx,
  strokePx,
  tapPx,
  type BandTypography,
} from '../web/src/design/tokens.ts';
import { WALL_THEMES } from '../src/types.ts';
import type { ReadingBand } from '../src/types.ts';

const BANDS: readonly ReadingBand[] = ['picture', 'emergent', 'fluent'];

/** What RoutinePanel hands the fit: the band's own natural sizes on a child's (near) screen. */
function naturalsFor(typo: BandTypography): StepNaturals {
  return { iconPx: typo.stepIconPx, markPx: typo.stepMarkPx, labelPx: typo.primaryTextPx, floorPx: tapPx.min };
}

/** The routine pane a band really gets in a theme: the shell's body less the switch and gap. */
function paneFor(band: ReadingBand, theme: (typeof WALL_THEMES)[number]): number {
  const body = shellGeometry(WALL_LAYOUTS[theme], false).body.height;
  return routinePanePx(body, nearTypography[band]);
}

/** Every invariant a fit must hold, whatever the inputs. */
function assertSane(fit: RoutineStepFit, n: StepNaturals, label: string): void {
  assert.ok(fit.rowPx >= tapPx.min, `${label}: row ${fit.rowPx} under the ${tapPx.min}px tap floor`);
  assert.ok(fit.rowPx <= naturalRowPx(n), `${label}: row ${fit.rowPx} over natural ${naturalRowPx(n)}`);
  assert.ok(fit.padPx >= STEP_PAD_MIN_PX && fit.padPx <= STEP_PAD_MAX_PX, `${label}: pad ${fit.padPx}`);
  // The content box, its padding and the heaviest edge a step wears all fit inside the row, so
  // the next-step ring and the confirm ring never make a row taller than its neighbours.
  assert.ok(
    2 * fit.padPx + fit.contentPx + 2 * STEP_EDGE_PX <= fit.rowPx,
    `${label}: ${fit.padPx}*2 + ${fit.contentPx} + ${STEP_EDGE_PX}*2 > row ${fit.rowPx}`,
  );
  assert.ok(fit.iconPx <= n.iconPx && fit.iconPx <= fit.contentPx, `${label}: icon ${fit.iconPx}`);
  assert.ok(fit.markPx <= n.markPx && fit.markPx <= fit.contentPx, `${label}: mark ${fit.markPx}`);
  assert.ok(fit.iconPx >= MIN.iconPx, `${label}: icon ${fit.iconPx} under the ${MIN.iconPx}px floor`);
  assert.ok(fit.markPx >= MIN.iconPx, `${label}: mark ${fit.markPx} under the ${MIN.iconPx}px floor`);
  if (n.labelPx === null) {
    assert.equal(fit.labelPx, null, `${label}: the picture band never gains words`);
  } else {
    assert.ok(fit.labelPx !== null && fit.labelPx >= MIN.fontSizePx, `${label}: label ${String(fit.labelPx)}`);
    assert.ok(fit.labelPx <= n.labelPx, `${label}: a label never grows past its natural size`);
    assert.ok(
      (Object.values(fontSizePx) as number[]).includes(fit.labelPx),
      `${label}: ${fit.labelPx} is not a size on the type scale`,
    );
  }
}

/** What n steps of this fit take up, gutters included. */
function columnPx(fit: RoutineStepFit, steps: number): number {
  return steps * fit.rowPx + (steps - 1) * STEP_GAP_PX;
}

// ---------------------------------------------------------------------------
// The panes, from the shells
// ---------------------------------------------------------------------------

test('the switch is capped at the face size, so the pre-reader\'s is 108 and not 140', () => {
  // Uncapped, the picture band's 96px secondary icon made a 140px switch over a 196px routine.
  assert.deepEqual(sectionSwitchMetrics(nearTypography.picture), { iconPx: 64, ringPx: 80, heightPx: 108 });
  assert.deepEqual(sectionSwitchMetrics(nearTypography.emergent), { iconPx: 48, ringPx: 64, heightPx: 92 });
  assert.deepEqual(sectionSwitchMetrics(nearTypography.fluent), { iconPx: 32, ringPx: 48, heightPx: 76 });
  for (const band of BANDS) {
    assert.ok(sectionSwitchMetrics(nearTypography[band]).heightPx >= nearTypography[band].minTapPx);
  }
});

test('the routine pane per band and theme: felt is shorter, the side shell is the old pane', () => {
  const panes = Object.fromEntries(
    BANDS.map((band) => [band, Object.fromEntries(WALL_THEMES.map((t) => [t, paneFor(band, t)]))]),
  );
  assert.deepEqual(panes, {
    picture: { felt: 224, gallery: 288, storybook: 288 },
    emergent: { felt: 240, gallery: 304, storybook: 304 },
    fluent: { felt: 256, gallery: 320, storybook: 320 },
  });
});

// ---------------------------------------------------------------------------
// 3, 4, 6, 8 and 12 steps, in every real pane
// ---------------------------------------------------------------------------

const COUNTS = [3, 4, 6, 8, 12] as const;

test('3, 4, 6, 8 and 12 steps: every fit holds the floors, in every band and theme', () => {
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      const pane = paneFor(band, theme);
      for (const steps of COUNTS) {
        const fit = fitRoutineSteps(steps, pane, n);
        const label = `${band}/${theme}/${steps} steps in ${pane}`;
        assertSane(fit, n, label);
        // It scrolls exactly when the column does not fit, and only ever AT the floor: a
        // scrolling list whose rows could still have shrunk is the fit giving up early.
        assert.equal(fit.scrolls, columnPx(fit, steps) > pane, `${label}: scrolls`);
        if (fit.scrolls) assert.equal(fit.rowPx, tapPx.min, `${label}: scrolled above the floor`);
      }
    }
  }
});

test('more steps never makes any step bigger', () => {
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      const pane = paneFor(band, theme);
      let was: RoutineStepFit | null = null;
      for (let steps = 1; steps <= 12; steps += 1) {
        const fit = fitRoutineSteps(steps, pane, n);
        if (was !== null) {
          const label = `${band}/${theme}: ${steps - 1} -> ${steps} steps`;
          for (const k of ['rowPx', 'padPx', 'contentPx', 'iconPx', 'markPx'] as const) {
            assert.ok(fit[k] <= was[k], `${label}: ${k} grew ${was[k]} -> ${fit[k]}`);
          }
          if (fit.labelPx !== null && was.labelPx !== null) {
            assert.ok(fit.labelPx <= was.labelPx, `${label}: label grew`);
          }
        }
        was = fit;
      }
    }
  }
});

test('the exact sizes at 3, 4, 6, 8 and 12 steps — the table the report quotes', () => {
  // [rowPx, iconPx, labelPx, scrolls] per count, felt and the side shell. Pinned so a change to
  // a natural size or a floor is a visible diff here rather than a surprise on the glass.
  const expect: Record<ReadingBand, Record<'felt' | 'side', readonly (readonly [number, number, number | null, boolean])[]>> = {
    picture: {
      felt: [[64, 44, null, false], [64, 44, null, true], [64, 44, null, true], [64, 44, null, true], [64, 44, null, true]],
      side: [[85, 62, null, false], [64, 44, null, true], [64, 44, null, true], [64, 44, null, true], [64, 44, null, true]],
    },
    emergent: {
      felt: [[69, 48, 17, false], [64, 44, 17, true], [64, 44, 17, true], [64, 44, 17, true], [64, 44, 17, true]],
      side: [[90, 66, 20, false], [64, 44, 17, false], [64, 44, 17, true], [64, 44, 17, true], [64, 44, 17, true]],
    },
    fluent: {
      felt: [[74, 32, 17, false], [64, 32, 17, true], [64, 32, 17, true], [64, 32, 17, true], [64, 32, 17, true]],
      side: [[78, 32, 20, false], [68, 32, 17, false], [64, 32, 17, true], [64, 32, 17, true], [64, 32, 17, true]],
    },
  };
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const [shell, theme] of [['felt', 'felt'], ['side', 'gallery']] as const) {
      const got = COUNTS.map((steps) => {
        const f = fitRoutineSteps(steps, paneFor(band, theme), n);
        return [f.rowPx, f.iconPx, f.labelPx, f.scrolls] as const;
      });
      assert.deepEqual(got, expect[band][shell], `${band} in the ${shell} shell`);
    }
  }
});

test('the pre-reader\'s three steps fit unscrolled in every theme', () => {
  // Three is her real routine (2026-09-06). She cannot read a fold, so for her it must not exist.
  const n = naturalsFor(nearTypography.picture);
  for (const theme of WALL_THEMES) {
    const fit = fitRoutineSteps(3, paneFor('picture', theme), n);
    assert.equal(fit.scrolls, false, theme);
  }
});

// ---------------------------------------------------------------------------
// The arithmetic itself, swept
// ---------------------------------------------------------------------------

test('swept: any count in any pane holds every invariant', () => {
  const shapes: readonly StepNaturals[] = [
    ...BANDS.map((b) => naturalsFor(nearTypography[b])),
    // Content that already fits the floor row never shrinks; a giant icon shrinks the most.
    { iconPx: iconPx.xs, markPx: iconPx.xs, labelPx: fontSizePx.meta, floorPx: tapPx.min },
    { iconPx: iconPx.hero, markPx: iconPx.lg, labelPx: fontSizePx.display, floorPx: tapPx.min },
    // A floor below the tap minimum is raised to it — the fit cannot be talked under 64.
    { iconPx: iconPx.md, markPx: iconPx.sm, labelPx: fontSizePx.body, floorPx: 10 },
  ];
  for (const n of shapes) {
    for (let pane = 40; pane <= 640; pane += 7) {
      for (let steps = 1; steps <= 20; steps += 1) {
        const fit = fitRoutineSteps(steps, pane, n);
        const label = `${JSON.stringify(n)} ${steps} in ${pane}`;
        assertSane(fit, n, label);
        assert.equal(fit.scrolls, columnPx(fit, steps) > pane, `${label}: scrolls`);
      }
    }
  }
});

test('a step with room is drawn at its natural size, with the full padding', () => {
  const n = naturalsFor(nearTypography.emergent);
  const fit = fitRoutineSteps(1, 1000, n);
  assert.equal(fit.rowPx, naturalRowPx(n));
  assert.equal(fit.padPx, STEP_PAD_MAX_PX);
  assert.equal(fit.iconPx, n.iconPx);
  assert.equal(fit.markPx, n.markPx);
  assert.equal(fit.labelPx, n.labelPx);
  assert.equal(fit.scrolls, false);
});

test('a label shrinks one type step at a time, and to a size whose two lines fit', () => {
  const n = naturalsFor(nearTypography.fluent);
  for (let pane = 64; pane <= 400; pane += 1) {
    const fit = fitRoutineSteps(1, pane, n);
    assert.ok(fit.labelPx !== null);
    // At the 14px floor the block may be the only thing too tall; above it, it always fits.
    if (fit.labelPx > MIN.fontSizePx) assert.ok(labelBlockPx(fit.labelPx) <= fit.contentPx, `pane ${pane}`);
  }
});

test('a step numeral keeps its size while its line fits, steps down the scale, and stops at 14', () => {
  // The storybook numeral, emergent's 40 near and 54 far, in rows from natural down to the floor.
  assert.equal(numeralThatFits(fontSizePx.display, 96), fontSizePx.display); // 68px line in 96
  assert.equal(numeralThatFits(fontSizePx.display, 52), fontSizePx.sectionTitle); // 50 in 52
  assert.equal(numeralThatFits(fontSizePx.sectionTitle, 44), fontSizePx.cardTitle); // 38 in 44
  // Never larger than asked, even with room to spare.
  assert.equal(numeralThatFits(fontSizePx.cardTitle, 400), fontSizePx.cardTitle);
  // Nothing fits: the floor, never under it.
  assert.equal(numeralThatFits(fontSizePx.display, 10), MIN.fontSizePx);
  // Swept: always on the scale or the natural size, never over natural, never under 14,
  // and whenever it is above the floor its one line fits.
  for (const natural of [fontSizePx.cardTitle, fontSizePx.sectionTitle, fontSizePx.display]) {
    let last = Number.POSITIVE_INFINITY;
    for (let content = 200; content >= 0; content -= 1) {
      const s = numeralThatFits(natural, content);
      assert.ok(s <= natural && s >= MIN.fontSizePx, `${natural} in ${content}: ${s}`);
      assert.ok(s <= last, `${natural}: grew from ${last} to ${s} as the row shrank to ${content}`);
      if (s > MIN.fontSizePx) assert.ok(Math.ceil(s * 1.25) <= content, `${natural} in ${content}: ${s}`);
      last = s;
    }
  }
});

test('an unmeasured pane, or a nonsense count, is drawn at natural size and never scrolls', () => {
  // The first frame, before the panel has measured, must not be drawn squeezed for want of a number.
  const n = naturalsFor(nearTypography.picture);
  const natural = fitRoutineSteps(1, 10_000, n);
  for (const [steps, pane] of [
    [3, Number.NaN],
    [3, 0],
    [3, -50],
    [3, Number.POSITIVE_INFINITY],
    [0, 300],
    [-2, 300],
    [Number.NaN, 300],
  ] as const) {
    assert.deepEqual(fitRoutineSteps(steps, pane, n), natural, `${steps} steps in ${pane}`);
  }
});

test('a fractional count is whole steps — 3.7 steps lay out as 3', () => {
  const n = naturalsFor(nearTypography.emergent);
  assert.deepEqual(fitRoutineSteps(3.7, 240, n), fitRoutineSteps(3, 240, n));
});

// ---------------------------------------------------------------------------
// The words still fit across — the half the old grid test was really about
// ---------------------------------------------------------------------------

/**
 * "Put your shoes", the widest line of the household's longest step, at 0.60em a character
 * (bold Nunito, measured on the panel 2026-09-13) — 0.65 here, because Fredoka, felt's face, is
 * the widest of the three faces the themes ship.
 */
const LONGEST_LINE_CHARS = 14;
const EM_PER_CHAR = 0.65;

test('in the narrowest body a theme draws, a step\'s label has room for its longest line', () => {
  for (const band of ['emergent', 'fluent'] as const) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      const width = shellGeometry(WALL_LAYOUTS[theme], false).body.width;
      const fit = fitRoutineSteps(5, paneFor(band, theme), n);
      assert.ok(fit.labelPx !== null);
      // A step is a row: [numeral] icon, label, mark — sm gaps, xs padding, focus edges.
      const fixed =
        2 * STEP_PAD_MAX_PX +
        2 * strokePx.focus +
        fit.iconPx +
        fit.markPx +
        3 * spacePx.sm +
        (WALL_LAYOUTS[theme].numberedSteps ? spacePx.xl : 0);
      const room = width - fixed;
      const need = Math.ceil(LONGEST_LINE_CHARS * EM_PER_CHAR * n.labelPx!);
      assert.ok(room >= need, `${band}/${theme}: ${room}px for a ${need}px line`);
    }
  }
});

test('"Waiting for a grown-up" fits the narrowest chore card at the status size, untruncated', () => {
  // The household's words, not reworded: the status line has its own smaller step instead.
  // The narrowest card is felt's, two across a 912px body. Its status row is
  // [status][points][mark], with the card's padding and its two edges (focus on the stripe
  // side, focus again when "Still time" thickens the other).
  const status = nearTypography.fluent.statusTextPx;
  const secondary = nearTypography.fluent.secondaryTextPx;
  assert.ok(status !== null && secondary !== null);
  const body = shellGeometry(WALL_LAYOUTS.felt, false).body.width;
  const card = (body - spacePx.tapGap) / 2;
  const points = Math.ceil('10 points'.length * EM_PER_CHAR * secondary);
  const room = card - 2 * spacePx.xs - 2 * strokePx.focus - points - iconPx.sm - 2 * spacePx.sm;
  const need = Math.ceil('Waiting for a grown-up'.length * EM_PER_CHAR * status);
  assert.ok(room >= need, `${room}px for "Waiting for a grown-up" at ${status}px (${need}px)`);
});

// ---------------------------------------------------------------------------
// When one column cannot hold the routine: columns (2026-10-11)
// ---------------------------------------------------------------------------

/** The pane RoutinePanel hands the grid fit: the measured height, and the shell body's width. */
function gridPaneFor(band: ReadingBand, theme: (typeof WALL_THEMES)[number]): RoutinePane {
  return { heightPx: paneFor(band, theme), widthPx: shellGeometry(WALL_LAYOUTS[theme], false).body.width };
}

/** The order mark RoutinePanel charges: only where the theme numbers its steps. */
function orderFor(band: ReadingBand, theme: (typeof WALL_THEMES)[number]): StepOrder | null {
  const t = nearTypography[band];
  return WALL_LAYOUTS[theme].numberedSteps ? { numeralPx: t.numeralTextPx, maxPips: t.maxPips } : null;
}

/** What the grid's rows take up, gutters included. */
function gridHeightPx(fit: RoutineGridFit): number {
  return columnPx(fit, fit.rows);
}

/** One column's width at this many columns: the pane less the inert gutters between them. */
function cellPx(pane: RoutinePane, columns: number): number {
  return (pane.widthPx - (columns - 1) * STEP_GAP_PX) / columns;
}

/**
 * The width a step needs, worked out HERE rather than through `stepWidthPx`: the row's parts as
 * the bands draw them — [order] [mark] picture [label] — `sm` apart, inside the padding and the
 * focus edge. The label is the longest line at the fitted size; the order slot is the band's
 * numeral (never under the 32px slot the bands reserve) or its pips.
 */
function neededPx(fit: RoutineStepFit, band: ReadingBand, order: StepOrder | null, steps: number): number {
  let orderSlot = 0;
  if (order !== null) {
    if (band === 'emergent' || band === 'fluent') {
      const numeral = numeralThatFits(order.numeralPx ?? fontSizePx.sectionTitle, fit.contentPx);
      orderSlot = Math.max(spacePx.xl, Math.ceil(String(steps).length * EM_PER_CHAR * numeral));
    } else {
      const marks = Math.min(steps, order.maxPips) + (steps > order.maxPips ? 1 : 0);
      orderSlot = marks * iconPx.sm + (marks - 1) * spacePx.xxs;
    }
  }
  const label = fit.labelPx === null ? 0 : Math.ceil(LONGEST_LINE_CHARS * EM_PER_CHAR * fit.labelPx);
  const parts = [orderSlot, fit.markPx, fit.iconPx, label].filter((w) => w > 0);
  return 2 * strokePx.focus + 2 * fit.padPx + parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * spacePx.sm;
}

test('felt: 4, 6 and 8 steps fit without scrolling, in every band, at the floors or above', () => {
  // The household, 2026-10-11: "people add more, they just shrink a little, but the window
  // stays the same size." Felt's one column holds three steps, so four scrolled.
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    const pane = gridPaneFor(band, 'felt');
    for (const steps of [4, 6, 8]) {
      const fit = fitRoutineGrid(steps, pane, n, orderFor(band, 'felt'));
      const label = `${band}/felt/${steps} steps`;
      assertSane(fit, n, label);
      assert.equal(fit.scrolls, false, `${label}: scrolls (${fit.columns}x${fit.rows})`);
      assert.ok(gridHeightPx(fit) <= pane.heightPx, `${label}: ${gridHeightPx(fit)} tall in ${pane.heightPx}`);
      assert.ok(fit.columns * fit.rows >= steps, `${label}: ${fit.columns}x${fit.rows} cannot hold them`);
      // Before this, one column of the same steps scrolled: the grid is what fixed it.
      assert.equal(fitRoutineSteps(steps, pane.heightPx, n).scrolls, true, `${label}: one column already fit`);
    }
  }
});

test('the grid, per band and theme at 3, 4, 6, 8 and 12 steps — the table the report quotes', () => {
  // [columns, rows, rowPx, iconPx, labelPx, scrolls]. Felt and gallery (the side shell, unnumbered)
  // and storybook (the side shell with its order mark charged to every step's width).
  type Row = readonly [number, number, number, number, number | null, boolean];
  const expect: Record<ReadingBand, Record<'felt' | 'gallery' | 'storybook', readonly Row[]>> = {
    picture: {
      felt: [[1, 3, 64, 44, null, false], [2, 2, 104, 78, null, false], [2, 3, 64, 44, null, false], [3, 3, 64, 44, null, false], [4, 3, 64, 44, null, false]],
      gallery: [[1, 3, 85, 62, null, false], [2, 2, 124, 96, null, false], [2, 3, 85, 62, null, false], [3, 3, 85, 62, null, false], [4, 3, 85, 62, null, false]],
      // Six pips and the "lots" mark are 212px a step, so storybook's pre-reader stops at two across.
      storybook: [[1, 3, 85, 62, null, false], [2, 2, 124, 96, null, false], [2, 3, 85, 62, null, false], [2, 4, 64, 44, null, true], [2, 6, 64, 44, null, true]],
    },
    emergent: {
      felt: [[1, 3, 69, 48, 17, false], [2, 2, 112, 85, 20, false], [2, 3, 69, 48, 17, false], [3, 3, 69, 48, 17, false], [3, 4, 64, 44, 17, true]],
      gallery: [[1, 3, 90, 66, 20, false], [1, 4, 64, 44, 17, false], [2, 3, 90, 66, 20, false], [2, 4, 64, 44, 17, false], [2, 6, 64, 44, 17, true]],
      storybook: [[1, 3, 90, 66, 20, false], [1, 4, 64, 44, 17, false], [2, 3, 90, 66, 20, false], [2, 4, 64, 44, 17, false], [2, 6, 64, 44, 17, true]],
    },
    fluent: {
      felt: [[1, 3, 74, 32, 17, false], [2, 2, 78, 32, 20, false], [2, 3, 74, 32, 17, false], [3, 3, 74, 32, 17, false], [3, 4, 64, 32, 17, true]],
      gallery: [[1, 3, 78, 32, 20, false], [1, 4, 68, 32, 17, false], [2, 3, 78, 32, 20, false], [2, 4, 68, 32, 17, false], [2, 6, 64, 32, 17, true]],
      storybook: [[1, 3, 78, 32, 20, false], [1, 4, 68, 32, 17, false], [2, 3, 78, 32, 20, false], [2, 4, 68, 32, 17, false], [2, 6, 64, 32, 17, true]],
    },
  };
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      const got = COUNTS.map((steps) => {
        const f = fitRoutineGrid(steps, gridPaneFor(band, theme), n, orderFor(band, theme));
        return [f.columns, f.rows, f.rowPx, f.iconPx, f.labelPx, f.scrolls] as const;
      });
      assert.deepEqual(got, expect[band][theme], `${band} in ${theme}`);
    }
  }
});

test('one column wherever one column holds the routine — the grid is never a first choice', () => {
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      const pane = gridPaneFor(band, theme);
      for (let steps = 1; steps <= 12; steps += 1) {
        const one = fitRoutineSteps(steps, pane.heightPx, n);
        const grid = fitRoutineGrid(steps, pane, n, orderFor(band, theme));
        const label = `${band}/${theme}/${steps}`;
        if (!one.scrolls) {
          assert.deepEqual(grid, { ...one, columns: 1, rows: steps }, `${label}: a column that fits was split`);
        } else {
          // Gallery and storybook fit at least as well as the column did: a grid only ever adds
          // room, so no step in it is smaller than the one column's.
          assert.ok(grid.rowPx >= one.rowPx && grid.iconPx >= one.iconPx, `${label}: the grid is smaller`);
          if (grid.labelPx !== null && one.labelPx !== null) {
            assert.ok(grid.labelPx >= one.labelPx, `${label}: the grid's label is smaller`);
          }
          // It scrolls exactly when its rows overflow, and only at the floor.
          assert.equal(grid.scrolls, gridHeightPx(grid) > pane.heightPx, `${label}: scrolls`);
          if (grid.scrolls) assert.equal(grid.rowPx, tapPx.min, `${label}: scrolled above the floor`);
        }
      }
    }
  }
});

test('the FEWEST columns that hold the steps: one fewer would overflow or cut a word', () => {
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      const pane = gridPaneFor(band, theme);
      const order = orderFor(band, theme);
      for (let steps = 2; steps <= 12; steps += 1) {
        const grid = fitRoutineGrid(steps, pane, n, order);
        if (grid.columns < 2 || grid.scrolls) continue;
        const fewer = grid.columns - 1;
        const rows = Math.ceil(steps / fewer);
        // The biggest unscrolled step those rows allow — and even at the floor row, is it too wide?
        const tall = fitRoutineSteps(rows, pane.heightPx, n);
        const floor = fitRoutineSteps(rows, rows * tapPx.min + (rows - 1) * STEP_GAP_PX, n);
        const overflows = tall.scrolls;
        const tooWide = neededPx(floor, band, order, steps) > cellPx(pane, fewer);
        assert.ok(overflows || tooWide, `${band}/${theme}/${steps}: ${fewer} columns would have held them`);
      }
    }
  }
});

test('every column of a grid has room for the step\'s longest line, its order mark and its picture', () => {
  // The half of the old grid that was wrong: three columns cut the reader's labels to five
  // letters. Worked out independently of `stepWidthPx`, for every count a routine might have.
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      const pane = gridPaneFor(band, theme);
      const order = orderFor(band, theme);
      for (let steps = 1; steps <= 16; steps += 1) {
        const grid = fitRoutineGrid(steps, pane, n, order);
        if (grid.columns === 1) continue;
        const need = neededPx(grid, band, order, steps);
        const room = cellPx(pane, grid.columns);
        assert.ok(need <= room, `${band}/${theme}/${steps}: ${need}px of step in a ${room}px column`);
        // And the module's own arithmetic agrees with this one.
        assert.equal(stepWidthPx(grid, stepOrderPx(order, steps, grid.contentPx)), need, `${band}/${theme}/${steps}`);
      }
    }
  }
});

test('within one column count, more steps never makes a step bigger', () => {
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      const pane = gridPaneFor(band, theme);
      let was: RoutineGridFit | null = null;
      for (let steps = 1; steps <= 16; steps += 1) {
        const fit = fitRoutineGrid(steps, pane, n, orderFor(band, theme));
        if (was !== null && was.columns === fit.columns) {
          const label = `${band}/${theme}: ${steps - 1} -> ${steps} steps in ${fit.columns} columns`;
          for (const k of ['rowPx', 'iconPx', 'markPx'] as const) {
            assert.ok(fit[k] <= was[k], `${label}: ${k} grew ${was[k]} -> ${fit[k]}`);
          }
        }
        // And the column count itself never goes DOWN as steps are added.
        if (was !== null) assert.ok(fit.columns >= was.columns, `${band}/${theme}: ${steps} steps lost a column`);
        was = fit;
      }
    }
  }
});

test('a grid fills across and then down, with no empty row', () => {
  for (const band of BANDS) {
    const n = naturalsFor(nearTypography[band]);
    for (const theme of WALL_THEMES) {
      for (let steps = 1; steps <= 16; steps += 1) {
        const fit = fitRoutineGrid(steps, gridPaneFor(band, theme), n, orderFor(band, theme));
        assert.ok(fit.columns >= 1 && fit.columns <= steps, `${band}/${theme}/${steps}: ${fit.columns} columns`);
        assert.equal(fit.rows, Math.ceil(steps / fit.columns), `${band}/${theme}/${steps}: rows`);
        assert.ok(fit.columns * (fit.rows - 1) < steps, `${band}/${theme}/${steps}: an empty last row`);
      }
    }
  }
});

test('swept: any count in any pane holds every invariant, in columns too', () => {
  const shapes: readonly (readonly [StepNaturals, StepOrder | null, ReadingBand])[] = [
    ...BANDS.map((b) => [naturalsFor(nearTypography[b]), null, b] as const),
    ...BANDS.map(
      (b) => [naturalsFor(nearTypography[b]), { numeralPx: nearTypography[b].numeralTextPx, maxPips: nearTypography[b].maxPips }, b] as const,
    ),
  ];
  for (const [n, order, band] of shapes) {
    for (const width of [180, 320, 480, 640, 816, 912, 1200]) {
      for (let height = 40; height <= 640; height += 23) {
        for (let steps = 1; steps <= 16; steps += 1) {
          const pane = { heightPx: height, widthPx: width };
          const fit = fitRoutineGrid(steps, pane, n, order);
          const label = `${band} ${order === null ? '' : 'numbered '}${steps} in ${width}x${height}`;
          assertSane(fit, n, label);
          assert.equal(fit.scrolls, gridHeightPx(fit) > height, `${label}: scrolls`);
          if (fit.columns > 1) {
            assert.ok(neededPx(fit, band, order, steps) <= cellPx(pane, fit.columns), `${label}: too narrow`);
          }
        }
      }
    }
  }
});

test('an unmeasured pane, or a nonsense count, is ONE column — never split for want of a number', () => {
  const n = naturalsFor(nearTypography.emergent);
  const natural = fitRoutineSteps(1, 10_000, n);
  // No height yet: natural size, one column, unscrolled, whatever the width.
  for (const height of [Number.NaN, 0, -1]) {
    assert.deepEqual(fitRoutineGrid(8, { heightPx: height, widthPx: 912 }, n), { ...natural, columns: 1, rows: 8 });
  }
  // A height but no width: one column at what the height allows — it may scroll, it is not split.
  for (const width of [Number.NaN, 0, -1, Number.POSITIVE_INFINITY]) {
    const fit = fitRoutineGrid(8, { heightPx: 240, widthPx: width }, n);
    assert.deepEqual(fit, { ...fitRoutineSteps(8, 240, n), columns: 1, rows: 8 }, `width ${width}`);
  }
  // A count that is not a count: the natural single column with no rows.
  for (const steps of [0, -2, Number.NaN]) {
    assert.deepEqual(fitRoutineGrid(steps, { heightPx: 240, widthPx: 912 }, n), { ...natural, columns: 1, rows: 0 });
  }
  // A fractional count is whole steps.
  assert.deepEqual(
    fitRoutineGrid(5.7, { heightPx: 240, widthPx: 912 }, n),
    fitRoutineGrid(5, { heightPx: 240, widthPx: 912 }, n),
  );
});

test('a column too narrow for even one step\'s longest line keeps the single column, and scrolls', () => {
  // 300px cannot hold two reader steps side by side at any row height: the fit must not cut
  // words to avoid a fold. The single column scrolls, with the fold drawn, as before.
  const n = naturalsFor(nearTypography.emergent);
  const fit = fitRoutineGrid(8, { heightPx: 240, widthPx: 300 }, n);
  assert.equal(fit.columns, 1);
  assert.equal(fit.scrolls, true);
  assert.equal(fit.rowPx, tapPx.min);
});

test('a done step\'s time is drawn where its column has room for it, and dropped — never the label — where not', () => {
  // The fluent band draws "7:02 AM" after a done step's label. It is not charged when the grid
  // is chosen, so a narrow column must give it up rather than squeeze the label.
  const typo = nearTypography.fluent;
  const n = naturalsFor(typo);
  const timeFor = (theme: (typeof WALL_THEMES)[number], steps: number): boolean => {
    const pane = gridPaneFor('fluent', theme);
    const order = orderFor('fluent', theme);
    const fit = fitRoutineGrid(steps, pane, n, order);
    return stepTimeFits(fit, gridColumnPx(pane.widthPx, fit.columns), stepOrderPx(order, steps, fit.contentPx), typo.statusTextPx);
  };
  // One column, either shell: always room.
  for (const theme of WALL_THEMES) assert.equal(timeFor(theme, 3), true, `${theme}: 3 steps`);
  // Felt two across (4 and 6 steps) has room; three across (8) does not.
  assert.equal(timeFor('felt', 4), true);
  assert.equal(timeFor('felt', 6), true);
  assert.equal(timeFor('felt', 8), false);
  // Whenever the time IS drawn, label + time fit the column (worked out here, not by the module).
  for (const theme of WALL_THEMES) {
    const pane = gridPaneFor('fluent', theme);
    const order = orderFor('fluent', theme);
    for (let steps = 1; steps <= 12; steps += 1) {
      const fit = fitRoutineGrid(steps, pane, n, order);
      const cell = cellPx(pane, fit.columns);
      if (!stepTimeFits(fit, cell, stepOrderPx(order, steps, fit.contentPx), typo.statusTextPx)) continue;
      const time = Math.ceil('12:59 PM'.length * EM_PER_CHAR * (typo.statusTextPx ?? 0));
      assert.ok(neededPx(fit, 'fluent', order, steps) + spacePx.sm + time <= cell, `${theme}/${steps}`);
    }
  }
  // No status size (the picture band), no time; an unmeasured column, room as before.
  const fit = fitRoutineSteps(3, 300, n);
  assert.equal(stepTimeFits(fit, 912, 0, null), false);
  assert.equal(stepTimeFits(fit, Number.NaN, 0, typo.statusTextPx), true);
  assert.equal(gridColumnPx(912, 3), (912 - 2 * STEP_GAP_PX) / 3);
  assert.equal(gridColumnPx(912, 0), 912, 'a nonsense column count is one column');
});
