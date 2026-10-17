/**
 * Unit H — which chores go on which board, and which of them are running late.
 *
 * Pure, total, no I/O. Two questions live here because both are decided by the same three
 * inputs and getting them subtly different in two renderers is exactly the failure the
 * build-plan's contracts-first rule exists to prevent.
 *
 * ## Lateness is DERIVED, and that is a design decision, not an implementation detail
 *
 * There is no `overdue` state in the data and there must never be one. A stored state needs
 * something to write it, and the candidates are both bad: a cron — and a 5:55 AM cron that
 * fails leaves a blank wall at 6:00, which PRD §4 forbids outright — or a request, which makes
 * a chore late only if somebody happened to look at it. Derived from `(pending, dueByLocal,
 * now)` it is correct at every instant with nothing running at all, and it moves on the clock
 * tick the wall already has rather than waiting for a snapshot rebuild.
 *
 * ## Overdue is an INVITATION, never an accusation (H10 panel, unanimous D)
 *
 * This wall is in a living room. Three children share it, they can see each other's boards, and
 * guests see all of it. So `overdue` renders as "there is still time" and never as an alert —
 * the `alert` glyph and the danger treatment are both deliberately unused here.
 *
 * `missed` does not exist on a child's board at all. A chore that ends the day pending is
 * simply not there tomorrow; it never becomes a visible failure. The state is still available
 * to the adult surface, which is where a record of what did not happen belongs.
 *
 * ## It marks in place, it does NOT re-sort
 *
 * The panel offered "sorted to the top, emphasised" and both reviewers named the sort as the
 * risk: the pre-reader navigates by *always the same place*, and re-ordering moves a tile out
 * from under a finger already reaching for it. Marking carries the whole of the information
 * with none of that, and the boards here are short enough that sorting buys almost nothing.
 * So `boardChores` preserves order and the emphasis is a per-chore flag.
 */

import type { ChoreAssignmentView, ChoreKind, ChoreState, LocalTime } from '../../../../src/types.ts';

/** A chore plus the two things the renderer needs that are not on the wire type. */
export interface BoardChore {
  readonly chore: ChoreAssignmentView;
  /**
   * Past its bound and still not done.  Rendered as "still time", never as a warning.
   */
  readonly overdue: boolean;
}

/**
 * Is "HH:MM" a time we can compare at all?
 *
 * Deliberately strict, and deliberately NOT trusting the branded type: `LocalTime` is a string
 * brand, so an unvalidated value that crossed the wire wears the brand without earning it.
 * `read.ts` already normalises on the way out of SQLite; this is the second half of the same
 * belt, on the side where being wrong accuses a child of being late.
 */
function isClockTime(v: unknown): v is string {
  return typeof v === 'string' && /^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(v);
}

/**
 * Is this chore past its bound?
 *
 * Lexicographic comparison of two zero-padded "HH:MM" strings is a correct minute-of-day
 * comparison, and it is the same trick `timeBoxState` uses on the same shape — one way to
 * compare wall-clock times in this codebase, not two.
 *
 * Everything unreadable answers FALSE. A chore with no bound, a malformed bound, or a clock we
 * cannot parse is NOT overdue: the failure direction that stays silent is the only acceptable
 * one when the alternative is telling a five-year-old she is late because a string was mistyped.
 */
export function isOverdue(chore: ChoreAssignmentView, nowLocal: LocalTime | string): boolean {
  // Only a chore nobody has acted on can be late. Claimed, approved and superseded are all
  // "this is dealt with", and a claim awaiting a grown-up is the child's part already done.
  if (chore.state !== 'pending') return false;
  if (!isClockTime(chore.dueByLocal)) return false;
  if (!isClockTime(nowLocal)) return false;
  return nowLocal > chore.dueByLocal;
}

/**
 * One child's chores of one kind, in board order, each marked for lateness.
 *
 * `superseded` is NOT on the board. It is a terminal, non-paying state — the loser of a
 * `first_complete` race — and until 2026-09-15 the card stayed up, faded, with "Someone else
 * got it" on it. The household's verdict: once a shared job is done it should not show up on
 * anybody else's screen. A job that is finished is finished; a faded card of it is a job that
 * looks half-open to a five-year-old and reads as "you were too slow" to the seven-year-old.
 * The ring agrees (`choreProgress`): a loss was never work this child could still do.
 *
 * The card leaves the column, so the cards under it move up — the one time this board
 * re-orders under a finger. It is the sibling's tap that does it, not hers, and it happens at
 * most once per race; the stable-order rule below is about her OWN taps.
 */
