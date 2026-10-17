/**
 * Unit D — the ledger and redemption domain. The public surface.
 *
 * The whole unit rests on one property: a balance is `SUM(delta)` over an append-only
 * `ledger_entry`, computed on every read. Nothing stores a total, so no code path in this
 * module can mutate a balance — it can only append a fact that changes what the sum says.
 * That is what makes "I had forty!" answerable by scrolling `ledgerHistory` instead of by
 * arguing with a cached number (build-plan.md §4 unit D, H3 finding #2).
 *
 * The seam Unit C depends on is `creditChoreApproval`. Its signature is FIXED.
 */

export { creditChoreApproval, adjust } from './entries.ts';
export type { CreditChoreApprovalArgs, AdjustArgs } from './entries.ts';

export { balanceFor, ledgerHistory } from './balance.ts';
export type { LedgerHistoryEntry } from './balance.ts';

export {
  approveRedemption,
  cancelRedemption,
  getRedemption,
  rejectRedemption,
  requestRedemption,
} from './redemption.ts';
export type { RedemptionApproval, RequestRedemptionArgs } from './redemption.ts';

export { LedgerError, isLedgerError } from './errors.ts';
export type { ApiErrorCode, LedgerErrorCode } from './errors.ts';
