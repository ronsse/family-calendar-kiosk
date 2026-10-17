/**
 * Unit H — the renderer contract: the props each of the seven leaves receives,
 * identically, in all three bands.
 *
 * The shape is deliberately WIDER than any one band needs.  Every band gets the
 * same props and each takes only the channels its band is allowed to use:
 *
 *   picture   icons, pips, glyphs, dials.  No text field is even referenced.
 *   emergent  the above plus the FULL label, capped at six words. It was `labelShort`
 *             and two words until 2026-09-09; see bandTypography.emergent for why real use
 *             overturned that. `labelShort` is still on this contract for surfaces that
 *             genuinely cannot fit a sentence, such as a 190px week column.
 *   fluent    everything, including numerals and full sentences.
 *
 * That is what makes "one state, three renderings" (PRD §4) true by construction
 * rather than by three parallel prop shapes that drift.  Derived values —
 * `pips`, the pre-formatted time strings, `treatment` — are computed ONCE in the
 * domain component and passed down, which is also what lets the picture band avoid
 * touching a numeric or textual field at all.
 *
 * `RendererSet` extends the FROZEN `BandRenderers<C>` from src/types.ts, narrowing
 * each slot to its own props.  Adding a leaf to the frozen interface is therefore a
 * compile error here until all three bands implement it.
 */

import type { CashOutOption } from './logic/balances.ts';
import type { ReactElement, ReactNode } from 'react';
import type {
  AssetRef,
  BandRenderers,
  ChoreState,
  LocalTime,
  MaterializationStatus,
  SceneBox,
} from '../../../src/types.ts';
import type { ChildAccent, StateTreatment } from '../design/tokens.ts';
import type { PipSpec } from './logic/pips.ts';
import type { RoutineStepFit } from './logic/routineFit.ts';
import type { MarkForm, MarkSide } from './logic/theme.ts';

// ---------------------------------------------------------------------------
// Glyphs — the non-colour channel.  Colour is the weakest channel this panel has.
// ---------------------------------------------------------------------------

/**
 * The first four are exactly `StateTreatment.glyph`, so a treatment can be handed
 * to a glyph without translation.  The rest are the wall's own vocabulary.
 */
export type GlyphName =
  | 'empty-circle'
  | 'hourglass'
  | 'check'
  | 'crossed'
  | 'cross'
  | 'minus'
  | 'plus'
  | 'star'
  | 'moon'
  | 'sun'
  | 'clock'
  | 'gift'
  | 'alert'
  | 'sync'
  | 'home'
  | 'calendar'
  | 'grown-up'
  | 'picture'
  | 'back'
  | 'forward'
  | 'up'
  | 'down'
  | 'lots'
  | 'unknown';

// ---------------------------------------------------------------------------
// Leaf props
// ---------------------------------------------------------------------------

