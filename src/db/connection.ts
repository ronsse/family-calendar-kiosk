/**
 * Unit A — persistence. Connection setup.
 *
 * Every connection this application opens MUST go through `openDatabase`. `PRAGMA
 * foreign_keys` is per-connection and is NOT persisted by running db/schema.sql, so a
 * connection opened any other way has every foreign key in the contract silently
 * unenforced — including the composite keys that stop a bedtime step reaching the
 * morning routine (H1 lens 4). `assertIntegrity` makes that failure loud rather than
 * silent, and is called on open.
 */

import Database from 'better-sqlite3';
import type { Database as Db } from 'better-sqlite3';

export interface OpenOptions {
  /** File path, or ':memory:' for tests. */
  path: string;
  readonly?: boolean;
}

export function openDatabase({ path, readonly = false }: OpenOptions): Db {
  const db = new Database(path, { readonly });

  // Order matters: journal_mode must be set before heavy use, and foreign_keys
  // cannot be changed inside a transaction.
  if (!readonly) db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  // NORMAL is safe under WAL and avoids an fsync per commit — the wall writes on every
  // tap and a 3-year-old taps a lot.
  if (!readonly) db.pragma('synchronous = NORMAL');
  // Fail fast instead of hanging the event loop: better-sqlite3 is synchronous, so a
  // long busy-wait would block the wall's own reads.
  db.pragma('busy_timeout = 5000');

  assertForeignKeysEnforced(db);
  return db;
}

/**
 * Proves foreign keys are actually being enforced on THIS connection, rather than
 * trusting the pragma's return value. Cheap, and it runs once per open.
 */
export function assertForeignKeysEnforced(db: Db): void {
  const on = db.pragma('foreign_keys', { simple: true });
  if (on !== 1) {
    throw new Error(
      'foreign_keys is OFF on this connection — every FK in the contract is unenforced',
    );
  }
}

/** Full integrity sweep. Run at startup; it is O(db size), so not per request. */
export function assertIntegrity(db: Db): void {
  const integrity = db.pragma('integrity_check', { simple: true });
  if (integrity !== 'ok') throw new Error(`integrity_check failed: ${String(integrity)}`);
  const violations = db.pragma('foreign_key_check') as unknown[];
  if (violations.length > 0) {
    throw new Error(`foreign_key_check found ${violations.length} violation(s)`);
  }
}

/**
 * Runs `fn` inside an IMMEDIATE transaction.
 *
 * IMMEDIATE, not DEFERRED: the write lock is taken up front, so two concurrent
 * materializations cannot both read "no row exists" and then contend on write. Every
 * mutation in this application is a read-then-write, so deferred would be wrong
 * everywhere it mattered.
 */
export function inTransaction<T>(db: Db, fn: () => T): T {
  return db.transaction(fn).immediate();
}
