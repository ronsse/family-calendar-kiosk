/**
 * Unit C — chores. Lazy, idempotent, self-repairing materialization.
 *
 * The shape of `materializeChoreDay` IS the contract, and it is deliberately the same
 * shape as `materializeRoutineRun` in src/db/repo.ts (H3 finding #1, found independently
 * by 5/5 pre-mortem panelists):
 *
 *   1. INSERT ... ON CONFLICT DO NOTHING — never rely on the insert's return value, and
 *      never swallow the conflict as an error.
 *   2. Re-SELECT the canonical row by its natural key `(chore_id, local_date)`. Whoever
 *      won the race, everyone agrees on the same day.
 *   3. If the day exists but has no assignments — the crash-between-writes case — expand
 *      them now. Without this a child sees an empty board forever.
 *
 * `chore_day` SNAPSHOTS `points_each` and `model`, and every expansion and every
 * transition reads them from the snapshot rather than from `chore`. That is what makes a
 * parent's mid-day edit harmless: raising a chore from 3 to 30 points at lunchtime cannot
 * retroactively repay this morning, and flipping `assignment_model` cannot turn a claim
 * race that already resolved into something else.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { localDate as todayLocal, nowUtc } from '../../time.ts';
import type { AssignmentModel, LocalDate, MaterializationStatus } from '../../types.ts';
import { evaluateRrule } from './recurrence.ts';
import { childrenAwayForJob } from './away.ts';
import { rotationAssigneeSkipping, type RotationMember } from './rotation.ts';

export interface MaterializedChoreDay {
  choreDayId: number;
  choreId: string;
  localDate: LocalDate;
  /** Snapshot, read back from the canonical row — not from `chore`. */
  pointsEach: number;
  /** Snapshot, read back from the canonical row — not from `chore`. */
  model: AssignmentModel;
  /** True only for the caller that actually inserted the day. */
  created: boolean;
  /** Assignments written by THIS call: the initial expansion, or a later self-repair. */
  assignmentsWritten: number;
}

export interface ChoreMaterializationResult {
  localDate: LocalDate;
  days: MaterializedChoreDay[];
  /** Chores whose rrule this build cannot evaluate. They are absent from the board. */
  unsupported: { choreId: string; reason: string }[];
  /** Chores that threw. Isolated so one bad chore cannot blank the whole board. */
  failed: { choreId: string; error: string }[];
  status: MaterializationStatus;
}

/**
 * Returns the day only if it is COMPLETE — the row exists AND it has assignments. A day
 * with no assignments is the crash-between-writes case and still needs the repair path,
 * so it deliberately does not qualify here.
 */
function readCompleteDay(
  db: Db,
  choreId: string,
  date: LocalDate,
): MaterializedChoreDay | null {
  const day = db
    .prepare(
      `SELECT id, points_each, model FROM chore_day WHERE chore_id = ? AND local_date = ?`,
    )
    .get(choreId, date) as
    | { id: number; points_each: number; model: AssignmentModel }
    | undefined;
  if (!day) return null;
  const existing = db
    .prepare(`SELECT COUNT(*) AS n FROM chore_assignment WHERE chore_day_id = ?`)
    .get(day.id) as { n: number };
  if (existing.n === 0) return null;
  return {
    choreDayId: day.id,
    choreId,
    localDate: date,
    pointsEach: day.points_each,
    model: day.model,
    created: false,
    assignmentsWritten: 0,
  };
}

/**
 * Materializes one chore's day, idempotently. Runs in one IMMEDIATE transaction.
 *
 * Throws only when the chore is missing or inactive, or when the canonical row cannot be
 * read back after the upsert (which means the database is corrupt). Callers that sweep
 * many chores must isolate that — see `materializeChoresForDate`.
 */
