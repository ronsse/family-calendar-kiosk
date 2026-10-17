/**
 * Unit E — routines. The read path: today's runs, one view per (routine, child).
 *
 * This is the 6:00 AM experience. Three properties are load-bearing and each one is a
 * failure the design review already paid for:
 *
 *  1. **Selection is by LOCAL day-of-week**, via `dayCode` on a floating LocalDate. Never
 *     by instant arithmetic — a 25-hour day repeats and a 23-hour day can skip, and the
 *     wall would either run Sunday's routine twice or miss Monday entirely (H3 finding #6).
 *  2. **The time box ships as DATA.** `opensAtLocal` / `closesAtLocal` are handed over
 *     verbatim and are NEVER evaluated here into open/locked/closed. A snapshot generated
 *     at 00:00 carrying `locked` would never open at 06:00, because the wall only refetches
 *     on SSE open and at the local date boundary — the fatal flaw H2 Q1 found in a rejected
 *     proposal. The client computes box state from its own clock.
 *  3. **Every icon is re-resolved through the fallback chain at read time.** The snapshot
 *     already stores a resolved `icon_asset_id`, but an asset can be un-validated after
 *     materialization (the schema trigger only protects fallback targets), which would ship
 *     a URL to a file that is no longer known-good. For the pre-reader a missing icon IS a
 *     blank screen (H2 gap #1), so the chain is walked again on the way out.
 *
 * Materialization itself is NOT reimplemented here. `materializeRoutineRun` (Unit A) is the
 * one idempotent, self-repairing implementation and this module composes on top of it.
 */

import type { Database as Db } from 'better-sqlite3';
import { materializeRoutineRun, resolveAsset, routinesForDate } from '../../db/repo.ts';
import { isLocalTime } from '../../time.ts';
import type {
  LocalDate,
  LocalTime,
  MaterializationStatus,
  RoutineRunStepView,
  RoutineRunView,
  Utc,
} from '../../types.ts';

/**
 * Fallback category for a routine's own icon. `routine` has no `category` column, so there
 * is nothing narrower to key on; an authored `asset_fallback('routine', …)` row is honoured
 * if the household adds one, otherwise the chain terminates at '_default'.
 */
export const ROUTINE_ICON_CATEGORY = 'routine';

/** Fallback category for a step whose definition row is gone (`source_step_id` is NULL). */
export const STEP_ICON_CATEGORY = 'routine_step';

/**
 * The box used when a stored time is unparseable. Deliberately always-open: an authoring
 * typo must never lock a child out of her morning routine, and "hiding a routine before its
 * window opens renders a blank wall at 05:30" is explicitly forbidden (H2 Q1).
 */
const ALWAYS_OPEN: readonly [LocalTime, LocalTime] = ['00:00' as LocalTime, '23:59' as LocalTime];

export interface TodaysRoutinesResult {
  routines: RoutineRunView[];
  /**
   * Feeds `Freshness.routineMaterialization`, so the wall can RENDER incompleteness rather
   * than presenting a short list with full confidence (H2 gap #3):
   *   ok    — every scheduled routine materialized (including the no-routines-today case)
   *   stale — some materialized, some failed: what is on screen is real but not the whole day
   *   error — routines were scheduled and none could be produced
   */
  status: MaterializationStatus;
  failures: RoutineFailure[];
}

export interface RoutineFailure {
  routineId: string;
  error: string;
  /**
   * True when a run for this local date already existed and was rendered anyway. The
   * routine is on the wall; what failed was the guarantee that it is up to date.
   */
  salvaged: boolean;
}

/**
 * Today's runs for `localDate`, one view per (routine, child) with at least one step.
 *
 * A child with no assignment in a routine gets no card — an empty card is noise on a wall a
 * three-year-old is reading by shape. Inactive children are excluded, so the views always
 * correspond to a child present in `WallSnapshot.children`.
 */
export function todaysRoutines(db: Db, localDate: LocalDate): RoutineRunView[] {
  return todaysRoutinesWithStatus(db, localDate).routines;
}

/**
 * As `todaysRoutines`, plus the provenance the snapshot needs.
 *
 * One routine that cannot be materialized must not take the rest of the morning down with
 * it — same reasoning as Unit B refusing to let one unreachable calendar stop the other six.
 * The failure is returned, not thrown, and surfaces on the wall as staleness.
 *
 * And when materialization fails, an ALREADY-materialized run for that date is rendered
 * anyway. This is not belt-and-braces; it is the prime invariant. `materializeRoutineRun`
 * opens an IMMEDIATE transaction unconditionally, so a database that has gone read-only —
 * a full disk, a filesystem remounted ro — fails even for a routine whose run and step
 * snapshot are sitting there complete. Without this path the wall is BLANK at 06:00 while
 * holding everything it needs. Stale-and-labelled satisfies the invariant; blank does not.
 */
