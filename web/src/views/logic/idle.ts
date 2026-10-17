/**
 * Unit H — the wall shell's memory, which is deliberately short.
 *
 * `activeChildId` and the band override live HERE and only here: in React state,
 * never localStorage, never the server.  A persisted selection is what leaves one
 * child's screen up all night and greets the household with the wrong wall at 6:00
 * AM (H3, adopted as H2 Q3 graft #3).
 *
 * After `--dur-idle-decay` (90 s) of no touch the shell decays to the ambient view.
 *
 * Since 2026-09-13 the open DESTINATION (the calendar, the grown-up screens) and a request
 * for the picture decay here too.  `destination` used to be a `useState` beside the reducer,
 * closed off the back of the reducer's decay — and the reducer only ran its clock while a
 * child was selected, so a calendar opened from the idle wall with nobody selected never
 * closed at all.  The household read that as "stuck on the calendar".  One memory, one clock.
 *
 * The Pi has no RTC: it boots with a wrong clock and NTP steps it, sometimes
 * backwards, sometimes by hours.  Both directions are handled explicitly below —
 * a backwards step must not freeze the decay, which is the exact failure the decay
 * exists to prevent.
 */

import type { ReadingBand } from '../../../../src/types.ts';
import { BAND_ORDER, durationMs } from '../../design/tokens.ts';

export const IDLE_DECAY_MS = durationMs.idleDecay;

/**
 * Picture-first, so every FAILURE in this codebase degrades toward pictures: the
 * renderer error boundary, a missing provider, an unmapped band.
 */
export const FALLBACK_BAND: ReadingBand = BAND_ORDER[0] ?? 'picture';

/**
 * The band the household chrome uses when NOBODY is selected.
 *
 * Deliberately not `FALLBACK_BAND`.  Degrading a broken renderer toward pictures
 * and choosing the idle screen's audience are different decisions that happen to
 * both be about bands.  The idle wall is read by adults and by the seven-year-old —
 * an ambient screen that replaced tonight's events with pictograms would be useless
 * to the person making lunches — while each child's own strip is still scoped to
 * her own band, so the pre-reader's half of that screen stays wordless.
 */
export const AMBIENT_BAND: ReadingBand = 'fluent';

/** Every screen the wall can open on top of whatever the rail has selected. */
export type WallDestination = 'week' | 'approvals' | 'scenes' | null;

export interface WallShellState {
  /** `null` is the ambient view: nobody selected, nothing personal on screen. */
  readonly activeChildId: string | null;
  /** An adult preview override.  Cleared on decay; never persisted. */
  readonly bandOverride: ReadingBand | null;
  /**
   * Which of the wall's own screens is open, on top of the rail's selection.  Independent of
   * `activeChildId` — the week can be opened from a child's screen and filtered to her — and
   * `null` means "whatever the rail says".
   */
  readonly destination: WallDestination;
  /**
   * Somebody tapped the house and asked for the PICTURE.  While this holds, the idle screen is
   * the picture even inside a board window; the decay lets the gate have the wall back.  This
   * is the manual way home from any screen — the gate alone left the household with no path
   * to the picture for the whole evening, and no way to ask for it.
   */
  readonly sceneRequested: boolean;
  readonly lastInteractionAtMs: number;
}

export function initialShellState(atMs: number): WallShellState {
  return {
    activeChildId: null,
    bandOverride: null,
    destination: null,
    sceneRequested: false,
    lastInteractionAtMs: atMs,
  };
}

/** The ambient wall as the gate decides it: nothing selected, nothing open, nothing asked for. */
function ambient(lastInteractionAtMs: number): WallShellState {
  return { activeChildId: null, bandOverride: null, destination: null, sceneRequested: false, lastInteractionAtMs };
}

/** Is there anything for the decay to take back? */
function holdsAnything(state: WallShellState): boolean {
  return (
    state.activeChildId !== null ||
    state.bandOverride !== null ||
    state.destination !== null ||
    state.sceneRequested
  );
}

export type WallShellEvent =
  | { type: 'selectChild'; childId: string; atMs: number }
  /** Open one of the wall's own screens, or close it with `null`.  The selection stays. */
  | { type: 'openDestination'; destination: WallDestination; atMs: number }
  /**
   * The house button: back to the picture from ANYWHERE.  Undoes everything entering a screen
   * did — the selection, the override, the destination — and asks for the picture on top.
   */
  | { type: 'home'; atMs: number }
  | { type: 'interaction'; atMs: number }
  | { type: 'setBand'; band: ReadingBand | null; atMs: number }
  | { type: 'tick'; atMs: number }
  /** The roster changed under us; a selection that no longer exists must go. */
  | { type: 'children'; childIds: readonly string[]; atMs: number };

function touched(state: WallShellState, atMs: number): WallShellState {
  return { ...state, lastInteractionAtMs: atMs };
}

export function wallShell(state: WallShellState, event: WallShellEvent): WallShellState {
  switch (event.type) {
    case 'selectChild':
      // The destination is kept on purpose: the week filtered to her is a real screen.
      return { ...state, activeChildId: event.childId, bandOverride: null, sceneRequested: false, lastInteractionAtMs: event.atMs };
    case 'openDestination':
      return { ...state, destination: event.destination, sceneRequested: false, lastInteractionAtMs: event.atMs };
    case 'home':
      return { ...ambient(event.atMs), sceneRequested: true };
    case 'interaction':
      return touched(state, event.atMs);
    case 'setBand':
      return { ...state, bandOverride: event.band, lastInteractionAtMs: event.atMs };
    case 'tick': {
      // Clock stepped backwards (NTP on an RTC-less Pi).  Re-anchor rather than
      // hold a selection open for however long the step was.
      if (event.atMs < state.lastInteractionAtMs) return touched(state, event.atMs);
      if (!holdsAnything(state)) return state;
      if (event.atMs - state.lastInteractionAtMs < IDLE_DECAY_MS) return state;
      return ambient(state.lastInteractionAtMs);
    }
    case 'children': {
      if (state.activeChildId === null) return state;
      if (event.childIds.includes(state.activeChildId)) return state;
      return { ...state, activeChildId: null, bandOverride: null, lastInteractionAtMs: event.atMs };
    }
    default: {
      const unreachable: never = event;
      throw new Error(`unhandled shell event ${JSON.stringify(unreachable)}`);
    }
  }
}

/** Milliseconds left before decay; 0 when it is due, Infinity when nothing to decay. */
export function msUntilDecay(state: WallShellState, nowMs: number): number {
  if (!holdsAnything(state)) return Infinity;
  if (nowMs < state.lastInteractionAtMs) return IDLE_DECAY_MS;
  return Math.max(0, IDLE_DECAY_MS - (nowMs - state.lastInteractionAtMs));
}

export function isAmbient(state: WallShellState): boolean {
  return state.activeChildId === null;
}

/**
 * The band the shell renders in.  An adult override wins; otherwise it is the
 * active child's own band, set once by an adult and never inferred; with nobody
 * selected the shell sits at `AMBIENT_BAND`.
 *
 * This is a lookup, not a branch — no `ReadingBand` literal is compared anywhere.
 */
export function effectiveBand(
  state: WallShellState,
  children: readonly { id: string; readingBand: ReadingBand }[],
): ReadingBand {
  if (state.bandOverride !== null) return state.bandOverride;
  if (state.activeChildId === null) return AMBIENT_BAND;
  const child = children.find((c) => c.id === state.activeChildId);
  return child?.readingBand ?? FALLBACK_BAND;
}