export interface AvatarProps {
  readonly childId: string;
  readonly avatar: AssetRef;
  readonly accent: ChildAccent;
  readonly selected: boolean;
  /*
   * NO PROGRESS. The avatar carried today's progress as marks and as numbers until 2026-10-11,
   * and had not drawn either since the rail went vertical and every face `compact` — so the
   * props were computed on every render and reached nothing. The rail is navigation (ChildBar
   * says why), and progress lives on the child's own screen. If it comes back to the face it
   * comes back as a ring, and `childDayProgress` / `pipsForProgress` are still there for it.
   *
   * NO NAME EITHER, since 2026-10-11 — the leaf is handed a `nameplate` to place, below. Each
   * band used to draw its own child's name: the fluent reader's whole name, the emergent reader's
   * first word, and nothing for the pre-reader, which read on the glass as one name cut off and
   * one dropped.
   */
  /**
   * The child's name as the RAIL draws it — whole, at the one size every name on that rail is
   * set at (logic/railNames.ts) — or absent for a face alone: the grown-up screens' plain column,
   * where width is the scarce axis. A leaf PLACES it, beside or below the face per `nameAt` and
   * inside its own tap target so face and name are one key, and never reads or restyles it.
   *
   * It is chrome, for the readers in the room; the child whose face it is finds herself by the
   * face. That is why the picture band carries one too without its leaf touching a word: the
   * pre-reader's tile was the only one without a name, and it read as his name gone missing.
   */
  readonly nameplate?: ReactNode;
  /**
   * Where the nameplate goes: `below` the face — gallery's plinth and storybook's spine — or
   * `beside` it, felt's bottom row: a face and a name pill in a bar one tap target tall, where a
   * stacked tile would not fit.
   */
  readonly nameAt?: 'beside' | 'below' | undefined;
  /** The face's size when the rail sets it (every named rail); the band's `navAvatarPx` otherwise. */
  readonly faceSizePx?: number | undefined;
  /** The frame's shape — the theme's (`WallLayout.faceFrame`). Round when absent. */
  readonly frame?: MarkForm | undefined;
  /**
   * Whether `selected` also fills the tile with the child's tint. True when absent. The plinth
   * and the spine say "selected" with their own shape — a heavy frame, a bookmark joined to the
   * page — and a tint behind that would be the same word twice, in the weaker channel.
   */
  readonly selectedTint?: boolean | undefined;
  readonly onSelect: () => void;
  /**
   * Crop `avatar` to this rectangle: the child's head in the picture that is on the wall
   * (2026-09-16).  Null — the common case, and every case before that date — means `avatar` is
   * her cartoon portrait and is drawn whole.  See `logic/sceneFace.ts`.
   */
  readonly crop?: SceneBox | null;
}

export interface RoutineStepProps {
  readonly runStepId: number;
  readonly position: number;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
  readonly done: boolean;
  /**
   * Pre-formatted local wall-clock time of completion; "" when not done, and "" when the step is
   * a cell of a grid too narrow to hold it beside the label (`stepTimeFits`).
   */
  readonly doneAtText: string;
  /**
   * The undo window is open: this tap has not been sent yet.
   *
   * NO BAND DRAWS THIS, deliberately, since 2026-09-16. All three used to swap the state
   * glyph for an hourglass while it was true, which showed a child the transport rather than
   * her chore and made every tap look like a countdown. It stays on the contract because the
   * state is real and a band may yet find an honest way to show it — but the default is to
   * say nothing, and a band adding it back needs a better reason than "it is available".
   */
  readonly undoPending: boolean;
  /**
   * The confirm ring is showing: one tap has landed and NOTHING has been applied yet.
   * Distinct from `undoPending`, which means the opposite — the change IS applied and
   * can still be taken back. A band that draws them the same way would tell a child
   * her step is done when it is not.
   */
  readonly confirmPending: boolean;
  /** True when this is the first not-yet-done step — the one to point at. */
  readonly isNext: boolean;
  /**
   * Draw the position, set by the THEME (`WallLayout.numberedSteps`) rather than by the band.
   *
   * The steps are one column wherever one column holds them, and a column says "this one, then
   * this one" by itself; past that they are a few columns, filled across and then down, and the
   * next-step ring points whichever way the grid is read (logic/routineFit.ts). Storybook numbers
   * them anyway, because a book numbers the one list on the wall that IS a sequence; felt and
   * gallery let position and the ring carry the order. Each band draws the number in its own
   * currency — a numeral for the readers, pips for the pre-reader.
   *
   * It is never the ONLY carrier of order — `isNext` is a focus ring and `done` changes the
   * mark, so the non-colour channels the 225-nit panel requires are there without it.
   */
  readonly showOrder: boolean;
  /**
   * The step's sizes, decided once for the whole routine by `fitRoutineGrid` from how many
   * steps there are and how big the pane is. Every step in a routine gets the same fit, so the
   * list never jumps when a step changes state; a band draws its picture, mark and label at
   * these sizes and not at its own.
   */
  readonly fit: RoutineStepFit;
  /** Which end of the row the state mark sits at (`WallLayout.stepMark`). */
  readonly markSide: MarkSide;
  /** The state mark's shape: felt's round sticker or a box (`WallLayout.stateMark`). */
  readonly markShape: MarkForm;
  readonly onToggle: () => void;
}

