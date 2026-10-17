/**
 * Which theme the wall wears, and the one DOM write that applies it.
 *
 * The theme is household data: `snapshot.theme`, set from the grown-up Settings behind the PIN
 * and pushed over SSE like any other setting. Nothing about it is drawn by a component. The
 * stylesheet's three token sets hang off ONE attribute on the ROOT ELEMENT,
 * `data-wall-theme`, and every themed value a renderer holds is a `var(--x, <felt>)` string,
 * so changing the attribute is the whole switch — the browser re-resolves, nothing re-renders.
 *
 * Why the root element and not the wall's own box: the theme blocks are
 * `:root[data-wall-theme="…"]`, and the derived tokens (`--edge-card: var(--c-border-strong)`)
 * resolve on the element that declares them. Put the attribute anywhere else and the colours
 * switch while the card edges keep felt's.
 *
 * A plain function over a two-method interface, so it is tested without a DOM.
 */

import { DEFAULT_WALL_THEME, isWallThemeId, type WallThemeId } from '../../../../src/types.ts';
import { layoutPx, spacePx } from '../../design/tokens.ts';

export const WALL_THEME_ATTRIBUTE = 'data-wall-theme';

/**
 * Total over `unknown`. The snapshot validator is shallow on purpose and an older server sends
 * no field at all, so a missing or misspelled theme is felt — the default, never a blank wall.
 */
export function resolveWallTheme(value: unknown): WallThemeId {
  return isWallThemeId(value) ? value : DEFAULT_WALL_THEME;
}

/** The two methods of `Element` this needs. */
export interface ThemeRoot {
  getAttribute(name: string): string | null;
  setAttribute(name: string, value: string): void;
}

/**
 * The page's `<html>` element, or null where there is no document (Node: the tests, a type
 * check). Reached structurally through `globalThis` for the reason `data/browser.ts` gives at
 * length: the project compiles without the DOM lib, so `document` is not an identifier here.
 */
export function documentRoot(): ThemeRoot | null {
  const g = globalThis as unknown as { document?: { documentElement?: ThemeRoot | null } | null };
  return g.document?.documentElement ?? null;
}

/**
 * Put `theme` on the root, resolved; returns what it applied. Writes only on a change, so the
 * snapshot that arrives every few seconds does not touch the DOM when nothing moved.
 */
export function applyWallTheme(root: ThemeRoot, theme: unknown): WallThemeId {
  const resolved = resolveWallTheme(theme);
  if (root.getAttribute(WALL_THEME_ATTRIBUTE) !== resolved) {
    root.setAttribute(WALL_THEME_ATTRIBUTE, resolved);
  }
  return resolved;
}

// ---------------------------------------------------------------------------
// What each theme changes about the STRUCTURE, as one table
// ---------------------------------------------------------------------------

/**
 * Where the children's faces stand.
 *
 *   - `bottom` — felt: a row of faces along the bottom edge, where the three-year-old's reach is.
 *   - `plinth` — gallery: a sunken column on the left, square portrait frames standing on it.
 *   - `spine`  — storybook: a dark column on the left, the selected child's bookmark bridging
 *     into the page.
 */
export type RailForm = 'bottom' | 'plinth' | 'spine';

/**
 * How the rail is actually DRAWN on a given screen, which is not always its form: felt's
 * bottom row becomes a plain column on the grown-up screens, whose body was measured at the
 * side shell's 816x412 (see `shellGeometry`).
 */
export type RailDraw = 'row' | 'column' | 'plinth' | 'spine';

/** `card` is a header bar in the theme's card language; `running-head` is a book's: a line of type over a rule. */
export type HeaderForm = 'card' | 'running-head';

/** The header's doors: felt's round stickers, gallery's square keys, storybook's index tabs. */
export type DoorForm = 'round' | 'square' | 'tab';

/** The state sticker on a step or a chore: round (felt) or a square box (gallery, storybook). */
export type MarkForm = 'round' | 'square';

/** Which end of a row the state mark sits at. */
export type MarkSide = 'start' | 'end';

/**
 * Everything a theme changes that is not a colour, a corner or a face — those are tokens, and
 * reach the glass through the stylesheet. These are the few STRUCTURAL choices, kept in one
 * table so a component asks "which form" rather than "which theme", and a fourth theme is one
 * row rather than a branch in every file.
 */
