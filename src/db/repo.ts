/**
 * Unit A — persistence. Repository functions.
 *
 * Low-level, typed data access. Domain rules (state machines, ledger arithmetic) belong
 * in src/domain/*, not here — this layer only guarantees that what comes out of SQLite
 * matches the frozen types, and that the two contracts hardest to get right are
 * implemented exactly once: asset fallback resolution, and lazy materialization.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from './connection.ts';
import { dayCode, localDate as todayLocal, nowUtc } from '../time.ts';
import type { AssetRef, Balance, Child, LocalDate, ReadingBand } from '../types.ts';

// ---------------------------------------------------------------------------
// Children
// ---------------------------------------------------------------------------

interface ChildRow {
  id: string;
  display_name: string;
  reading_band: ReadingBand;
  ledger_enabled: number;
  avatar_asset_id: string;
  sort_order: number;
}

export function listActiveChildren(db: Db): Child[] {
  const rows = db
    .prepare(
      `SELECT id, display_name, reading_band, ledger_enabled, avatar_asset_id, sort_order
         FROM child WHERE active = 1 ORDER BY sort_order`,
    )
    .all() as ChildRow[];
  return rows.map((r) => ({
    id: r.id,
    displayName: r.display_name,
    readingBand: r.reading_band,
    ledgerEnabled: r.ledger_enabled === 1,
    avatarAssetId: r.avatar_asset_id,
    sortOrder: r.sort_order,
  }));
}

// ---------------------------------------------------------------------------
// Assets — the fallback chain
// ---------------------------------------------------------------------------

/**
 * Resolves an asset id to a renderable reference, walking
 *   explicit -> asset_fallback[category] -> asset_fallback['_default']
 * and skipping any candidate whose file was never validated.
 *
 * This function is why the render path cannot produce an empty image. For the pre-reader
 * a missing icon is a blank screen (H2 gap #1), and `REFERENCES asset(id)` alone proves
 * only that a row exists, not that its file is real (H1 lens 4). Schema triggers keep the
 * '_default' row present and validated, so the final step always succeeds — if it ever
 * does not, that is a corrupt database and throwing is correct.
 */
export function resolveAsset(db: Db, assetId: string | null, category: string): AssetRef {
  const byId = db.prepare(
    `SELECT id, rel_path FROM asset WHERE id = ? AND validated_at_utc IS NOT NULL`,
  );
  if (assetId) {
    const hit = byId.get(assetId) as { id: string; rel_path: string } | undefined;
    if (hit) return { assetId: hit.id, url: hit.rel_path, isFallback: false };
  }
  const byCategory = db.prepare(
    `SELECT a.id, a.rel_path FROM asset_fallback f
       JOIN asset a ON a.id = f.asset_id
      WHERE f.category = ? AND a.validated_at_utc IS NOT NULL`,
  );
  const cat = byCategory.get(category) as { id: string; rel_path: string } | undefined;
  if (cat) return { assetId: cat.id, url: cat.rel_path, isFallback: true };

  const def = byCategory.get('_default') as { id: string; rel_path: string } | undefined;
  if (def) return { assetId: def.id, url: def.rel_path, isFallback: true };

  throw new Error(
    'asset fallback chain exhausted: the _default fallback is missing or unvalidated',
  );
}

/**
 * Every category that has a validated fallback icon of its OWN.
 *
 * The chain in `resolveAsset` is total but its last step is `_default`, which is the
 * question-mark placeholder — so asking for a category nobody has drawn yet does not
 * degrade to something generic, it degrades to something that looks broken. A caller that
 * DERIVES a category rather than being handed one (the event classifier, Unit B) must
 * therefore be able to ask whether the art exists before committing to the answer.
 *
 * That is what lets a vocabulary entry ship before its icon does: an unillustrated category
 * is skipped here and the caller keeps its own sensible default. One query, not one per row.
 */
export function fallbackCategories(db: Db): Set<string> {
  const rows = db
    .prepare(
      `SELECT f.category AS category FROM asset_fallback f
         JOIN asset a ON a.id = f.asset_id
        WHERE a.validated_at_utc IS NOT NULL`,
    )
    .all() as { category: string }[];
  return new Set(rows.map((r) => r.category));
}

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

/**
 * One row per ACTIVE child, always — including children with no ledger history.
 *
 * A bare `SUM(delta) ... GROUP BY child_id` over ledger_entry returns no row at all for a
 * child before their first approval, which is every child on day one. A renderer calling
 * `.find()` would get undefined and either crash a kiosk that does not reload for months,
 * or show an empty badge a five-year-old cannot distinguish from zero (H1 lens 5).
 */
export function listBalances(db: Db): Balance[] {
  const rate = getCentsPerPoint(db);
  const rows = db
    .prepare(
      `SELECT c.id AS child_id,
              c.ledger_enabled AS ledger_enabled,
              COALESCE(SUM(l.delta), 0) AS points
         FROM child c
         LEFT JOIN ledger_entry l ON l.child_id = c.id
        WHERE c.active = 1
        GROUP BY c.id
        ORDER BY c.sort_order`,
    )
    .all() as { child_id: string; ledger_enabled: number; points: number }[];

  return rows.map((r) => ({
    childId: r.child_id,
    points: r.points,
    cashCents: r.ledger_enabled === 1 && rate !== null ? r.points * rate : null,
  }));
}

