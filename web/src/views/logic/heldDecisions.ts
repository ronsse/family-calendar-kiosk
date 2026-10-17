/**
 * Approval undo (pass 2, #3): a decision taken in Waiting is HELD for a few seconds before it is sent.
 *
 * Why a delayed send and not a reversal. Approving writes a ledger row and a balance a child can
 * see. A server-side undo would need a second row that takes the points back. That is honest
 * bookkeeping, but it would put an approve-and-unapprove pair in the household's history for every
 * slip of a finger. A decision held on the wall writes NOTHING until the window closes, so the ledger
 * only ever holds what an adult meant. Its one cost: if the wall reloads inside the window, the decision
 * never left. The row is then simply still waiting, which is the safe way to lose it.
 *
 * Only the Waiting rows hold. A decision taken through the pad (no PIN held yet) was already a
 * deliberate two-step act, and it goes at once as before. Leaving Waiting, leaving the portal, or the
 * idle decay sends everything held at once (`flushAll`). Nothing is dropped just because the
 * screen moved on.
 */

import type { ApprovalDecision, ApprovalItem } from '../../app/adminActions.ts';

export const UNDO_WINDOW_MS = 5_000;
export const UNDO_WORDS = 'Undo';

export interface HeldDecision {
  readonly item: ApprovalItem;
  readonly decision: ApprovalDecision;
  /** The PIN it will be sent with: the visit's, at the moment of the tap. */
  readonly pin: string;
  readonly atMs: number;
}

/** Hold a decision. A second decision on the same row replaces the first and restarts its window. */
export function holdDecision(
  held: readonly HeldDecision[],
  item: ApprovalItem,
  decision: ApprovalDecision,
  pin: string,
  nowMs: number,
): readonly HeldDecision[] {
  return [...held.filter((h) => h.item.key !== item.key), { item, decision, pin, atMs: nowMs }];
}

/** Undo: the row goes back to waiting, and nothing was ever sent. */
export function undoDecision(held: readonly HeldDecision[], key: string): readonly HeldDecision[] {
  return held.filter((h) => h.item.key !== key);
}

/** Split into what must be sent now and what is still inside its window. */
export function dueDecisions(
  held: readonly HeldDecision[],
  nowMs: number,
): { readonly due: readonly HeldDecision[]; readonly rest: readonly HeldDecision[] } {
  const due: HeldDecision[] = [];
  const rest: HeldDecision[] = [];
  for (const h of held) (nowMs - h.atMs >= UNDO_WINDOW_MS ? due : rest).push(h);
  return { due, rest };
}

/** When the next held decision is due, or null when nothing is held. */
export function nextDueAtMs(held: readonly HeldDecision[]): number | null {
  let at: number | null = null;
  for (const h of held) {
    const due = h.atMs + UNDO_WINDOW_MS;
    if (at === null || due < at) at = due;
  }
  return at;
}

export function isHeld(held: readonly HeldDecision[], key: string): boolean {
  return held.some((h) => h.item.key === key);
}
