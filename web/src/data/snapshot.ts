/**
 * Unit I — deciding what to do with a response, before anything renders it.
 *
 * The rule from docs/api.md that this file exists to enforce: **no 5xx and no error page ever
 * reaches a child.** Every outcome below is one of four, and three of them keep the previous
 * snapshot on screen:
 *
 *   accept   — the answer is for the day we asked about. Render it.
 *   refetch  — the answer is for a DIFFERENT day. Do not render it; ask again. A snapshot
 *              built at local midnight one second out of step is yesterday's wall, and
 *              nothing else fires until the next boundary (H1 lens 3).
 *   reload   — this bundle is too old to parse what is coming. Reload before parsing.
 *   degrade  — anything else. Keep the last good snapshot and mark it stale.
 *
 * `degrade` is the interesting one. A 503 from the catch-all, a socket reset, a body that is
 * not JSON, HTML from a captive portal — all the same answer, because the child in front of
 * the panel needs the same thing from all of them: yesterday's wall, honestly labelled.
 * Stale-but-labelled satisfies the prime invariant; stale-and-confident does not, and blank
 * does not either.
 */

import type { LocalDate, WallSnapshot } from '../../../src/types.ts';

export type DegradeReason =
  /** The panel's token is unknown or revoked. Render the offline card, never a login. */
  | 'device_revoked'
  /** The server answered, but not with something that is a snapshot. */
  | 'malformed'
  /** The server refused, or the request never arrived. */
  | 'unreachable'
  /** We asked for today repeatedly and kept being handed another day. */
  | 'date_mismatch';

export type SnapshotOutcome =
  | { kind: 'accept'; snapshot: WallSnapshot }
  | { kind: 'refetch' }
  | { kind: 'reload' }
  | { kind: 'degrade'; reason: DegradeReason };

/**
 * Structural check, deliberately shallow.
 *
 * It verifies the fields the SHELL dereferences unconditionally — the ones whose absence is a
 * thrown TypeError inside a render rather than a missing card. Everything below that is the
 * renderers' problem, and Unit H already wraps them in an error boundary keyed on the
 * snapshot, so one bad row costs one component and not the wall.
 *
 * A deep validator would be worse, not better: it would reject a snapshot carrying a field
 * this bundle has never heard of, which is exactly what a forward-compatible deploy looks
 * like, and the punishment for rejecting it is a blank screen.
 */
export function isRenderableSnapshot(value: unknown): value is WallSnapshot {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const s = value as Record<string, unknown>;

  const freshness = s['freshness'];
  if (freshness === null || typeof freshness !== 'object') return false;
  const f = freshness as Record<string, unknown>;
  if (typeof f['snapshotLocalDate'] !== 'string') return false;
  if (typeof f['generatedAtUtc'] !== 'string') return false;

  if (typeof s['requestedLocalDate'] !== 'string') return false;
  // The shell maps `children` before anything else renders; an absent array is a TypeError in
  // the first line of the component, which is a blank wall and not a missing card.
  if (!Array.isArray(s['children'])) return false;
  return true;
}

/** The date the SERVER used, or null if this is not a snapshot at all. */
export function snapshotLocalDate(value: unknown): LocalDate | null {
  if (!isRenderableSnapshot(value)) return null;
  return value.freshness.snapshotLocalDate;
}

/**
 * A 200 body, judged against the date we asked for.
 *
 * The comparison is against `freshness.snapshotLocalDate` — the date the server actually
 * BUILT — and not against `requestedLocalDate`, which is only an echo and would agree with
 * itself even when the build did not.
 */
export function evaluateSnapshot(requested: LocalDate, body: unknown): SnapshotOutcome {
  if (!isRenderableSnapshot(body)) return { kind: 'degrade', reason: 'malformed' };
  if (body.freshness.snapshotLocalDate !== requested) return { kind: 'refetch' };
  return { kind: 'accept', snapshot: body };
}

/**
 * A whole response, status included.
 *
 * `stale_client` arrives as `426` and is the one case that must be handled BEFORE the body is
 * trusted: a bundle old enough to be refused is old enough to misparse the refusal.
 */
export function classifyResponse(
  requested: LocalDate,
  status: number,
  body: unknown,
): SnapshotOutcome {
  if (status === 426) return { kind: 'reload' };
  if (status === 403) return { kind: 'degrade', reason: 'device_revoked' };
  if (status === 409 && errorCode(body) === 'date_mismatch') return { kind: 'refetch' };
  if (status !== 200) return { kind: 'degrade', reason: 'unreachable' };
  return evaluateSnapshot(requested, body);
}

/** The `error` field of the uniform `{ error, message }` shape, when there is one. */
export function errorCode(body: unknown): string | null {
  if (body === null || typeof body !== 'object' || Array.isArray(body)) return null;
  const code = (body as Record<string, unknown>)['error'];
  return typeof code === 'string' ? code : null;
}
