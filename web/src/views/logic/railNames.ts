/**
 * Unit H — every child's name on the rail, whole, at one size (2026-10-11).
 *
 * ## Whose name it is
 *
 * The rail's names were the bands' to draw, and each band drew a different one: the fluent
 * reader's whole name at 17px, the emergent reader's FIRST WORD at 20, and nothing at all beside
 * the pre-reader. On the example household that read "Child A", "Child" and a bare face — the
 * second looked cut off and the third looked dropped, and both were the code doing what it said.
 *
 * A name on the rail is not addressed to the child whose face it is: she finds herself by the
 * face, the one she is wearing in this week's picture. It is for everyone else in the room — the
 * sister choosing whose screen to open, the grown-up checking whose board is up. So it is CHROME:
 * the rail (ChildBar) draws it for every child, the pre-reader included, and a band only places
 * it inside its own tap target and never reads it. That is how the picture band can carry a name
 * without its leaf touching a word (test/unit-h.sources.test.ts).
 *
 * ## Whole, always
 *
 * Never a first word, never an ellipsis, never clamped. What gives instead, in this order: the
 * type (down to the 14px floor and never under it), then a second line where the name has a
 * space to break at, then — felt's bottom row only — the face. Type first because the name is for
 * the readers; the face last because shrinking it is the one change that costs the child who
 * cannot read. Every name on a rail is ONE size: three captions at three sizes read as three
 * kinds of thing.
 *
 * ## The width of a name is an estimate, and a safe one
 *
 * 0.65 em a character. Measured 2026-10-11 in headless Chromium at weight 700, the wall's three
 * faces set seven-to-ten-letter first names at 0.45-0.58 em a character — Andika (gallery's "Wall
 * Reader") is the widest of them, not Fredoka — and DejaVu Sans, the fallback if a face fails to
 * load, at 0.57-0.67. When even the last step does not hold a name by the estimate the plan says
 * so (`fits: false`) and the name is drawn whole anyway, free to wrap wherever it must: a name on
 * two lines is still her name, and a name with an ellipsis is somebody else's.
 */

import { fontSizePx, iconPx, layoutPx, spacePx, strokePx } from '../../design/tokens.ts';
import type { RailDraw } from './theme.ts';

/** Where a name stands: in a pill beside the face (felt's bottom row), or under it (the side rails). */
export type NamePlace = 'beside' | 'below';

export interface RailNamePlan {
  readonly place: NamePlace;
  /** The one size every name on this rail is set at. */
  readonly sizePx: number;
  /** The lines the longest name is planned for: two only where it has a space to break at. */
  readonly lines: 1 | 2;
  /** The face beside or above it. */
  readonly facePx: number;
  /** False when the last step does not hold the longest name either. It is still drawn whole. */
  readonly fits: boolean;
}

/** One character's width in ems, on the safe side of every face the wall ships (above). */
export const NAME_EM_PER_CHAR = 0.65;
/** The line box: the wall's `--lh-snug`. */
export const NAME_LINE_HEIGHT = 1.25;

/** A tile's padding around face and name when the rail sets the face. */
export const NAME_TILE_PAD_PX = spacePx.xxs;
export const NAME_BESIDE_GAP_PX = spacePx.xs;
export const NAME_BELOW_GAP_PX = spacePx.xxs;
/** The pill a name stands in beside a face: its padding, and its edge in the child's colour. */
export const NAME_PILL_PAD_X_PX = spacePx.sm;
export const NAME_PILL_PAD_Y_PX = spacePx.xxs;
export const NAME_PILL_EDGE_PX = strokePx.medium;

/** Between tiles, and between the home key and the first tile: the inert gutter. */
export const RAIL_GAP_PX = spacePx.tapGap;

/** Felt's bottom row gives up, in order: [face, type, lines]. The face is the bar less its padding. */
export const ROW_STEPS: readonly (readonly [number, number, 1 | 2])[] = [
  [layoutPx.railBottomHeight - 2 * NAME_TILE_PAD_PX, fontSizePx.body, 1],
  [layoutPx.railBottomHeight - 2 * NAME_TILE_PAD_PX, fontSizePx.small, 1],
  [layoutPx.railBottomHeight - 2 * NAME_TILE_PAD_PX, fontSizePx.meta, 1],
  [layoutPx.railBottomHeight - 2 * NAME_TILE_PAD_PX, fontSizePx.meta, 2],
  [iconPx.md, fontSizePx.meta, 1],
  [iconPx.md, fontSizePx.meta, 2],
];

/**
 * The side rails give up only type, then a line: [type, lines]. The face keeps the rail's 64 —
 * a name UNDER a face competes with it for height, which a 104px column has to spare, and never
 * for width, which is what a name needs. 17 at most: a caption under a portrait, not a heading.
 */
export const COLUMN_STEPS: readonly (readonly [number, 1 | 2])[] = [
  [fontSizePx.small, 1],
  [fontSizePx.meta, 1],
  [fontSizePx.meta, 2],
];

/** The face on a side rail: the band's nav face, the same in every band. */
export const COLUMN_FACE_PX = iconPx.lg;

/** The side rails' inset from their own edges: the column keeps its 80px of faces, and the named forms give their names the width. */
export function railInsetPx(form: RailDraw): number {
  return form === 'column' ? spacePx.sm : spacePx.xxs;
}