export interface WallLayout {
  readonly theme: WallThemeId;
  readonly rail: RailForm;
  readonly header: HeaderForm;
  readonly doors: DoorForm;
  readonly stateMark: MarkForm;
  /** The routine step's state mark: felt leads with it (a sticker to tick), the others end on it. */
  readonly stepMark: MarkSide;
  /** The chore's state mark: felt ends on it (beside the points), the others lead with it (a ledger's box). */
  readonly choreMark: MarkSide;
  /**
   * Whether a routine step carries its position numeral. Storybook's alone: the routine is the
   * one list on the wall that IS a sequence, and a book numbers what is meant to be done in
   * order. The other two carry order by position — down a column, or across and down a grid
   * when one column cannot hold the routine — and by the next-step ring.
   */
  readonly numberedSteps: boolean;
  /** Felt sets its jobs out as tiles two across; gallery and storybook as a one-column ledger. */
  readonly choreColumns: 1 | 2;
  /**
   * The face's frame on the rail: gallery's square portrait frame, and a round face in the
   * other two. Not `stateMark` — storybook's state marks are boxes and its faces are round.
   */
  readonly faceFrame: MarkForm;
  /**
   * How the grown-up screens are navigated: felt's row of tabs across the top, or a column of
   * keys down the left edge where gallery's plinth and storybook's spine already stand. See
   * `grownupGeometry`.
   */
  readonly grownupNav: GrownupNavForm;
  /**
   * The grown-up queue's "Send back" / "Not yet" key: a solid red key in felt, whose keys are
   * all filled stickers, and an OUTLINED one in gallery and storybook, whose mocks draw the
   * refusal as a ruled key beside a filled approval. Red ink on the surface is an adult-only
   * pairing the contrast table already allows (`--c-danger` on `--c-surface`, 4:1).
   */
  readonly rejectKey: RejectKeyForm;
}

/** The refusal key's fill: solid like its neighbour, or outlined so the approval leads. */
export type RejectKeyForm = 'solid' | 'outline';

/** The grown-up screens' section keys: a row of tabs across the top, or a column on the left. */
export type GrownupNavForm = 'tabs' | 'column';

export const WALL_LAYOUTS: Readonly<Record<WallThemeId, WallLayout>> = {
  felt: {
    theme: 'felt',
    rail: 'bottom',
    header: 'card',
    doors: 'round',
    stateMark: 'round',
    stepMark: 'start',
    choreMark: 'end',
    numberedSteps: false,
    choreColumns: 2,
    faceFrame: 'round',
    grownupNav: 'tabs',
    rejectKey: 'solid',
  },
  gallery: {
    theme: 'gallery',
    rail: 'plinth',
    header: 'card',
    doors: 'square',
    stateMark: 'square',
    stepMark: 'end',
    choreMark: 'start',
    numberedSteps: false,
    choreColumns: 1,
    faceFrame: 'square',
    grownupNav: 'column',
    rejectKey: 'outline',
  },
  storybook: {
    theme: 'storybook',
    rail: 'spine',
    header: 'running-head',
    doors: 'tab',
    stateMark: 'square',
    stepMark: 'end',
    choreMark: 'start',
    numberedSteps: true,
    choreColumns: 1,
    faceFrame: 'round',
    grownupNav: 'column',
    rejectKey: 'outline',
  },
};

/** Total over `unknown`, for the same reason `resolveWallTheme` is: garbage is felt's layout. */
export function layoutFor(theme: unknown): WallLayout {
  return WALL_LAYOUTS[resolveWallTheme(theme)];
}

/**
 * The wall's frame for one screen: where the rail goes, and what that leaves the body.
 *
 * Two shells, and every number in them adds up to the 960x540 glass (the tests check both axes):
 *
 *   - **side** — a full-height column flush to the left edge (`layoutPx.sideWidth`), then the
 *     header and the body in a padded column beside it. The body is 816x412, exactly what it was
 *     beside the old 80px rail, so every screen measured against that pane still fits.
 *   - **bottom** — felt's: the header across the top, the body, and the face row along the bottom
 *     edge (`layoutPx.railBottomHeight`). The wall's top and bottom padding drop from 24 to 16 to
 *     pay for the second bar; the body is 912x348 — wider and shorter.
 *
 * The PICTURE LIBRARY is always the side shell. It was measured against a 412px pane
 * (`adminActions.ts` budgets it from it), and an adult standing at the wall is not navigating
 * by the faces. So felt's rail moves to the left for it and back when they leave — the one
 * place a theme's rail moves. The other grown-up screens have their own frame and no rail at
 * all: `grownupGeometry`.
 *
 * The picture is neither: it is full bleed, and no shell is drawn under it.
 */
export interface ShellGeometry {
  readonly kind: 'side' | 'bottom';
  readonly rail: RailDraw;
  readonly pad: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  /** The side column's width, or the bottom row's height. */
  readonly railPx: number;
  readonly headerPx: number;
  readonly gutterPx: number;
  readonly body: { readonly width: number; readonly height: number };
}

export function shellGeometry(layout: WallLayout, adultScreen: boolean): ShellGeometry {
  const W = layoutPx.wallWidth;
  const H = layoutPx.wallHeight;
  const header = layoutPx.wallHeaderHeight;
  const gutter = layoutPx.wallGutter;
  if (layout.rail === 'bottom' && !adultScreen) {
    // 16 top and bottom rather than the wall's 24: the second bar has to be paid for somewhere,
    // and the edge of the glass is the cheapest place. The sides keep 24.
    const pad = { top: spacePx.md, right: layoutPx.wallPad, bottom: spacePx.md, left: layoutPx.wallPad };
    const railPx = layoutPx.railBottomHeight;
    return {
      kind: 'bottom',
      rail: 'row',
      pad,
      railPx,
      headerPx: header,
      gutterPx: gutter,
      body: {
        width: W - pad.left - pad.right,
        height: H - pad.top - header - gutter - gutter - railPx - pad.bottom,
      },
    };
  }
  // The column beside a full-height rail: the wall's own 24 on three sides, and the gutter on
  // the side that faces the rail.
  const pad = { top: layoutPx.wallPad, right: layoutPx.wallPad, bottom: layoutPx.wallPad, left: gutter };
  const railPx = layoutPx.sideWidth;
  return {
    kind: 'side',
    rail: layout.rail === 'bottom' ? 'column' : layout.rail,
    pad,
    railPx,
    headerPx: header,
    gutterPx: gutter,
    body: {
      width: W - railPx - pad.left - pad.right,
      height: H - pad.top - header - gutter - pad.bottom,
    },
  };
}

