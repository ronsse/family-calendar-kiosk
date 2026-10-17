/**
 * Unit E — routines. WHO DOES WHICH STEPS, changed from the wall.
 *
 * Asked for twice (2026-09-13): *"we need a way to look through the chores and be able to assign
 * them. For example, right now, the youngest doesn't have brushing his teeth as part of his bedtime
 * routine."* Until now the only way to give a child a step was to edit `db/household.sql` and
 * re-provision — which deletes children, which cascades to their ledger, which is why
 * `provision.ts` refuses it once anyone has earned anything. So in practice a routine was
 * whatever it was the day the wall went up.
 *
 * ## Three operations, and what each one may touch
 *
 *   assign   — a step joins or leaves ONE child's sequence for ONE routine. Joining appends
 *              at the end; leaving closes the gap so positions stay 1..n.
 *   move     — a step swaps places with its neighbour in that child's sequence.
 *   catalog  — everything the screen needs to draw this, in one read.
 *
 * Only `routine_step_assignment` is ever written for the definition. The steps themselves,
 * the routines and their time boxes are not authored here — the same step row serves three
 * children, so "the youngest gets teeth at bedtime" is a row in the assignment table and nothing else.
 *
 * ## Today's run follows, and that is the whole reason this is not a settings edit
 *
 * A run is a SNAPSHOT (`materializeRoutineRun` copies each child's steps into
 * `routine_run_step` the first time the day is read), and tonight's bedtime was snapshotted
 * this morning. A parent who gives the youngest his teeth at four in the afternoon means TONIGHT, not
 * tomorrow — unlike a chore's points, where "starts tomorrow" is the right answer because
 * today's pay was promised at breakfast. So every write here ends by reconciling today's run
 * for the child it touched, if one exists:
 *
 *   - a step that is newly assigned gets a run row, so it is on the child's screen now;
 *   - a step that is no longer assigned loses its run row (its completions cascade with it —
 *     a step an adult has just removed from the routine is not history worth a stuck card);
 *   - a step that stays keeps its row AND its completion, whatever position it moved to.
 *
 * Positions are renumbered in two passes (park above any live value, then settle) because
 * `UNIQUE (run_id, child_id, position)` and `UNIQUE (routine_id, child_id, position)` would
 * otherwise reject the swap halfway through.
 *
 * Yesterday's runs are never touched: a run is a record of what was asked that day.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { resolveAsset } from '../../db/repo.ts';
import { localDate as todayLocal } from '../../time.ts';
import type { AssetRef, LocalDate } from '../../types.ts';

export interface RoutineStepCatalogEntry {
  readonly id: string;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
  readonly active: boolean;
}

export interface RoutineStepAssignmentEntry {
  readonly childId: string;
  readonly stepId: string;
  readonly position: number;
}

export interface RoutineCatalogEntry {
  readonly id: string;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly opensAtLocal: string;
  readonly closesAtLocal: string;
  readonly daysOfWeek: string;
  readonly active: boolean;
  /** Every step the routine owns, in id order — the pool a child's sequence is drawn from. */
  readonly steps: readonly RoutineStepCatalogEntry[];
  /** Every (child, step, position) fact for this routine. The screen groups them by child. */
  readonly assignments: readonly RoutineStepAssignmentEntry[];
}

export interface RoutineCatalog {
  readonly routines: readonly RoutineCatalogEntry[];
}

export function readRoutineCatalog(db: Db): RoutineCatalog {
  const routines = db
    .prepare(
      `SELECT id, label_short, label_full, opens_at_local, closes_at_local, days_of_week, active
         FROM routine
        ORDER BY sort_order, id`,
    )
    .all() as {
    id: string;
    label_short: string;
    label_full: string;
    opens_at_local: string;
    closes_at_local: string;
    days_of_week: string;
    active: number;
  }[];
  const stepsFor = db.prepare(
    `SELECT id, label_short, label_full, icon_asset_id, category, active
       FROM routine_step WHERE routine_id = ? ORDER BY id`,
  );
  const assignmentsFor = db.prepare(
    `SELECT child_id, routine_step_id, position
       FROM routine_step_assignment WHERE routine_id = ?
      ORDER BY child_id, position`,
  );
  return {
    routines: routines.map((r) => ({
      id: r.id,
      labelShort: r.label_short,
      labelFull: r.label_full,
      opensAtLocal: r.opens_at_local,
      closesAtLocal: r.closes_at_local,
      daysOfWeek: r.days_of_week,
      active: r.active === 1,
      steps: (
        stepsFor.all(r.id) as {
          id: string;
          label_short: string;
          label_full: string;
          icon_asset_id: string;
          category: string;
          active: number;
        }[]
      ).map((s) => ({
        id: s.id,
        labelShort: s.label_short,
        labelFull: s.label_full,
        icon: resolveAsset(db, s.icon_asset_id, s.category),
        active: s.active === 1,
      })),
      assignments: (
        assignmentsFor.all(r.id) as { child_id: string; routine_step_id: string; position: number }[]
      ).map((a) => ({ childId: a.child_id, stepId: a.routine_step_id, position: a.position })),
    })),
  };
}

