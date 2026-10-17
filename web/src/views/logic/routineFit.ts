/**
 * Routine auto-fit: how many steps, how tall the pane, and therefore how big each step is.
 *
 * The routine pane is a FIXED box — whatever the child's screen has left under the section
 * switch — and a routine is a column of steps in it, in order (or a few columns, below). As
 * steps are added, each one gives a little back: the padding first, then the picture, then the
 * type. Only when a step is down to its floors does the pane stop shrinking them and start to
 * scroll (`ScrollColumn` draws the fold, and `RoutinePanel` keeps the next step in view).
 *
 * The floors are the two this wall never trades:
 *
 *   - **A step is a tap target**, so a row never goes under `tapPx.min` (64). Motor skill, not
 *     eyesight: a three-year-old's finger is no more precise because the list got longer.
 *   - **Type never goes under 14px** (`MIN.fontSizePx`), and it only ever moves along the type
 *     scale, one step at a time, so "smaller" means a size the design system already has.
 *
 * ## And when one column cannot hold it, columns (2026-10-11)
 *
 * One column is the first answer, because it keeps the order where a child's eye already is.
 * But felt's pane is 224-256px, and a 64px row plus its 16px gutter is 80: three steps is all
 * one column holds there, so a four-step morning SCROLLED — and the household's words for what
 * they wanted were *"people add more, they just shrink a little, but the window stays the same
 * size."* So when one column would scroll, the steps go into the FEWEST columns that hold them
 * (`fitRoutineGrid`), left to right and then down, the way a page is read — and only when no
 * column count holds them does the grid scroll, at its floors, exactly as the column did.
 *
 * A column is never so narrow that a step's label loses its longest line (`STEP_LINE_CHARS`).
 * That is the half of the old per-band `stepColumns` that was wrong — it bought room with
 * width and cut the emergent reader's labels to five letters — and it is checked here rather
 * than assumed: a grid that would cut words is never chosen, and the fit scrolls instead.
 *
 * A grid can be read two ways (across, or down), and the tournament said so of the old one.
 * What answers that here is the next-step RING, which points at one step whichever way the eye
 * reads, plus a fill that runs the way a page does. The theme's position numeral is NOT added
 * to a grid: charged to felt's 3-across columns it costs 30-50px a step, and an 8-step routine
 * scrolls again in every band — the exact fault this section exists to remove. Storybook keeps
 * its numerals in a grid as in a column, and its width is charged (`StepOrder`).
 *
 * Pure arithmetic and in a `.ts` file on purpose: the test runner strips `.ts` and not `.tsx`,
 * so the sizes that decide whether a five-year-old's fifth step is on screen are tested here
 * rather than trusted to a component.
 */

import { cssTokens, fontSizePx, iconPx, MIN, spacePx, strokePx } from '../../design/tokens.ts';

/** The inert gutter between two steps — mis-tap prevention, never spent on fitting. */
export const STEP_GAP_PX = spacePx.tapGap;

/**
 * The heaviest edge a step wears: the confirm ring and the next-step ring are both
 * `strokePx.focus`. A row is a fixed height, so its content is sized for the worst edge and the
 * row never changes height when the ring moves to the next step.
 */
export const STEP_EDGE_PX = strokePx.focus;

/** Padding inside a step at its natural size, and the least it gives back to. */
export const STEP_PAD_MAX_PX = spacePx.xs;
export const STEP_PAD_MIN_PX = spacePx.xxs;

/** A step's label may wrap to two lines and no further (it ellipses after that). */
export const STEP_LABEL_LINES = 2;

const LINE_HEIGHT = Number(cssTokens['--lh-snug']);

/** The type scale, smallest first — the only sizes a label may shrink to. */
const TYPE_SCALE: readonly number[] = [
  fontSizePx.meta,
  fontSizePx.small,
  fontSizePx.body,
  fontSizePx.bodyLarge,
  fontSizePx.cardTitle,
  fontSizePx.sectionTitle,
  fontSizePx.display,
  fontSizePx.hero,
  fontSizePx.clock,
];

