/**
 * Unit F — `GET /api/health`. The probe the kiosk gate believes.
 *
 * "Liveness must mean *today's snapshot can be produced*, not *the process is listening*"
 * (api.md, H1 lens 4). Two independent facts answer that, and they are reported separately
 * because they have opposite consequences:
 *
 *   `ok`         — the database ANSWERS A READ. A wall can render an already-materialized
 *                  day from a read-only database, stale and labelled, and that satisfies the
 *                  prime invariant. A wall cannot render from a database it cannot read.
 *   `dbWritable` — a write of the SAME ALLOCATION CLASS as first-materialization of the day
 *                  succeeds, and is then rolled back.
 *
 * The second is the finding. A one-row touch still succeeds on a 95%-full disk while the
 * real 06:00 materialization — a routine run, its per-child step snapshots, a chore day and
 * its assignments — hits `SQLITE_FULL`. A trivial probe reports green and the gate keeps a
 * doomed tab up until a child is standing in front of it. So the probe allocates like the
 * morning does.
 *
 * It writes into `household_config`, which carries no foreign keys, and rolls the whole
 * transaction back by throwing a sentinel out of it — so the rollback happens on the error
 * path too, not only when the code remembers. Nothing is ever committed, and no reader can
 * observe the rows: SQLite's transaction is atomic and WAL isolates readers from it.
 *
 * A TEMP table would be the obvious alternative and is wrong: `temp_store` defaults to a
 * file under the system temp directory, which is a DIFFERENT FILESYSTEM from the database.
 * The probe would then prove that /tmp has room, which is precisely the question nobody
 * asked.
 */

import type { Database as Db } from 'better-sqlite3';
import { nowUtc } from '../time.ts';
import type { Utc } from '../types.ts';

export interface HealthReport {
  ok: boolean;
  dbWritable: boolean;
  generatedAtUtc: Utc;
}

/**
 * Rows and bytes the probe allocates.
 *
 * Sized against a real morning on the reference household: two routines materialize a
 * `routine_run` plus roughly 24 `routine_run_step` rows carrying two labels and a resolved
 * asset id each, and four chores materialize a `chore_day` plus up to a dozen
 * `chore_assignment` rows.
 *
 * MEASURED, rather than asserted: under `PRAGMA max_page_count`, that morning allocates two
 * 4 KiB pages, and 48 x 256 bytes allocates four or five. So the probe is deliberately a
 * small multiple of the thing it stands in for — the same allocation class, biased
 * conservative, and the bias is chosen rather than accidental. The two ways to be wrong are
 * not symmetric: a probe that is too SMALL reports green while 06:00 hits `SQLITE_FULL`,
 * which is the documented catastrophe, whereas a probe that is too LARGE reports
 * `dbWritable: false` on a database that would in fact have fitted this one morning — and a
 * disk with under 20 KiB of headroom is one the next calendar generation ends anyway.
 * `dbWritable: false` is also not an outage by itself: `ok` is reported separately, and an
 * already-materialized day still renders from a database that cannot grow.
 */
export const PROBE_ROWS = 48;
export const PROBE_ROW_BYTES = 256;

const ROLLBACK = Symbol('health-probe-rollback');

export interface ProbeOptions {
  rows?: number | undefined;
  rowBytes?: number | undefined;
}

/**
 * Can the database still absorb a day's first materialization? Never throws.
 *
 * Returns false — rather than throwing, and rather than the cheerful true a trivial probe
 * would return — for a read-only connection, a full disk, a locked database, or a corrupt
 * one. False is not itself an outage: it means the wall may render today only if today is
 * already materialized, which is the read-only fast path Units A and C are built around.
 */
export function probeDbWritable(db: Db, options: ProbeOptions = {}): boolean {
  const rows = options.rows ?? PROBE_ROWS;
  const bytes = options.rowBytes ?? PROBE_ROW_BYTES;
  // Prefixed and per-call unique, so two probes cannot collide inside the window in which
  // neither has rolled back yet.
  const prefix = `__health_probe:${Date.now().toString(36)}:${Math.random().toString(36).slice(2)}`;
  const payload = 'x'.repeat(Math.max(1, bytes));

  try {
    if (db.inTransaction) {
      // Something else owns the transaction; a nested BEGIN would either fail or, worse,
      // commit the probe rows with the caller's work.
      return false;
    }
    db.transaction(() => {
      const insert = db.prepare(
        `INSERT INTO household_config (key, value_text) VALUES (?, ?)`,
      );
      for (let i = 0; i < rows; i++) insert.run(`${prefix}:${i}`, payload);
      // The ONLY exit. better-sqlite3 rolls back when the function throws, so there is no
      // path — including an exception from an insert above — that can leave these rows
      // behind.
      throw ROLLBACK;
    }).immediate();
    // Unreachable: the transaction body always throws.
    return false;
  } catch (err) {
    return err === ROLLBACK;
  }
}

/** Does the database answer a read of the tables a snapshot needs? Never throws. */
export function probeReadable(db: Db): boolean {
  try {
    db.prepare(`SELECT COUNT(*) AS n FROM child WHERE active = 1`).get();
    db.prepare(`SELECT COUNT(*) AS n FROM routine WHERE active = 1`).get();
    return true;
  } catch {
    return false;
  }
}

export function probeHealth(db: Db, options: ProbeOptions = {}): HealthReport {
  return {
    ok: probeReadable(db),
    dbWritable: probeDbWritable(db, options),
    generatedAtUtc: nowUtc(),
  };
}
