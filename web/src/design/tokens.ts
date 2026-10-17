/**
 * family-calendar — design tokens, typed.  Unit G (build-plan.md §4).
 *
 * `cssTokens` mirrors web/src/design/tokens.css exactly, one entry per custom
 * property.  test/unit-g.tokens.test.ts parses the stylesheet and asserts the two
 * files are identical, so drift between them is a test failure rather than a
 * subtly-wrong wall.
 *
 * Everything else in this module is derived from `cssTokens` at module load, so
 * a number can only be wrong in one place.
 *
 * THREE THEMES (2026-10-11).  `cssTokens` is FELT, the default, and mirrors the
 * stylesheet's `:root`.  `themeOverrides` holds what GALLERY and STORYBOOK change,
 * mirroring their `:root[data-wall-theme="…"]` blocks the same way.  A renderer
 * never reads a theme's values: every colour, corner, face and ledge this module
 * hands it is a `var(--name, <felt value>)` string, so the browser takes the theme
 * from the root attribute and switches it live, and a stylesheet that failed to
 * arrive still draws felt with every number right.  The per-theme HEX values
 * (`themeTokens`, `childAccentsFor`, `stateTreatmentsFor`) exist for the tests,
 * which grade every theme's palette on the panel metric, and for the Theme
 * picker's swatches, which must show a theme that is not the one on screen.
 *
 * All lengths are LOGICAL px.  Chromium runs the kiosk at
 * --force-device-scale-factor=2.0, so the viewport is 960x540 logical on a
 * 1920x1080 panel and 1 logical px == 2 physical px == ~0.50 mm.
 */

import type {
  ChoreState,
  MaterializationStatus,
  ReadingBand,
  WallThemeId,
} from '../../../src/types.ts';

// ---------------------------------------------------------------------------
// The panel
// ---------------------------------------------------------------------------

/**
 * The hardware, as measured (CLAUDE.md: corrected from EDID on 2026-08-23 — it is
 * a 2270L, not a 2470L).  These are facts, not preferences; a renderer that wants
 * a physical size should compute it from here rather than guessing.
 */
export const PANEL = {
  model: 'Elo 2270L',
  diagonalInches: 21.5,
  physicalWidthPx: 1920,
  physicalHeightPx: 1080,
  /** Chromium --force-device-scale-factor, mirrored from pi/config/kiosk.env. */
  deviceScaleFactor: 2,
  logicalWidthPx: 960,
  logicalHeightPx: 540,
  /** ~102.5 ppi across 18.74" of usable width. */
  physicalPixelsPerMm: 4.03,
  /**
   * Backlight peak, per the 2470L datasheet.  CLAUDE.md flags this as UNVERIFIED
   * for the 2270L — re-measure before trusting it for anything but "dim".
   */
  peakNits: 225,
  /**
   * Veiling glare through the anti-glare etch, as a fraction of peak white.
   * WCAG's contrast formula bakes in 0.05; this panel is dimmer and hazier than
   * WCAG's reference display, so every contrast figure in this design system is
   * computed with 0.10 instead — a strictly harsher metric.
   */
  flare: 0.1,
} as const;

/** One logical px in millimetres on the glass. */
export const LOGICAL_PX_MM = PANEL.deviceScaleFactor / PANEL.physicalPixelsPerMm;

// ---------------------------------------------------------------------------
// The floors.  Nothing in this system, and nothing a renderer writes, goes below.
// ---------------------------------------------------------------------------

export const MIN = {
  /** 14 logical == 28 physical.  There is no caption size and no fine print. */
  fontSizePx: 14,
  /** 64 logical == 128 physical == ~32 mm.  A three-year-old, standing, reaching. */
  tapTargetPx: 64,
  /** Dead space between adjacent tap targets, so a miss does not hit the neighbour. */
  tapGapPx: 16,
  /** 1px logical is 2px physical, which the etch smears away.  2 is the floor. */
  strokePx: 2,
  /** Icons are the pre-reader's entire interface; they start large. */
  iconPx: 24,
  /** 400-weight stems read as hairlines at this density. */
  fontWeight: 600,
} as const;

// ---------------------------------------------------------------------------
// cssTokens — the mirror of tokens.css
// ---------------------------------------------------------------------------

const T = {
  '--c-bg': '#D3DBE4',
  '--c-surface': '#FFFFFF',
  '--c-surface-sunken': '#D7DEE5',
  '--c-surface-inverse': '#1B1E2B',

  '--c-border': '#7F8CA0',
  '--c-border-strong': '#2A2F3D',

  '--c-ink': '#1B1E2B',
  '--c-ink-muted': '#454C5E',
  '--c-ink-inverse': '#FFFFFF',

  '--c-id-1': '#1A3AA6',
  '--c-id-1-tint': '#D2DDFF',
  '--c-id-1-on': '#FFFFFF',
  '--c-id-2': '#D4267C',
  '--c-id-2-tint': '#FFD6E9',
  '--c-id-2-on': '#FFFFFF',
  '--c-id-3': '#FFB01E',
  '--c-id-3-tint': '#FFDE92',
  '--c-id-3-on': '#1B1E2B',

  '--c-state-todo-edge': '#6B757A',
  '--c-state-todo-fill': '#FFFFFF',
  '--c-state-doing-edge': '#E08A00',
  '--c-state-doing-fill': '#FFDC73',
  '--c-state-done-edge': '#0B4E24',
  '--c-state-done-fill': '#178340',
  '--c-state-void-edge': '#C2CBD5',
  '--c-state-void-fill': '#FFFFFF',

  '--c-src-slate': '#2E4257',
  '--c-src-plum': '#7A3A66',
  '--c-src-teal': '#1F7175',
  '--c-src-moss': '#4A8C3A',
  '--c-src-grey': '#75808E',
  '--c-src-sun': '#C98A1E',

  '--c-today-fill': '#FFE07A',
  '--c-today-edge': '#9A6B00',

  '--o-state-void': '0.7',
  '--o-disabled': '0.45',

  '--c-danger': '#B4201A',
  '--c-focus': '#0B57D0',

  '--c-leave-ready-fill': '#CFE6F7',
  '--c-leave-ready-edge': '#1F5F8F',
  '--c-leave-go-fill': '#FFCBA6',
  '--c-leave-go-edge': '#B3410F',

  '--fs-100': '14px',
  '--fs-200': '17px',
  '--fs-300': '20px',
  '--fs-400': '24px',
  '--fs-500': '30px',
  '--fs-600': '40px',
  '--fs-700': '54px',
  '--fs-800': '72px',
  '--fs-900': '96px',

  '--fw-600': '600',
  '--fw-700': '700',
  '--fw-800': '800',

  '--lh-tight': '1.1',
  '--lh-snug': '1.25',
  '--lh-normal': '1.45',

  '--ls-tight': '-0.01em',
  '--ls-normal': '0em',
  '--ls-caps': '0.06em',

  '--font-family':
    '"Fredoka", "Nunito", system-ui, -apple-system, "Segoe UI", "DejaVu Sans", sans-serif',
  '--font-numeric': '"Fredoka", "Nunito", system-ui, "DejaVu Sans", sans-serif',
  '--font-display': '"Fredoka", "Nunito", system-ui, "DejaVu Sans", sans-serif',

  '--icon-100': '24px',
  '--icon-200': '32px',
  '--icon-300': '48px',
  '--icon-400': '64px',
  '--icon-500': '96px',
  '--icon-600': '128px',
  '--icon-700': '160px',

  '--tap-min': '64px',
  '--tap-md': '80px',
  '--tap-lg': '96px',
  '--tap-xl': '132px',

  '--sp-0': '0px',
  '--sp-1': '4px',
  '--sp-2': '8px',
  '--sp-3': '12px',
  '--sp-4': '16px',
  '--sp-5': '24px',
  '--sp-6': '32px',
  '--sp-7': '48px',
  '--sp-8': '64px',
  '--sp-tap-gap': '16px',

  '--r-sm': '14px',
  '--r-md': '14px',
  '--r-lg': '14px',
  '--r-xl': '22px',
  '--r-pill': '999px',

  '--stroke-min': '2px',
  '--stroke-1': '2px',
  '--stroke-2': '3px',
  '--stroke-3': '4px',
  '--stroke-focus': '6px',
  '--stroke-card': '3px',

  '--edge-card': 'var(--c-border-strong)',
  '--shadow-card': '5px 5px 0 0 var(--c-border-strong)',
  '--shadow-control': '4px 4px 0 0 var(--c-border-strong)',
  '--shadow-none': 'none',

  '--ground-texture': 'radial-gradient(var(--c-border) 1.2px, transparent 1.4px)',
  '--ground-texture-size': '14px 14px',

  '--wall-w': '960px',
  '--wall-h': '540px',
  '--wall-pad': '24px',
  '--wall-gutter': '16px',

  '--wall-header-h': '64px',

  '--wall-rail-w': '80px',

  '--wall-backdrop-h': '208px',

  '--wall-list-card-h': '88px',

  '--wall-agenda-row-h': '36px',
  '--wall-agenda-time-w': '84px',

  '--wall-rail-home-h': '64px',

  '--wall-rail-bottom-h': '64px',
  '--wall-side-w': '104px',

  '--dur-tap': '120ms',
  '--dur-settle': '260ms',
  '--dur-undo': '2000ms',
  '--dur-idle-decay': '90000ms',
} as const;

