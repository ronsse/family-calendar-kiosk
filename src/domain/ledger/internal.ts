/**
 * Unit D — ledger. Shared row mapping and the two lookups every writer needs.
 *
 * Not exported from index.ts: this is the inside of the module.
 */

import type { Database as Db } from 'better-sqlite3';
import { LedgerError } from './errors.ts';
import type {
  LedgerEntry,
  LedgerReason,
  LedgerRefType,
  RedemptionRequest,
  RedemptionState,
  Utc,
} from '../../types.ts';

export const ENTRY_COLUMNS =
  'id, child_id, delta, reason, ref_type, ref_id, note, created_at_utc';

export interface LedgerEntryRow {
  id: number;
  child_id: string;
  delta: number;
  reason: LedgerReason;
  ref_type: LedgerRefType;
  ref_id: string;
  note: string | null;
  created_at_utc: string;
}

export function toLedgerEntry(r: LedgerEntryRow): LedgerEntry {
  return {
    id: r.id,
    childId: r.child_id,
    delta: r.delta,
    reason: r.reason,
    refType: r.ref_type,
    refId: r.ref_id,
    note: r.note,
    createdAtUtc: r.created_at_utc as Utc,
  };
}

export const REQUEST_COLUMNS =
  'id, child_id, points_requested, cents_per_point, cash_cents, state, requested_at_utc, decided_at_utc';

export interface RedemptionRow {
  id: number;
  child_id: string;
  points_requested: number;
  cents_per_point: number;
  cash_cents: number;
  state: RedemptionState;
  requested_at_utc: string;
  decided_at_utc: string | null;
}

export function toRedemptionRequest(r: RedemptionRow): RedemptionRequest {
  return {
    id: r.id,
    childId: r.child_id,
    pointsRequested: r.points_requested,
    centsPerPoint: r.cents_per_point,
    cashCents: r.cash_cents,
    state: r.state,
    requestedAtUtc: r.requested_at_utc as Utc,
    decidedAtUtc: r.decided_at_utc as Utc | null,
  };
}

export interface ChildLedgerFacts {
  id: string;
  ledgerEnabled: boolean;
}

/**
 * Every ledger write goes through this first. Inactive children are deliberately NOT
 * excluded: a child who left the household still has a history an adult can audit, and
 * `active` is a presentation flag, not an accounting one.
 */
export function requireChild(db: Db, childId: string): ChildLedgerFacts {
  const row = db.prepare('SELECT id, ledger_enabled FROM child WHERE id = ?').get(childId) as
    | { id: string; ledger_enabled: number }
    | undefined;
  if (!row) throw new Error(`no such child: ${childId}`);
  return { id: row.id, ledgerEnabled: row.ledger_enabled === 1 };
}

/** Throws unless the child exists AND has a ledger. */
export function requireLedgerChild(db: Db, childId: string): ChildLedgerFacts {
  const child = requireChild(db, childId);
  if (!child.ledgerEnabled) {
    throw new LedgerError(
      'ledger_disabled',
      `${childId} has ledger_enabled = 0: chores run the full state machine and pay nothing`,
    );
  }
  return child;
}

/**
 * The canonical entry for a natural key, or null.
 *
 * This is the re-SELECT half of every `INSERT ... ON CONFLICT DO NOTHING` in this module.
 * Never proceed on the insert's return value: whoever won the race, both callers must agree
 * on the same row (H3 finding #1).
 */
export function findEntryByRef(
  db: Db,
  childId: string,
  refType: LedgerRefType,
  refId: string,
  reason: LedgerReason,
): LedgerEntry | null {
  const row = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM ledger_entry
        WHERE child_id = ? AND ref_type = ? AND ref_id = ? AND reason = ?`,
    )
    .get(childId, refType, refId, reason) as LedgerEntryRow | undefined;
  return row ? toLedgerEntry(row) : null;
}

/** Raw points total. Aggregate without GROUP BY, so it always yields exactly one row. */
export function pointsFor(db: Db, childId: string): number {
  const row = db
    .prepare('SELECT COALESCE(SUM(delta), 0) AS points FROM ledger_entry WHERE child_id = ?')
    .get(childId) as { points: number };
  return row.points;
}

export function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer, got ${String(value)}`);
  }
}