/** What one step wants when there is room: the band's own sizes at the reader's distance. */
export interface StepNaturals {
  /** The step's picture. */
  readonly iconPx: number;
  /** The state mark — the sticker, or the box. */
  readonly markPx: number;
  /** The label, or null for the band that draws no words. */
  readonly labelPx: number | null;
  /** The shortest a row may be. Never under `MIN.tapTargetPx`, whatever is passed. */
  readonly floorPx: number;
}

export interface RoutineStepFit {
  /** Every step's height: fixed, so the list does not jump when a step changes state. */
  readonly rowPx: number;
  /** The padding on every side of a step's content. */
  readonly padPx: number;
  /** The tallest anything inside a step may be: `rowPx` less the padding and the worst edge. */
  readonly contentPx: number;
  readonly iconPx: number;
  readonly markPx: number;
  /** Null exactly when the natural label is null — the picture band never gains words. */
  readonly labelPx: number | null;
  /** True only when the steps are at their floors and still do not fit. */
  readonly scrolls: boolean;
}

/** How tall a label is at `sizePx` on its full two lines. */
export function labelBlockPx(sizePx: number | null): number {
  return sizePx === null ? 0 : Math.ceil(STEP_LABEL_LINES * sizePx * LINE_HEIGHT);
}

/** The tallest thing a step holds at its natural size. */
function naturalContentPx(n: StepNaturals): number {
  return Math.max(n.iconPx, n.markPx, labelBlockPx(n.labelPx));
}

function floorOf(n: StepNaturals): number {
  return Math.max(MIN.tapTargetPx, Number.isFinite(n.floorPx) ? n.floorPx : MIN.tapTargetPx);
}

/** A step's height when nothing has to give: its content, the full padding and the worst edge. */
export function naturalRowPx(n: StepNaturals): number {
  return Math.max(floorOf(n), naturalContentPx(n) + 2 * STEP_PAD_MAX_PX + 2 * STEP_EDGE_PX);
}

/**
 * The largest size on the type scale, no bigger than `naturalPx`, whose two lines fit in
 * `contentPx` — and never under the 14px floor, even if that means the block is taller than the
 * box (the label then clamps to fewer lines rather than going under the floor).
 */
function labelThatFits(naturalPx: number, contentPx: number): number {
  const candidates = [naturalPx, ...TYPE_SCALE.filter((s) => s < naturalPx).reverse()];
  for (const s of candidates) {
    if (s < MIN.fontSizePx) break;
    if (labelBlockPx(s) <= contentPx) return s;
  }
  return MIN.fontSizePx;
}

/**
 * The step's position numeral (storybook's), sized for the row it is in: the largest size on the
 * type scale, no bigger than the band's numeral, whose ONE line fits `contentPx` — and never
 * under the 14px floor. A numeral is a single line, so it keeps more of its size than a label
 * squeezed into the same row; at the floor row a 54px emergent numeral is a 40px one.
 */
export function numeralThatFits(naturalPx: number, contentPx: number): number {
  const candidates = [naturalPx, ...TYPE_SCALE.filter((s) => s < naturalPx).reverse()];
  for (const s of candidates) {
    if (s < MIN.fontSizePx) break;
    if (Math.ceil(s * LINE_HEIGHT) <= contentPx) return s;
  }
  return MIN.fontSizePx;
}

/** The sizes a step has when it is not being squeezed at all. */
function natural(n: StepNaturals): RoutineStepFit {
  const rowPx = naturalRowPx(n);
  return {
    rowPx,
    padPx: STEP_PAD_MAX_PX,
    contentPx: rowPx - 2 * STEP_PAD_MAX_PX - 2 * STEP_EDGE_PX,
    iconPx: n.iconPx,
    markPx: n.markPx,
    labelPx: n.labelPx,
    scrolls: false,
  };
}

