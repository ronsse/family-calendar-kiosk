/**
 * Unit D — ledger. Redemption: points become real pocket money.
 *
 * Points are destroyed at APPROVAL, and there is deliberately no `paid` state. The physical
 * handover of cash is unobservable, and any state that depends on an adult remembering to tap
 * it will drift and then lie to a child (H2 Q2, unanimous). The cost — that nothing tracks who
 * is still owed cash — is recorded as unsettled in docs/design-review/H2-tournament.md. Do not
 * add a `paid` transition here to close it; that is a Phase 0 contract change.
 *
 * Every transition below is `UPDATE ... WHERE <id> AND <expected state> RETURNING id`, and the
 * dependent write happens only if a row came back. The transition IS the idempotency guard;
 * `UNIQUE(child_id, ref_type, ref_id, reason)` is the structural backstop behind it, not the
 * primary defence (H3 finding #2).
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { getCentsPerPoint } from '../../db/repo.ts';
import { nowUtc } from '../../time.ts';
import type { RedemptionRequest } from '../../types.ts';
import { LedgerError } from './errors.ts';
import {
  assertPositiveInt,
  findEntryByRef,
  pointsFor,
  REQUEST_COLUMNS,
  requireLedgerChild,
  toRedemptionRequest,
  type RedemptionRow,
} from './internal.ts';

function selectRow(db: Db, id: number): RedemptionRow | undefined {
  return db.prepare(`SELECT ${REQUEST_COLUMNS} FROM redemption_request WHERE id = ?`).get(id) as
    | RedemptionRow
    | undefined;
}

export function getRedemption(db: Db, id: number): RedemptionRequest | null {
  const row = selectRow(db, id);
  return row ? toRedemptionRequest(row) : null;
}

export interface RequestRedemptionArgs {
  childId: string;
  pointsRequested: number;
}

/**
 * A child asks to cash points in.
 *
 * The balance is checked HERE as well as at approval, so an impossible ask never occupies the
 * one-pending slot. `ux_one_pending_redemption` allows a single open request per child, and
 * without an up-front check a mis-tapped request for more points than she holds would sit in
 * that slot until an adult noticed (H1 finding #9) — which is why cancel exists too.
 *
 * The rate is SNAPSHOTTED onto the row at request time: if an adult re-tunes
 * `cents_per_point` between the ask and the approval, the child is paid what she was shown.
 */
export function requestRedemption(db: Db, args: RequestRedemptionArgs): RedemptionRequest {
  const { childId, pointsRequested } = args;
  assertPositiveInt(pointsRequested, 'pointsRequested');

  return inTransaction(db, () => {
    // The pre-reader has no balance to spend, and this is enforced server-side: her wall may
    // not even render the button, but the button is not the guard.
    requireLedgerChild(db, childId);

    const rate = getCentsPerPoint(db);
    if (rate === null) {
      // An operator misconfiguration, not a refusal a child did anything to earn. api.md:
      // no 5xx is ever rendered to a child — the wall keeps its last good snapshot.
      throw new Error('household_config.cents_per_point is unset or not a positive integer');
    }

    const pending = selectPending(db, childId);
    if (pending) {
      throw new LedgerError(
        'pending_redemption_exists',
        `${childId} already has redemption request ${pending.id} open`,
      );
    }

    const balance = pointsFor(db, childId);
    if (pointsRequested > balance) {
      throw new LedgerError(
        'insufficient_points',
        `${childId} asked for ${pointsRequested} but holds ${balance}`,
      );
    }

    const row = db
      .prepare(
        `INSERT INTO redemption_request
           (child_id, points_requested, cents_per_point, cash_cents, state, requested_at_utc)
         VALUES (?, ?, ?, ?, 'pending', ?)
         RETURNING ${REQUEST_COLUMNS}`,
      )
      .get(childId, pointsRequested, rate, pointsRequested * rate, nowUtc()) as RedemptionRow;
    return toRedemptionRequest(row);
  });
}

function selectPending(db: Db, childId: string): { id: number } | undefined {
  return db
    .prepare(`SELECT id FROM redemption_request WHERE child_id = ? AND state = 'pending'`)
    .get(childId) as { id: number } | undefined;
}

export interface RedemptionApproval {
  state: 'approved';
  ledgerEntryId: number;
}

/**
 * A parent approves. One transaction, three steps that must not come apart:
 *
 *  1. `pending -> approved`, gated on the current state. If no row comes back, nothing else
 *     runs — that is what makes a double tap or a retried request safe.
 *  2. The balance is re-read INSIDE this transaction. The request snapshotted a rate, not an
 *     entitlement: points may have been spent or clawed back since it was raised, and two
 *     approvals racing must not both see the pre-approval balance. IMMEDIATE takes the write
 *     lock up front, so the second one reads the first one's committed effect or blocks.
 *  3. Only then the negative entry.
 *
 * An insufficient balance throws, which rolls step 1 back with it: the request stays `pending`
 * so a parent can reject it deliberately rather than finding it silently consumed.
 */