export interface ChoreCardProps {
  readonly assignmentId: number;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
  readonly state: ChoreState;
  readonly treatment: StateTreatment;
  readonly stateWordShort: string;
  readonly stateWordFull: string;
  readonly points: number;
  /** The same points, as marks, for the bands that cannot read a numeral. */
  readonly pips: PipSpec;
  readonly accent: ChildAccent;
  /** False for a chore nobody can act on right now (claimed, approved, void). */
  readonly interactive: boolean;
  /**
   * Past its `dueByLocal` and still not done — rendered as "there is STILL TIME", never as a
   * warning (H10 panel, unanimous D).
   *
   * This wall stands in a living room. Three children share it and can see each other's boards,
   * and guests see all of it, so a visible failure state is a public one. Every band therefore
   * draws this with the `clock` glyph and an emphasis, and NONE of them may reach for `alert`,
   * the danger token, or the void treatment: those say "you did not do this" where the design
   * says "you can still do this".
   *
   * There is no counterpart for `missed`. A chore that ends the day pending is simply not on
   * the board tomorrow; it never becomes a thing a child is shown having failed.
   *
   * It is EMPHASIS IN PLACE and never a re-order. The panel offered "sorted to the top" and
   * both reviewers named the sort as the risk — the pre-reader navigates by *always the same
   * place*, and moving a tile out from under a finger already reaching for it costs more than
   * the ordering buys on a board this short.
   */
  readonly stillTime: boolean;
  /** See `RoutineStepProps.undoPending`: real, passed, and deliberately undrawn. */
  readonly undoPending: boolean;
  /** Which end of the card the state mark sits at (`WallLayout.choreMark`). */
  readonly markSide: MarkSide;
  /** The state mark's shape (`WallLayout.stateMark`). */
  readonly markShape: MarkForm;
  readonly onClaim: () => void;
}

export interface PointsBadgeProps {
  readonly childId: string;
  readonly points: number;
  readonly pips: PipSpec;
  /** "$1.25", or null when the household rate is unset. */
  readonly cashText: string | null;
  /** No data source in the frozen snapshot yet; renderers draw it when it exists. */
  readonly streakDays: number | null;
  readonly accent: ChildAccent;
  /** Points sitting in a pending redemption request, or null when there is none. */
  readonly pendingRedemptionPoints: number | null;
  /**
   * What she may ask for, cheapest first, with "all of it" last. Empty when she cannot ask —
   * no balance, no rate, or a request already pending.
   *
   * A LIST rather than a single action, from 2026-09-07. Cashing out used to mean the whole
   * balance and nothing else, and that was not the conservative default it looked like: points
   * are destroyed at approval, so "ask for all of it and let the adult hand over less" silently
   * burns the difference. The panel that settled this (unanimous) chose fixed money buttons
   * with unaffordable ones ABSENT — the option is not there, rather than there and refused,
   * which is how guardrails work everywhere else in this codebase.
   */
  readonly cashOutOptions: readonly CashOutOption[];
  /** Takes the amount, because there is now more than one. */
  readonly onRequestRedemption: ((points: number) => void) | null;
}

