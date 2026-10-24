/**
 * Unit C — chores. How many days running a child has finished what was asked of her.
 *
 * `WallSnapshot` carried `streakDays` from the day the contract froze and it was hardcoded
 * `null`, because nothing computed it. The history was always there — `chore_day` is keyed by
 * local date and `chore_assignment` records a terminal state per child — so this is a read,
 * not a new kind of state. Nothing is stored: a stored streak is a second copy of a truth the
 * assignments already hold, and it would need a nightly job to stay true.
 *
 * Six rules, and each one is a decision that could reasonably have gone the other way.
 *
 * 1. **DUTIES ONLY.** Extras are optional and pay points; requiring them would break a
 *    streak because a child declined something the product calls optional, which is the
 *    system contradicting itself on the child's own screen.
 *
 * 2. **"Done" is `claimed` OR `approved` — the child's part, NOT the parent's.** Approval is
 *    an adult tapping a button, and this project already refused to build one number that
 *    depends on that: the ledger has no `paid` state because "a state that depends on an
 *    adult remembering to tap it will drift and then lie to a child" (H2 Q2). A streak
 *    broken because a parent was busy on Tuesday is that same failure, aimed at a child who
 *    did everything asked. Approval still gates the POINTS; it does not gate the streak.
 *
 * 3. **A day with no duties is NEUTRAL** — it neither extends the streak nor breaks it.
 *    Chores recur on schedules and a Sunday with nothing assigned is not a failure. The
 *    consequence is worth stating plainly: a streak counts QUALIFYING DAYS, not calendar
 *    days, so it can span a gap. "Every day I was asked, I did it" is the claim it makes.
 *
 * 4. **`superseded` is excluded from the day entirely, not counted as done.** On a shared
 *    first-complete chore the losers of the claim race are superseded — not a failure, but
 *    not work either. Counting it as done would award a streak day for losing a race;
 *    counting it as failed would punish a child for being second. It leaves the denominator.
 *
 * 5. **Today can never break the streak, only extend it.** An unfinished today is unfinished,
 *    not failed — at 06:30 nothing has been done yet by anyone. So the number reads through
 *    yesterday until today completes, and never falls while a child is looking at it.
 *
 * 6. **A day counts with one duty left undone** (ADR-0006 §4, the household's call on
 *    2026-10-24). "Every duty, every day" made the day hardest for the child with the most
 *    asked of her, and one miss already costs nothing at the WEEK's scale (Lally); the day
 *    gets the same allowance. At least one duty must be done, so a day with a single duty
 *    still needs it. `dayCounts` is the one definition; the week dots must use it too.
 */

import type { Database as Db } from 'better-sqlite3';
import type { LocalDate } from '../../types.ts';

/**
 * Below this the streak is not shown at all — `null`, and the badge simply has no streak
 * line. A "0 day streak" is the wall telling a child she has nothing, in a house where a
 * sibling can walk over and read it.
 *
 * THREE, not two, and the number came from the panel rather than from taste: two independent
 * reviewers picked the same threshold unprompted, on the same argument — under three days
 * there is no pattern yet, so the line would be noise that appears and vanishes. See
 * docs/decisions/0005-streaks.md, including the residual risk they both named and which is
 * NOT solved: a streak vanishing after a long run is itself a visible signal.
 */
export const STREAK_DISPLAY_MIN = 3;

/** How many of a day's duties may be left undone and the day still count (rule 6). */
export const DUTIES_A_DAY_MAY_MISS = 1;

/** Whether a day with `asked` duties, `done` of them finished, counts as a full day. */
export function dayCounts(done: number, asked: number): boolean {
  return asked > 0 && done >= Math.max(1, asked - DUTIES_A_DAY_MAY_MISS);
}

interface DayRow {
  local_date: string;
  /** Duties assigned that day, excluding superseded ones (rule 4). */
  qualifying: number;
  /** Of those, the ones the child finished (rule 2). */
  done: number;
}

/**
 * The raw run of qualifying days ending today. Zero is a real answer and a common one.
 *
 * Kept separate from the display rule so the number itself is testable without a threshold
 * in the way, and so changing what is SHOWN never changes what is COUNTED.
 */
export function choreStreakDays(db: Db, childId: string, today: LocalDate): number {
  const rows = db
    .prepare(
      `SELECT cd.local_date AS local_date,
              COUNT(*) AS qualifying,
              SUM(CASE WHEN ca.state IN ('claimed','approved') THEN 1 ELSE 0 END) AS done
         FROM chore_assignment ca
         JOIN chore_day cd ON cd.id = ca.chore_day_id
         JOIN chore c      ON c.id  = cd.chore_id
        WHERE ca.child_id = ?
          AND c.kind = 'duty'
          AND ca.state <> 'superseded'
          AND cd.local_date <= ?
        GROUP BY cd.local_date
        ORDER BY cd.local_date DESC`,
    )
    .all(childId, today) as DayRow[];

  let streak = 0;
  for (const row of rows) {
    // A day whose only duties were superseded groups to zero rows and never appears here;
    // this guard is for safety, not for a case the query produces.
    if (row.qualifying === 0) continue;
    if (dayCounts(row.done, row.qualifying)) {
      streak += 1;
      continue;
    }
    // Rule 5. Only the first row can be today, since the scan is newest-first.
    if (row.local_date === today) continue;
    break;
  }
  return streak;
}

/** The streak as the wall should render it: a number worth showing, or nothing. */
export function displayStreak(streak: number): number | null {
  return streak >= STREAK_DISPLAY_MIN ? streak : null;
}
