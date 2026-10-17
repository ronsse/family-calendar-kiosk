/**
 * Unit F — HTTP. The wire protocol constants and the uniform error shape.
 *
 * docs/api.md is FROZEN, and its error table is the set of codes the WALL CLIENT branches
 * on. Everything in `ContractErrorCode` comes from that table verbatim. Three further codes
 * exist for conditions the table does not describe, and each is deliberately unreachable
 * from a well-formed wall client:
 *
 *   bad_request  400 — a malformed ADMIN parameter (a missing `requestId`, a missing device
 *                      label). Never emitted on the wall surface: there, a missing `childId`
 *                      is `wrong_child` and a malformed row id is `not_claimable`, both of
 *                      which are in the frozen table and both of which fail safe.
 *   not_found    404 — an unrouted path. The kiosk never requests one.
 *   unavailable  503 — the catch-all. "No 5xx is ever rendered to a child": every unexpected
 *                      failure lands here as a small JSON body, and the client's contract is
 *                      to keep its last good snapshot and mark it stale rather than to render
 *                      anything from this response. The status is for the client, not the
 *                      child — what the child sees is yesterday's wall with a staleness mark.
 *
 * Adding a code to the frozen table would be a stop-the-world contract change; these three
 * are operational rather than domain refusals, so they are declared here and reported.
 */

/** Exactly the codes in docs/api.md's error table. Nothing may be added to this union. */
export type ContractErrorCode =
  | 'bad_pin'
  | 'device_revoked'
  | 'not_claimable'
  | 'already_claimed'
  | 'insufficient_points'
  | 'pending_redemption_exists'
  | 'stale_client'
  | 'date_mismatch'
  | 'wrong_child';

/** Transport-level conditions the frozen table does not cover. See the header note. */
export type OperationalErrorCode = 'bad_request' | 'not_found' | 'unavailable';

export type ApiErrorCode = ContractErrorCode | OperationalErrorCode;

const STATUS: Record<ApiErrorCode, number> = {
  bad_pin: 401,
  device_revoked: 403,
  wrong_child: 403,
  not_claimable: 409,
  already_claimed: 409,
  insufficient_points: 409,
  pending_redemption_exists: 409,
  date_mismatch: 409,
  stale_client: 426,
  bad_request: 400,
  not_found: 404,
  unavailable: 503,
};

/**
 * A refusal with a wire code. Thrown by handlers and serialised as
 * `{ error, message }` — the uniform shape docs/api.md specifies.
 *
 * `message` is a human string that reaches a screen children and guests can read, so it
 * must never carry SQL, a stack, a file path or a token. Handlers log the cause; the wire
 * gets the sentence.
 */
export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;

  constructor(code: ApiErrorCode, message: string) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    this.status = STATUS[code];
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

export function statusFor(code: ApiErrorCode): number {
  return STATUS[code];
}

/** `WallSnapshot.apiVersion`. Bumped only when the wire shape changes. */
export const API_VERSION = 1;

/**
 * `WallSnapshot.minClientBuild`, and the value in every heartbeat.
 *
 * The kiosk holds one JS bundle in memory for months. Deploy a renamed field and the old
 * bundle parses a shape it does not understand and throws inside a render — a blank wall
 * with no adult in front of it (H3 finding #9). Raising this forces a hard reload BEFORE
 * the parse. It is therefore only ever raised alongside a breaking wire change.
 */
export const MIN_CLIENT_BUILD = 1;

/** The client states its bundle build here; below MIN_CLIENT_BUILD it is sent to reload. */
export const CLIENT_BUILD_HEADER = 'x-client-build';

/** Present on EVERY response, so the reload trigger does not depend on hitting the snapshot. */
export const MIN_CLIENT_BUILD_HEADER = 'X-Min-Client-Build';
export const API_VERSION_HEADER = 'X-Api-Version';

/**
 * How far apart the client's and the server's idea of "today" may be before the server
 * refuses to build the requested date.
 *
 * The client's date WINS inside this window, which is the whole point of H1 lens 3: at local
 * midnight a second of skew makes the server answer "yesterday", and since nothing refires
 * until the next boundary the wall stays a day behind through 6:00 AM. One day of tolerance
 * covers every real skew, including a request in flight across the boundary.
 *
 * Beyond it the request is refused rather than honoured, because building an arbitrary date
 * MATERIALIZES it: a kiosk with a dead RTC asking for 2000-01-01 would write routine runs and
 * chore days for a date nothing will ever read again. `date_mismatch` is the frozen code for
 * "the server could not build the requested localDate", and the client's response to it is to
 * refetch — so a genuinely broken clock degrades to last-good-plus-staleness, which is the
 * outcome the prime invariant asks for.
 */
export const MAX_DATE_SKEW_DAYS = 1;
