/**
 * Unit C — chores. The state machine.
 *
 *     pending ──claim──► claimed ──approve──► approved   (terminal, paying)
 *        ▲                  │
 *        ├─────reject───────┤   (an adult, from the grown-up screen)
 *        └─────unclaim──────┘   (the child herself, from the wall)
 *     pending ──(a sibling won a first_complete race)──► superseded (terminal, non-paying)
 *
 * There is deliberately no `rejected` state. It had no producer, contradicted api.md, and
 * left the card un-redoable for the rest of the day; rejection returns the chore to
 * `pending` so the child can do it again (H1 finding #8). Do not reintroduce it.
 *
 * Two properties carry the whole file:
 *
 * **The ownership predicate is load-bearing, not defensive.** Three children's cards sit
 * adjacent on one 21.5" panel at child height with 64px targets. A tap a centimetre off
 * lands on a sibling's card while the request body still names the selected child.
 * Without `AND child_id = :childId` the transition applies to the wrong sibling's row, and
 * once a parent approves it that is a permanent append-only ledger fact: a chore paid to a
 * child who did not do it, and a confidently-wrong entry in her history (H1 finding #12).
 * A mismatch is a SILENT NO-OP reported as `wrong_child` — never a fallthrough to
 * `not_claimable`, which reads to a child as "the button is broken" rather than "that is
 * not your card". The pre-check exists to make the two distinguishable; the predicate on
 * the UPDATE is what actually guarantees it.
 *
 * **The transition is the idempotency guard, not the ledger.** `UPDATE ... WHERE
 * state='claimed' RETURNING id`, and the ledger is credited only if a row came back. A
 * double tap or a browser retry cannot double-pay, because the second call's UPDATE
 * matches nothing (H3 finding #2). `UNIQUE(child_id, ref_type, ref_id, reason)` on
 * `ledger_entry` is the structural backstop behind this, not the primary guard.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { nowUtc } from '../../time.ts';
import type { AssignmentModel, ChoreState } from '../../types.ts';
import { creditChoreApproval } from '../ledger/index.ts';

/**
 * Domain-level refusals. The route layer maps them onto api.md's codes:
 *   wrong_child     -> 403 wrong_child   (silent no-op; render nothing)
 *   already_claimed -> 409 already_claimed (lost a first_complete race; expected)
 *   not_claimable   -> 409 not_claimable
 *   not_found       -> 409 not_claimable  (api.md has no distinct code; kept apart here
 *                      so a genuinely missing row is debuggable)
 */
export type ChoreTransitionError =
  | 'not_found'
  | 'wrong_child'
  | 'not_claimable'
  | 'already_claimed';

export interface ChoreTransitionResult {
  ok: boolean;
  /** Did THIS call move the row? False on an idempotent repeat of a call that already won. */
  changed: boolean;
  assignmentId: number;
  /** The row's owner. Null when the row is missing or ownership failed (nothing leaks). */
  childId: string | null;
  /** The row's state AFTER the call. Null when the row is missing or ownership failed. */
  state: ChoreState | null;
  reason: ChoreTransitionError | null;
  /** first_complete losers moved to `superseded` by THIS call. */
  supersededIds: number[];
  /**
   * first_complete losers brought BACK to `pending` by THIS call — the unclaim's mirror of
   * `supersededIds`. Optional so the three older transitions, which never restore, keep
   * their shape.
   */
  restoredIds?: number[];
  /**
   * The ledger entry written by THIS call. Null when nothing was written — because the
   * child has `ledger_enabled = 0`, because the chore is worth zero points, or because
   * this was an idempotent repeat. Read it together with `changed`; this unit deliberately
   * does not reach into `ledger_entry` to re-derive an id it did not write.
   */
  ledgerEntryId: number | null;
}

interface AssignmentRow {
  id: number;
  child_id: string;
  state: ChoreState;
  chore_day_id: number;
  model: AssignmentModel;
  points_each: number;
}