/**
 * `count` steps in a pane `paneHeightPx` tall.
 *
 * The row is the pane shared evenly (less the gutters), held between the floor and the natural
 * height. Within that range everything moves together along one fraction `u` — 1 at natural
 * size, 0 at the floor — so a longer routine is always a little smaller and never larger:
 *
 *   - the CONTENT box (the picture, the mark, the two lines of label) shrinks from its natural
 *     size to what the floor row leaves it, rounding down;
 *   - the PADDING comes down from 8 to 4, rounding down, and whatever is left over centres the
 *     content in the fixed row.
 *
 * Both are computed from `u` rather than one from the other because integer padding taken out
 * of an integer row would make the content one pixel BIGGER each time the padding stepped down.
 *
 * A pane that has not been measured yet (zero, negative, NaN) gets the natural sizes and no
 * scroll — the first frame is never drawn squeezed for want of a number.
 */
export function fitRoutineSteps(count: number, paneHeightPx: number, n: StepNaturals): RoutineStepFit {
  if (!Number.isFinite(count) || count < 1 || !Number.isFinite(paneHeightPx) || paneHeightPx <= 0) {
    return natural(n);
  }
  const steps = Math.floor(count);
  const floor = floorOf(n);
  const full = naturalRowPx(n);
  const shared = Math.floor((paneHeightPx - (steps - 1) * STEP_GAP_PX) / steps);
  const rowPx = Math.min(full, Math.max(floor, shared));
  const scrolls = steps * rowPx + (steps - 1) * STEP_GAP_PX > paneHeightPx;

  const u = full === floor ? 1 : (rowPx - floor) / (full - floor);
  const contentNatural = naturalContentPx(n);
  const contentAtFloor = floor - 2 * STEP_PAD_MIN_PX - 2 * STEP_EDGE_PX;
  // A step whose content already fits the floor row never shrinks it; the floor was the only
  // reason the row was that tall.
  const contentPx =
    contentNatural <= contentAtFloor
      ? contentNatural
      : contentAtFloor + Math.floor((contentNatural - contentAtFloor) * u);
  const padPx = STEP_PAD_MIN_PX + Math.floor((STEP_PAD_MAX_PX - STEP_PAD_MIN_PX) * u);

  return {
    rowPx,
    padPx,
    contentPx,
    iconPx: Math.min(n.iconPx, contentPx),
    markPx: Math.min(n.markPx, contentPx),
    labelPx: n.labelPx === null ? null : labelThatFits(n.labelPx, contentPx),
    scrolls,
  };
}

// ---------------------------------------------------------------------------
// Columns, when one column cannot hold the routine
// ---------------------------------------------------------------------------

/**
 * The widest line a step's label must keep whole, in characters: "Put your shoes", the widest
 * line of the household's longest step.
 */
export const STEP_LINE_CHARS = 14;

/**
 * Width per character, in ems: 0.60 for bold Nunito, measured on the panel 2026-09-13, and 0.65
 * here to sit on the safe side of every face the themes ship. Measured again 2026-10-11 in
 * headless Chromium at weight 700: Andika (gallery's "Wall Reader") is the widest of the three,
 * not Fredoka, at up to 0.58 em a character on a name, and DejaVu Sans — the fallback — up to 0.67.
 */
export const STEP_EM_PER_CHAR = 0.65;

/** The routine pane, both axes. */
export interface RoutinePane {
  readonly heightPx: number;
  readonly widthPx: number;
}

/**
 * The step's ORDER mark, for the theme that numbers its steps (storybook): a numeral for the
 * bands that read one, and pips — the band's own quantity — for the band that does not.
 */
export interface StepOrder {
  /** The band's numeral size, or null for the band that counts in pips. */
  readonly numeralPx: number | null;
  /** The band's pip cap (`maxPips`): past it a step's pips end in the "lots" mark. */
  readonly maxPips: number;
}

export interface RoutineGridFit extends RoutineStepFit {
  /** Columns, filled left to right and then down. 1 whenever one column holds the routine. */
  readonly columns: number;
  /** How many rows that makes — the count every step was sized for. */
  readonly rows: number;
}

/** The order numeral's slot: never under the 32px the bands reserve for it. */
function numeralSlotPx(numeralPx: number, count: number, contentPx: number): number {
  const digits = String(Math.max(1, Math.floor(count))).length;
  return Math.max(spacePx.xl, Math.ceil(digits * STEP_EM_PER_CHAR * numeralThatFits(numeralPx, contentPx)));
}

