/**
 * Unit C — chores. WHO IS ASKED, AND HOW, changed from the wall.
 *
 * The routine screen's sibling (`domain/routines/assign.ts`): *"a way to look through the chores
 * and be able to assign them."* Until now a chore's roster and its model were `--chores` file
 * edits, run from a shell, and a household that wanted the youngest on the dishwasher for a week had to
 * find a laptop. This module gives the grown-up screen the same three verbs the routines one has,
 * over the two things a chore has that a routine step does not:
 *
 *   member   — a child joins or leaves the chore's ROSTER. Joining appends; leaving closes the
 *              gap so positions stay 1..n.
 *   move     — a child swaps places with a neighbour in the roster. Only a `rotation` reads the
 *              order, but it is harmless to keep it tidy on every model.
 *   model    — how the roster is asked: each on their own (`individual`), take turns
 *              (`rotation`), or first one to do it (`first_complete`).
 *
 * ## The roster is one table with two meanings, and this module always writes the explicit one
 *
 * `chore_rotation_member` is the rotation ORDER for a `rotation` chore and the ROSTER for the
 * others; an EMPTY roster means "every active child" for the non-rotation models and "nobody"
 * for a rotation (`materialize.ts`, `roster()`). That double meaning is fine for a file and a
 * trap for a toggle: taking the last child off an explicit roster would not produce a chore
 * nobody does, it would produce a chore EVERYBODY does. So the wall may never empty a roster —
 * `roster_empty` refuses it — and the first write against an implicit roster spells it out
 * (all active children, in household order) before applying the change. Switching TO `rotation`
 * on an implicit roster spells it out for the same reason: a rotation with no members
 * materializes a day nobody is asked to do.
 *
 * ## Today follows for the roster, and tomorrow for the model
 *
 * A `chore_day` is a SNAPSHOT of `(points_each, model)` and its assignments are frozen at
 * materialization — that is what makes a mid-day reprice harmless and a rotation's turn
 * un-rerollable, and this module keeps both. So a MODEL change starts tomorrow, full stop.
 *
 * A ROSTER change is different in exactly the way a routine step is: a parent who adds the youngest to
 * "feed the dog" at four in the afternoon means today. So when today's day exists and its
 * snapshotted model is NOT a rotation:
 *
 *   - a child who joins gets a `pending` row — or `superseded`, when today is a `first_complete`
 *     day and the race has already been won, because a claim button on a chore a sibling has
 *     already done is a lie;
 *   - a child who leaves loses their row only while it is still `pending`. A claim or an
 *     approval is work a child did, and it stays.
 *
 * A rotation day is never touched: its one assignee was chosen this morning and a child may
 * already be doing it.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../../db/connection.ts';
import { resolveAsset } from '../../db/repo.ts';
import { localDate as todayLocal } from '../../time.ts';
import type { AssetRef, AssignmentModel, ChoreKind, LocalDate } from '../../types.ts';

export interface ChoreRosterEntry {
  readonly childId: string;
  readonly position: number;
}

export interface ChoreCatalogEntry {
  readonly id: string;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
  readonly category: string;
  readonly assignmentModel: AssignmentModel;
  readonly basePoints: number;
  readonly kind: ChoreKind;
  readonly rrule: string;
  readonly dueByLocal: string | null;
  readonly active: boolean;
  /**
   * The EFFECTIVE roster, in order: what the table says, or every active child when the table
   * says nothing. The screen never has to know the empty-means-everyone rule.
   */
  readonly roster: readonly ChoreRosterEntry[];
  /** True when `roster` was spelled out by a person rather than implied by an empty table. */
  readonly rosterExplicit: boolean;
}

/** One icon a new chore may wear: a validated `kind = 'icon'` asset, with its category. */
export interface ChoreIconEntry {
  readonly assetId: string;
  readonly url: string;
  readonly category: string;
}

export interface ChoreCatalog {
  readonly chores: readonly ChoreCatalogEntry[];
  /**
   * Every icon the sheet may offer, in id order. Unvalidated rows are left out: an icon whose
   * file was never checked would draw as a blank on the very picker that exists to avoid one.
   */
  readonly icons: readonly ChoreIconEntry[];
}

/** Every active child, in household order — the implicit roster. */
function household(db: Db): string[] {
  return (
    db.prepare(`SELECT id FROM child WHERE active = 1 ORDER BY sort_order`).all() as { id: string }[]
  ).map((r) => r.id);
}

/** The explicit roster, in position order, including inactive children (they are still rows). */
function explicitRoster(db: Db, choreId: string): string[] {
  return (
    db
      .prepare(`SELECT child_id FROM chore_rotation_member WHERE chore_id = ? ORDER BY position`)
      .all(choreId) as { child_id: string }[]
  ).map((r) => r.child_id);
}

