/**
 * Unit C — chores. Whose turn is it?
 *
 * The assignee of a rotation chore is a PURE FUNCTION of `(chore_id, local_date)` over
 * `chore_rotation_member.position`, evaluated once at materialization and then frozen
 * into a `chore_assignment` row. Both halves matter:
 *
 *  * **Pure** — nothing random, nothing read from the clock, nothing derived from who
 *    happens to be looking. A child who does not like the answer must not be able to
 *    re-roll it by pulling the kiosk's refresh, and two devices reading the same day must
 *    agree.
 *  * **Frozen at materialization** — the row is written once; later reads return it
 *    rather than recomputing. So deactivating a sibling this afternoon cannot silently
 *    reassign a chore that has already been claimed.
 *
 * The chore id is folded into the index so two rotations sharing a member list do not
 * land on the same child every single day — otherwise one child gets every chore on
 * Tuesday and the other gets every chore on Wednesday.
 *
 * Known limit, recorded rather than papered over: the index advances by the number of
 * LOCAL DAYS between occurrences, so a `FREQ=WEEKLY` chore whose member count divides 7
 * (i.e. exactly seven members) would land on the same child forever. Rotating on an
 * occurrence ordinal instead would fix that but would make the assignee depend on the
 * rrule string, so editing the rule would reshuffle every future turn. With a
 * three-child household the day index is the better trade; revisit at seven.
 */

import type { LocalDate } from '../../types.ts';
import { dayIndex, mod } from './localdays.ts';

export interface RotationMember {
  childId: string;
  position: number;
}

/**
 * The child whose turn it is on `date`, or null when the rotation has no members.
 *
 * Members are ordered by `position`, which the schema only guarantees to be unique per
 * chore — not dense, not 1-based. Indexing into the ordered array (rather than
 * `position % n`) is what makes positions 1, 2, 7 rotate over three children instead of
 * skipping one.
 */
export function rotationAssignee(
  choreId: string,
  date: LocalDate,
  members: readonly RotationMember[],
): string | null {
  if (members.length === 0) return null;
  const ordered = [...members].sort(
    (a, b) => a.position - b.position || (a.childId < b.childId ? -1 : 1),
  );
  const index = mod(dayIndex(date) + fnv1a(choreId), ordered.length);
  return ordered[index]?.childId ?? null;
}

/** FNV-1a, 32-bit. Any stable non-cryptographic hash would do; this one has no deps. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