/**
 * The widest order mark in a routine of `count` steps — the last step's, which has the most
 * digits or the most pips. Pips are the picture band's `iconPx.sm` marks with `xxs` between
 * them, and past `maxPips` a "lots" mark after them.
 */
export function stepOrderPx(order: StepOrder | null, count: number, contentPx: number): number {
  if (order === null || !Number.isFinite(count) || count < 1) return 0;
  if (order.numeralPx !== null) return numeralSlotPx(order.numeralPx, count, contentPx);
  const pips = Math.min(Math.floor(count), Math.max(0, order.maxPips));
  const marks = pips + (Math.floor(count) > pips ? 1 : 0);
  return marks === 0 ? 0 : marks * iconPx.sm + (marks - 1) * spacePx.xxs;
}

/**
 * How wide one step needs to be at a fit: [order] [mark] picture [label] — each part a `sm` gap
 * from the next, inside the padding and the heaviest edge. The label is its longest line at the
 * fitted size, never less: a step narrower than this cuts a word.
 */
export function stepWidthPx(fit: RoutineStepFit, orderPx: number): number {
  const label = fit.labelPx === null ? 0 : Math.ceil(STEP_LINE_CHARS * STEP_EM_PER_CHAR * fit.labelPx);
  const parts = [orderPx, fit.markPx, fit.iconPx, label].filter((w) => w > 0);
  return 2 * STEP_EDGE_PX + 2 * fit.padPx + parts.reduce((a, b) => a + b, 0) + (parts.length - 1) * spacePx.sm;
}

/** One column's width when `columns` share a pane: the pane less the inert gutters between them. */
export function gridColumnPx(paneWidthPx: number, columns: number): number {
  const c = Math.max(1, Math.floor(columns));
  return (paneWidthPx - (c - 1) * STEP_GAP_PX) / c;
}

/** "12:59 PM" — the longest a step's done-at time can be. */
export const STEP_TIME_CHARS = 8;

/**
 * Whether a DONE step still has room for the time it was done at ("7:02 AM", which the fluent
 * band draws after its label) in a column `columnPx` wide.
 *
 * The time is the one part of a step that gives way to a grid. It is not charged when the fit
 * chooses a column count — charged, it would push felt's eight-step routine back into a scroll
 * for a fact the tick already carries — so in a narrow column it is simply not drawn, and the
 * label keeps the room. An unmeasured column (NaN) has room: one column across the whole body
 * always did.
 */
export function stepTimeFits(
  fit: RoutineStepFit,
  columnPx: number,
  orderPx: number,
  timeTextPx: number | null,
): boolean {
  if (timeTextPx === null) return false;
  if (!Number.isFinite(columnPx)) return true;
  const time = Math.ceil(STEP_TIME_CHARS * STEP_EM_PER_CHAR * timeTextPx);
  return stepWidthPx(fit, orderPx) + spacePx.sm + time <= columnPx;
}

/**
 * The biggest fit of `rows` rows in `heightPx` whose step is no wider than `columnPx`: the
 * height's fit when that is narrow enough, otherwise a row given back a pixel at a time — the
 * step's width only ever shrinks with its height — and null when even the floor row is too wide.
 */
function fitAcross(
  rows: number,
  heightPx: number,
  columnPx: number,
  n: StepNaturals,
  order: StepOrder | null,
  count: number,
): RoutineStepFit | null {
  const width = (f: RoutineStepFit): number => stepWidthPx(f, stepOrderPx(order, count, f.contentPx));
  const tall = fitRoutineSteps(rows, heightPx, n);
  if (width(tall) <= columnPx) return tall;
  for (let row = tall.rowPx - 1; row >= floorOf(n); row -= 1) {
    const fit = fitRoutineSteps(rows, rows * row + (rows - 1) * STEP_GAP_PX, n);
    if (width(fit) <= columnPx) return fit;
  }
  return null;
}

