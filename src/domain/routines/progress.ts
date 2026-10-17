/**
 * Unit E — routines. Progress derivation.
 *
 * "3 of 5 done", per child per run, always computed from LIVE (non-revoked) completions.
 * Never stored: a counter column is a second copy of truth that drifts from the rows the
 * moment a revoke lands, and the thing it would then lie to is a child counting her own
 * pictures. Same reasoning as the ledger's SUM(delta)-on-read (H3 finding #2).
 */

import type { Database as Db } from 'better-sqlite3';
import type { RoutineRunStepView, RoutineRunView } from '../../types.ts';

export interface RoutineProgress {
  runId: number;
  childId: string;
  /** Steps with a live completion. */
  done: number;
  total: number;
  /** True only when `total > 0` — an empty run is not a finished one. */
  complete: boolean;
}

/** Pure derivation from an already-built view. No database round-trip. */
export function progressOf(view: RoutineRunView): RoutineProgress {
  return {
    runId: view.runId,
    childId: view.childId,
    ...countSteps(view.steps),
  };
}

function countSteps(steps: readonly RoutineRunStepView[]): {
  done: number;
  total: number;
  complete: boolean;
} {
  const done = steps.filter((s) => s.completedAtUtc !== null).length;
  const total = steps.length;
  return { done, total, complete: total > 0 && done === total };
}

/**
 * Progress straight from the database, for callers holding a run id rather than a view —
 * chiefly the mutation routes, which answer "3 of 5" after a tap without rebuilding the
 * whole wall snapshot.
 *
 * The LEFT JOIN cannot fan out: `ux_one_live_completion` permits at most one row per step
 * with `revoked_at_utc IS NULL`, which is precisely the join predicate.
 */
export function progressForRun(db: Db, runId: number, childId: string): RoutineProgress {
  const row = db
    .prepare(
      `SELECT COUNT(*) AS total, COUNT(c.id) AS done
         FROM routine_run_step s
         LEFT JOIN routine_step_completion c
                ON c.run_step_id = s.id AND c.revoked_at_utc IS NULL
        WHERE s.run_id = ? AND s.child_id = ?`,
    )
    .get(runId, childId) as { total: number; done: number };

  return {
    runId,
    childId,
    done: row.done,
    total: row.total,
    complete: row.total > 0 && row.done === row.total,
  };
}