export const cssTokens = T;
export type CssTokenName = keyof typeof T;

/** Every token name whose value is a colour, for the contrast rules and tests. */
export type ColourTokenName = Extract<CssTokenName, `--c-${string}`>;

const n = (v: string): number => {
  const parsed = Number.parseFloat(v);
  if (!Number.isFinite(parsed)) throw new Error(`token "${v}" is not numeric`);
  return parsed;
};

// ---------------------------------------------------------------------------
// Themes
// ---------------------------------------------------------------------------

/**
 * What each theme CHANGES, relative to felt.  Mirrors the stylesheet's
 * `:root[data-wall-theme="…"]` blocks exactly (unit-g.tokens asserts it), and a
 * theme may only override a name felt declares: a token that existed in one theme
 * and not the others would render as its fallback there, silently.
 *
 * What is NOT here is as deliberate as what is.  Type sizes, tap targets, icons,
 * spacing and the numbered strokes are the panel's physics and the band ladder's,
 * and they hold in every theme.  A theme is a palette, a face, its corners, its
 * card and its ground — nothing a layout does arithmetic with.
 */
export const themeOverrides: Readonly<
  Record<WallThemeId, Readonly<Partial<Record<CssTokenName, string>>>>
> = {
  felt: {},
  gallery: {
    '--c-bg': '#DDE0DA',
    '--c-surface-sunken': '#D8DCD6',
    '--c-surface-inverse': '#1A1F23',
    '--c-border': '#9AA39F',
    '--c-border-strong': '#4C565A',
    '--c-ink': '#14181B',
    '--c-ink-muted': '#48525A',
    '--c-id-1': '#1434A0',
    '--c-id-1-tint': '#CCD9FF',
    '--c-id-2-tint': '#FFCCE4',
    '--c-id-3': '#F0A800',
    '--c-id-3-tint': '#FFE19C',
    '--c-id-3-on': '#14181B',
    '--c-state-doing-fill': '#FFE3A6',
    '--c-state-done-edge': '#0A4A28',
    '--c-state-done-fill': '#15803A',
    '--c-state-void-edge': '#C3C9C6',
    '--c-src-slate': '#2B3E52',
    '--c-src-plum': '#76386A',
    '--c-src-teal': '#1D6E73',
    '--c-src-moss': '#44883A',
    '--c-src-grey': '#7A8084',
    '--c-src-sun': '#C2851A',
    '--c-today-fill': '#D5E7F6',
    '--c-today-edge': '#2A5C8C',
    '--c-danger': '#A8221B',
    '--c-leave-ready-fill': '#CDE9DB',
    '--c-leave-ready-edge': '#1E6B4C',
    '--c-leave-go-fill': '#FFCEAA',

    '--font-family':
      '"Wall Reader", "Nunito", system-ui, -apple-system, "Segoe UI", "DejaVu Sans", sans-serif',
    '--font-numeric': '"Wall Reader", "Nunito", system-ui, "DejaVu Sans", sans-serif',
    '--font-display': '"Wall Reader", "Nunito", system-ui, "DejaVu Sans", sans-serif',

    '--r-sm': '4px',
    '--r-md': '4px',
    '--r-lg': '4px',
    '--r-xl': '4px',

    '--stroke-card': '2px',
    '--edge-card': 'var(--c-border)',
    '--shadow-card': '0 3px 0 0 var(--c-border)',
    '--shadow-control': '0 3px 0 0 var(--c-border-strong)',
    '--ground-texture': 'none',
    '--ground-texture-size': 'auto',
  },
  storybook: {
    '--c-bg': '#E6E2D8',
    '--c-surface-sunken': '#DDD8CD',
    '--c-surface-inverse': '#1E2140',
    '--c-border': '#9896A8',
    '--c-border-strong': '#4C4C70',
    '--c-ink': '#171A33',
    '--c-ink-muted': '#4E4F6A',
    '--c-ink-inverse': '#FFFDF9',
    '--c-id-1': '#1434A0',
    '--c-id-2': '#D02076',
    '--c-id-3': '#F3AD00',
    '--c-id-3-tint': '#FFDF93',
    '--c-id-3-on': '#1E2140',
    '--c-state-doing-fill': '#FFE2A2',
    '--c-state-done-fill': '#17813B',
    '--c-state-void-edge': '#CBC9C3',
    '--c-src-grey': '#80796F',
    '--c-today-edge': '#8A5A00',
    '--c-danger': '#A8221B',
    '--c-leave-ready-fill': '#D5E4F7',

    '--font-family': '"Nunito", system-ui, -apple-system, "Segoe UI", "DejaVu Sans", sans-serif',
    '--font-numeric': '"Nunito", system-ui, "DejaVu Sans", sans-serif',
    '--font-display': '"Fraunces", Georgia, "DejaVu Serif", serif',

    '--r-sm': '8px',
    '--r-md': '8px',
    '--r-xl': '14px',

    '--stroke-card': '2px',
    '--edge-card': 'var(--c-border)',
    '--shadow-card': 'none',
    '--shadow-control': '0 3px 0 0 var(--c-border-strong)',
    '--ground-texture': 'none',
    '--ground-texture-size': 'auto',
  },
};