/**
 * `count` steps in a pane: ONE column when one column holds them, otherwise the fewest columns
 * that do, and only when none does, the most columns a step's longest line allows — scrolling,
 * at the floors, as the single column always has.
 *
 * Every step in the grid is sized by `fitRoutineSteps` for the ROWS, so everything this module
 * promises a column it promises a row of the grid: the 64px floor, type on the scale and never
 * under 14, one height for every step. The width is checked, never assumed: a column count whose
 * steps would be narrower than their order mark, mark, picture and longest line is not chosen.
 *
 * One consequence, and it is the right way round: the step that would have been the fourth in a
 * scrolling column is, in a two-by-two grid, BIGGER than the third was. The pane did not grow;
 * the steps stopped queueing in one file. Within a column count, more steps are never bigger.
 *
 * An unmeasured height (zero, negative, NaN) is one column at natural size, unscrolled, and an
 * unmeasured width is one column at whatever the height allows — the first frame is never drawn
 * squeezed, or split, for want of a number.
 */
export function fitRoutineGrid(
  count: number,
  pane: RoutinePane,
  n: StepNaturals,
  order: StepOrder | null = null,
): RoutineGridFit {
  const one = fitRoutineSteps(count, pane.heightPx, n);
  const steps = Number.isFinite(count) && count >= 1 ? Math.floor(count) : 0;
  const single: RoutineGridFit = { ...one, columns: 1, rows: steps };
  if (!one.scrolls || !Number.isFinite(pane.widthPx) || pane.widthPx <= 0) return single;

  let widest = single;
  for (let columns = 2; columns <= steps; columns += 1) {
    const rows = Math.ceil(steps / columns);
    const columnPx = gridColumnPx(pane.widthPx, columns);
    const fit = fitAcross(rows, pane.heightPx, columnPx, n, order, steps);
    // A step only gets wider as its row count falls, so once a column count is too narrow
    // every larger one is too.
    if (fit === null) break;
    widest = { ...fit, columns, rows };
    if (!fit.scrolls) return widest;
  }
  return widest;
}

// ---------------------------------------------------------------------------
// The section switch above the pane, which is what sets the pane's height
// ---------------------------------------------------------------------------

/** The three numbers of `BandTypography` the switch is sized from. */
export interface SwitchTypography {
  readonly secondaryIconPx: number;
  readonly navAvatarPx: number;
  readonly minTapPx: number;
}

export interface SectionSwitchMetrics {
  /** The routine's icon (or the chore glyph) inside the ring. */
  readonly iconPx: number;
  /** The progress ring around it. */
  readonly ringPx: number;
  /** The whole row: ring, padding and the selected button's focus edge. */
  readonly heightPx: number;
}

/**
 * The switch's sizes for a band.
 *
 * The icon is the band's secondary icon CAPPED at the rail's face size. It is chrome, and the
 * pre-reader's secondary icon is 96 — uncapped, her switch was a 140px row over a routine that
 * then had 196px for three steps. Capped at the face she navigates by everywhere else it is a
 * 108px row, and three steps fit in every theme.
 */
export function sectionSwitchMetrics(typo: SwitchTypography): SectionSwitchMetrics {
  const iconPx = Math.min(typo.secondaryIconPx, typo.navAvatarPx);
  const ringPx = iconPx + spacePx.md;
  // Each button is a ring plus `xs` padding and, when selected, a `focus` edge; the row
  // stretches every button to the selected one's height.
  const heightPx = Math.max(typo.minTapPx, ringPx + 2 * spacePx.xs + 2 * strokePx.focus);
  return { iconPx, ringPx, heightPx };
}

/** The gap between the switch and the pane under it (`ChildView`'s column gap). */
export const CHILD_VIEW_GAP_PX = spacePx.md;

/**
 * The routine pane's height on a child's screen: the shell's body less the switch and the gap.
 * The panel MEASURES its real height; this is the same arithmetic, for the tests and for the
 * metrics table, and the panel audit is what checks the two agree on the glass.
 */
export function routinePanePx(bodyHeightPx: number, typo: SwitchTypography): number {
  return bodyHeightPx - sectionSwitchMetrics(typo).heightPx - CHILD_VIEW_GAP_PX;
}
