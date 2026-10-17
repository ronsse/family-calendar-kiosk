/**
 * Unit D — ledger. The two reads.
 *
 * There is exactly one representation of a balance in this system: `SUM(delta)` over
 * `ledger_entry`, computed at the moment of the read. No stored column, no cache, no
 * denormalised total anywhere — so there is no second copy of truth to diverge from the
 * entries, and no path in this module can "mutate a balance" because there is nothing to
 * mutate (H3 finding #2, build-plan.md §4 unit D).
 */

import type { Database as Db } from 'better-sqlite3';
import { getCentsPerPoint } from '../../db/repo.ts';
import type { Balance, LedgerEntry } from '../../types.ts';
import {
  ENTRY_COLUMNS,
  pointsFor,
  requireChild,
  toLedgerEntry,
  type LedgerEntryRow,
} from './internal.ts';

/**
 * One child's balance, always derived.
 *
 * A child with no ledger history returns `points: 0`, not nothing — the aggregate carries no
 * GROUP BY, so it yields one row unconditionally. (The zero-rows trap H1 lens 5 found is
 * specific to `GROUP BY child_id`, which is why `listBalances` in Unit A is a LEFT JOIN from
 * `child`. Use that one for the wall snapshot; this one answers about a single child.)
 *
 * `points` is the sum of the entries unconditionally — `ledger_enabled` gates WRITING, never
 * reading. Short-circuiting it to 0 for a ledger-disabled child would be a second notion of a
 * balance: if the flag were ever cleared on a child who already had history, this read and Unit
 * A's `listBalances` would return different numbers for the same child, which is precisely the
 * divergence the append-only design exists to make impossible.
 *
 * `cashCents` is null when the child has no ledger or the household rate is unset — the same
 * rule `listBalances` applies, so the two reads can never disagree.
 */
export function balanceFor(db: Db, childId: string): Balance {
  const child = requireChild(db, childId);
  const rate = getCentsPerPoint(db);
  const points = pointsFor(db, childId);
  return {
    childId: child.id,
    points,
    cashCents: child.ledgerEnabled && rate !== null ? points * rate : null,
  };
}

/** A ledger entry plus the balance as it stood immediately after that entry. */
export interface LedgerHistoryEntry extends LedgerEntry {
  runningTotal: number;
}

/**
 * Every entry for one child, oldest first, each carrying the running total at that point.
 *
 * This is what settles "I had forty!" — by scrolling the entries, never by trusting a cached
 * number (api.md, `/api/admin/v1/children/:id/ledger`). Each row carries `reason`, `refType`
 * and `refId` so the UI can deep-link back to the chore or redemption that caused it.
 *
 * Oldest-first because the window function's frame is what makes `runningTotal` meaningful;
 * a caller wanting newest-first reverses the array, which preserves the totals. Sorting by
 * `id` rather than `created_at_utc` is deliberate: two entries written in the same
 * transaction share a timestamp, and id is the only total order.
 */
export function ledgerHistory(db: Db, childId: string): LedgerHistoryEntry[] {
  requireChild(db, childId);
  const rows = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS},
              SUM(delta) OVER (ORDER BY id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)
                AS running_total
         FROM ledger_entry
        WHERE child_id = ?
        ORDER BY id`,
    )
    .all(childId) as (LedgerEntryRow & { running_total: number })[];
  return rows.map((r) => ({ ...toLedgerEntry(r), runningTotal: r.running_total }));
}
