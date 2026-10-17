/**
 * Unit H — what stands under anything drawn over the week's picture.
 *
 * The picture is behind EVERY page (WallBackdrop), under a 70% veil of the page's own ground.
 * The veil is decoration, not a surface: 30% of the art still comes through it, so type laid
 * straight on it is graded against whatever the artist painted there that week. So nothing that
 * carries a word or a glyph stands on the picture bare. It stands on a PLATE — an opaque fill in
 * the theme's own card language, whose ink is a graded pair in every theme (CONTRAST_RULES: ink
 * on surface and on surface-sunken, 7 or better).
 *
 * Found 2026-10-11, all designed before the picture went behind every page, when "transparent"
 * meant the page: the section doors were transparent at 70% opacity, storybook's running head
 * was a rule with the art under its words, and felt's house key on a floating rail was an
 * outline. The panel audit passed all three, because its contrast rule walks a text's ANCESTORS
 * for a background and the picture is a SIBLING of the page — it graded those words against the
 * wall root's plain ground. Rule 9 in tools/panel-audit.mjs asks the right question now.
 *
 * Plain data, in token NAMES rather than CSS. `plateStyle` (primitives/style.ts) turns a plate
 * into `var()` strings for the glass; test/unit-h.plate.test.ts resolves the same names through
 * each theme's tokens and grades them. One description with two readers, so they cannot drift.
 */

import type { CssTokenName } from '../../design/tokens.ts';
import type { HeaderForm, RailDraw } from './theme.ts';

/** The fills a plate may have: opaque, and each one graded for ink at 7 in every theme. */
export type PlateFill = Extract<CssTokenName, '--c-surface' | '--c-surface-sunken'>;

export interface Plate {
  readonly fill: PlateFill;
  /** How heavy the edge is: the theme's card edge, the medium stroke, or the focus stroke. */
  readonly edgeWidth: Extract<CssTokenName, '--stroke-card' | '--stroke-2' | '--stroke-focus'>;
  readonly edge: Extract<CssTokenName, '--edge-card' | '--c-border' | '--c-border-strong'>;
  /**
   * What it stands on. `--shadow-control` is a KEY's ledge — how a child knows a thing can be
   * pressed, which is why storybook keeps it while its cards lie flat. `--shadow-none` is a key
   * already pressed: the one you are in.
   */
  readonly ledge: Extract<CssTokenName, '--shadow-control' | '--shadow-card' | '--shadow-none'>;
}

/** A card, as the theme draws one: felt's outlined paper, gallery's mat, storybook's flat page. */
export const CARD_PLATE: Plate = {
  fill: '--c-surface',
  edgeWidth: '--stroke-card',
  edge: '--edge-card',
  ledge: '--shadow-card',
};

/**
 * A section door (Bedtime, Jobs, Extras) on a child's screen.
 *
 * Unchosen, it is a raised KEY in the theme's language: the card's fill and edge, on the key's
 * ledge. Chosen, it is pressed in — the heavy focus edge and no ledge — so the choice reads by
 * WEIGHT and by DEPTH, two channels neither of which is colour. Both are opaque: the old
 * unchosen door was transparent at 70% opacity, which on a page with the picture behind it is
 * 30% art under its label. The fill stays the surface in both, because the door's progress ring
 * is drawn in the child's colour and is graded against that surface.
 */
export function doorPlate(selected: boolean): Plate {
  return selected
    ? { fill: '--c-surface', edgeWidth: '--stroke-focus', edge: '--c-border-strong', ledge: '--shadow-none' }
    : { fill: '--c-surface', edgeWidth: '--stroke-card', edge: '--edge-card', ledge: '--shadow-control' };
}

/**
 * The header bar, as a plate, and how far it HANGS.
 *
 * Felt and gallery set the bar as a card, which was always a plate. Storybook's is a book's
 * running head, and a running head was designed for a page of paper: with the picture behind the
 * page it was a line of type on the art. It keeps its form — a line of type over a rule — on a
 * plate that HANGS from the top edge of the glass, square-cornered where it meets the edge and
 * rounded below, the way storybook's ribbon and index tabs hang. `hangPx` is the shell's top
 * margin, which the plate grows up through, so the bar's own 64px and everything below it stay
 * exactly where they were.
 */
export function headerPlate(form: HeaderForm, shellTopPx: number): { plate: Plate; hangPx: number } {
  return { plate: CARD_PLATE, hangPx: form === 'running-head' ? Math.max(0, shellTopPx) : 0 };
}

/**
 * The rail's house key, or null where the rail has a ground of its own.
 *
 * Gallery's plinth and storybook's spine are opaque columns, and the key stands on them in their
 * own way. Felt's rail is a row of faces along the bottom (a column on the grown-up screens) with
 * NOTHING under it but the picture, so there the key needs a plate: a raised key while it will
 * take you somewhere, and sunken and flat while you are already home — "you are here" by depth,
 * where it used to be an outline at 85% opacity over the art.
 */
export function railKeyPlate(form: RailDraw, live: boolean): Plate | null {
  if (form === 'plinth' || form === 'spine') return null;
  return live
    ? { fill: '--c-surface', edgeWidth: '--stroke-2', edge: '--c-border-strong', ledge: '--shadow-control' }
    : { fill: '--c-surface-sunken', edgeWidth: '--stroke-2', edge: '--c-border', ledge: '--shadow-none' };
}