export function materializeChoreDay(
  db: Db,
  choreId: string,
  date: LocalDate = todayLocal(),
): MaterializedChoreDay {
  // FAST PATH — read-only, no transaction.
  //
  // Opening an IMMEDIATE transaction unconditionally means a read-only database (full
  // disk, filesystem remounted ro) throws for EVERY chore, including ones already fully
  // materialized on disk. The board would report itself broken while holding everything
  // needed to render it. Same structural fix Unit A made in `materializeRoutineRun`.
  const ready = readCompleteDay(db, choreId, date);
  if (ready) return ready;

  return inTransaction(db, () => {
    const chore = db
      .prepare(
        `SELECT id, assignment_model, base_points FROM chore WHERE id = ? AND active = 1`,
      )
      .get(choreId) as
      | { id: string; assignment_model: AssignmentModel; base_points: number }
      | undefined;
    if (!chore) throw new Error(`no active chore ${choreId}`);

    // Step 1. The conflict is the normal case on every read after the first.
    const info = db
      .prepare(
        `INSERT INTO chore_day (chore_id, local_date, points_each, model, created_at_utc)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(choreId, date, chore.base_points, chore.assignment_model, nowUtc());

    // Step 2. The canonical row, whoever won.
    const day = db
      .prepare(
        `SELECT id, points_each, model FROM chore_day WHERE chore_id = ? AND local_date = ?`,
      )
      .get(choreId, date) as
      | { id: number; points_each: number; model: AssignmentModel }
      | undefined;
    if (!day) throw new Error('chore_day vanished after upsert — database is corrupt');

    // Step 3. Self-repair. Note this expands from the SNAPSHOTTED model, not `chore`.
    const existing = db
      .prepare(`SELECT COUNT(*) AS n FROM chore_assignment WHERE chore_day_id = ?`)
      .get(day.id) as { n: number };
    const written = existing.n === 0 ? expandAssignments(db, day.id, choreId, date, day.model) : 0;

    return {
      choreDayId: day.id,
      choreId,
      localDate: date,
      pointsEach: day.points_each,
      model: day.model,
      created: info.changes === 1,
      assignmentsWritten: written,
    };
  });
}

/**
 * Materializes every active chore that occurs on `date`.
 *
 * Each chore gets its own transaction so a single corrupt or unauthorable chore cannot
 * roll back the rest of the board, and its failure is reported rather than thrown: at
 * 06:00 four correct chore cards plus one logged error beats an exception propagating
 * into the snapshot builder and rendering nothing at all.
 */
export function materializeChoresForDate(
  db: Db,
  date: LocalDate = todayLocal(),
): ChoreMaterializationResult {
  const chores = db
    .prepare(`SELECT id, rrule FROM chore WHERE active = 1 ORDER BY id`)
    .all() as { id: string; rrule: string }[];

  const days: MaterializedChoreDay[] = [];
  const unsupported: { choreId: string; reason: string }[] = [];
  const failed: { choreId: string; error: string }[] = [];

  for (const chore of chores) {
    const evaluation = evaluateRrule(chore.rrule, date);
    if (!evaluation.supported) {
      unsupported.push({ choreId: chore.id, reason: evaluation.reason });
      continue;
    }
    if (!evaluation.occurs) continue;
    try {
      days.push(materializeChoreDay(db, chore.id, date));
    } catch (err) {
      failed.push({ choreId: chore.id, error: err instanceof Error ? err.message : String(err) });
    }
  }

  return {
    localDate: date,
    days,
    unsupported,
    failed,
    // Either list being non-empty means a chore an adult authored is NOT on the board.
    // That is exactly the wrongness the freshness contract exists to make visible.
    status: failed.length > 0 || unsupported.length > 0 ? 'error' : 'ok',
  };
}

/**
 * Expands a materialized day into per-child rows, per the SNAPSHOTTED model.
 *
 *   individual      — one row per eligible child; each child's own chore.
 *   shared          — one row per eligible child, each claimable independently. The
 *                     schema settled the open question from H2 by naming the column
 *                     `points_each` ("snapshot of base_points"): every claimant earns the
 *                     full amount, the points are not divided.
 *   first_complete  — one row per eligible child. Every row starts `pending`; the first
 *                     claim wins and supersedes the rest in the same transaction
 *                     (see transitions.ts).
 *   rotation        — exactly one row, for the deterministic assignee, passed along the
 *                     roster past a child who is out when the job is due (`away.ts`).
 *
 * `ON CONFLICT DO NOTHING` on `UNIQUE(chore_day_id, child_id)` keeps a concurrent
 * self-repair from double-inserting.
 */
function expandAssignments(
  db: Db,
  choreDayId: number,
  choreId: string,
  date: LocalDate,
  model: AssignmentModel,
): number {
  const insert = db.prepare(
    `INSERT INTO chore_assignment (chore_day_id, child_id, state)
     VALUES (?, ?, 'pending') ON CONFLICT DO NOTHING`,
  );

  if (model === 'rotation') {
    // The due time is read from `chore`, not snapshotted: it decides who is home for the job,
    // once, here, and the assignment row it produces is the frozen record of that decision.
    const due = db.prepare(`SELECT due_by_local FROM chore WHERE id = ?`).get(choreId) as
      | { due_by_local: string | null }
      | undefined;
    const away =
      due?.due_by_local != null ? childrenAwayForJob(db, date, due.due_by_local) : new Set<string>();
    const assignee = rotationAssigneeSkipping(choreId, date, rotationMembers(db, choreId), away);
    // No active members: the day exists with no assignments and every later read retries
    // the (cheap) repair. An empty rotation is an authoring gap, not a render failure.
    if (assignee === null) return 0;
    return insert.run(choreDayId, assignee).changes;
  }

  let written = 0;
  for (const childId of roster(db, choreId)) written += insert.run(choreDayId, childId).changes;
  return written;
}

/** Rotation order, restricted to children who are still active. */
export function rotationMembers(db: Db, choreId: string): RotationMember[] {
  const rows = db
    .prepare(
      `SELECT m.child_id, m.position
         FROM chore_rotation_member m
         JOIN child c ON c.id = m.child_id AND c.active = 1
        WHERE m.chore_id = ?
        ORDER BY m.position`,
    )
    .all(choreId) as { child_id: string; position: number }[];
  return rows.map((r) => ({ childId: r.child_id, position: r.position }));
}

/**
 * Who is eligible for a non-rotation chore.
 *
 * `chore_rotation_member` is the chore's ROSTER; for `rotation` it additionally carries
 * the order. So a `shared` chore with an explicit member list is scoped to those
 * children, and one without is the whole household. The alternative — ignoring the table
 * unless the model is `rotation` — silently puts a card on a third child's board when an
 * adult has plainly said which two children a chore belongs to.
 */
function roster(db: Db, choreId: string): string[] {
  const members = rotationMembers(db, choreId);
  if (members.length > 0) return members.map((m) => m.childId);
  const rows = db
    .prepare(`SELECT id FROM child WHERE active = 1 ORDER BY sort_order`)
    .all() as { id: string }[];
  return rows.map((r) => r.id);
}