export interface EventCardProps {
  readonly eventId: number;
  readonly title: string;
  readonly icon: AssetRef;
  /**
   * The event's own emoji, or `null`.
   *
   * Drawn INSTEAD of `icon` where there is one — see primitives/EmojiOrIcon. The drawn set has
   * ten categories and every sport shares a ball; this is the channel that can tell gymnastics
   * from swimming from dance, which is what the two non-readers actually need from a row.
   */
  readonly emoji: string | null;
  /** "7:30 AM" or the all-day word.  Bands with no text ignore it. */
  readonly timeText: string;
  /** Local start, for the picture band's dial.  Null for an all-day event. */
  readonly startsAtLocalTime: LocalTime | null;
  readonly isAllDay: boolean;
  /** The child this event belongs to, or null for a household event. */
  readonly accent: ChildAccent | null;
  /**
   * The stripe for the CALENDAR this event came from, already resolved.
   *
   * A child accent still wins where there is one — whose it is beats where it came from. This
   * is what a household event gets instead of the plain card border, so School reads
   * differently from Family without anybody having to read a legend.
   */
  readonly sourceStripe: string;
}

export interface CountdownCardProps {
  readonly countdownId: string;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
  /** Drawn INSTEAD of `icon` when present — see primitives/EmojiOrIcon. */
  readonly emoji: string | null;
  readonly sleepsRemaining: number;
  /** Sleeps as moons, for the band that cannot read "3". */
  readonly pips: PipSpec;
  readonly targetDateText: string;
}

export interface StatusPillProps {
  readonly tone: MaterializationStatus;
  readonly glyph: GlyphName;
  readonly labelShort: string;
  readonly labelFull: string;
}

// ---------------------------------------------------------------------------
// The registry's element type
// ---------------------------------------------------------------------------

/**
 * A presentational leaf.  Plain function components: no children, no refs, no
 * hooks that own state — all stateful logic lives once, in the domain layer.
 */
export type RendererComponent<P> = (props: P) => ReactElement | null;

/**
 * The base every leaf is assignable to.  `never` as the parameter makes any
 * concrete `RendererComponent<P>` assignable to it under strict contravariance,
 * which is what lets `RendererSet` narrow the frozen `BandRenderers<C>` slots
 * without `any` appearing anywhere in this codebase.
 */
export type AnyRenderer = RendererComponent<never>;

export interface RendererSet extends BandRenderers<AnyRenderer> {
  Avatar: RendererComponent<AvatarProps>;
  RoutineStep: RendererComponent<RoutineStepProps>;
  ChoreCard: RendererComponent<ChoreCardProps>;
  PointsBadge: RendererComponent<PointsBadgeProps>;
  EventCard: RendererComponent<EventCardProps>;
  CountdownCard: RendererComponent<CountdownCardProps>;
  StatusPill: RendererComponent<StatusPillProps>;
}

export type LeafName = keyof BandRenderers<AnyRenderer>;

export interface LeafPropsByName {
  Avatar: AvatarProps;
  RoutineStep: RoutineStepProps;
  ChoreCard: ChoreCardProps;
  PointsBadge: PointsBadgeProps;
  EventCard: EventCardProps;
  CountdownCard: CountdownCardProps;
  StatusPill: StatusPillProps;
}

/**
 * The seven names as data, so the exhaustiveness test can iterate them without
 * importing a `.tsx` file (node's type stripping cannot load JSX).  The two
 * compile-time checks below are the real guarantee: a leaf added to the frozen
 * `BandRenderers` and forgotten here fails `tsc`, not just the test.
 */
export const RENDERER_NAMES = [
  'Avatar',
  'RoutineStep',
  'ChoreCard',
  'PointsBadge',
  'EventCard',
  'CountdownCard',
  'StatusPill',
] as const satisfies readonly LeafName[];

type MissingFromNames = Exclude<LeafName, (typeof RENDERER_NAMES)[number]>;
type MissingFromProps = Exclude<LeafName, keyof LeafPropsByName>;

const _everyLeafIsNamed: [MissingFromNames] extends [never] ? true : never = true;
const _everyLeafHasProps: [MissingFromProps] extends [never] ? true : never = true;
void _everyLeafIsNamed;
void _everyLeafHasProps;