/**
 * The grown-up screens' frame (2026-10-11): no rail and no wall header, because an adult past
 * the PIN is not navigating by the children's faces — the sections are the navigation.
 *
 *   - **tabs** — felt's: one row of section tabs across the top IS the header, then the body.
 *     The wall's 24 on all four sides; the body is 912x412.
 *   - **column** — gallery's and storybook's: a full-height column of section keys flush to
 *     the left edge, where their rail already stands, and a header row beside it carrying the
 *     title, the time, the stale label and Leave. The body is 816x412, the side shell's pane.
 *
 * Both bodies are 412 tall, which every grown-up list was budgeted against
 * (`APPROVAL_PANE_HEIGHT_PX`), so a section measures the same in every theme and only its
 * width moves. The tests add both up to the 960x540 glass.
 *
 * Leave stands in the TAB ROW in felt and in the HEADER beside the column: seven keys down the
 * column would need 7x64 + 6x16 = 544px of a 540px wall.
 */
export interface GrownupGeometry {
  readonly nav: GrownupNavForm;
  readonly pad: { readonly top: number; readonly right: number; readonly bottom: number; readonly left: number };
  /** The tab row's height, or the column's width. */
  readonly navPx: number;
  /** The header row beside the column; 0 for tabs, whose row is the header. */
  readonly headerPx: number;
  readonly gutterPx: number;
  readonly body: { readonly width: number; readonly height: number };
}

export function grownupGeometry(layout: WallLayout): GrownupGeometry {
  const W = layoutPx.wallWidth;
  const H = layoutPx.wallHeight;
  const gutter = layoutPx.wallGutter;
  if (layout.grownupNav === 'tabs') {
    const edge = layoutPx.wallPad;
    const pad = { top: edge, right: edge, bottom: edge, left: edge };
    const navPx = layoutPx.wallHeaderHeight;
    return {
      nav: 'tabs',
      pad,
      navPx,
      headerPx: 0,
      gutterPx: gutter,
      body: {
        width: W - pad.left - pad.right,
        height: H - pad.top - navPx - gutter - pad.bottom,
      },
    };
  }
  // The side shell's numbers exactly, so a grown-up screen and the picture library beside it
  // share one pane.
  const pad = { top: layoutPx.wallPad, right: layoutPx.wallPad, bottom: layoutPx.wallPad, left: gutter };
  const navPx = layoutPx.sideWidth;
  const headerPx = layoutPx.wallHeaderHeight;
  return {
    nav: 'column',
    pad,
    navPx,
    headerPx,
    gutterPx: gutter,
    body: {
      width: W - navPx - pad.left - pad.right,
      height: H - pad.top - headerPx - gutter - pad.bottom,
    },
  };
}

/**
 * Where the calendar's pager stands: in the header, or at the head of the week card.
 *
 * In the HEADER where the header runs across the wall (felt, 912). Beside a side rail it is
 * 816, and the pager's two keys and their gaps are 160 of that — which is room the bar does
 * not have once the status is stale, because "Showing older information" is the one thing on
 * it that must never shrink. Measured on a throwaway wall 2026-10-11, week screen, stale: the
 * clock got 29px of the 122 it needs in gallery and 35 of 117 in storybook, while felt's 912
 * lost 16. So in a side shell the pager moves down into the week card as a head row, as the
 * storybook design drew it ("This week" over its pager tabs). That costs the grid HEIGHT —
 * `weekPanePx` in logic/week.ts — and never width, which is the axis five columns cannot spare.
 */
export type PagerPlace = 'header' | 'week';

export function pagerPlace(frame: ShellGeometry): PagerPlace {
  return frame.kind === 'side' ? 'week' : 'header';
}

/**
 * How many countdown cards the idle board can hold in a pane this tall — four beside the side
 * rail (412) and three above felt's bottom one (348). A fixed four would clip the fourth card
 * in felt, on the board read from the kitchen.
 */
export function countdownsThatFit(paneHeightPx: number): number {
  if (!Number.isFinite(paneHeightPx) || paneHeightPx <= 0) return 0;
  // The panel's own gap between cards (CountdownPanel), so the two cannot count differently.
  const gap = spacePx.tapGap;
  return Math.max(0, Math.floor((paneHeightPx + gap) / (layoutPx.listCardHeight + gap)));
}