function effectiveRoster(db: Db, choreId: string): { ids: string[]; explicit: boolean } {
  const explicit = explicitRoster(db, choreId);
  if (explicit.length > 0) return { ids: explicit, explicit: true };
  return { ids: household(db), explicit: false };
}

function iconChoices(db: Db): ChoreIconEntry[] {
  return (
    db
      .prepare(
        `SELECT id, rel_path, category FROM asset
          WHERE kind = 'icon' AND validated_at_utc IS NOT NULL
          ORDER BY id`,
      )
      .all() as { id: string; rel_path: string; category: string }[]
  ).map((r) => ({ assetId: r.id, url: r.rel_path, category: r.category }));
}

export function readChoreCatalog(db: Db): ChoreCatalog {
  const rows = db
    .prepare(
      `SELECT id, label_short, label_full, icon_asset_id, category, assignment_model,
              base_points, kind, rrule, due_by_local, active
         FROM chore
        ORDER BY active DESC, kind, label_full, id`,
    )
    .all() as {
    id: string;
    label_short: string;
    label_full: string;
    icon_asset_id: string;
    category: string;
    assignment_model: AssignmentModel;
    base_points: number;
    kind: ChoreKind;
    rrule: string;
    due_by_local: string | null;
    active: number;
  }[];
  return {
    chores: rows.map((c) => {
      const roster = effectiveRoster(db, c.id);
      return {
        id: c.id,
        labelShort: c.label_short,
        labelFull: c.label_full,
        icon: resolveAsset(db, c.icon_asset_id, c.category),
        category: c.category,
        assignmentModel: c.assignment_model,
        basePoints: c.base_points,
        kind: c.kind,
        rrule: c.rrule,
        dueByLocal: c.due_by_local,
        active: c.active === 1,
        roster: roster.ids.map((childId, i) => ({ childId, position: i + 1 })),
        rosterExplicit: roster.explicit,
      };
    }),
    icons: iconChoices(db),
  };
}

/**
 * `unknown_chore` / `unknown_child` — no such active chore, or no such active child.
 * `roster_empty` — the change would leave nobody on the chore (see the module note for why that
 * is refused rather than written). `bad_model` — not a model the schema knows.
 */
export type ChoreEditFailure = 'unknown_chore' | 'unknown_child' | 'roster_empty' | 'bad_model';

export interface ChoreEditOutcome {
  ok: true;
  /** False when the definition already said this: nothing was written. */
  changed: boolean;
  /** Assignment rows added or removed on today's day, so the caller knows whether the wall moved. */
  todayTouched: number;
}

export interface ChoreEditRefused {
  ok: false;
  reason: ChoreEditFailure;
}

export type ChoreEditResult = ChoreEditOutcome | ChoreEditRefused;

export interface SetMemberInput {
  choreId: string;
  childId: string;
  /** True to put the child on the roster, false to take them off. */
  member: boolean;
}

export interface MoveMemberInput {
  choreId: string;
  childId: string;
  direction: 'up' | 'down';
}

export interface SetModelInput {
  choreId: string;
  assignmentModel: AssignmentModel;
}

export const ASSIGNMENT_MODELS: readonly AssignmentModel[] = [
  'individual',
  'shared',
  'first_complete',
  'rotation',
];

function activeChore(db: Db, choreId: string): { assignment_model: AssignmentModel } | undefined {
  return db
    .prepare(`SELECT assignment_model FROM chore WHERE id = ? AND active = 1`)
    .get(choreId) as { assignment_model: AssignmentModel } | undefined;
}

function activeChild(db: Db, childId: string): boolean {
  return db.prepare(`SELECT 1 AS present FROM child WHERE id = ? AND active = 1`).get(childId) !== undefined;
}

/**
 * Rewrites the roster to exactly `childIds`, in that order, positions 1..n. Two passes so
 * `UNIQUE (chore_id, position)` never fires mid-rewrite.
 */
function writeRoster(db: Db, choreId: string, childIds: readonly string[]): void {
  db.prepare(
    `DELETE FROM chore_rotation_member
      WHERE chore_id = ? AND child_id NOT IN (SELECT value FROM json_each(?))`,
  ).run(choreId, JSON.stringify(childIds));
  db.prepare(`UPDATE chore_rotation_member SET position = position + 100000 WHERE chore_id = ?`).run(
    choreId,
  );
  const settle = db.prepare(
    `UPDATE chore_rotation_member SET position = ? WHERE chore_id = ? AND child_id = ?`,
  );
  const insert = db.prepare(
    `INSERT INTO chore_rotation_member (chore_id, child_id, position) VALUES (?, ?, ?)`,
  );
  childIds.forEach((childId, i) => {
    if (settle.run(i + 1, choreId, childId).changes === 0) insert.run(choreId, childId, i + 1);
  });
}

