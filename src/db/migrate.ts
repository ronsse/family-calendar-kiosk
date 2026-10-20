/**
 * Unit A — persistence. Migration runner.
 *
 * Idempotent: safe to run on every boot, which is what makes "reflash the Pi, run the
 * script, no manual steps" true for the server side too. `db/schema.sql` is the frozen
 * Phase 0 contract and is applied verbatim; this file never edits it.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Database as Db } from 'better-sqlite3';
import { assertIntegrity } from './connection.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
export const SCHEMA_PATH = resolve(HERE, '../../db/schema.sql');
export const SEED_DEV_PATH = resolve(HERE, '../../db/seed.dev.sql');

/** The version db/schema.sql declares. Bumping it requires a new migration step. */
export const TARGET_VERSION = 12;

/**
 * Upgrades, keyed by the version they PRODUCE.
 *
 * A fresh database gets `schema.sql` verbatim and is born at `TARGET_VERSION`; an existing
 * one walks this list. Both paths must land on the same shape, which is what the schema
 * verifier checks — and the reason each step here is written to mirror a specific edit in
 * `schema.sql` rather than to be clever.
 *
 * SQLite's `ALTER TABLE ADD COLUMN` cannot add a CHECK constraint to an existing table, so a
 * migrated database enforces `kind` and `due_by_local` by DEFAULT and by the writer rather
 * than by the table. That asymmetry is deliberate and is the cheap half of the trade: the
 * alternative is the twelve-step table rebuild, on a live household database, to gain a
 * constraint on two columns that only `provision.ts` writes.
 */
const UPGRADES: readonly { readonly to: number; readonly sql: string }[] = [
  {
    to: 2,
    sql: `
      ALTER TABLE chore ADD COLUMN kind TEXT NOT NULL DEFAULT 'duty';
      ALTER TABLE chore ADD COLUMN due_by_local TEXT;
    `,
  },
  {
    // v3 is a NEW table rather than an altered one, so unlike v2 it carries its CHECK
    // constraints on both paths — a migrated database and a fresh one are identical here, and
    // the `target` CHECK that keeps this table from growing into a tap log holds either way.
    to: 3,
    sql: `
      CREATE TABLE door_tap (
        local_date  TEXT NOT NULL,
        target      TEXT NOT NULL CHECK (target IN ('calendar','grown-ups')),
        scene       INTEGER NOT NULL CHECK (scene IN (0,1)),
        taps        INTEGER NOT NULL DEFAULT 0 CHECK (taps >= 0),
        minutes     INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
        last_local  TEXT,
        PRIMARY KEY (local_date, target, scene)
      ) STRICT;
    `,
  },
  {
    // Same shape as v3 and for the same reason: a new table carries its CHECK constraints on
    // both paths, so a household database that has been running since August ends up
    // byte-identical to one created fresh from schema.sql today. Mirrors the `scene` block in
    // db/schema.sql verbatim — the comments live there, next to the columns.
    to: 4,
    sql: `
      CREATE TABLE scene (
        id              TEXT PRIMARY KEY,
        rel_path        TEXT NOT NULL,
        state           TEXT NOT NULL CHECK (state IN ('candidate','approved','retired')),
        source          TEXT NOT NULL CHECK (source IN ('baseline','generated')),
        style_id        TEXT,
        created_at_utc  TEXT NOT NULL,
        decided_at_utc  TEXT
      ) STRICT;
      CREATE INDEX ix_scene_active ON scene(state, decided_at_utc DESC);
    `,
  },
  {
    // A plain nullable column, so unlike v4 there is no CHECK to lose on the migrated path —
    // ALTER TABLE ADD COLUMN and the fresh schema produce the identical shape.
    //
    // Existing rows keep NULL and draw no emoji until the next sync generation replaces them,
    // which is minutes away on the normal schedule. Backfilling was considered and refused: it
    // would mean running the classifier over history from inside a migration.
    to: 5,
    sql: `ALTER TABLE calendar_event ADD COLUMN emoji TEXT;`,
  },
  {
    // Same shape as v5. Authored rather than derived — see the column comment in schema.sql.
    to: 6,
    sql: `ALTER TABLE countdown ADD COLUMN emoji TEXT;`,
  },
  {
    // ALTER TABLE ADD COLUMN cannot carry a CHECK, so a migrated database enforces the two
    // legal values by DEFAULT and by the writer rather than by the table — the same asymmetry
    // v2 took, and for the same reason: the alternative is a twelve-step table rebuild on a
    // live household database to constrain one column that only provisioning writes.
    to: 7,
    sql: `ALTER TABLE calendar_source ADD COLUMN event_filter TEXT NOT NULL DEFAULT 'all';`,
  },
  {
    to: 8,
    sql: `ALTER TABLE calendar_source ADD COLUMN keep_terms TEXT;`,
  },
  {
    // A new table, so both paths carry the same shape. Mirrors the `dog_deed_done` block in
    // db/schema.sql; the comments live there.
    to: 9,
    sql: `
      CREATE TABLE dog_deed_done (
        week        TEXT NOT NULL,
        deed_id     TEXT NOT NULL,
        done_at_utc TEXT NOT NULL,
        PRIMARY KEY (week, deed_id)
      ) STRICT;
    `,
  },
  {
    // Same shape as v5, and for the same event: the category the classifier DERIVED from the
    // title, before the "is it illustrated" step that folds it into `icon_asset_id`. Existing
    // rows keep NULL until the next sync generation replaces them — minutes away — and, as with
    // v5, no backfill: the classifier does not run from inside a migration.
    to: 10,
    sql: `ALTER TABLE calendar_event ADD COLUMN category TEXT;`,
  },
  {
    // v11 is a new table, so it carries its CHECK on both paths, like v3 and v9. The backfill
    // is the one fact the old table kept: each scene's LATEST decision. Every earlier approval
    // was overwritten in place by `approveScene`, so history before this step is as long as
    // the household's backups make it (`provision.ts --scene-events`), and no longer.
    to: 11,
    sql: `
      CREATE TABLE scene_decision (
        scene_id  TEXT NOT NULL,
        kind      TEXT NOT NULL CHECK (kind IN ('approved','retired')),
        at_utc    TEXT NOT NULL,
        PRIMARY KEY (scene_id, at_utc, kind)
      ) STRICT;
      INSERT OR IGNORE INTO scene_decision (scene_id, kind, at_utc)
        SELECT id, state, decided_at_utc FROM scene
         WHERE state IN ('approved','retired') AND decided_at_utc IS NOT NULL;
    `,
  },
  {
    // A countdown may carry its own horizon. NULL keeps the household's 60 days, so every
    // existing row is unchanged; a grown-up's birthday sets 14, because two months of "Mum's
    // birthday" on a child's wall is furniture (2026-10-20).
    to: 12,
    sql: `
      ALTER TABLE countdown ADD COLUMN horizon_days INTEGER
        CHECK (horizon_days IS NULL OR horizon_days BETWEEN 0 AND 366);
    `,
  },
];