/** Every token's value under `theme`: felt, with that theme's overrides on top. */
export function themeTokens(theme: WallThemeId): Readonly<Record<CssTokenName, string>> {
  return { ...T, ...themeOverrides[theme] };
}

/**
 * A token's FELT value with every `var(--x)` inside it replaced by --x's felt value,
 * so it can stand as a var() fallback.  A fallback is used exactly when the custom
 * properties are missing, so it may not lean on them.
 */
function feltLiteral(name: CssTokenName, seen: readonly string[] = []): string {
  if (seen.includes(name)) throw new Error(`token cycle: ${[...seen, name].join(' -> ')}`);
  return T[name].replace(/var\((--[a-z0-9-]+)\)/g, (_whole: string, ref: string) => {
    if (!Object.hasOwn(T, ref)) throw new Error(`${name} references undeclared ${ref}`);
    return feltLiteral(ref as CssTokenName, [...seen, name]);
  });
}

/**
 * A token as a renderer uses it: `var(--name, <felt value>)`.  The browser resolves
 * the theme from `data-wall-theme` on the root element; the fallback is felt, so a
 * wall whose stylesheet never arrived draws the default theme rather than nothing.
 */
export function cssVar(name: CssTokenName): string {
  return `var(${name}, ${feltLiteral(name)})`;
}

type ColourPick = (name: ColourTokenName) => string;

/** One theme's colours as HEX — for grading and for the picker's swatches, never for drawing. */
function hexPick(theme: WallThemeId): ColourPick {
  const t = themeTokens(theme);
  return (name) => t[name];
}

// ---------------------------------------------------------------------------
// Derived, typed groups
// ---------------------------------------------------------------------------

export const colour = {
  bg: cssVar('--c-bg'),
  surface: cssVar('--c-surface'),
  surfaceSunken: cssVar('--c-surface-sunken'),
  surfaceInverse: cssVar('--c-surface-inverse'),
  border: cssVar('--c-border'),
  borderStrong: cssVar('--c-border-strong'),
  ink: cssVar('--c-ink'),
  inkMuted: cssVar('--c-ink-muted'),
  inkInverse: cssVar('--c-ink-inverse'),
  danger: cssVar('--c-danger'),
  focus: cssVar('--c-focus'),
  /**
   * Today's column on the week view — a CALENDAR position, not a chore state.
   *
   * Its own token since 2026-09-09. WeekView had a standing `TOKEN WANTED` note saying so:
   * it borrowed the "claimed" chore fill, which meant today's colour would silently follow
   * the chore palette anywhere that moved. Two things with nothing to do with each other.
   */
  todayFill: cssVar('--c-today-fill'),
  todayEdge: cssVar('--c-today-edge'),
  /** The leave-by banner's two phases. Neither a chore state nor the adult red. */
  leaveReadyFill: cssVar('--c-leave-ready-fill'),
  leaveReadyEdge: cssVar('--c-leave-ready-edge'),
  leaveGoFill: cssVar('--c-leave-go-fill'),
  leaveGoEdge: cssVar('--c-leave-go-edge'),
} as const;

/**
 * The stripe colour for a calendar SOURCE, keyed by `calendar_source.colour_token`.
 *
 * A third identity axis: state says what happened to a chore, a child accent says whose it is,
 * and this says which calendar an event came from. It had been carried on the wire as
 * `CalendarEventView.colourToken` since the freeze and rendered by nothing at all, so every
 * event on the wall was the same colour whatever calendar it came from.
 */
export const sourceColour: Record<string, string> = {
  slate: cssVar('--c-src-slate'),
  plum: cssVar('--c-src-plum'),
  teal: cssVar('--c-src-teal'),
  moss: cssVar('--c-src-moss'),
  grey: cssVar('--c-src-grey'),
  sun: cssVar('--c-src-sun'),
};

/**
 * The stripe for a token, or the ordinary card border when the token is unknown.
 *
 * Total on purpose. `colour_token` is a free-text column that provisioning writes, so a typo
 * must cost one stripe its colour and not throw inside a renderer that is drawing a child's
 * day. The fallback is exactly what every event looked like before this existed.
 */
export function sourceStripe(token: string | null | undefined): string {
  return (token !== null && token !== undefined && sourceColour[token]) || colour.border;
}

export const fontSizePx = {
  /** 14 — the floor.  Units, dates, the smallest legal thing on the wall. */
  meta: n(T['--fs-100']),
  small: n(T['--fs-200']),
  body: n(T['--fs-300']),
  bodyLarge: n(T['--fs-400']),
  cardTitle: n(T['--fs-500']),
  sectionTitle: n(T['--fs-600']),
  display: n(T['--fs-700']),
  hero: n(T['--fs-800']),
  clock: n(T['--fs-900']),
} as const;

export const fontWeight = {
  regular: n(T['--fw-600']),
  bold: n(T['--fw-700']),
  black: n(T['--fw-800']),
} as const;

export const iconPx = {
  xs: n(T['--icon-100']),
  sm: n(T['--icon-200']),
  md: n(T['--icon-300']),
  lg: n(T['--icon-400']),
  xl: n(T['--icon-500']),
  xxl: n(T['--icon-600']),
  hero: n(T['--icon-700']),
} as const;

export const tapPx = {
  min: n(T['--tap-min']),
  md: n(T['--tap-md']),
  lg: n(T['--tap-lg']),
  xl: n(T['--tap-xl']),
} as const;

export const spacePx = {
  none: n(T['--sp-0']),
  xxs: n(T['--sp-1']),
  xs: n(T['--sp-2']),
  sm: n(T['--sp-3']),
  md: n(T['--sp-4']),
  lg: n(T['--sp-5']),
  xl: n(T['--sp-6']),
  xxl: n(T['--sp-7']),
  xxxl: n(T['--sp-8']),
  /** Mandatory dead space between two tap targets. */
  tapGap: n(T['--sp-tap-gap']),
} as const;

/**
 * Corners, as CSS strings rather than numbers, because they are per theme: felt's
 * paper is round and gallery's mats are square, and the root attribute decides.
 * This replaced `radiusPx` on 2026-10-11; nothing ever did arithmetic on a corner.
 */
export const radius = {
  sm: cssVar('--r-sm'),
  md: cssVar('--r-md'),
  lg: cssVar('--r-lg'),
  xl: cssVar('--r-xl'),
  pill: cssVar('--r-pill'),
} as const;

/**
 * The three faces.  `family` for every word; `numeric` for a count small enough to
 * sit in a row; `display` for a big numeral or a heading — storybook's Fraunces,
 * which the designer never set below 24px (`numeralText` makes that the rule).
 */
export const font = {
  family: cssVar('--font-family'),
  numeric: cssVar('--font-numeric'),
  display: cssVar('--font-display'),
} as const;

/**
 * ONE CARD LANGUAGE PER THEME.  Felt is paper with a dark 3px outline and a hard
 * 5px offset; gallery a white mat with a thin grey edge and a 3px ledge below it;
 * storybook a page-flat card with a 2px rule and no ledge at all.  `card()` in
 * primitives/style.ts is the reader; `controlShadow` is the smaller ledge under
 * a pressable key, which storybook keeps because a ledge is how a child knows a
 * thing can be pressed.
 */