/**
 * Makes TODAY's day for the chore agree with a roster change, if the day exists and its
 * snapshotted model reads the roster as a set rather than as an order. Returns rows touched.
 */
export function reconcileDay(
  db: Db,
  choreId: string,
  childId: string,
  member: boolean,
  date: LocalDate,
): number {
  const day = db
    .prepare(`SELECT id, model FROM chore_day WHERE chore_id = ? AND local_date = ?`)
    .get(choreId, date) as { id: number; model: AssignmentModel } | undefined;
  if (!day || day.model === 'rotation') return 0;

  if (!member) {
    return db
      .prepare(
        `DELETE FROM chore_assignment WHERE chore_day_id = ? AND child_id = ? AND state = 'pending'`,
      )
      .run(day.id, childId).changes;
  }

  // A first_complete race that is already won has no room for a new runner.
  const won =
    day.model === 'first_complete' &&
    (
      db
        .prepare(
          `SELECT COUNT(*) AS n FROM chore_assignment
            WHERE chore_day_id = ? AND state IN ('claimed', 'approved')`,
        )
        .get(day.id) as { n: number }
    ).n > 0;
  return db
    .prepare(
      `INSERT INTO chore_assignment (chore_day_id, child_id, state)
       VALUES (?, ?, ?) ON CONFLICT DO NOTHING`,
    )
    .run(day.id, childId, won ? 'superseded' : 'pending').changes;
}

export function setChoreMember(
  db: Db,
  input: SetMemberInput,
  date: LocalDate = todayLocal(),
): ChoreEditResult {
  return inTransaction(db, () => {
    if (activeChore(db, input.choreId) === undefined) return { ok: false, reason: 'unknown_chore' };
    if (!activeChild(db, input.childId)) return { ok: false, reason: 'unknown_child' };
    const before = effectiveRoster(db, input.choreId);
    const has = before.ids.includes(input.childId);
    if (has === input.member) return { ok: true, changed: false, todayTouched: 0 };
    const after = input.member
      ? [...before.ids, input.childId]
      : before.ids.filter((id) => id !== input.childId);
    if (after.length === 0) return { ok: false, reason: 'roster_empty' };
    writeRoster(db, input.choreId, after);
    const touched = reconcileDay(db, input.choreId, input.childId, input.member, date);
    return { ok: true, changed: true, todayTouched: touched };
  });
}

export function moveChoreMember(db: Db, input: MoveMemberInput): ChoreEditResult {
  return inTransaction(db, () => {
    if (activeChore(db, input.choreId) === undefined) return { ok: false, reason: 'unknown_chore' };
    if (!activeChild(db, input.childId)) return { ok: false, reason: 'unknown_child' };
    const before = effectiveRoster(db, input.choreId);
    const at = before.ids.indexOf(input.childId);
    // Not on the roster, or already at the end it is being pushed towards: a no-op, not an
    // error — a stepper at the edge of its range on this wall never dies and never complains.
    if (at < 0) return { ok: true, changed: false, todayTouched: 0 };
    const to = input.direction === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= before.ids.length) return { ok: true, changed: false, todayTouched: 0 };
    const after = [...before.ids];
    [after[at], after[to]] = [after[to]!, after[at]!];
    writeRoster(db, input.choreId, after);
    // The order is read tomorrow morning, by the rotation. Today's turn was taken already.
    return { ok: true, changed: true, todayTouched: 0 };
  });
}

export function setChoreModel(db: Db, input: SetModelInput): ChoreEditResult {
  return inTransaction(db, () => {
    if (!ASSIGNMENT_MODELS.includes(input.assignmentModel)) return { ok: false, reason: 'bad_model' };
    const chore = activeChore(db, input.choreId);
    if (chore === undefined) return { ok: false, reason: 'unknown_chore' };
    if (chore.assignment_model === input.assignmentModel) {
      return { ok: true, changed: false, todayTouched: 0 };
    }
    db.prepare(`UPDATE chore SET assignment_model = ? WHERE id = ?`).run(
      input.assignmentModel,
      input.choreId,
    );
    // A rotation over an implicit roster is a rotation over nobody. Spell it out.
    if (input.assignmentModel === 'rotation') {
      const roster = effectiveRoster(db, input.choreId);
      if (!roster.explicit) writeRoster(db, input.choreId, roster.ids);
    }
    // Today's day carries its own snapshot of the model and keeps it; this starts tomorrow.
    return { ok: true, changed: true, todayTouched: 0 };
  });
}