/**
 * `pending -> claimed`, plus the first_complete race.
 *
 * A claim never moves points; it is a request. `childId` is REQUIRED here because this is
 * the wall surface, where the acting child is the client's in-memory selection.
 */
export function claimChore(
  db: Db,
  args: { assignmentId: number; childId: string },
): ChoreTransitionResult {
  const { assignmentId, childId } = args;
  return inTransaction(db, () => {
    const row = loadAssignment(db, assignmentId);
    if (!row) return refuse(assignmentId, 'not_found');
    if (row.child_id !== childId) return refuse(assignmentId, 'wrong_child');

    const now = nowUtc();
    const won = db
      .prepare(
        `UPDATE chore_assignment SET state = 'claimed', claimed_at_utc = ?
          WHERE id = ? AND child_id = ? AND state = 'pending'
        RETURNING id`,
      )
      .get(now, assignmentId, childId) as { id: number } | undefined;

    if (!won) {
      const after = loadAssignment(db, assignmentId);
      if (!after) return refuse(assignmentId, 'not_found');
      // Already claimed by this child: a double tap on their own card. Idempotent, not
      // an error — the card already shows what the second tap was asking for.
      if (after.state === 'claimed') return settled(after, false);
      // Lost a first_complete race. Expected, and rendered as "someone else did it".
      if (after.state === 'superseded') return refuse(assignmentId, 'already_claimed');
      return {
        ...refuse(assignmentId, 'not_claimable'),
        childId: after.child_id,
        state: after.state,
      };
    }

    let supersededIds: number[] = [];
    if (row.model === 'first_complete') {
      // The losers, in the SAME transaction as the win. `AND state = 'pending'` keeps a
      // late arrival from clobbering a row that is already decided.
      const losers = db
        .prepare(
          `UPDATE chore_assignment SET state = 'superseded', decided_at_utc = ?
            WHERE chore_day_id = ? AND id <> ? AND state = 'pending'
          RETURNING id`,
        )
        .all(now, row.chore_day_id, assignmentId) as { id: number }[];
      supersededIds = losers.map((l) => l.id);
    }

    return {
      ok: true,
      changed: true,
      assignmentId,
      childId,
      state: 'claimed',
      reason: null,
      supersededIds,
      ledgerEntryId: null,
    };
  });
}

/**
 * `claimed -> pending`, by the child who claimed it.
 *
 * The wall's undo. A tap gate holds a claim for two seconds and a second tap inside that
 * window cancels it locally — but a child who notices a minute later that she tapped the
 * wrong card had no way back until 2026-09-13: the "Waiting" card was inert, and the only
 * undo was an adult's reject behind the PIN. This is the same move as `rejectChore` with
 * the ownership predicate REQUIRED (it is the wall surface) and WITHOUT `decided_at_utc`,
 * which records that an adult decided something; nobody did.
 *
 * For a `first_complete` chore the claim superseded the siblings' cards in the same
 * transaction, so the unclaim brings them back in the same transaction too. Without that
 * an unclaimed "clear the table" would vanish from every board for the rest of the day —
 * nobody could do it and nobody would know why. Only `superseded` rows come back; a
 * sibling who was already `claimed` or `approved` cannot exist on a first_complete day
 * once this row was claimed, and the predicate says so rather than assuming it.
 *
 * `approved` is terminal and paid — unwinding it is a ledger adjustment, not an unclaim —
 * and `superseded` is terminal too; both refuse as `not_claimable`.
 */