export const cardEdge = cssVar('--edge-card');
export const cardEdgeWidth = cssVar('--stroke-card');
export const cardShadow = cssVar('--shadow-card');
export const controlShadow = cssVar('--shadow-control');

/**
 * What the wall's root paints.  Felt's dot grid is a background IMAGE over the
 * ground colour (none in the other two), so it is three longhands, never the
 * `background` shorthand — React warns when the two are mixed on one element.
 */
export const ground = {
  colour: colour.bg,
  texture: cssVar('--ground-texture'),
  textureSize: cssVar('--ground-texture-size'),
} as const;

export const strokePx = {
  min: n(T['--stroke-min']),
  hairline: n(T['--stroke-1']),
  medium: n(T['--stroke-2']),
  thick: n(T['--stroke-3']),
  focus: n(T['--stroke-focus']),
} as const;

export const layoutPx = {
  wallWidth: n(T['--wall-w']),
  wallHeight: n(T['--wall-h']),
  wallPad: n(T['--wall-pad']),
  wallGutter: n(T['--wall-gutter']),
  wallHeaderHeight: n(T['--wall-header-h']),
  /**
   * The switcher rail. ONE width, since 2026-09-15.
   *
   * It is ALWAYS on screen — that is the whole point of a rail — so the question is only how
   * much of the wall it is allowed to hold while it is there. It had two widths: 96 with a
   * child selected and 160 while choosing, on the theory that the open rail carried names and
   * progress. It never did — the vertical rail is `compact` on every screen, so the open
   * width drew the same three faces with 64px of sand beside each, and the household saw it
   * for what it was: "the sidebar with the house and then the three children, it's
   * unnecessarily wide."
   *
   * 80 is the 64px face — which does not shrink; it is the thing a three-year-old navigates
   * by — in 8px of padding a side, and it is a 64px tap target with room to spare. The rail
   * stays a fixed width so the faces are in the same three places on every screen.
   */
  railWidth: n(T['--wall-rail-w']),
  /**
   * The illustrated horizon band along the bottom edge.
   *
   * 208 is the tallest it can be without reaching the content: the shortest pane on the wall
   * (a child's, under the 56px header) starts 96px down, and every card that could sit over
   * the band is opaque. The art is bottom-anchored and its upper half is empty sky, so what
   * actually shows through is the silhouette line and the gaps between cards.
   */
  backdropHeight: n(T['--wall-backdrop-h']),
  /**
   * One height for every card in the idle wall's two list columns.
   *
   * Measured 2026-08-26, before: the events column ran 71 / 71 / 71 / 101 and the countdowns
   * 71 / 93 / 123 / 123, because a title wrapping to two lines grew its card and a wrapping
   * meta line grew it again. Two columns of different-sized boxes with different gaps read as
   * unfinished however good each box is, and the countdown column overflowed the pane by 13px
   * while the rail sat on 76px of slack.
   *
   * 88 is what fits: four cards plus three mandatory 16px gaps is 400 in the 420 the pane has.
   * Content that does not fit is clipped rather than allowed to push the column, which is the
   * right failure on a screen that cannot scroll.
   */
  listCardHeight: n(T['--wall-list-card-h']),
  /**
   * One row of the idle wall's day agenda.
   *
   * The agenda is four day headings deep, so its rows cannot be the 88px a standalone card
   * gets — four headings at 30 plus eight rows at 88 is 824px in a pane that has 420. At 36
   * the worst case is 120 + 288 = 408 and the fourth day still lands on screen.
   *
   * That is not a legibility compromise: the row carries a time and a title at 17 and 20
   * logical px, which on this panel at scale 2.0 is 34 and 40 physical — well clear of the
   * 14px floor, and the same size the chore state words already use.
   */
  agendaRowHeight: n(T['--wall-agenda-row-h']),
  /** The agenda's time column. Fixed, so every time starts at the same x. */
  agendaTimeWidth: n(T['--wall-agenda-time-w']),
  /**
   * The rail's home button.
   *
   * 56, not the 104 a face gets, and the arithmetic is the reason: three faces at 104 plus a
   * fourth tile and three gaps is 464 in a rail that has 420. At 56 it is 416 and the faces do
   * not move. It is also correct on its own terms — a house is a control, a face is a person,
   * and they should not be the same size.
   */
  railHomeHeight: n(T['--wall-rail-home-h']),
  /**
   * Felt's face rail, along the bottom edge (since 2026-10).
   *
   * The designer drew it 96 tall with 72px faces. At 96 the child's pane is 316px and a
   * four-step routine is already scrolling; at 64 it is 348. A face in this bar is 56 — the
   * bar less a 4px inset top and bottom — inside a 64px tap target, which is the floor.
   */
  railBottomHeight: n(T['--wall-rail-bottom-h']),
  /**
   * Gallery's plinth and storybook's spine: the side column, full-bleed to the left edge.
   *
   * 104 and not the drawn 168 because of what it leaves: 960 − 104 − 16 − 24 is 816, the body
   * width the grown-up screens (`APPROVAL_PANE_PX`), the five-day calendar and the idle board
   * were all measured against. A 168 spine would re-open every one of those measurements.
   */
  sideWidth: n(T['--wall-side-w']),
} as const;

export const durationMs = {
  tap: n(T['--dur-tap']),
  settle: n(T['--dur-settle']),
  /** H2 Q1 graft: intercept a mis-tap locally before it needs a server revoke. */
  undo: n(T['--dur-undo']),
  /** H2 Q3 graft: activeChild decays to the ambient view after this long idle. */
  idleDecay: n(T['--dur-idle-decay']),
} as const;

// ---------------------------------------------------------------------------
// Identity — one accent per child slot
// ---------------------------------------------------------------------------

/**
 * A child's identity is carried by FOUR redundant channels, never by colour
 * alone: the accent, a shape, a fixed screen position, and the child's own
 * avatar asset.  Renderers must use at least the shape and the position in
 * addition to the accent — a deuteranope adult and a three-year-old who has not
 * learned colour names both need the non-colour channels.
 */
export interface ChildAccent {
  /** Stable slot index.  Derived from Child.sortOrder, never from the child id. */
  readonly slot: number;
  readonly solid: string;
  readonly tint: string;
  /** The ink that goes ON `solid`.  Slot 3 is light; do not assume white. */
  readonly onSolid: string;
  /**
   * RESERVED, and currently unread.
   *
   * It was the avatar frame's outline — a non-colour identity channel from the days when the
   * three avatars were interchangeable geometric placeholders. They are portraits now, which
   * carries identity better than a polygon and without making one rail look like three
   * unrelated components. Kept because it is a declared channel and cheap to restore: a
   * household with two children whose portraits resemble each other would want it back.
   */
  readonly shape: 'circle' | 'rounded-square' | 'shield';
  /** Redundant non-colour channel #2.  Fixed left-to-right column on the wall. */
  readonly column: 0 | 1 | 2;
  /** Type on a solid must be at least this big — the fills are only ~4.1:1. */
  readonly minTextOnSolidPx: number;
}

