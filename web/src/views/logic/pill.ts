/**
 * A pill's two questions, answered without pixels: is it a BUTTON, and is it FILLED.
 *
 * Three flags come in.  `on` is the chosen one of a set (a model, a kind, a schedule): filled,
 * and not a button, because tapping the chosen thing again means nothing.  `solid` is the same
 * fill on a pill that IS a button — a sheet's Next or Add, the one thing on the row the parent
 * came to press.  `live` false is inert: muted, not a button.
 *
 * `on` and `solid` used to be one flag, and on 2026-09-14 the New-chore sheet's Next was drawn
 * filled and dead: a door that gated nothing, this project's signature bug.  This file exists so
 * that the answer is a function with a test, not a face with an eyeball.
 */

export interface PillFlags {
  readonly on: boolean;
  readonly solid: boolean;
  readonly live: boolean;
}

export interface PillState {
  /** A real button that fires `onTap`. */
  readonly enabled: boolean;
  /** Ink fill with inverse text. */
  readonly filled: boolean;
  /** The sunken, muted face: not chosen and not live. */
  readonly muted: boolean;
}

export function pillState({ on, solid, live }: PillFlags): PillState {
  const filled = on || solid;
  return {
    enabled: live && !on,
    filled,
    muted: !live && !filled,
  };
}