export function unclaimChore(
  db: Db,
  args: { assignmentId: number; childId: string },
): ChoreTransitionResult {
  const { assignmentId, childId } = args;
  return inTransaction(db, () => {
    const row = loadAssignment(db, assignmentId);
    if (!row) return refuse(assignmentId, 'not_found');
    if (row.child_id !== childId) return refuse(assignmentId, 'wrong_child');

    const won = db
      .prepare(
        `UPDATE chore_assignment SET state = 'pending', claimed_at_utc = NULL
          WHERE id = ? AND child_id = ? AND state = 'claimed'
        RETURNING id`,
      )
      .get(assignmentId, childId) as { id: number } | undefined;

    if (!won) {
      const after = loadAssignment(db, assignmentId);
      if (!after) return refuse(assignmentId, 'not_found');
      // Already back on the board: a double tap on "Waiting". Idempotent, not an error.
      if (after.state === 'pending') return settled(after, false);
      return {
        ...refuse(assignmentId, 'not_claimable'),
        childId: after.child_id,
        state: after.state,
      };
    }

    let restoredIds: number[] = [];
    if (row.model === 'first_complete') {
      const restored = db
        .prepare(
          `UPDATE chore_assignment SET state = 'pending', decided_at_utc = NULL
            WHERE chore_day_id = ? AND id <> ? AND state = 'superseded'
          RETURNING id`,
        )
        .all(row.chore_day_id, assignmentId) as { id: number }[];
      restoredIds = restored.map((r) => r.id);
    }

    return {
      ok: true,
      changed: true,
      assignmentId,
      childId,
      state: 'pending',
      reason: null,
      supersededIds: [],
      restoredIds,
      ledgerEntryId: null,
    };
  });
}

/**
 * `claimed -> approved`, and the ledger credit, in ONE transaction.
 *
 * This is the admin surface, where api.md's route carries no body — so `childId` is
 * optional. When it is omitted the ownership predicate cannot be applied, and the credit
 * is instead pinned to the row's OWN `child_id`, taken from the UPDATE's RETURNING clause.
 * Either way the points can only ever reach the child the row belongs to; a caller-supplied
 * id can never redirect them.
 *
 * Points come from `chore_day.points_each` — the snapshot — so a mid-day edit to the chore
 * cannot change what today pays.
 */
export function approveChore(
  db: Db,
  args: { assignmentId: number; childId?: string | undefined },
): ChoreTransitionResult {
  const { assignmentId, childId } = args;
  return inTransaction(db, () => {
    const row = loadAssignment(db, assignmentId);
    if (!row) return refuse(assignmentId, 'not_found');
    if (childId !== undefined && row.child_id !== childId) {
      return refuse(assignmentId, 'wrong_child');
    }

    const now = nowUtc();
    const won = (
      childId === undefined
        ? db
            .prepare(
              `UPDATE chore_assignment SET state = 'approved', decided_at_utc = ?
                WHERE id = ? AND state = 'claimed'
              RETURNING id, child_id`,
            )
            .get(now, assignmentId)
        : db
            .prepare(
              `UPDATE chore_assignment SET state = 'approved', decided_at_utc = ?
                WHERE id = ? AND child_id = ? AND state = 'claimed'
              RETURNING id, child_id`,
            )
            .get(now, assignmentId, childId)
    ) as { id: number; child_id: string } | undefined;

    if (!won) {
      const after = loadAssignment(db, assignmentId);
      if (!after) return refuse(assignmentId, 'not_found');
      // Double tap, or a browser retry of a request that already succeeded. api.md: the
      // second call returns the already-decided state, never a second ledger entry.
      if (after.state === 'approved') return settled(after, false);
      return {
        ...refuse(assignmentId, 'not_claimable'),
        childId: after.child_id,
        state: after.state,
      };
    }

    // `base_points >= 0` permits a zero-point chore, and `ledger_entry.delta <> 0` would
    // reject it — which would roll this whole transaction back and leave the card stuck
    // on `claimed` for the rest of the day. A chore worth nothing still runs the machine
    // and simply pays nothing, exactly like the pre-reader's.
    const ledgerEntryId =
      row.points_each > 0
        ? creditChoreApproval(db, {
            childId: won.child_id,
            assignmentId,
            points: row.points_each,
          })
        : null;

    return {
      ok: true,
      changed: true,
      assignmentId,
      childId: won.child_id,
      state: 'approved',
      reason: null,
      supersededIds: [],
      ledgerEntryId,
    };
  });
}