function buildChildAccents(c: ColourPick): readonly [ChildAccent, ChildAccent, ChildAccent] {
  return [
    {
      slot: 0,
      solid: c('--c-id-1'),
      tint: c('--c-id-1-tint'),
      onSolid: c('--c-id-1-on'),
      shape: 'circle',
      column: 0,
      minTextOnSolidPx: fontSizePx.bodyLarge,
    },
    {
      slot: 1,
      solid: c('--c-id-2'),
      tint: c('--c-id-2-tint'),
      onSolid: c('--c-id-2-on'),
      shape: 'rounded-square',
      column: 1,
      minTextOnSolidPx: fontSizePx.bodyLarge,
    },
    {
      slot: 2,
      solid: c('--c-id-3'),
      tint: c('--c-id-3-tint'),
      onSolid: c('--c-id-3-on'),
      shape: 'shield',
      column: 2,
      minTextOnSolidPx: fontSizePx.bodyLarge,
    },
  ];
}

export const childAccents = buildChildAccents(cssVar);

/** The same three accents as one theme's HEX — for the contrast tests and the picker. */
export const childAccentsFor = (theme: WallThemeId): readonly [ChildAccent, ChildAccent, ChildAccent] =>
  buildChildAccents(hexPick(theme));

/**
 * The lightness ladder only has three rungs that separate on this panel.  A
 * fourth child needs a fourth rung derived the same way (see README) — wrapping
 * would give two children the same colour AND the same shape.
 */
export const MAX_DISTINCT_CHILDREN = childAccents.length;

/**
 * Total by construction: a slot beyond the ladder wraps rather than returning
 * nothing, because a missing accent on the wall is a blank card and a blank card
 * is the failure this project exists to prevent.  Adults get told about the
 * collision in the admin surface, not at 6:00 AM.
 */
export function childAccentForSlot(slot: number): ChildAccent {
  const i = ((Math.trunc(slot) % childAccents.length) + childAccents.length) % childAccents.length;
  // Non-null: i is in range by construction, and childAccents is a fixed 3-tuple.
  return childAccents[i] ?? childAccents[0];
}

// ---------------------------------------------------------------------------
// State — chore / routine-step progress
// ---------------------------------------------------------------------------

/**
 * Colour is the weakest channel this panel has, so state is carried mostly by
 * FORM.  `requiresIcon` is true for every state on purpose: it is the encoding
 * of "never colour alone", and unit-g.state.test.ts asserts it.
 */
export interface StateTreatment {
  readonly state: ChoreState;
  /** outline: fill is the plain surface.  tint / solid change the card body. */
  readonly fillRole: 'outline' | 'tint' | 'solid';
  readonly fill: string;
  readonly edge: string;
  readonly edgeWidthPx: number;
  readonly ink: string;
  readonly opacity: number;
  /** Never false.  The glyph, not the hue, is what a pre-reader reads. */
  readonly requiresIcon: true;
  /** Distinct per state, so the four are separable in greyscale and to a dichromat. */
  readonly glyph: 'empty-circle' | 'hourglass' | 'check' | 'crossed';
}

function buildStateTreatments(c: ColourPick): Record<ChoreState, StateTreatment> {
  return {
    pending: {
      state: 'pending',
      fillRole: 'outline',
      fill: c('--c-state-todo-fill'),
      edge: c('--c-state-todo-edge'),
      edgeWidthPx: n(T['--stroke-2']),
      ink: c('--c-ink'),
      opacity: 1,
      requiresIcon: true,
      glyph: 'empty-circle',
    },
    claimed: {
      state: 'claimed',
      fillRole: 'tint',
      fill: c('--c-state-doing-fill'),
      edge: c('--c-state-doing-edge'),
      edgeWidthPx: n(T['--stroke-3']),
      ink: c('--c-ink'),
      opacity: 1,
      requiresIcon: true,
      glyph: 'hourglass',
    },
    approved: {
      state: 'approved',
      fillRole: 'solid',
      fill: c('--c-state-done-fill'),
      edge: c('--c-state-done-edge'),
      edgeWidthPx: n(T['--stroke-3']),
      ink: c('--c-ink-inverse'),
      opacity: 1,
      requiresIcon: true,
      glyph: 'check',
    },
    superseded: {
      state: 'superseded',
      fillRole: 'outline',
      fill: c('--c-state-void-fill'),
      edge: c('--c-state-void-edge'),
      edgeWidthPx: n(T['--stroke-1']),
      ink: c('--c-ink'),
      opacity: n(T['--o-state-void']),
      requiresIcon: true,
      glyph: 'crossed',
    },
  };
}

export const stateTreatments = buildStateTreatments(cssVar);

/** One theme's state treatments as HEX — for grading, never for drawing. */
export const stateTreatmentsFor = (theme: WallThemeId): Record<ChoreState, StateTreatment> =>
  buildStateTreatments(hexPick(theme));

/** Freshness reuses the state ladder rather than inventing a fourth palette. */
function buildFreshnessColour(c: ColourPick): Record<MaterializationStatus, string> {
  return {
    ok: c('--c-state-done-edge'),
    stale: c('--c-state-doing-edge'),
    error: c('--c-danger'),
  };
}

export const freshnessColour = buildFreshnessColour(cssVar);

/** One theme's freshness colours as HEX — for grading, never for drawing. */
export const freshnessColourFor = (theme: WallThemeId): Record<MaterializationStatus, string> =>
  buildFreshnessColour(hexPick(theme));

// ---------------------------------------------------------------------------
// Band typography — one state, three renderings (PRD §4)
// ---------------------------------------------------------------------------

/**
 * Per-band presentation.  The renderer registry (types.ts BandRendererRegistry)
 * is the only place allowed to branch on band; this record is the data it reads.
 *
 * Note the inversion: the LESS a child reads, the BIGGER everything gets — bigger
 * icons, bigger tap targets, no text at all.  Literacy and fine motor control
 * arrive together, so the picture band needs both the largest pictures and the
 * most forgiving targets.
 *
 * For the picture band every text size is `null`, not 0.  0 is a size, and a size
 * invites someone to render text at it; null makes "there is no text here" a type
 * the renderer must handle.
 */
