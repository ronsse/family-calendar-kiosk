/**
 * Unit E — routines. Step transitions: complete, and undo.
 *
 * Three rules, all of them decided rather than incidental:
 *
 *  1. **Ownership is a predicate on the WRITE, not a check beside it.** Three children's
 *     cards sit on one panel at child height with adjacent 64px targets; a tap a centimetre
 *     off lands on a sibling's card while the request body still names the selected child.
 *     Every statement here carries `AND child_id = :childId`, so a mismatch cannot mutate a
 *     row even if the guard above it is later refactored away. A mismatch is a SILENT no-op
 *     (`403 wrong_child` at the API) — never a fallthrough that reads to a child as "the
 *     button is broken" (api.md, H1 lens 5).
 *
 *  2. **Un-completion is a soft revoke, never a DELETE.** `ux_one_live_completion` is
 *     partial (`WHERE revoked_at_utc IS NULL`), so at most one completion is live while
 *     revoked rows accumulate — revoke-then-recomplete works and the history survives both.
 *
 *  3. **Revoke is child-accessible on purpose.** A three-year-old mis-tapping a capacitive
 *     panel is certain, and PIN-gating the undo bricks the routine until an adult
 *     intervenes — an H2 Q1 fatal flaw. There is deliberately no adult check in this file.
 *
 * Both operations are idempotent. Completing an already-complete step is a success that
 * returns the ORIGINAL timestamp: a double tap must not rewrite when the child did it.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { nowUtc } from '../../time.ts';
import type { Utc } from '../../types.ts';
import { progressForRun, type RoutineProgress } from './progress.ts';

export interface StepMutation {
  runStepId: number;
  childId: string;
}

export interface StepCompleted {
  ok: true;
  runStepId: number;
  childId: string;
  completedAtUtc: Utc;
  /** True when the step was already complete: this call wrote nothing. */
  unchanged: boolean;
  progress: RoutineProgress;
}

export interface StepRevoked {
  ok: true;
  runStepId: number;
  childId: string;
  /** Null only when the step has never been completed. */
  revokedAtUtc: Utc | null;
  /** True when nothing was live to revoke: this call wrote nothing. */
  unchanged: boolean;
  progress: RoutineProgress;
}

/**
 * `wrong_child` — the row exists and belongs to a sibling. Nothing was written.
 * `unknown_step` — no such run step (a stale bundle pointing at yesterday's ids).
 */
export type StepRefusalReason = 'wrong_child' | 'unknown_step';

export interface StepRefused {
  ok: false;
  runStepId: number;
  childId: string;
  reason: StepRefusalReason;
}

export type CompleteStepResult = StepCompleted | StepRefused;
export type RevokeStepResult = StepRevoked | StepRefused;

interface OwnerRow {
  id: number;
  run_id: number;
  child_id: string;
}

function owner(db: Db, runStepId: number): OwnerRow | undefined {
  return db
    .prepare(`SELECT id, run_id, child_id FROM routine_run_step WHERE id = ?`)
    .get(runStepId) as OwnerRow | undefined;
}

/**
 * Marks a step done for the child who owns it.
 *
 * Follows the house write shape (H3 finding #1): INSERT ... ON CONFLICT DO NOTHING, then
 * re-SELECT the canonical live row. The insert's return value is never the answer — under
 * two simultaneous taps the loser must still be told the truth, which is the winner's row.
 */
export function completeStep(db: Db, { runStepId, childId }: StepMutation): CompleteStepResult {
  return inTransaction(db, () => {
    const step = owner(db, runStepId);
    if (!step) return refuse(runStepId, childId, 'unknown_step');
    if (step.child_id !== childId) return refuse(runStepId, childId, 'wrong_child');

    // The ownership predicate lives in the INSERT itself. The trailing WHERE is also what
    // makes `ON CONFLICT` unambiguous to parse on an INSERT ... SELECT.
    const info = db
      .prepare(
        `INSERT INTO routine_step_completion (run_step_id, completed_at_utc)
         SELECT s.id, ?
           FROM routine_run_step s
          WHERE s.id = ? AND s.child_id = ?
         ON CONFLICT DO NOTHING`,
      )
      .run(nowUtc(), runStepId, childId);

    const live = db
      .prepare(
        `SELECT completed_at_utc FROM routine_step_completion
          WHERE run_step_id = ? AND revoked_at_utc IS NULL`,
      )
      .get(runStepId) as { completed_at_utc: string } | undefined;
    if (!live) throw new Error(`completion vanished after upsert for step ${runStepId}`);

    return {
      ok: true,
      runStepId,
      childId,
      completedAtUtc: live.completed_at_utc as Utc,
      unchanged: info.changes === 0,
      progress: progressForRun(db, step.run_id, childId),
    };
  });
}

/**
 * Undoes a completion for the child who owns it. Soft: the row stays, stamped.
 *
 * Revoking a step that is not complete is a success, not an error — the child's intent
 * ("this is not done") already holds, and a second undo tap must not throw an error onto a
 * wall with no adult in front of it.
 */
export function revokeStep(db: Db, { runStepId, childId }: StepMutation): RevokeStepResult {
  return inTransaction(db, () => {
    const step = owner(db, runStepId);
    if (!step) return refuse(runStepId, childId, 'unknown_step');
    if (step.child_id !== childId) return refuse(runStepId, childId, 'wrong_child');

    const info = db
      .prepare(
        `UPDATE routine_step_completion
            SET revoked_at_utc = ?
          WHERE run_step_id = ?
            AND revoked_at_utc IS NULL
            AND EXISTS (SELECT 1 FROM routine_run_step s
                         WHERE s.id = routine_step_completion.run_step_id
                           AND s.child_id = ?)`,
      )
      .run(nowUtc(), runStepId, childId);

    // The canonical answer either way: the row this call stamped, or the previous undo's.
    const last = db
      .prepare(
        `SELECT revoked_at_utc FROM routine_step_completion
          WHERE run_step_id = ? AND revoked_at_utc IS NOT NULL
          ORDER BY revoked_at_utc DESC, id DESC LIMIT 1`,
      )
      .get(runStepId) as { revoked_at_utc: string } | undefined;

    return {
      ok: true,
      runStepId,
      childId,
      revokedAtUtc: (last?.revoked_at_utc ?? null) as Utc | null,
      unchanged: info.changes === 0,
      progress: progressForRun(db, step.run_id, childId),
    };
  });
}

function refuse(runStepId: number, childId: string, reason: StepRefusalReason): StepRefused {
  return { ok: false, runStepId, childId, reason };
}