export function approveRedemption(db: Db, requestId: number): RedemptionApproval {
  assertPositiveInt(requestId, 'requestId');

  return inTransaction(db, () => {
    const claimed = db
      .prepare(
        `UPDATE redemption_request SET state = 'approved', decided_at_utc = ?
          WHERE id = ? AND state = 'pending'
        RETURNING id, child_id, points_requested`,
      )
      .get(nowUtc(), requestId) as
      | { id: number; child_id: string; points_requested: number }
      | undefined;

    if (!claimed) return alreadyApproved(db, requestId);

    // Defence in depth. `requestRedemption` refuses a ledger-disabled child, so no pending
    // row should exist for one; if a hand-written row ever does, she still gets no entry.
    requireLedgerChild(db, claimed.child_id);

    const balance = pointsFor(db, claimed.child_id);
    if (balance < claimed.points_requested) {
      throw new LedgerError(
        'insufficient_points',
        `${claimed.child_id} holds ${balance}, request ${requestId} is for ${claimed.points_requested}`,
      );
    }

    // A plain INSERT, unlike every other write in this module: step 1 guarantees this runs at
    // most once per request, so a uniqueness conflict here is not a retry — it is corruption,
    // and it must abort the approval rather than be swallowed by ON CONFLICT DO NOTHING.
    const entry = db
      .prepare(
        `INSERT INTO ledger_entry
           (child_id, delta, reason, ref_type, ref_id, note, created_at_utc)
         VALUES (?, ?, 'redemption_approved', 'redemption_request', ?, NULL, ?)
         RETURNING id`,
      )
      .get(
        claimed.child_id,
        -claimed.points_requested,
        String(requestId),
        nowUtc(),
      ) as { id: number };

    return { state: 'approved', ledgerEntryId: entry.id };
  });
}

/** The retry path: an already-approved request returns its existing entry, not a new one. */
function alreadyApproved(db: Db, requestId: number): RedemptionApproval {
  const row = selectRow(db, requestId);
  if (!row) throw new LedgerError('not_claimable', `no redemption request ${requestId}`);
  if (row.state !== 'approved') {
    throw new LedgerError(
      'not_claimable',
      `redemption request ${requestId} is ${row.state}, not pending`,
    );
  }
  const entry = findEntryByRef(
    db,
    row.child_id,
    'redemption_request',
    String(requestId),
    'redemption_approved',
  );
  if (!entry) {
    throw new Error(
      `redemption request ${requestId} is approved but has no ledger entry — the database is corrupt`,
    );
  }
  return { state: 'approved', ledgerEntryId: entry.id };
}

/**
 * A parent refuses. No ledger row: nothing was earned and nothing is destroyed, and the slot
 * is freed so the child can ask again for an amount that works.
 *
 * NOTE for Unit F: api.md's body carries an optional `note`, but the frozen
 * `redemption_request` table has no column for it. It is accepted at the route and not
 * persisted; do not expect to read it back.
 */
export function rejectRedemption(db: Db, requestId: number): { state: 'rejected' } {
  assertPositiveInt(requestId, 'requestId');
  const decided = db
    .prepare(
      `UPDATE redemption_request SET state = 'rejected', decided_at_utc = ?
        WHERE id = ? AND state = 'pending' RETURNING id`,
    )
    .get(nowUtc(), requestId) as { id: number } | undefined;
  if (decided) return { state: 'rejected' };

  const row = selectRow(db, requestId);
  if (!row) throw new LedgerError('not_claimable', `no redemption request ${requestId}`);
  if (row.state === 'rejected') return { state: 'rejected' };
  throw new LedgerError(
    'not_claimable',
    `redemption request ${requestId} is ${row.state}, not pending`,
  );
}

/**
 * The child withdraws her own request.
 *
 * Child-initiated, on the wall surface, for the same reason step-revoke is: a mis-tap must be
 * recoverable BY THE CHILD, because PIN-gating the undo leaves her locked out of the one
 * pending slot until an adult intervenes (H1 finding #9).
 *
 * Ownership is verified before state. Three children's cards sit on one panel at child height
 * with adjacent 64px targets, so a tap a centimetre off lands on a sibling's row while the
 * body still names the selected child. A mismatch is `wrong_child` and Unit F renders it as a
 * silent no-op — never a fallthrough to `not_claimable`, which reads to a child as "the button
 * is broken" rather than "that is not your card" (H1 lens 5).
 */
export function cancelRedemption(
  db: Db,
  requestId: number,
  childId: string,
): { state: 'cancelled' } {
  assertPositiveInt(requestId, 'requestId');
  const cancelled = db
    .prepare(
      `UPDATE redemption_request SET state = 'cancelled', decided_at_utc = ?
        WHERE id = ? AND child_id = ? AND state = 'pending' RETURNING id`,
    )
    .get(nowUtc(), requestId, childId) as { id: number } | undefined;
  if (cancelled) return { state: 'cancelled' };

  const row = selectRow(db, requestId);
  if (!row) throw new LedgerError('not_claimable', `no redemption request ${requestId}`);
  if (row.child_id !== childId) {
    throw new LedgerError(
      'wrong_child',
      `redemption request ${requestId} belongs to ${row.child_id}, not ${childId}`,
    );
  }
  if (row.state === 'cancelled') return { state: 'cancelled' };
  throw new LedgerError(
    'not_claimable',
    `redemption request ${requestId} is ${row.state}, not pending`,
  );
}