export interface MigrateResult {
  applied: boolean;
  version: number;
}

function currentVersion(db: Db): number {
  const t = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_migration'`)
    .get();
  if (!t) return 0;
  const row = db.prepare('SELECT MAX(version) AS v FROM schema_migration').get() as
    | { v: number | null }
    | undefined;
  return row?.v ?? 0;
}

/**
 * Applies the schema if the database is empty. Does nothing if it is already at
 * TARGET_VERSION, so calling this on every boot is free.
 *
 * schema.sql ends with its own INSERT INTO schema_migration, so it is applied only to a
 * version-0 database; re-running it would violate the primary key. That is deliberate —
 * a failed re-run is better than a silently half-applied one.
 */
export function migrate(db: Db): MigrateResult {
  const from = currentVersion(db);
  if (from >= TARGET_VERSION) return { applied: false, version: from };

  if (from === 0) {
    // executeScript cannot run inside a transaction wrapper here: schema.sql contains
    // PRAGMA statements, and journal_mode is a no-op inside one.
    db.exec(readFileSync(SCHEMA_PATH, 'utf8'));
    assertIntegrity(db);
    return { applied: true, version: TARGET_VERSION };
  }

  // An existing database walks the steps. Each one is its own transaction WITH its
  // `schema_migration` row, so a failure half way leaves the version at the last step that
  // actually completed rather than at a number that describes a shape the file does not have.
  let at = from;
  for (const step of UPGRADES) {
    if (step.to <= at) continue;
    if (step.to !== at + 1) {
      throw new Error(`no upgrade path from version ${at} to ${step.to}`);
    }
    db.transaction(() => {
      db.exec(step.sql);
      db.prepare('INSERT INTO schema_migration(version, applied_at_utc) VALUES (?, ?)').run(
        step.to,
        new Date().toISOString(),
      );
    })();
    at = step.to;
  }
  if (at !== TARGET_VERSION) {
    throw new Error(
      `database is at version ${at}, target is ${TARGET_VERSION}, and no upgrade path exists`,
    );
  }
  assertIntegrity(db);
  return { applied: true, version: at };
}

/** Development fixtures. Synthetic only — never real household data (build-plan §3.1). */
export function seedDev(db: Db): void {
  db.exec(readFileSync(SEED_DEV_PATH, 'utf8'));
}

// `node --experimental-strip-types src/db/migrate.ts [path]`
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { openDatabase } = await import('./connection.ts');
  const path = process.argv[2] ?? 'dev.db';
  const db = openDatabase({ path });
  const result = migrate(db);
  console.log(
    result.applied
      ? `migrated ${path} to version ${result.version}`
      : `${path} already at version ${result.version}`,
  );
  db.close();
}