export function boardChores(
  chores: readonly ChoreAssignmentView[] | undefined,
  childId: string,
  kind: ChoreKind,
  nowLocal: LocalTime | string,
): BoardChore[] {
  const out: BoardChore[] = [];
  for (const chore of chores ?? []) {
    if (chore.childId !== childId) continue;
    if (chore.kind !== kind) continue;
    if (chore.state === 'superseded') continue;
    out.push({ chore, overdue: isOverdue(chore, nowLocal) });
  }
  // Soonest bound first, unbounded last, and NEVER by state. The board is one column now
  // (2026-09-13) and "what is next" is the order a list of jobs wants — but a card must stay
  // where it is when she taps it. Ordering by state would move a freshly claimed card down
  // the column under her finger, and the undo tap that follows would land on whichever card
  // slid up into its place. Due time does not change with a tap; the order is stable all day.
  out.sort((a, b) => {
    const ad = a.chore.dueByLocal;
    const bd = b.chore.dueByLocal;
    if (ad !== bd) {
      if (ad === null) return 1;
      if (bd === null) return -1;
      if (ad !== bd) return ad < bd ? -1 : 1;
    }
    return a.chore.assignmentId - b.chore.assignmentId;
  });
  return out;
}

/**
 * The state a chore card draws, given the server's word and the child's own last tap.
 *
 * The only states the wall may invent are the ones its own taps imply: a pending card she
 * just claimed shows "Waiting", and a waiting card she just took back shows as to-do again.
 * Anything decided by an adult is drawn exactly as the server says, whatever the gate holds.
 *
 * `next` is what a tap on that card would ask for — `true` claims, `false` unclaims — and is
 * `null` when the card is not a control. It is derived HERE, from the same state the card is
 * drawn in, so the drawn state, the interactivity and the tap direction cannot disagree: the
 * 2026-09-13 dead-undo bug was exactly those three being decided in three places.
 */
export function shownChoreTap(
  serverState: ChoreState,
  claimedLocally: boolean,
): { state: ChoreState; next: boolean | null } {
  const state: ChoreState =
    serverState === 'pending' && claimedLocally ? 'claimed'
    : serverState === 'claimed' && !claimedLocally ? 'pending'
    : serverState;
  const next = state === 'pending' ? true : state === 'claimed' ? false : null;
  return { state, next };
}

/**
 * How many of a kind are done, for the switcher's progress ring.
 *
 * `isDone` is passed in rather than read off the state, because the ring has to agree with what
 * the child can see — and what she can see includes her own optimistic tap, which lives in the
 * tap gate and not in the snapshot. A ring that ignored the gate would sit still for the whole
 * undo window after she ticked something, which reads as the tap not having worked.
 */
export function choreProgress(
  chores: readonly ChoreAssignmentView[] | undefined,
  childId: string,
  kind: ChoreKind,
  isDone: (chore: ChoreAssignmentView) => boolean,
): { done: number; total: number } {
  let done = 0;
  let total = 0;
  for (const chore of chores ?? []) {
    if (chore.childId !== childId) continue;
    if (chore.kind !== kind) continue;
    // A superseded chore is not work this child can still do, so it is not in the denominator.
    // Left in, a child who lost one race would have a ring that could never fill.
    if (chore.state === 'superseded') continue;
    total += 1;
    if (isDone(chore)) done += 1;
  }
  return { done, total };
}

/**
 * Does this child have chores of this kind AT ALL today?
 *
 * Used to decide whether a destination is worth a tap, NOT whether to draw its circle. Both
 * circles stay on screen whenever she has any chores, because the pre-reader navigates by
 * position and a switcher whose buttons come and go with the day defeats that. An empty ring
 * already reads correctly — `ProgressRing` draws its track alone, which says "none yet".
 */
export function hasKind(
  chores: readonly ChoreAssignmentView[] | undefined,
  childId: string,
  kind: ChoreKind,
): boolean {
  return (chores ?? []).some((c) => c.childId === childId && c.kind === kind);
}