/** The frame every tile on the plinth wears — ink round the selected one, invisible round the rest. */
export function tileFramePx(form: RailDraw): number {
  return form === 'plinth' ? strokePx.thick : 0;
}

/** A line of type at `sizePx`. */
export function nameLinePx(sizePx: number): number {
  return Math.ceil(sizePx * NAME_LINE_HEIGHT);
}

function clean(name: string): string {
  return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ') : '';
}

/**
 * How wide `name` sets at `sizePx`, by the estimate. On two lines it breaks at the space that
 * leaves the longer half shortest; a name with no space cannot be broken there, so two lines
 * are no narrower than one.
 */
export function nameWidthPx(name: string, sizePx: number, lines: 1 | 2 = 1): number {
  const chars = [...clean(name)];
  let longest = chars.length;
  if (lines === 2) {
    chars.forEach((c, i) => {
      if (c === ' ') longest = Math.min(longest, Math.max(i, chars.length - i - 1));
    });
  }
  return Math.ceil(longest * NAME_EM_PER_CHAR * sizePx);
}

/** The pill's height: its lines, its padding and its edge. */
export function namePillHeightPx(sizePx: number, lines: 1 | 2): number {
  return lines * nameLinePx(sizePx) + 2 * NAME_PILL_PAD_Y_PX + 2 * NAME_PILL_EDGE_PX;
}

/** One tile of felt's bottom row: padding, face, gap, and the name in its pill. */
export function rowTileWidthPx(name: string, facePx: number, sizePx: number, lines: 1 | 2): number {
  return (
    2 * NAME_TILE_PAD_PX +
    facePx +
    NAME_BESIDE_GAP_PX +
    2 * NAME_PILL_EDGE_PX +
    2 * NAME_PILL_PAD_X_PX +
    nameWidthPx(name, sizePx, lines)
  );
}

/**
 * The names on one rail, or null where the rail names nobody — the plain column of faces on
 * felt's grown-up screens, where the 816px body is what is scarce.
 *
 * `widthPx` is the room the rail is drawn in: the bottom row's whole length (the home key and
 * the gutters are charged here), or the side column's width. `homeKey` says whether the house
 * key stands in the rail too.
 */
export function planRailNames(
  form: RailDraw,
  names: readonly string[],
  widthPx: number,
  homeKey: boolean,
): RailNamePlan | null {
  if (form === 'column') return null;
  if (form === 'row') return planRow(names, widthPx, homeKey);
  return planColumn(form, names, widthPx, homeKey);
}

function planRow(names: readonly string[], widthPx: number, homeKey: boolean): RailNamePlan {
  const innerPx = layoutPx.railBottomHeight - 2 * NAME_TILE_PAD_PX;
  const keys = names.length + (homeKey ? 1 : 0);
  const fixed = (homeKey ? layoutPx.railHomeHeight : 0) + Math.max(0, keys - 1) * RAIL_GAP_PX;
  for (const [facePx, sizePx, lines] of ROW_STEPS) {
    if (namePillHeightPx(sizePx, lines) > innerPx) continue;
    const tiles = names.reduce((sum, name) => sum + rowTileWidthPx(name, facePx, sizePx, lines), 0);
    if (fixed + tiles <= widthPx) return { place: 'beside', sizePx, lines, facePx, fits: true };
  }
  const [facePx, sizePx, lines] = ROW_STEPS[ROW_STEPS.length - 1] ?? [iconPx.md, fontSizePx.meta, 2];
  return { place: 'beside', sizePx, lines, facePx, fits: false };
}

function planColumn(
  form: RailDraw,
  names: readonly string[],
  widthPx: number,
  homeKey: boolean,
): RailNamePlan {
  const frame = tileFramePx(form);
  // A name has the tile's width less its frame and the face key's padding.
  const roomPx = widthPx - 2 * railInsetPx(form) - 2 * frame - 2 * NAME_TILE_PAD_PX;
  // And a tile has its share of the rail's height, after the wall's margin top and bottom, the
  // home key and the gutters.
  const keys = names.length + (homeKey ? 1 : 0);
  const columnPx =
    layoutPx.wallHeight -
    2 * layoutPx.wallPad -
    (homeKey ? layoutPx.railHomeHeight : 0) -
    Math.max(0, keys - 1) * RAIL_GAP_PX;
  const tilePx = names.length === 0 ? columnPx : columnPx / names.length;
  for (const [sizePx, lines] of COLUMN_STEPS) {
    const height =
      2 * frame + 2 * NAME_TILE_PAD_PX + COLUMN_FACE_PX + NAME_BELOW_GAP_PX + lines * nameLinePx(sizePx);
    if (height > tilePx) continue;
    if (names.every((name) => nameWidthPx(name, sizePx, lines) <= roomPx)) {
      return { place: 'below', sizePx, lines, facePx: COLUMN_FACE_PX, fits: true };
    }
  }
  const [sizePx, lines] = COLUMN_STEPS[COLUMN_STEPS.length - 1] ?? [fontSizePx.meta, 2];
  return { place: 'below', sizePx, lines, facePx: COLUMN_FACE_PX, fits: false };
}