export function getCentsPerPoint(db: Db): number | null {
  const row = db
    .prepare(`SELECT value_text FROM household_config WHERE key = 'cents_per_point'`)
    .get() as { value_text: string } | undefined;
  if (!row) return null;
  const n = Number.parseInt(row.value_text, 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

// ---------------------------------------------------------------------------
// Lazy materialization
// ---------------------------------------------------------------------------

export interface MaterializedRun {
  runId: number;
  created: boolean;
  stepsRepaired: number;
}

/**
 * Returns the run only if it is COMPLETE — the row exists AND its step snapshot is
 * present. A run with no steps is the crash-between-writes case and still needs the
 * repair path, so it deliberately does not qualify here.
 */
function readCompleteRun(db: Db, routineId: string, date: LocalDate): MaterializedRun | null {
  const run = db
    .prepare(`SELECT id FROM routine_run WHERE routine_id = ? AND local_date = ?`)
    .get(routineId, date) as { id: number } | undefined;
  if (!run) return null;
  const steps = db
    .prepare(`SELECT COUNT(*) AS n FROM routine_run_step WHERE run_id = ?`)
    .get(run.id) as { n: number };
  if (steps.n === 0) return null;
  return { runId: run.id, created: false, stepsRepaired: 0 };
}

/**
 * Materializes today's run for one routine, idempotently and self-repairingly.
 *
 * The shape of this function IS the contract (H3 finding #1, found independently by 5/5
 * pre-mortem panelists; H2 Q1 winner):
 *
 *  1. INSERT ... ON CONFLICT DO NOTHING — never rely on the insert's return value, and
 *     never swallow the conflict as an error.
 *  2. Re-SELECT the canonical row by its natural key. Whoever won the race, everyone
 *     agrees on the same run.
 *  3. If the run exists but has no step snapshot — the crash-between-writes case — insert
 *     the snapshot now. Without this a child sees an empty routine forever.
 *
 * Steps are SNAPSHOTTED with resolved labels and assets, which is what makes a parent's
 * mid-day edit harmless to a run already in flight.
 *
 * Returns the canonical run id. Runs in one IMMEDIATE transaction.
 */
export function materializeRoutineRun(
  db: Db,
  routineId: string,
  date: LocalDate = todayLocal(),
): MaterializedRun {
  // FAST PATH — read-only, no transaction.
  //
  // Opening an IMMEDIATE transaction unconditionally means a read-only database (full
  // disk, filesystem remounted ro) throws for EVERY routine — including ones whose run
  // and step snapshot are already complete on disk. That is a blank wall at 6:00 AM
  // while holding everything needed to render. Found by Unit E, which had to work
  // around it; this is the structural fix.
  const ready = readCompleteRun(db, routineId, date);
  if (ready) return ready;

  return inTransaction(db, () => {
    const routine = db
      .prepare(
        `SELECT id, opens_at_local, closes_at_local, days_of_week
           FROM routine WHERE id = ? AND active = 1`,
      )
      .get(routineId) as
      | { id: string; opens_at_local: string; closes_at_local: string; days_of_week: string }
      | undefined;
    if (!routine) throw new Error(`no active routine ${routineId}`);

    const info = db
      .prepare(
        `INSERT INTO routine_run (routine_id, local_date, opens_at_local, closes_at_local, created_at_utc)
         VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
      )
      .run(routineId, date, routine.opens_at_local, routine.closes_at_local, nowUtc());

    // Step 2: the canonical row, whoever won.
    const run = db
      .prepare(`SELECT id FROM routine_run WHERE routine_id = ? AND local_date = ?`)
      .get(routineId, date) as { id: number } | undefined;
    if (!run) throw new Error('routine_run vanished after upsert — database is corrupt');

    // Step 3: self-repair a missing snapshot.
    const stepCount = db
      .prepare(`SELECT COUNT(*) AS n FROM routine_run_step WHERE run_id = ?`)
      .get(run.id) as { n: number };
    let repaired = 0;
    if (stepCount.n === 0) repaired = snapshotSteps(db, run.id, routineId);

    return { runId: run.id, created: info.changes === 1, stepsRepaired: repaired };
  });
}

/** Copies each assigned child's ordered steps into the run, with resolved assets. */
function snapshotSteps(db: Db, runId: number, routineId: string): number {
  const assignments = db
    .prepare(
      `SELECT a.child_id, a.position, s.id AS step_id, s.label_short, s.label_full,
              s.icon_asset_id, s.category
         FROM routine_step_assignment a
         JOIN routine_step s ON s.id = a.routine_step_id AND s.routine_id = a.routine_id
        WHERE a.routine_id = ? AND s.active = 1
        ORDER BY a.child_id, a.position`,
    )
    .all(routineId) as {
    child_id: string;
    position: number;
    step_id: string;
    label_short: string;
    label_full: string;
    icon_asset_id: string;
    category: string;
  }[];

  const insert = db.prepare(
    `INSERT INTO routine_run_step
       (run_id, child_id, source_step_id, position, label_short, label_full, icon_asset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  let n = 0;
  for (const a of assignments) {
    const icon = resolveAsset(db, a.icon_asset_id, a.category);
    const r = insert.run(
      runId,
      a.child_id,
      a.step_id,
      a.position,
      a.label_short,
      a.label_full,
      icon.assetId,
    );
    n += r.changes;
  }
  return n;
}

/** Routines whose `days_of_week` includes `date`. */
export function routinesForDate(db: Db, date: LocalDate): string[] {
  const code = dayCode(date);
  const rows = db
    .prepare(`SELECT id, days_of_week FROM routine WHERE active = 1 ORDER BY sort_order`)
    .all() as { id: string; days_of_week: string }[];
  return rows.filter((r) => r.days_of_week.split(',').includes(code)).map((r) => r.id);
}