export interface BandTypography {
  readonly band: ReadingBand;
  /** False means NO WORDS REACH THE SCREEN.  Not small words. None. */
  readonly showsText: boolean;
  /** Which field of the domain view may be rendered, if any. */
  readonly labelField: 'none' | 'labelShort' | 'labelFull';
  /** Hard truncation budget for labels.  0 when no text is shown. */
  readonly maxLabelWords: number;
  readonly primaryTextPx: number | null;
  readonly secondaryTextPx: number | null;
  /** Points, streaks, "3 sleeps".  Null when quantity is shown as pips. */
  readonly numeralTextPx: number | null;
  readonly primaryIconPx: number;
  readonly secondaryIconPx: number;
  /** This band's tap-target size.  Always >= MIN.tapTargetPx. */
  readonly minTapPx: number;
  /**
   * The child-bar avatar, and the bar's tap floor.
   *
   * Separate from `secondaryIconPx` because the bar is NAVIGATION, not content, and it is
   * the one element on screen whose height every other element pays for. Reusing the card
   * token put a 96px avatar in a persistent strip: the bar took 177 of 540 vertical pixels
   * and the day below it was clipped (measured 2026-08-25 on the panel).
   *
   * The per-band difference is preserved and is the point — ChildBar draws each child in
   * THEIR band so the pre-reader finds herself by face while a sibling's screen is up, so
   * picture stays the largest. It just no longer has to be card-sized to be findable.
   */
  /**
   * The child-bar avatar, and the tap target around it.
   *
   * IDENTICAL IN ALL THREE BANDS, on purpose, and the only pair on this interface that is.
   * The band scale says literacy buys density — but that is a rule about CONTENT, and
   * navigation is chrome. Letting it scale produced exactly the failure you would predict
   * (measured on the panel 2026-08-25): from the eldest's fluent view the rail drew her own face
   * at 32px, the middle child's at 48 and the youngest's at 64, so the one component whose whole job is
   * "always the same place, always the same shape" was three different shapes.
   *
   * Chrome is sized for the LEAST capable user, always. Each band still decides what goes
   * inside the tile — the pre-reader's carries no word — so the original property survives:
   * a three-year-old finds her face while her sister's screen is up, and now finds it the
   * same size as everyone else's.
   */
  readonly navAvatarPx: number;
  /**
   * 80 since 2026-09-15 — the rail's width, and the face plus 8px a side. It was 96, which
   * with the tap target's own 12px padding put an 88px tile in a 96px rail; the rail is
   * narrower now and the avatar leaves pad it at 8 so the tile is exactly the rail.
   */
  readonly navTapPx: number;
  /**
   * A routine step's picture and state mark at their NATURAL size — what a step has when the
   * pane has room. `fitRoutineSteps` (views/logic/routineFit.ts) takes them down as steps are
   * added, to the 64px row floor and the 14px type floor, and only then does the panel scroll.
   *
   * A routine is ONE column wherever one column holds it, and a few columns only where it does
   * not (felt's short pane) — and then never narrower than a label's longest line
   * (`fitRoutineGrid`). These replace `stepColumns`, a per-band column count that bought room by
   * making steps narrower: three columns cut the emergent reader's labels to five letters. The
   * label's natural size is the band's `primaryTextPx`, so it is not repeated here.
   *
   *   - picture: 96 and 48 — the picture is the step, for a child who cannot read the word.
   *   - emergent: 96 and 32 — the pictogram is this band's premise; the mark is a tick.
   *   - fluent: 32 and 32 — the words carry the step and the picture is a reminder.
   */
  readonly stepIconPx: number;
  readonly stepMarkPx: number;
  /**
   * A chore's STATUS line — "Waiting for a grown-up", "To do", "Still time" — one step under
   * the band's secondary text, floored at 14px. Null for the band that reads no words.
   *
   * Smaller, never reworded (the household, 2026-10): *"that can just be smaller text to
   * describe what's done there, so that it fits."* The mark beside it already carries the
   * state; the line is its caption. It truncates before the chore's NAME gives up a pixel,
   * which is the rule this card was rebuilt around (CLAUDE.md, "the chore's NAME must never
   * lose space").
   */
  readonly statusTextPx: number | null;
  /**
   * How a count is shown.  A pre-reader cannot read "7", so quantity is repeated
   * marks; the emergent reader gets both so the numeral acquires meaning.
   */
  readonly quantity: 'pips' | 'numeral-and-pips' | 'numeral';
  /** Above this, pips stop being countable and the band shows a "lots" mark. */
  readonly maxPips: number;
}

export const bandTypography: Record<ReadingBand, BandTypography> = {
  picture: {
    band: 'picture',
    showsText: false,
    labelField: 'none',
    maxLabelWords: 0,
    primaryTextPx: null,
    secondaryTextPx: null,
    numeralTextPx: null,
    primaryIconPx: iconPx.hero,
    secondaryIconPx: iconPx.xl,
    minTapPx: tapPx.lg,
    navAvatarPx: iconPx.lg,
    stepIconPx: iconPx.xl,
    stepMarkPx: iconPx.md,
    statusTextPx: null,
    navTapPx: tapPx.md,
    quantity: 'pips',
    maxPips: 5,
  },
  emergent: {
    band: 'emergent',
    showsText: true,
    /**
     * `labelFull` and SIX words, from 2026-09-09. It was `labelShort` and two.
     *
     * The two-word rule was built for this band on purpose — a five-year-old "reads a little,
     * slowly, and only words she already knows by shape" — and the first evening of real use
     * overturned it. Her board read `Clear table` / `Dog` / `Fish`, and the verdict was "on
     * the middle child, you can't read any of the descriptions. It's almost worthless."
     *
     * The mistake was treating SHORT as easy. `Dog` is not a shorter way of saying "fill the
     * dog's water and food"; it is a different and emptier sentence, and the child who is
     * learning to read is exactly the one who needs the words rather than a stub of them.
     * Two words was also below what the card can hold: 364px at this type size takes about
     * 24 characters a line over two lines, which fits every duty this household has.
     *
     * Six rather than unlimited, because the cap still has a job — "collect the trash from
     * around the house and take it out" is eleven words and would clamp to an ellipsis
     * anyway. Truncating on a WORD is a truncation a reader can see; slicing a line is not.
     */
    labelField: 'labelFull',
    maxLabelWords: 6,
    /**
     * 30 -> 24 on 2026-09-09, and it settles two complaints with one number.
     *
     * *"The size scaling is a little aggressive with the middle child and the youngest... they can be shrunk a
     * little bit."* And at 30px his cards still ellipsised the instruction they had just been
     * given — `Clear the table after…` — because three cards across a 800px pane leaves the
     * name about 330px, which is 22 characters a line at 30px and 27 at 24. Every duty this
     * household has fits at 24 and only the shortest fit at 30.
     *
     * The band is not carried by this number: the icon is still 48 where fluent's is 32, the
     * tap floor is still 80 where fluent's is 64, quantity is still numeral-and-pips, and the
     * routine step still leads with a 96px pictogram. What changes is that the words now fit,
     * which for the child who is learning to read is the entire point of showing her words.
     */
    primaryTextPx: fontSizePx.bodyLarge,
    secondaryTextPx: fontSizePx.body,
    numeralTextPx: fontSizePx.display,
    primaryIconPx: iconPx.xl,
    secondaryIconPx: iconPx.md,
    minTapPx: tapPx.md,
    navAvatarPx: iconPx.lg,
    stepIconPx: iconPx.xl,
    stepMarkPx: iconPx.sm,
    statusTextPx: stepDown(fontSizePx.body),
    navTapPx: tapPx.md,
    quantity: 'numeral-and-pips',
    maxPips: 10,
  },
  fluent: {
    band: 'fluent',
    showsText: true,
    labelField: 'labelFull',
    maxLabelWords: 8,
    primaryTextPx: fontSizePx.bodyLarge,
    secondaryTextPx: fontSizePx.small,
    numeralTextPx: fontSizePx.sectionTitle,
    primaryIconPx: iconPx.md,
    secondaryIconPx: iconPx.sm,
    // `min`, the 64px floor, not `md`. Fluent steps and chores are ROWS (H5 §3.3), and at 80 a
    // row came to 96px with its padding: four of them plus their mandatory tap gaps is 432px
    // against the ~294 this pane has, so the fourth step was clipped off the bottom. Literacy
    // buying density is exactly what this token is for.
    minTapPx: tapPx.min,
    navAvatarPx: iconPx.lg,
    stepIconPx: iconPx.sm,
    stepMarkPx: iconPx.sm,
    statusTextPx: stepDown(fontSizePx.small),
    navTapPx: tapPx.md,
    quantity: 'numeral',
    maxPips: 0,
  },
};