/**
 * `unknown_routine` / `unknown_step` — the ids do not name a routine, or a step OF THAT
 * routine (a bedtime step cannot be assigned into the morning; the schema's composite FK says
 * the same thing a second time). `unknown_child` — no such active child.
 */
export type AssignFailure = 'unknown_routine' | 'unknown_step' | 'unknown_child';

export interface AssignStepInput {
  routineId: string;
  stepId: string;
  childId: string;
  /** True to put the step in the child's sequence, false to take it out. */
  assigned: boolean;
}

export interface MoveStepInput {
  routineId: string;
  stepId: string;
  childId: string;
  direction: 'up' | 'down';
}

function validate(db: Db, routineId: string, stepId: string, childId: string): AssignFailure | null {
  const routine = db.prepare(`SELECT 1 AS present FROM routine WHERE id = ?`).get(routineId);
  if (!routine) return 'unknown_routine';
  const step = db
    .prepare(`SELECT 1 AS present FROM routine_step WHERE id = ? AND routine_id = ?`)
    .get(stepId, routineId);
  if (!step) return 'unknown_step';
  const child = db.prepare(`SELECT 1 AS present FROM child WHERE id = ? AND active = 1`).get(childId);
  if (!child) return 'unknown_child';
  return null;
}

/** A child's sequence for a routine, in position order. */
function sequence(db: Db, routineId: string, childId: string): string[] {
  return (
    db
      .prepare(
        `SELECT routine_step_id FROM routine_step_assignment
          WHERE routine_id = ? AND child_id = ? ORDER BY position`,
      )
      .all(routineId, childId) as { routine_step_id: string }[]
  ).map((r) => r.routine_step_id);
}

/**
 * Rewrites a child's sequence to exactly `stepIds`, in that order, positions 1..n.
 *
 * Two passes so the UNIQUE on position never fires mid-rewrite: every surviving row is parked
 * at a position no live row can hold, then settled. Rows for steps not in the list are
 * deleted; steps in the list with no row are inserted.
 */
function writeSequence(db: Db, routineId: string, childId: string, stepIds: readonly string[]): void {
  const park = db.prepare(
    `UPDATE routine_step_assignment SET position = position + 100000
      WHERE routine_id = ? AND child_id = ?`,
  );
  const settle = db.prepare(
    `UPDATE routine_step_assignment SET position = ?
      WHERE routine_id = ? AND child_id = ? AND routine_step_id = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO routine_step_assignment (routine_id, child_id, routine_step_id, position)
     VALUES (?, ?, ?, ?)`,
  );
  const present = new Set(sequence(db, routineId, childId));
  db.prepare(
    `DELETE FROM routine_step_assignment
      WHERE routine_id = ? AND child_id = ?
        AND routine_step_id NOT IN (SELECT value FROM json_each(?))`,
  ).run(routineId, childId, JSON.stringify(stepIds));
  park.run(routineId, childId);
  stepIds.forEach((stepId, i) => {
    if (present.has(stepId)) settle.run(i + 1, routineId, childId, stepId);
    else insert.run(routineId, childId, stepId, i + 1);
  });
}

/**
 * Makes TODAY's run for (routine, child) agree with the definition, if the run exists.
 *
 * A run that does not exist yet is left alone: the next read snapshots it from the definition
 * this call just wrote, which is the normal path. A run that exists was snapshotted before
 * this change, and the child's screen is showing it now.
 */
