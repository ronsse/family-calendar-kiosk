/**
 * Unit C — chores. The read the wall renders.
 *
 * Every icon goes through `resolveAsset` (Unit A), which walks
 * explicit -> asset_fallback[category] -> asset_fallback['_default'] and skips any
 * candidate whose file was never validated. That is why no card here can render blank:
 * for the pre-reader a missing icon IS a blank screen (H2 gap #1), and
 * `REFERENCES asset(id)` proves only that a row exists, not that its file is real.
 * The chain is resolved on the way out, once per row, never fetched hopefully at render
 * time.
 *
 * `points` is the DAY's snapshot (`chore_day.points_each`), never `chore.base_points`.
 * Labels are the live definition because the frozen schema snapshots only points and
 * model onto `chore_day` — so a mid-day rename does reach today's card, while a mid-day
 * repricing does not.
 */

import type { Database as Db } from 'better-sqlite3';
import { resolveAsset } from '../../db/repo.ts';
import type {
  ChoreAssignmentView,
  ChoreKind,
  ChoreState,
  LocalDate,
  LocalTime,
  Utc,
} from '../../types.ts';
import { materializeChoresForDate, type ChoreMaterializationResult } from './materialize.ts';

interface ViewRow {
  assignment_id: number;
  chore_id: string;
  child_id: string;
  local_date: string;
  state: ChoreState;
  points_each: number;
  label_short: string;
  label_full: string;
  icon_asset_id: string;
  category: string;
  kind: string;
  due_by_local: string | null;
  claimed_at_utc: string | null;
  counts_toward_day: number;
}

const VIEW_SQL = `
  SELECT a.id AS assignment_id, a.child_id, a.state, a.claimed_at_utc,
         d.local_date, d.points_each,
         ch.id AS chore_id, ch.label_short, ch.label_full, ch.icon_asset_id, ch.category,
         ch.kind, ch.due_by_local, ch.counts_toward_day
    FROM chore_assignment a
    JOIN chore_day d ON d.id = a.chore_day_id
    JOIN chore ch    ON ch.id = d.chore_id
    JOIN child c     ON c.id = a.child_id
   WHERE c.active = 1
     AND ch.active = 1`;

/*
 * BOTH `active` FLAGS, and the second one was missing until 2026-09-06.
 *
 * `c` is the CHILD and `ch` is the CHORE. They are one character apart, both plausible in this
 * WHERE, and for months only the child was checked — so retiring a chore removed it from
 * tomorrow (materialization filters `active = 1`) and left it on the board for every day
 * already materialized. Since materialization is lazy and per-day, "already materialized" is
 * always TODAY by the time an adult retires anything in the evening. Found when the real chore
 * list went live: the dev-seed chores were retired and the wall kept drawing all four of them
 * alongside the seven new ones, which pushed the board 68px past its pane.
 *
 * The intended behaviour was never in doubt — `provision.ts` already prints "the wall's read
 * filters on active = 1, so those cards vanish unapproved — approve them first" when retiring a
 * chore with outstanding claims. That warning was describing this line. It was just describing
 * it wrongly.
 */

/**
 * Every child's chore cards for one local date, ordered by child then chore.
 *
 * `superseded` rows are INCLUDED. Losing a first_complete race is a terminal, non-paying
 * state — not a failure — and the wall renders it as "someone else got there first".
 * Filtering it out here would make a card a child was looking at simply vanish, which is
 * indistinguishable from the board being broken.
 *
 * This is a pure read: it does not materialize. Call `choresForDate` for the read the
 * snapshot builder wants.
 */
export function listChoreAssignments(db: Db, date: LocalDate): ChoreAssignmentView[] {
  const rows = db
    .prepare(`${VIEW_SQL} AND d.local_date = ? ORDER BY c.sort_order, ch.id`)
    .all(date) as ViewRow[];
  return rows.map((r) => toView(db, r));
}

/** One card, by assignment id — for echoing a row back after a transition. */
export function getChoreAssignment(db: Db, assignmentId: number): ChoreAssignmentView | null {
  const row = db.prepare(`${VIEW_SQL} AND a.id = ?`).get(assignmentId) as ViewRow | undefined;
  return row ? toView(db, row) : null;
}

export interface ChoresForDate {
  assignments: ChoreAssignmentView[];
  materialization: ChoreMaterializationResult;
}

/**
 * Materialize, then read — in that order, which is the whole point of exposing it.
 *
 * A caller that reads without materializing gets an empty board on the first read of the
 * day, and the first read of the day is 06:00 on a school morning. Making the correct
 * order the easy call is cheaper than documenting it and hoping.
 */
export function choresForDate(db: Db, date: LocalDate): ChoresForDate {
  const materialization = materializeChoresForDate(db, date);
  return { assignments: listChoreAssignments(db, date), materialization };
}

/**
 * "HH:MM" or nothing.
 *
 * Same reasoning as `kind`: on a migrated database the column has no CHECK behind it, and a
 * malformed bound must not reach the view layer, where it would be compared against the wall's
 * clock and silently decide a chore is or is not late. An unreadable bound is NO bound — the
 * chore simply never goes overdue, which is the direction that cannot accuse a child of being
 * late because a string was mistyped.
 */
function normaliseDueBy(raw: string | null): LocalTime | null {
  if (typeof raw !== 'string') return null;
  if (!/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(raw)) return null;
  return raw as LocalTime;
}

function toView(db: Db, r: ViewRow): ChoreAssignmentView {
  return {
    assignmentId: r.assignment_id,
    choreId: r.chore_id,
    childId: r.child_id,
    localDate: r.local_date as LocalDate,
    state: r.state,
    // A migrated database cannot carry a CHECK on this column (SQLite will not add one to an
    // existing table), so the read is where an unexpected value is caught. Anything that is
    // not 'extra' is a duty: the safe direction is the one that does not promise money.
    kind: (r.kind === 'extra' ? 'extra' : 'duty') satisfies ChoreKind,
    countsTowardDay: r.kind !== 'extra' && r.counts_toward_day !== 0,
    dueByLocal: normaliseDueBy(r.due_by_local),
    points: r.points_each,
    labelShort: r.label_short,
    labelFull: r.label_full,
    icon: resolveAsset(db, r.icon_asset_id, r.category),
    category: r.category,
    // Only a claim carries one. The column is cleared on unclaim and send-back, but a row in any
    // other state says nothing about when it was claimed, so it is not read off one.
    claimedAtUtc: r.state === 'claimed' ? ((r.claimed_at_utc ?? null) as Utc | null) : null,
  };
}
