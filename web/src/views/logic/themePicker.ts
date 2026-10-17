/**
 * The grown-up Settings' Theme picker, as data.
 *
 * Three looks, one option each, and each option carries everything its card draws: the look's
 * name, whether it is the household's default, whether the wall wears it now, whether a tap on
 * it would do anything, and a SWATCH — the look's own ground, card, accents and face rail.
 *
 * ## The swatch is literal values, and it has to be
 *
 * Every renderer on the wall draws with `var(--x, <felt>)` strings, which resolve against the
 * root's `data-wall-theme`. Drawn that way, three swatches would be three copies of whichever
 * look is up — the one thing a picker must never show. So the swatch reads each look's own
 * table (`themeTokens`, which tokens.ts keeps for the tests and for exactly this), and a
 * DERIVED token is resolved inside that look's table too: felt's card edge is
 * `var(--c-border-strong)`, and resolved against the page instead of against felt it would
 * borrow the edge of whatever the wall is wearing.
 *
 * ## Every option is live unless a request is in flight
 *
 * Including the one already chosen. Tapping it asks the server for the look the wall already
 * wears, which answers with the same settings and pushes nothing (the route only tells the
 * screens when something changed) — a radio button that does nothing because nothing needs
 * doing, not a dead control. While ANY admin request is out, all three are inert, exactly like
 * every stepper on this screen: two writes racing is how a screen ends up showing the loser.
 *
 * Kept out of the `.tsx` so it can be tested (CLAUDE.md: a logic module never imports a
 * component file, and the test runner cannot load one).
 */

import { DEFAULT_WALL_THEME, type WallThemeId } from '../../../../src/types.ts';
import { themeTokens, type CssTokenName } from '../../design/tokens.ts';
import { layoutFor, resolveWallTheme, type MarkForm, type RailForm } from './theme.ts';

/** What the household calls each look — the designer's names, which the household chose from. */
export const THEME_NAMES: Readonly<Record<WallThemeId, string>> = {
  felt: 'Felt board',
  gallery: 'Gallery',
  storybook: 'Storybook',
};

/**
 * A, B, C: the order the three were drawn in and shown to the household, and the order the
 * admin mockup lays the picker out in (the admin mockups (private notes), screen 8). The
 * default sits in the middle, which is where it was when it was chosen.
 */
export const PICKER_ORDER: readonly WallThemeId[] = ['gallery', 'felt', 'storybook'];

/** One look in miniature: everything here is a literal CSS value from that look's own table. */
export interface ThemeSwatch {
  readonly ground: string;
  /** `none`, or felt's dotted felt — the ground's texture, resolved. */
  readonly groundTexture: string;
  readonly groundTextureSize: string;
  readonly card: string;
  readonly cardEdge: string;
  readonly cardEdgeWidth: string;
  readonly cardCorner: string;
  readonly cardShadow: string;
  /** Where the faces stand: felt's bottom row, gallery's plinth, storybook's spine. */
  readonly rail: RailForm;
  /** What the faces stand on. Null for felt, whose faces stand on the ground itself. */
  readonly railFill: string | null;
  /** The line between the rail and the page. Null where there is no rail surface. */
  readonly railEdge: string | null;
  readonly faceFrame: MarkForm;
  /** The three children's accents, in slot order. */
  readonly accents: readonly [string, string, string];
}

export interface ThemeOption {
  readonly theme: WallThemeId;
  readonly name: string;
  readonly isDefault: boolean;
  /** The wall wears this one now. */
  readonly selected: boolean;
  /** A tap would send. False for all three while a request is in flight, and never otherwise. */
  readonly live: boolean;
  readonly swatch: ThemeSwatch;
}

/**
 * A token's value under `theme`, with every `var(--x)` inside it replaced by --x's value
 * under the SAME theme. Throws on a reference the table does not declare or a cycle — both are
 * stylesheet bugs the tokens test already refuses, and a swatch is the wrong place to guess.
 */
export function themeLiteral(theme: WallThemeId, name: CssTokenName): string {
  const table = themeTokens(theme);
  const resolve = (token: CssTokenName, seen: readonly string[]): string => {
    if (seen.includes(token)) throw new Error(`token cycle: ${[...seen, token].join(' -> ')}`);
    return table[token].replace(/var\((--[a-z0-9-]+)\)/g, (_whole: string, ref: string) => {
      if (!Object.hasOwn(table, ref)) throw new Error(`${token} references undeclared ${ref}`);
      return resolve(ref as CssTokenName, [...seen, token]);
    });
  };
  return resolve(name, []);
}

export function themeSwatch(theme: WallThemeId): ThemeSwatch {
  const v = (name: CssTokenName) => themeLiteral(theme, name);
  const layout = layoutFor(theme);
  return {
    ground: v('--c-bg'),
    groundTexture: v('--ground-texture'),
    groundTextureSize: v('--ground-texture-size'),
    card: v('--c-surface'),
    cardEdge: v('--edge-card'),
    cardEdgeWidth: v('--stroke-card'),
    cardCorner: v('--r-md'),
    cardShadow: v('--shadow-card'),
    rail: layout.rail,
    // The same surfaces ChildBar's `railStyle` gives each form, so the miniature is the wall's.
    railFill:
      layout.rail === 'plinth'
        ? v('--c-surface-sunken')
        : layout.rail === 'spine'
          ? v('--c-surface-inverse')
          : null,
    railEdge:
      layout.rail === 'plinth' ? v('--c-border') : layout.rail === 'spine' ? v('--c-border-strong') : null,
    faceFrame: layout.faceFrame,
    accents: [v('--c-id-1'), v('--c-id-2'), v('--c-id-3')],
  };
}

/**
 * The picker's three options, in `PICKER_ORDER`.
 *
 * `current` is `unknown` on purpose: it is the settings RESPONSE's field, which an older server
 * does not send. Anything that is not a look is felt — the same rule the wall itself follows —
 * so the picker can never show nothing selected while the wall is plainly wearing something.
 */
export function themeOptions(current: unknown, busy: boolean): readonly ThemeOption[] {
  const wearing = resolveWallTheme(current);
  return PICKER_ORDER.map((theme) => ({
    theme,
    name: THEME_NAMES[theme],
    isDefault: theme === DEFAULT_WALL_THEME,
    selected: theme === wearing,
    live: !busy,
    swatch: themeSwatch(theme),
  }));
}