/**
 * VIEWING DISTANCE, as a scale (H8, 2026-08-26).
 *
 * `bandTypography` above is the FAR scale, and it stays exactly as it was: it sizes the idle
 * wall, which a parent glances at from the kitchen while making lunches and which the 6:00 AM
 * invariant is about. Nothing on that screen may shrink.
 *
 * `nearTypography` is the same three bands read at ARM'S LENGTH — a child who walked up and put
 * a finger on the glass, or an adult standing at the wall for ninety seconds after dinner.
 * Every text size steps down; NOTHING ELSE MOVES.
 *
 * What deliberately does not move, and why:
 *
 *   - **Tap targets.** Motor skill, not eyesight. A three-year-old's finger is imprecise at six
 *     inches. `minTapPx` and `navTapPx` are identical in both scales.
 *   - **Icons.** The pre-reader's picture is the thing she navigates by and it is not a
 *     legibility compromise, it is the content.
 *   - **The band ladder.** Literacy still buys density — emergent stays a step above fluent in
 *     both scales. The baseline moved; the ordering did not.
 *
 * The old baseline is the direct cause of a week of overflow fights: a routine step rendered a
 * 30px label because 30px reads from ten feet, four steps then wanted 354px in a pane with 300,
 * and the fix was a switcher rebuild and a header cut to make room for type sized for a
 * distance nobody stands at.
 */
export type ViewingDistance = 'near' | 'far' | 'desk';

/**
 * One step down the type scale, floored at the 14px minimum.
 *
 * Exported because viewing distance is not the only thing that legitimately moves a size by one
 * step: a five-across calendar column is 143px, and the week grid steps its chip title down for
 * the same reason `nearTypography` steps everything down — the reader's situation changed, not
 * the design. Anything that wants a smaller size must come through here rather than picking a
 * number, so "one step" means one step everywhere.
 */