export function reconcileRun(db: Db, routineId: string, childId: string, date: LocalDate): number {
  const run = db
    .prepare(`SELECT id FROM routine_run WHERE routine_id = ? AND local_date = ?`)
    .get(routineId, date) as { id: number } | undefined;
  if (!run) return 0;

  const wanted = db
    .prepare(
      `SELECT a.position, s.id AS step_id, s.label_short, s.label_full, s.icon_asset_id, s.category
         FROM routine_step_assignment a
         JOIN routine_step s ON s.id = a.routine_step_id AND s.routine_id = a.routine_id
        WHERE a.routine_id = ? AND a.child_id = ? AND s.active = 1
        ORDER BY a.position`,
    )
    .all(routineId, childId) as {
    position: number;
    step_id: string;
    label_short: string;
    label_full: string;
    icon_asset_id: string;
    category: string;
  }[];
  const wantedIds = wanted.map((w) => w.step_id);

  // Gone from the definition, gone from today. Completions cascade.
  const removed = db
    .prepare(
      `DELETE FROM routine_run_step
        WHERE run_id = ? AND child_id = ?
          AND (source_step_id IS NULL
               OR source_step_id NOT IN (SELECT value FROM json_each(?)))`,
    )
    .run(run.id, childId, JSON.stringify(wantedIds)).changes;

  db.prepare(
    `UPDATE routine_run_step SET position = position + 100000 WHERE run_id = ? AND child_id = ?`,
  ).run(run.id, childId);
  const settle = db.prepare(
    `UPDATE routine_run_step SET position = ?, label_short = ?, label_full = ?, icon_asset_id = ?
      WHERE run_id = ? AND child_id = ? AND source_step_id = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO routine_run_step
       (run_id, child_id, source_step_id, position, label_short, label_full, icon_asset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );
  let added = 0;
  wanted.forEach((w, i) => {
    const icon = resolveAsset(db, w.icon_asset_id, w.category);
    const settled = settle.run(i + 1, w.label_short, w.label_full, icon.assetId, run.id, childId, w.step_id);
    if (settled.changes === 0) {
      insert.run(run.id, childId, w.step_id, i + 1, w.label_short, w.label_full, icon.assetId);
      added += 1;
    }
  });
  return removed + added;
}

export interface AssignOutcome {
  ok: true;
  /** False when the definition already said this: nothing was written. */
  changed: boolean;
  /** Run rows added or removed on today's run, so the caller knows whether the wall moved. */
  todayTouched: number;
}

export interface AssignRefused {
  ok: false;
  reason: AssignFailure;
}

export function assignStep(
  db: Db,
  input: AssignStepInput,
  date: LocalDate = todayLocal(),
): AssignOutcome | AssignRefused {
  return inTransaction(db, () => {
    const failure = validate(db, input.routineId, input.stepId, input.childId);
    if (failure !== null) return { ok: false, reason: failure };
    const before = sequence(db, input.routineId, input.childId);
    const has = before.includes(input.stepId);
    if (has === input.assigned) return { ok: true, changed: false, todayTouched: 0 };
    const after = input.assigned
      ? [...before, input.stepId]
      : before.filter((id) => id !== input.stepId);
    writeSequence(db, input.routineId, input.childId, after);
    const touched = reconcileRun(db, input.routineId, input.childId, date);
    return { ok: true, changed: true, todayTouched: touched };
  });
}

export function moveStep(
  db: Db,
  input: MoveStepInput,
  date: LocalDate = todayLocal(),
): AssignOutcome | AssignRefused {
  return inTransaction(db, () => {
    const failure = validate(db, input.routineId, input.stepId, input.childId);
    if (failure !== null) return { ok: false, reason: failure };
    const before = sequence(db, input.routineId, input.childId);
    const at = before.indexOf(input.stepId);
    // Not in the sequence, or already at the end it is being pushed towards: a no-op, not an
    // error. A stepper at the edge of its range on this wall never dies and never complains.
    if (at < 0) return { ok: true, changed: false, todayTouched: 0 };
    const to = input.direction === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= before.length) return { ok: true, changed: false, todayTouched: 0 };
    const after = [...before];
    const neighbour = after[to] as string;
    after[to] = input.stepId;
    after[at] = neighbour;
    writeSequence(db, input.routineId, input.childId, after);
    const touched = reconcileRun(db, input.routineId, input.childId, date);
    return { ok: true, changed: true, todayTouched: touched };
  });
}
