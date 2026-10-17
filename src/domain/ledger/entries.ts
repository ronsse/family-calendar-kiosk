/**
 * Unit D — ledger. The two direct writers: chore credit, and manual adjustment.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { nowUtc } from '../../time.ts';
import type { LedgerEntry } from '../../types.ts';
import { LedgerError } from './errors.ts';
import { findEntryByRef, requireChild, requireLedgerChild } from './internal.ts';

const INSERT_ENTRY = `INSERT INTO ledger_entry
    (child_id, delta, reason, ref_type, ref_id, note, created_at_utc)
  VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`;

export interface CreditChoreApprovalArgs {
  childId: string;
  assignmentId: number;
  points: number;
}

/**
 * Credits an approved chore. THE SEAM — Unit C imports this; the signature is fixed.
 *
 * MUST be called inside an existing transaction — the caller owns the transaction, because
 * the chore state transition and this write must commit together or not at all. That is not
 * a comment, it is asserted below: a payment that commits without the transition that
 * authorised it is a chore paid twice, and a transition that commits without the payment is a
 * chore approved for nothing. Both are permanent, append-only facts a child will argue with.
 *
 * Returns the new (or already-existing) `ledger_entry` id, or null when NO ROW WAS WRITTEN:
 *
 *   - `child.ledger_enabled = 0` — the pre-reader. Her chores run the full state machine and
 *     pay nothing; she has a completion history, not a balance (H2 Q2). Enforced here,
 *     server-side, never in the UI.
 *   - `points === 0` — the schema permits a zero-value chore (`base_points >= 0`) while
 *     `ledger_entry` forbids a zero delta (`CHECK (delta <> 0)`). Writing one would abort the
 *     caller's whole transaction and jam the approve button, so a zero-point approval is
 *     correctly "approved, nothing owed".
 *
 * Idempotent by construction. The primary guard is the caller's state transition —
 * `UPDATE ... WHERE id=? AND state='claimed' RETURNING id`, call this only if a row came
 * back — but a second call here is still a no-op rather than an error: INSERT ... ON CONFLICT
 * DO NOTHING against `UNIQUE(child_id, ref_type, ref_id, reason)`, then re-SELECT the
 * canonical row. Never trust the insert's return value (H3 finding #1).
 */
export function creditChoreApproval(
  db: Db,
  args: CreditChoreApprovalArgs,
): number | null {
  const { childId, assignmentId, points } = args;

  if (!db.inTransaction) {
    throw new Error(
      'creditChoreApproval must be called inside a transaction: the chore state transition ' +
        'and this write have to commit together or not at all',
    );
  }
  if (!Number.isInteger(assignmentId)) {
    throw new Error(`assignmentId must be an integer, got ${String(assignmentId)}`);
  }
  if (!Number.isInteger(points) || points < 0) {
    throw new Error(`points must be a non-negative integer, got ${String(points)}`);
  }

  const child = requireChild(db, childId);
  const refId = String(assignmentId);

  assertAssignmentOwnership(db, assignmentId, childId);

  if (!child.ledgerEnabled) return null;
  if (points === 0) return null;

  db.prepare(INSERT_ENTRY).run(
    childId,
    points,
    'chore_approved',
    'chore_assignment',
    refId,
    null,
    nowUtc(),
  );

  const entry = findEntryByRef(db, childId, 'chore_assignment', refId, 'chore_approved');
  if (!entry) throw new Error('ledger_entry vanished after upsert — the database is corrupt');
  return entry.id;
}

/**
 * Refuses to pay a chore to a child who does not own it.
 *
 * `ledger_entry.ref_id` is polymorphic TEXT and therefore cannot be a foreign key, so the
 * check is conditional: if the assignment row exists and names a different child, that is
 * H1 lens 5's wrong-child payment — three children's cards sit on one panel with adjacent
 * 64px targets — and throwing rolls back the caller's transition with it. If no such row
 * exists we proceed: the ledger references the assignment, it does not require one, and
 * imposing that precondition would put Unit D in charge of Unit C's table.
 */
function assertAssignmentOwnership(db: Db, assignmentId: number, childId: string): void {
  const row = db
    .prepare('SELECT child_id FROM chore_assignment WHERE id = ?')
    .get(assignmentId) as { child_id: string } | undefined;
  if (row && row.child_id !== childId) {
    throw new LedgerError(
      'wrong_child',
      `assignment ${assignmentId} belongs to ${row.child_id}, not ${childId}`,
    );
  }
}

export interface AdjustArgs {
  childId: string;
  /** Non-zero; negative is a legitimate correction. `CHECK (delta <> 0)` in the schema. */
  delta: number;
  note: string | null;
  /**
   * Caller-supplied idempotency key, stored VERBATIM as `ref_id`.
   *
   * A manual adjustment has no natural key and both obvious substitutes are wrong: a constant
   * makes the *second* bonus a constraint violation that silently drops points, while a fresh
   * id per call lets a double-tap pay twice (H1 finding #10). The client generates one uuid
   * per user action.
   */
  requestId: string;
}

/**
 * A manual adjustment — a bonus, or a correction.
 *
 * Repeat calls with the same `requestId` are a NO-OP returning the existing entry: not an
 * error, and not a second row. Note that the entry returned is the ORIGINAL one, deltas and
 * all — a retry with the same key but a different amount does not amend anything, because a
 * retry is by definition the same user action arriving twice.
 */
export function adjust(db: Db, args: AdjustArgs): LedgerEntry {
  const { childId, delta, note, requestId } = args;

  if (!Number.isInteger(delta) || delta === 0) {
    throw new Error(`delta must be a non-zero integer, got ${String(delta)}`);
  }
  if (typeof requestId !== 'string' || requestId.length === 0) {
    throw new Error('requestId is mandatory: it is the idempotency key for this adjustment');
  }

  return inTransaction(db, () => {
    requireLedgerChild(db, childId);

    db.prepare(INSERT_ENTRY).run(
      childId,
      delta,
      'adjustment',
      'manual',
      requestId,
      note,
      nowUtc(),
    );

    const entry = findEntryByRef(db, childId, 'manual', requestId, 'adjustment');
    if (!entry) throw new Error('ledger_entry vanished after upsert — the database is corrupt');
    return entry;
  });
}