export function todaysRoutinesWithStatus(db: Db, localDate: LocalDate): TodaysRoutinesResult {
  const scheduled = routinesForDate(db, localDate); // local day-of-week, already sort_order'd
  const routines: RoutineRunView[] = [];
  const failures: RoutineFailure[] = [];

  for (const routineId of scheduled) {
    try {
      const { runId } = materializeRoutineRun(db, routineId, localDate);
      routines.push(...viewsForRun(db, runId));
    } catch (err) {
      const salvaged = salvage(db, routineId, localDate);
      routines.push(...salvaged);
      failures.push({
        routineId,
        error: err instanceof Error ? err.message : String(err),
        salvaged: salvaged.length > 0,
      });
    }
  }

  return { routines, status: statusFor(routines.length, failures.length), failures };
}

/** Whatever is already on disk for this routine and date. Never throws: this IS the fallback. */
function salvage(db: Db, routineId: string, localDate: LocalDate): RoutineRunView[] {
  try {
    const run = db
      .prepare(`SELECT id FROM routine_run WHERE routine_id = ? AND local_date = ?`)
      .get(routineId, localDate) as { id: number } | undefined;
    return run ? viewsForRun(db, run.id) : [];
  } catch {
    return [];
  }
}

function statusFor(rendered: number, failed: number): MaterializationStatus {
  if (failed === 0) return 'ok';
  // Something is on the wall, but the day is no longer guaranteed complete.
  return rendered > 0 ? 'stale' : 'error';
}

interface RunRow {
  run_id: number;
  routine_id: string;
  local_date: string;
  opens_at_local: string;
  closes_at_local: string;
  label_short: string;
  label_full: string;
  icon_asset_id: string;
}

interface StepRow {
  run_step_id: number;
  child_id: string;
  position: number;
  label_short: string;
  label_full: string;
  icon_asset_id: string;
  icon_category: string;
  completed_at_utc: string | null;
}

/** Splits one run's snapshot into one view per child, steps in assigned order. */
export function viewsForRun(db: Db, runId: number): RoutineRunView[] {
  const run = db
    .prepare(
      `SELECT run.id              AS run_id,
              run.routine_id      AS routine_id,
              run.local_date      AS local_date,
              run.opens_at_local  AS opens_at_local,
              run.closes_at_local AS closes_at_local,
              r.label_short       AS label_short,
              r.label_full        AS label_full,
              r.icon_asset_id     AS icon_asset_id
         FROM routine_run run
         JOIN routine r ON r.id = run.routine_id
        WHERE run.id = ?`,
    )
    .get(runId) as RunRow | undefined;
  if (!run) throw new Error(`no routine_run ${runId}`);

  // The BOX comes from the run's own snapshot columns, not from `routine`: a parent moving
  // the window at 14:00 must not move it under a run already in flight (H2 Q1). Labels and
  // the routine icon have no snapshot columns in the frozen schema, so they are read live.
  const [opensAtLocal, closesAtLocal] = safeBox(run.opens_at_local, run.closes_at_local);
  const icon = resolveAsset(db, run.icon_asset_id, ROUTINE_ICON_CATEGORY);

  const steps = db
    .prepare(
      `SELECT s.id            AS run_step_id,
              s.child_id      AS child_id,
              s.position      AS position,
              s.label_short   AS label_short,
              s.label_full    AS label_full,
              s.icon_asset_id AS icon_asset_id,
              COALESCE(def.category, ?) AS icon_category,
              c.completed_at_utc AS completed_at_utc
         FROM routine_run_step s
         JOIN child ch ON ch.id = s.child_id AND ch.active = 1
         LEFT JOIN routine_step def ON def.id = s.source_step_id
         LEFT JOIN routine_step_completion c
                ON c.run_step_id = s.id AND c.revoked_at_utc IS NULL
        WHERE s.run_id = ?
        ORDER BY ch.sort_order, s.position`,
    )
    .all(STEP_ICON_CATEGORY, runId) as StepRow[];

  const byChild = new Map<string, RoutineRunStepView[]>();
  for (const s of steps) {
    let bucket = byChild.get(s.child_id);
    if (!bucket) {
      bucket = [];
      byChild.set(s.child_id, bucket);
    }
    bucket.push({
      runStepId: s.run_step_id,
      position: s.position,
      labelShort: s.label_short,
      labelFull: s.label_full,
      // Re-resolved, not trusted: see property 3 at the top of this file. `icon_category`
      // is the AUTHORING category off the definition and is consulted only when the
      // snapshotted asset is no longer renderable — a repair path, not a content read, so
      // snapshot isolation is intact.
      icon: resolveAsset(db, s.icon_asset_id, s.icon_category),
      completedAtUtc: s.completed_at_utc as Utc | null,
    });
  }

  // Map preserves insertion order, which the ORDER BY made child.sort_order.
  return [...byChild].map(([childId, childSteps]) => ({
    runId: run.run_id,
    routineId: run.routine_id,
    childId,
    localDate: run.local_date as LocalDate,
    labelShort: run.label_short,
    labelFull: run.label_full,
    icon,
    opensAtLocal,
    closesAtLocal,
    steps: childSteps,
  }));
}

function safeBox(opens: string, closes: string): readonly [LocalTime, LocalTime] {
  if (!isLocalTime(opens) || !isLocalTime(closes)) return ALWAYS_OPEN;
  return [opens, closes];
}