export function stepDown(size: number | null): number | null {
  if (size === null) return null;
  const scale = [
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
  const i = scale.indexOf(size);
  // A size that is not ON the scale is left alone rather than guessed at, and the floor holds.
  if (i <= 0) return size;
  return scale[i - 1] ?? size;
}

export const nearTypography: Record<ReadingBand, BandTypography> = {
  picture: bandTypography.picture,
  emergent: {
    ...bandTypography.emergent,
    primaryTextPx: stepDown(bandTypography.emergent.primaryTextPx),
    secondaryTextPx: stepDown(bandTypography.emergent.secondaryTextPx),
    numeralTextPx: stepDown(bandTypography.emergent.numeralTextPx),
    statusTextPx: stepDown(bandTypography.emergent.statusTextPx),
  },
  fluent: {
    ...bandTypography.fluent,
    primaryTextPx: stepDown(bandTypography.fluent.primaryTextPx),
    secondaryTextPx: stepDown(bandTypography.fluent.secondaryTextPx),
    numeralTextPx: stepDown(bandTypography.fluent.numeralTextPx),
    statusTextPx: stepDown(bandTypography.fluent.statusTextPx),
  },
};

/**
 * THE DESK — an adult at a control panel, which is a third reader and not a third distance.
 *
 * H8 named the axis "viewing distance" because the two cases it had were the kitchen and the
 * glass. The grown-up portal is neither: it is the same arm's length as `near`, but the person
 * reading it is an adult operating controls, not a five-year-old finding her chore. An adult
 * reads 14px fine, and the household's verdict on the first version was blunt — *"you can shrink
 * the size in the [admin] tab a lot."*
 *
 * One more step down from `near`, floored at 14px like everything else.
 *
 * WHAT DOES NOT MOVE, and this is the part worth defending: **the 64px tap floor stays.** The
 * rule's stated basis is motor skill rather than eyesight, and while this surface is behind a
 * PIN, it is still a panel in a living room that children stand at — often at an adult's elbow
 * while it is open. It is also the only screen where a mis-tap has a cost: one button sends a
 * child's finished chore back to be done again. Smaller type buys more rows; smaller targets
 * would buy the wrong thing.
 */
export const deskTypography: Record<ReadingBand, BandTypography> = {
  picture: nearTypography.picture,
  emergent: {
    ...nearTypography.emergent,
    primaryTextPx: stepDown(nearTypography.emergent.primaryTextPx),
    secondaryTextPx: stepDown(nearTypography.emergent.secondaryTextPx),
    numeralTextPx: stepDown(nearTypography.emergent.numeralTextPx),
    statusTextPx: stepDown(nearTypography.emergent.statusTextPx),
    secondaryIconPx: iconPx.xs,
  },
  fluent: {
    ...nearTypography.fluent,
    primaryTextPx: stepDown(nearTypography.fluent.primaryTextPx),
    secondaryTextPx: stepDown(nearTypography.fluent.secondaryTextPx),
    numeralTextPx: stepDown(nearTypography.fluent.numeralTextPx),
    statusTextPx: stepDown(nearTypography.fluent.statusTextPx),
    // The row icon comes down with the words, 32 -> 24. On a child's card the picture IS the
    // content and never shrinks; on an adult's row it is a reminder sitting next to a name that
    // already says which chore this is.
    secondaryIconPx: iconPx.xs,
  },
};

export const typographyFor = (band: ReadingBand, distance: ViewingDistance): BandTypography =>
  (distance === 'desk' ? deskTypography : distance === 'near' ? nearTypography : bandTypography)[
    band
  ];

/** Ordered least-literate first, so a fallback always degrades toward pictures. */
export const BAND_ORDER: readonly ReadingBand[] = ['picture', 'emergent', 'fluent'];

// ---------------------------------------------------------------------------
// Contrast rules — the palette's contract, as data
// ---------------------------------------------------------------------------

/**
 * Declared, not eyeballed.  test/unit-g.contrast.test.ts recomputes relative
 * luminance from the hex values and asserts every one of these, using the
 * panel's 0.10 flare term rather than WCAG's 0.05 — in EVERY theme, so a theme
 * is a palette that has passed the same contract, not a mood board.
 *
 * `min` values, and why they are what they are:
 *   7.0  body text on its own ground (WCAG AAA, measured on the harsher metric)
 *   4.0  ink on a coloured solid, valid only for type >= 24px logical
 *   1.6  two child accents, so identity separates in greyscale
 *   1.5  two adjacent state edges, or an edge against the fill it outlines
 *   1.25 two adjacent ground levels (the border carries the rest)
 */
export interface ContrastRule {
  readonly a: ColourTokenName;
  readonly b: ColourTokenName;
  readonly min: number;
  readonly why: string;
}

export const CONTRAST_RULES: readonly ContrastRule[] = [
  { a: '--c-ink', b: '--c-surface', min: 7, why: 'body text on a card' },
  { a: '--c-ink', b: '--c-bg', min: 7, why: 'body text directly on the page' },
  { a: '--c-ink', b: '--c-surface-sunken', min: 7, why: 'body text in a well' },
  { a: '--c-ink-muted', b: '--c-surface', min: 4, why: 'secondary text on a card' },
  { a: '--c-ink-muted', b: '--c-bg', min: 4, why: 'secondary text on the page' },
  { a: '--c-ink-inverse', b: '--c-surface-inverse', min: 7, why: 'text on the dark block' },

  { a: '--c-surface', b: '--c-bg', min: 1.25, why: 'a card must lift off the page' },
  { a: '--c-surface', b: '--c-surface-sunken', min: 1.25, why: 'a well must sink into a card' },
  { a: '--c-border', b: '--c-surface', min: 1.5, why: 'card outline on a card' },
  { a: '--c-border', b: '--c-bg', min: 1.5, why: 'card outline against the page' },
  { a: '--c-border-strong', b: '--c-surface', min: 1.5, why: 'emphasised outline on a card' },
  { a: '--c-border-strong', b: '--c-bg', min: 1.5, why: 'emphasised outline on the page' },

  // Today's column on the week view. Its own axis, so it is graded against what is actually
  // around it: the ink printed on it, and the WHITE day columns either side — that separation
  // is the whole mechanism, and the reason it works with the words switched off. 1.25 is the
  // ground-level rule, the same bar `--c-surface` against `--c-bg` has to clear, and every
  // theme is graded against it. Measured 2026-10-11: felt's and storybook's yellow 1.28,
  // gallery's sky-blue 1.25, and the green they replaced (#CDEBC2) 1.28 on the same metric.
  // One per source stripe. The bar is --c-border's, because that is what a stripe IS.
  { a: '--c-src-slate', b: '--c-surface', min: 1.5, why: 'the slate source stripe on a card' },
  { a: '--c-src-plum', b: '--c-surface', min: 1.5, why: 'the plum source stripe on a card' },
  { a: '--c-src-teal', b: '--c-surface', min: 1.5, why: 'the teal source stripe on a card' },
  { a: '--c-src-moss', b: '--c-surface', min: 1.5, why: 'the moss source stripe on a card' },
  { a: '--c-src-grey', b: '--c-surface', min: 1.5, why: 'the grey source stripe on a card' },
  { a: '--c-src-sun', b: '--c-surface', min: 1.5, why: 'the sun source stripe on a card' },

  { a: '--c-ink', b: '--c-today-fill', min: 4, why: "text in today's column" },
  { a: '--c-today-fill', b: '--c-surface', min: 1.25, why: "today must lift off the other days" },
  { a: '--c-today-edge', b: '--c-today-fill', min: 1.5, why: "today's rule against its own fill" },
  { a: '--c-today-edge', b: '--c-surface', min: 1.5, why: "today's rule against a white column" },

  { a: '--c-ink', b: '--c-leave-ready-fill', min: 4, why: 'the get-ready banner’s words' },
  { a: '--c-leave-ready-fill', b: '--c-surface', min: 1.25, why: 'get-ready must lift off the card' },
  { a: '--c-leave-ready-edge', b: '--c-leave-ready-fill', min: 1.5, why: 'get-ready rule on its fill' },
  { a: '--c-ink', b: '--c-leave-go-fill', min: 4, why: 'the time-to-go banner’s words' },
  { a: '--c-leave-go-fill', b: '--c-surface', min: 1.25, why: 'time-to-go must lift off the card' },
  { a: '--c-leave-go-edge', b: '--c-leave-go-fill', min: 1.5, why: 'time-to-go rule on its fill' },

  { a: '--c-id-1-on', b: '--c-id-1', min: 4, why: 'name/points on child 1 accent (>=24px)' },
  { a: '--c-id-2-on', b: '--c-id-2', min: 4, why: 'name/points on child 2 accent (>=24px)' },
  { a: '--c-id-3-on', b: '--c-id-3', min: 4, why: 'name/points on child 3 accent (>=24px)' },
  { a: '--c-ink', b: '--c-id-1-tint', min: 7, why: 'text on child 1 tint' },
  { a: '--c-ink', b: '--c-id-2-tint', min: 7, why: 'text on child 2 tint' },
  { a: '--c-ink', b: '--c-id-3-tint', min: 7, why: 'text on child 3 tint' },
  { a: '--c-id-1-tint', b: '--c-surface', min: 1.25, why: 'child 1 tint legal only on a card' },
  { a: '--c-id-2-tint', b: '--c-surface', min: 1.25, why: 'child 2 tint legal only on a card' },
  { a: '--c-id-3-tint', b: '--c-surface', min: 1.25, why: 'child 3 tint legal only on a card' },

  { a: '--c-id-1', b: '--c-id-2', min: 1.6, why: 'child 1 vs child 2, in greyscale' },
  { a: '--c-id-2', b: '--c-id-3', min: 1.6, why: 'child 2 vs child 3, in greyscale' },
  { a: '--c-id-1', b: '--c-id-3', min: 1.6, why: 'child 1 vs child 3, in greyscale' },

  { a: '--c-state-done-edge', b: '--c-state-todo-edge', min: 1.5, why: 'done vs to-do edge' },
  { a: '--c-state-todo-edge', b: '--c-state-doing-edge', min: 1.5, why: 'to-do vs waiting edge' },
  { a: '--c-state-doing-edge', b: '--c-state-void-edge', min: 1.5, why: 'waiting vs superseded edge' },
  { a: '--c-state-done-edge', b: '--c-state-doing-edge', min: 1.5, why: 'done vs waiting edge' },
  { a: '--c-state-todo-edge', b: '--c-state-void-edge', min: 1.5, why: 'to-do vs superseded edge' },
  { a: '--c-state-done-edge', b: '--c-state-void-edge', min: 1.5, why: 'done vs superseded edge' },

  { a: '--c-state-todo-edge', b: '--c-state-todo-fill', min: 1.5, why: 'to-do outline on its fill' },
  { a: '--c-state-doing-edge', b: '--c-state-doing-fill', min: 1.5, why: 'waiting outline on its fill' },
  { a: '--c-state-done-edge', b: '--c-state-done-fill', min: 1.5, why: 'done outline on its fill' },
  { a: '--c-state-void-edge', b: '--c-state-void-fill', min: 1.5, why: 'superseded outline on its fill' },
  { a: '--c-ink', b: '--c-state-doing-fill', min: 7, why: 'text on the waiting card' },
  { a: '--c-ink-inverse', b: '--c-state-done-fill', min: 4, why: 'text on the done card (>=24px)' },
  { a: '--c-state-doing-fill', b: '--c-surface', min: 1.2, why: 'a waiting card among plain cards' },

  { a: '--c-ink-inverse', b: '--c-danger', min: 4, why: 'text on a danger solid (adult only)' },
  { a: '--c-danger', b: '--c-surface', min: 4, why: 'danger text on a card (adult only)' },
  { a: '--c-focus', b: '--c-surface', min: 3, why: 'focus ring on a card' },
  { a: '--c-focus', b: '--c-bg', min: 3, why: 'focus ring on the page' },
];
