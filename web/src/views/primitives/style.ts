/**
 * Unit H — style helpers.  Every value comes from Unit G's tokens.
 *
 * SIZES are written as token VALUES (numbers), and the THEMED things — colour,
 * corners, faces, the card's edge and ledge — as `var(--name, <felt value>)`
 * strings from tokens.ts.  That split is what keeps the old guarantee: if
 * `tokens.css` fails to load — a bad deploy, a cache miss, a Chromium profile wipe
 * at 05:58 — every size is still a number, and every themed value falls back to
 * felt rather than to unstyled black-on-white boxes.  A theme switch is the browser
 * re-resolving those strings when the root attribute changes; nothing re-renders.
 *
 * A renderer must never write a raw hex or a raw px number; test/unit-h.sources
 * greps for both.  Reach for a token, or add one to Unit G.
 */

import type { CSSProperties } from 'react';
import {
  cardEdge,
  cardEdgeWidth,
  cardShadow,
  colour,
  cssTokens,
  cssVar,
  font,
  fontSizePx,
  fontWeight,
  radius,
  spacePx,
} from '../../design/tokens.ts';
import type { Plate } from '../logic/plate.ts';

export const px = (v: number): string => `${v}px`;

/**
 * A card, in the theme's own card language: an opaque surface, a real edge, and a
 * hard ledge (or, in storybook, none) instead of a blur.  Felt's is paper with a
 * dark outline and an offset; gallery's a mat on a ledge; storybook's lies flat.
 */
export function card(extra: CSSProperties = {}): CSSProperties {
  return {
    background: colour.surface,
    border: `${cardEdgeWidth} solid ${cardEdge}`,
    borderRadius: radius.lg,
    boxShadow: cardShadow,
    boxSizing: 'border-box',
    ...extra,
  };
}

/**
 * A plate (logic/plate.ts) as CSS: its fill, its edge and its ledge, each a themed `var()`.
 * Corners and size are the caller's, because a plate is the same material whatever its shape.
 */
export function plateStyle(plate: Plate, extra: CSSProperties = {}): CSSProperties {
  return {
    background: cssVar(plate.fill),
    border: `${cssVar(plate.edgeWidth)} solid ${cssVar(plate.edge)}`,
    boxShadow: cssVar(plate.ledge),
    boxSizing: 'border-box',
    ...extra,
  };
}

/**
 * A tap target.  `minPx` comes from the band's own typography, never from a guess;
 * the floor is Unit G's `MIN.tapTargetPx` and the bands only go up from there.
 */
export function tapTarget(minPx: number, extra: CSSProperties = {}): CSSProperties {
  return {
    minWidth: px(minPx),
    minHeight: px(minPx),
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: px(spacePx.sm),
    padding: px(spacePx.sm),
    margin: 0,
    cursor: 'pointer',
    background: 'transparent',
    border: 'none',
    color: colour.ink,
    fontFamily: 'inherit',
    touchAction: 'manipulation',
    WebkitTapHighlightColor: 'transparent',
    appearance: 'none',
    textAlign: 'left',
    boxSizing: 'border-box',
    ...extra,
  };
}

/** Mandatory dead space between adjacent targets: a miss must land on nothing. */
export const tapRow: CSSProperties = {
  display: 'flex',
  gap: px(spacePx.tapGap),
  alignItems: 'stretch',
};

export const tapColumn: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: px(spacePx.tapGap),
};

export const stack: CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: px(spacePx.xs),
};

export const row: CSSProperties = {
  display: 'flex',
  flexDirection: 'row',
  alignItems: 'center',
  gap: px(spacePx.sm),
};

/** Text.  Only ink tokens are text colours; hue lives in fills and edges. */
export function text(
  sizePx: number,
  opts: { muted?: boolean; weight?: number; wrap?: boolean; lines?: number } = {},
): CSSProperties {
  return {
    fontSize: px(sizePx),
    fontWeight: opts.weight ?? fontWeight.bold,
    color: opts.muted === true ? colour.inkMuted : colour.ink,
    lineHeight: cssTokens['--lh-snug'],
    overflow: 'hidden',
    // `wrap` for anything that must stay READABLE rather than stay on one line. A card label
    // in a tile has a width it cannot argue with, and single-line-with-ellipsis turns
    // "Get dressed" into "Ge…" — which tells a seven-year-old nothing and tells a five-year-old
    // less. Two short lines are strictly better than one truncated one; the panel has more
    // vertical room in a tile than it has horizontal.
    ...(opts.wrap === true
      ? {
          whiteSpace: 'normal',
          overflowWrap: 'break-word',
          // `lines` caps the wrap. Without it a long title grows the card and pushes the next
          // one off a screen that cannot scroll; with it the title uses the room it has and
          // then ellipses, which is the failure mode you want on a wall.
          ...(opts.lines === undefined
            ? {}
            : {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical' as const,
                WebkitLineClamp: opts.lines,
              }),
        }
      : { textOverflow: 'ellipsis', whiteSpace: 'nowrap' }),
  };
}

/**
 * A number on the wall.  Tabular figures, so a balance that ticks from 9 to 10 does
 * not shift the whole card sideways — on a screen glanced at from across the room,
 * movement reads as change even when the value is stable.
 *
 * At `bodyLarge` (24) and up it is set in the theme's DISPLAY face, below that in
 * its numeric one.  That is storybook's rule — Fraunces for the big numerals and
 * never under 24px — and costs the other two nothing, because their two faces are
 * the same face.  Neither Fredoka nor Fraunces carries tabular figures, so in felt
 * and storybook `tabular-nums` is inert and a big count can shift by a few px.
 */
export function numeralText(sizePx: number, ink: string): CSSProperties {
  return {
    ...text(sizePx),
    color: ink,
    fontFamily: sizePx >= fontSizePx.bodyLarge ? font.display : font.numeric,
    fontVariantNumeric: 'tabular-nums',
  };
}

/** Ink chosen by the surface it sits on — never assume white (Unit G rule 6). */
export function onSolid(accent: { onSolid: string; minTextOnSolidPx: number }): CSSProperties {
  return {
    color: accent.onSolid,
    fontSize: px(Math.max(accent.minTextOnSolidPx, fontSizePx.bodyLarge)),
    fontWeight: fontWeight.black,
  };
}