/**
 * `claimed -> pending`. The chore goes back on the board so the child can redo it.
 *
 * There is no `rejected` state and no rejection is ever paid, so nothing here touches the
 * ledger. `claimed_at_utc` is cleared — a stale claim timestamp on a pending row would
 * make the card read as claimed to anything that inspects it — while `decided_at_utc`
 * records that an adult sent it back.
 *
 * api.md's route accepts `{ note? }`, but `chore_assignment` has no column for it in the
 * frozen schema, so the note is not persisted anywhere. It is the route's to log; this
 * function deliberately does not accept a parameter it would silently drop.
 */
export function rejectChore(
  db: Db,
  args: { assignmentId: number; childId?: string | undefined },
): ChoreTransitionResult {
  const { assignmentId, childId } = args;
  return inTransaction(db, () => {
    const row = loadAssignment(db, assignmentId);
    if (!row) return refuse(assignmentId, 'not_found');
    if (childId !== undefined && row.child_id !== childId) {
      return refuse(assignmentId, 'wrong_child');
    }

    const now = nowUtc();
    const won = (
      childId === undefined
        ? db
            .prepare(
              `UPDATE chore_assignment
                  SET state = 'pending', claimed_at_utc = NULL, decided_at_utc = ?
                WHERE id = ? AND state = 'claimed'
              RETURNING id, child_id`,
            )
            .get(now, assignmentId)
        : db
            .prepare(
              `UPDATE chore_assignment
                  SET state = 'pending', claimed_at_utc = NULL, decided_at_utc = ?
                WHERE id = ? AND child_id = ? AND state = 'claimed'
              RETURNING id, child_id`,
            )
            .get(now, assignmentId, childId)
    ) as { id: number; child_id: string } | undefined;

    if (!won) {
      const after = loadAssignment(db, assignmentId);
      if (!after) return refuse(assignmentId, 'not_found');
      // Already back on the board. A second tap on "send back" is not a failure.
      if (after.state === 'pending') return settled(after, false);
      // `approved` is terminal and paid: unwinding it is a ledger adjustment, not a
      // reject. `superseded` is terminal too.
      return {
        ...refuse(assignmentId, 'not_claimable'),
        childId: after.child_id,
        state: after.state,
      };
    }

    return {
      ok: true,
      changed: true,
      assignmentId,
      childId: won.child_id,
      state: 'pending',
      reason: null,
      supersededIds: [],
      ledgerEntryId: null,
    };
  });
}

function loadAssignment(db: Db, assignmentId: number): AssignmentRow | undefined {
  return db
    .prepare(
      `SELECT a.id, a.child_id, a.state, a.chore_day_id, d.model, d.points_each
         FROM chore_assignment a
         JOIN chore_day d ON d.id = a.chore_day_id
        WHERE a.id = ?`,
    )
    .get(assignmentId) as AssignmentRow | undefined;
}

/** A refusal. `childId`/`state` stay null so a wrong-child tap leaks nothing about a sibling. */
function refuse(assignmentId: number, reason: ChoreTransitionError): ChoreTransitionResult {
  return {
    ok: false,
    changed: false,
    assignmentId,
    childId: null,
    state: null,
    reason,
    supersededIds: [],
    ledgerEntryId: null,
  };
}

/** The call asked for a state the row is already in. Success, but nothing moved. */
function settled(row: AssignmentRow, changed: boolean): ChoreTransitionResult {
  return {
    ok: true,
    changed,
    assignmentId: row.id,
    childId: row.child_id,
    state: row.state,
    reason: null,
    supersededIds: [],
    ledgerEntryId: null,
  };
}
