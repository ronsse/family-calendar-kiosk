/**
 * Unit I — reconnection timing, and the promise that there is always another chance.
 *
 * The wall has exactly two ways to learn that something changed: the SSE stream, and a poll.
 * The stream is the good one and it is also the one that fails — a Wi-Fi blip, a container
 * restart, an idle proxy. So the rule this module encodes is not "reconnect quickly", it is
 * **there is never a state in which nothing is scheduled**. `pollIntervalMs` returns a finite
 * number for every input, including "the stream has been dead for a week", which is what makes
 * "the wall refreshes eventually" a property rather than a hope.
 *
 * The backoff is bounded at a minute for the same reason it exists at all: an unbounded one
 * reaches hours, and an hour of not-reconnecting spans the whole school morning.
 */

export const SSE_BACKOFF_BASE_MS = 1_000;
export const SSE_BACKOFF_MAX_MS = 60_000;

/** Proportion of the delay that is randomised, so N kiosks never re-storm in lockstep. */
export const SSE_BACKOFF_JITTER = 0.2;

/**
 * Delay before reconnect attempt number `failures + 1`.
 *
 * `failures = 0` means the stream was healthy a moment ago, so reconnect immediately: the
 * common case is a container restart, and a second of dark stream is a second the wall does
 * not learn about a tap.
 *
 * `jitter01` is a caller-supplied [0,1) value rather than an internal `Math.random()` so the
 * bound is testable rather than statistical.
 */
export function sseDelayMs(failures: number, jitter01 = 0.5): number {
  if (!Number.isFinite(failures) || failures <= 0) return 0;
  const exponent = Math.min(failures - 1, 30);
  const raw = Math.min(SSE_BACKOFF_BASE_MS * 2 ** exponent, SSE_BACKOFF_MAX_MS);
  const clamped = Math.min(Math.max(jitter01, 0), 1);
  const spread = raw * SSE_BACKOFF_JITTER;
  // Centred on `raw` and then clamped to the ceiling: jitter must never push a delay past the
  // bound, or the bound is decorative.
  const jittered = raw - spread / 2 + spread * clamped;
  return Math.min(Math.round(jittered), SSE_BACKOFF_MAX_MS);
}

/** How long the wall waits between full refetches while the stream is healthy. */
export const POLL_HEALTHY_MS = 15 * 60_000;
/** …and while it is not. Fast enough that a morning is not lost, slow enough not to hammer. */
export const POLL_DEGRADED_MS = 60_000;
/** Consecutive stream failures after which the poll tightens. */
export const SSE_DEAD_AFTER_FAILURES = 2;

/**
 * The polling floor. ALWAYS finite, for every input.
 *
 * A healthy stream does not make polling unnecessary — it makes it cheap. The stream can be
 * open and silent for reasons nothing observes (a proxy holding bytes, a half-open socket that
 * TCP has not noticed), and in that state the wall looks perfectly alive while being a day
 * behind. Fifteen minutes of redundant refetch is a rounding error on a household database and
 * it is the difference between "usually right" and "right".
 */
export function pollIntervalMs(consecutiveSseFailures: number): number {
  if (!Number.isFinite(consecutiveSseFailures) || consecutiveSseFailures < SSE_DEAD_AFTER_FAILURES) {
    return POLL_HEALTHY_MS;
  }
  return POLL_DEGRADED_MS;
}

/** Retry spacing for a snapshot whose date did not match what we asked for. */
export const MISMATCH_RETRY_BASE_MS = 1_000;
export const MISMATCH_RETRY_MAX_MS = 30_000;
/** After this many mismatched answers the wall stops asking and renders stale-but-labelled. */
export const MISMATCH_MAX_RETRIES = 4;

export function mismatchRetryMs(attempt: number): number {
  if (!Number.isFinite(attempt) || attempt <= 0) return MISMATCH_RETRY_BASE_MS;
  const exponent = Math.min(attempt - 1, 20);
  return Math.min(MISMATCH_RETRY_BASE_MS * 2 ** exponent, MISMATCH_RETRY_MAX_MS);
}

/** Retry spacing after any other failed snapshot fetch. Bounded for the same reason. */
export const FETCH_RETRY_BASE_MS = 2_000;
export const FETCH_RETRY_MAX_MS = 60_000;

export function fetchRetryMs(failures: number): number {
  if (!Number.isFinite(failures) || failures <= 0) return FETCH_RETRY_BASE_MS;
  const exponent = Math.min(failures - 1, 20);
  return Math.min(FETCH_RETRY_BASE_MS * 2 ** exponent, FETCH_RETRY_MAX_MS);
}
