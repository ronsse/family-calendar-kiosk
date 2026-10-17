/**
 * The grown-up portal, and the one PIN that opens it.
 *
 * ## Why this is a module and not two `useState`s
 *
 * The wall has two grown-up destinations — the approvals queue and the picture catalog — and
 * until 2026-09-10 each held its own idea of whether a PIN had been entered.  Approvals held
 * one per visit; Pictures asked per action.  Both were defensible on their own and together
 * they were neither, because from the room there is one door with the word "Grown-ups" on it.
 * An adult who has just proved who they are to approve four chores should not be asked again
 * to put a picture up.
 *
 * So the PIN is held for a VISIT TO THE PORTAL, and this module owns exactly what that phrase
 * means: which destinations are inside it, and what happens to the held PIN when the wall
 * moves.  Both are decisions, both are testable, and neither belongs in a `.tsx` the test
 * runner cannot load.
 *
 * ## How far this relaxes the rule, exactly
 *
 * The rule was one PIN entry per REQUEST — never a session — because children and guests touch
 * this panel.  What is given up: while the portal is open, whoever is standing at it can decide
 * anything in it.  What is NOT given up:
 *
 *   - **The server is untouched.**  `requireParentPin` is still per request (docs/api.md §Auth).
 *     Nothing here grants standing authority; the screen retypes what it was handed.
 *   - **Leaving the portal forgets it**, by `visitPinAfterMove` below — and "leaving" includes
 *     the idle decay, which closes every destination after 90 seconds.  A parent who walks away
 *     has closed the door behind them without knowing it.
 *   - **It is never written down.**  No storage, no cookie, no module-level binding: the value
 *     lives in React state at the root and dies with a reload.
 *
 * The door CHECKS the PIN now (2026-10-11), and still without a verify route — inventing one
 * would be a second way to check a PIN, a second door to keep in step with the first.  The
 * portal's first screen needs the household settings, and reading them is an admin request
 * like any other, so the door stays shut until that read answers (`verifying` in
 * ApprovalsView).  A PIN the server refuses is forgotten and the pad comes back before anything
 * behind the door is drawn.  Until then a wrong PIN opened the portal and was only found out at
 * the first decision.
 */

import type { WallDestination } from '../views/logic/idle.ts';

/** Re-exported: the destination is shell memory now (idle.ts), and callers here predate that. */
export type { WallDestination };

/**
 * What is behind the door.  The calendar is NOT: it is a child's destination that adults also
 * read, it decides nothing, and putting it in here would keep a PIN alive while the wall showed
 * a screen with no adult surface on it at all.
 */
export const GROWNUP_DESTINATIONS = ['approvals', 'scenes'] as const;

export type GrownupDestination = (typeof GROWNUP_DESTINATIONS)[number];

export function isGrownupDestination(destination: WallDestination): destination is GrownupDestination {
  return destination !== null && (GROWNUP_DESTINATIONS as readonly string[]).includes(destination);
}

/**
 * The held PIN after the wall moves to `to` — the whole lifetime rule, in one function.
 *
 * Inside the portal it survives, so approving four chores and then putting a picture up is one
 * entry.  Anywhere else it is gone, and `null` (the idle wall, the home button, a child's
 * screen) is emphatically "anywhere else".
 */
export function visitPinAfterMove(held: string | null, to: WallDestination): string | null {
  return isGrownupDestination(to) ? held : null;
}
