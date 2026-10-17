/**
 * Unit D — ledger. Domain refusals.
 *
 * A refusal here is a *decision*, not a crash: the caller (Unit F) turns it into one of the
 * error codes in docs/api.md, which is FROZEN. So `wireCode` is constrained to that table and
 * this file may never widen it — a new wire code is a stop-the-world contract change.
 *
 * `code` is the precise domain reason and exists because the frozen table is coarser than the
 * domain. `ledger_disabled` is the case in point: the pre-reader has no ledger at all, which is
 * not the same fact as "you asked for more points than you have", but the table has no code for
 * it. It maps to `insufficient_points`, which is at least true for her (she holds zero, always),
 * and the precise reason stays available for logs and tests.
 */

/** The codes docs/api.md defines. FROZEN there; nothing here may add to this union. */
export type ApiErrorCode =
  | 'not_claimable'
  | 'already_claimed'
  | 'insufficient_points'
  | 'pending_redemption_exists'
  | 'wrong_child';

export type LedgerErrorCode =
  /** The ask exceeds the balance — checked at request time AND again at approval time. */
  | 'insufficient_points'
  /** `ux_one_pending_redemption`: one open request per child, so requests cannot be stacked. */
  | 'pending_redemption_exists'
  /** The row does not belong to the acting child. Silent no-op on the wall (H1 lens 5). */
  | 'wrong_child'
  /** The row is not in a state that permits this transition. */
  | 'not_claimable'
  /** `child.ledger_enabled = 0`: this child has a completion history, not a balance (H2 Q2). */
  | 'ledger_disabled';

const WIRE_CODE: Record<LedgerErrorCode, ApiErrorCode> = {
  insufficient_points: 'insufficient_points',
  pending_redemption_exists: 'pending_redemption_exists',
  wrong_child: 'wrong_child',
  not_claimable: 'not_claimable',
  // No wire code exists for "this child has no ledger"; api.md is frozen. She holds zero
  // points and always will, so `insufficient_points` is the least-wrong closed mapping.
  ledger_disabled: 'insufficient_points',
};

export class LedgerError extends Error {
  readonly code: LedgerErrorCode;
  /** The code Unit F puts on the wire. Always one of api.md's frozen codes. */
  readonly wireCode: ApiErrorCode;

  constructor(code: LedgerErrorCode, message: string) {
    super(message);
    this.name = 'LedgerError';
    this.code = code;
    this.wireCode = WIRE_CODE[code];
  }
}

export function isLedgerError(e: unknown): e is LedgerError {
  return e instanceof LedgerError;
}
