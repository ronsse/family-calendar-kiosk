/**
 * Unit J — the end-to-end harness.
 *
 * Every unit tested itself. This suite tests that they COMPOSE, so nothing here fakes a
 * unit under test: a real `node:http` server on a real ephemeral port, a real
 * `better-sqlite3` database in a real FILE, real migrations, real fixtures, and real HTTP
 * over the loopback. The only thing ever mocked is the external calendar upstream, and even
 * that is mocked by being genuinely unreachable rather than by substituting a stub.
 *
 * ## Why a file, never `:memory:`
 *
 * `:memory:` is private to the connection that opened it. Three of this application's
 * properties are therefore untestable against it, and all three are ones the wall depends
 * on: WAL cross-connection visibility (the sync worker holds its OWN connection to the same
 * file — `startSyncScheduler` refuses `:memory:` for exactly this reason), the `-wal`/`-shm`
 * sidecar files that a full disk fills first, and durability across a close. A green suite
 * on `:memory:` would be asserting a different storage engine than the one on the wall.
 *
 * ## Two callers, and the type system keeps them apart
 *
 * `wall()` CANNOT send a PIN — the parameter does not exist on it. `admin()` REQUIRES one.
 * That is not stylistic: acceptance step 4 is "the pre-reader completes a routine with no
 * adult help", and a test that proves it while quietly holding a PIN header proves nothing.
 * Making the child's client structurally incapable of authenticating as a parent is the only
 * version of that assertion worth having.
 */

import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../../src/db/connection.ts';
import { migrate, seedDev } from '../../src/db/migrate.ts';
import { issueDeviceToken, setParentPin } from '../../src/http/auth.ts';
import { createWallServer, type ServerLogEvent, type WallServer } from '../../src/http/server.ts';
import { localDate as toLocalDate } from '../../src/time.ts';
import type { LocalDate, WallSnapshot } from '../../src/types.ts';

/** Synthetic, like every fixture in this repo. Never a real household PIN. */
export const PARENT_PIN = '1111';

/** The seeded roster: one child per literacy band (db/seed.dev.sql). */
export const CHILD_FLUENT = 'child-a';
export const CHILD_EMERGENT = 'child-b';
export const CHILD_PRE_READER = 'child-c';

export interface Harness {
  db: Db;
  wall: WallServer;
  base: string;
  token: string;
  deviceId: string;
  /** The real file the server is backed by. Handed to a second connection in one test. */
  dbPath: string;
  /** Everything `createWallServer` logged. Refusals and unexpected faults both land here. */
  logs: ServerLogEvent[];
  /** Moves the server's clock. Every handler reads it exactly once per request. */
  setNow(instant: Date | string): void;
  now(): Date;
  /** The household date at the server's current clock reading. */
  serverToday(): LocalDate;
  stop(): Promise<void>;
}

export interface StartOptions {
  /** Pins the server clock. Omit for the real one. */
  clock?: Date | string;
  /** Sizes the health probe's allocation. Only the health tests touch this. */
  healthProbe?: { rows?: number; rowBytes?: number };
  seed?: boolean;
}

export async function startWall(options: StartOptions = {}): Promise<Harness> {
  const dir = mkdtempSync(join(tmpdir(), 'fc-e2e-'));
  const dbPath = join(dir, 'wall.db');
  const db = openDatabase({ path: dbPath });
  migrate(db);
  if (options.seed !== false) seedDev(db);

  // Provisioned out of band, exactly as `pi/scripts/setup.sh` must: the first device token
  // cannot be minted by a route that already needs a device token.
  const device = issueDeviceToken(db, 'e2e-kiosk');
  await setParentPin(db, PARENT_PIN);

  let current: Date | null = options.clock === undefined ? null : new Date(options.clock);
  const logs: ServerLogEvent[] = [];

  const wall = createWallServer({
    db,
    logger: (event) => logs.push(event),
    // Long enough that no test races a heartbeat it did not ask for.
    heartbeatMs: 60_000,
    clock: () => (current === null ? new Date() : new Date(current)),
    ...(options.healthProbe ? { healthProbe: options.healthProbe } : {}),
  });
  const addr: AddressInfo = await wall.listen(0);

  let stopped = false;
  return {
    db,
    wall,
    base: `http://127.0.0.1:${addr.port}`,
    token: device.token,
    deviceId: device.id,
    dbPath,
    logs,
    setNow: (instant) => {
      current = new Date(instant);
    },
    now: () => (current === null ? new Date() : new Date(current)),
    serverToday: () => toLocalDate(current === null ? new Date() : current),
    stop: async () => {
      if (stopped) return;
      stopped = true;
      await wall.close();
      try {
        db.close();
      } catch {
        /* a test may have closed it deliberately to induce a storage fault */
      }
      rmSync(dir, { recursive: true, force: true });
    },
  };
}

// ---------------------------------------------------------------------------
// The two clients
// ---------------------------------------------------------------------------

export interface Reply {
  status: number;
  headers: Headers;
  body: Record<string, unknown>;
  text: string;
}

interface RawOptions {
  body?: unknown;
  /** `undefined` uses the harness token; `null` sends no Authorization header at all. */
  token?: string | null | undefined;
  pin?: string | undefined;
  headers?: Record<string, string> | undefined;
}

async function request(h: Harness, method: string, path: string, opts: RawOptions): Promise<Reply> {
  const headers: Record<string, string> = { ...opts.headers };
  const token = opts.token === undefined ? h.token : opts.token;
  if (token !== null) headers['Authorization'] = `Device ${token}`;
  if (opts.pin !== undefined) headers['X-Parent-Pin'] = opts.pin;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  const res = await fetch(`${h.base}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const text = await res.text();
  let body: Record<string, unknown> = {};
  if (text.length > 0) {
    try {
      const parsed: unknown = JSON.parse(text);
      body = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
    } catch {
      body = {};
    }
  }
  return { status: res.status, headers: res.headers, body, text };
}

/**
 * The panel. A device token and nothing else — there is no `pin` parameter, so no test can
 * accidentally prove a child's journey while holding a parent's credential.
 */
export function wall(
  h: Harness,
  method: string,
  path: string,
  opts: { body?: unknown; token?: string | null; headers?: Record<string, string> } = {},
): Promise<Reply> {
  return request(h, method, path, opts);
}

/** An adult standing at the panel. The PIN is mandatory, and is verified per request. */
export function admin(
  h: Harness,
  method: string,
  path: string,
  pin: string,
  opts: { body?: unknown; token?: string | null } = {},
): Promise<Reply> {
  return request(h, method, path, { ...opts, pin });
}

/**
 * An admin route called with a device token and NO PIN — the wall reaching for an approval.
 * Separate from `admin` so the intent is visible at the call site.
 */
export function adminWithoutPin(
  h: Harness,
  method: string,
  path: string,
  opts: { body?: unknown } = {},
): Promise<Reply> {
  return request(h, method, path, opts);
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function snapshot(h: Harness, date?: LocalDate): Promise<WallSnapshot> {
  const localDate = date ?? h.serverToday();
  const res = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${localDate}`);
  if (res.status !== 200) {
    throw new Error(`snapshot ${localDate} failed: ${res.status} ${res.text}`);
  }
  return res.body as unknown as WallSnapshot;
}

export function balanceOf(snap: WallSnapshot, childId: string): number {
  const hit = snap.balances.find((b) => b.childId === childId);
  if (!hit) throw new Error(`no balance row for ${childId} — one per active child is contracted`);
  return hit.points;
}

export function choreCard(snap: WallSnapshot, childId: string, choreId: string) {
  const hit = snap.chores.find((c) => c.childId === childId && c.choreId === choreId);
  if (!hit) throw new Error(`no ${choreId} card for ${childId} on ${snap.requestedLocalDate}`);
  return hit;
}

/** The highest-value card a child can actually claim today. Rotation moves, so nothing is hardcoded. */
export function bestPendingCard(snap: WallSnapshot, childId: string) {
  const cards = snap.chores
    .filter((c) => c.childId === childId && c.state === 'pending')
    .sort((a, b) => b.points - a.points);
  const hit = cards[0];
  if (!hit) throw new Error(`no pending chore for ${childId} on ${snap.requestedLocalDate}`);
  return hit;
}

export function runsFor(snap: WallSnapshot, childId: string) {
  return snap.routines.filter((r) => r.childId === childId);
}

/** Raw row state, for asserting that a refused call mutated NOTHING. */
export function assignmentState(h: Harness, assignmentId: number): string | null {
  const row = h.db.prepare(`SELECT state FROM chore_assignment WHERE id = ?`).get(assignmentId) as
    | { state: string }
    | undefined;
  return row?.state ?? null;
}

export function ledgerRowCount(h: Harness, childId: string): number {
  const row = h.db
    .prepare(`SELECT COUNT(*) AS n FROM ledger_entry WHERE child_id = ?`)
    .get(childId) as { n: number };
  return row.n;
}

/** `sql` must select a single `n`. For asserting that a refusal left no row behind. */
export function countRows(h: Harness, sql: string, params: unknown[] = []): number {
  const stmt = h.db.prepare(sql);
  const row = (params.length === 0 ? stmt.get() : stmt.get(...(params as never[]))) as { n: number };
  return row.n;
}

// ---------------------------------------------------------------------------
// SSE
// ---------------------------------------------------------------------------

export interface SseSession {
  /** Frames received so far, oldest first. */
  events: Record<string, unknown>[];
  /** Resolves once `predicate` matches a frame, or rejects on timeout. */
  waitFor(predicate: (e: Record<string, unknown>) => boolean, timeoutMs?: number): Promise<Record<string, unknown>>;
  close(): void;
}

/** Opens `GET /api/wall/v1/stream` and parses the frames as they arrive. */
export async function openStream(h: Harness): Promise<SseSession> {
  const controller = new AbortController();
  const res = await fetch(`${h.base}/api/wall/v1/stream`, {
    headers: { Authorization: `Device ${h.token}` },
    signal: controller.signal,
  });
  if (!res.ok || res.body === null) throw new Error(`stream failed: ${res.status}`);

  const events: Record<string, unknown>[] = [];
  const waiters: { match: (e: Record<string, unknown>) => boolean; resolve: (e: Record<string, unknown>) => void }[] = [];

  const pump = async (): Promise<void> => {
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) return;
        buffer += decoder.decode(value, { stream: true });
        let split = buffer.indexOf('\n\n');
        while (split !== -1) {
          const frame = buffer.slice(0, split);
          buffer = buffer.slice(split + 2);
          for (const line of frame.split('\n')) {
            if (!line.startsWith('data:')) continue;
            const parsed: unknown = JSON.parse(line.slice(5).trim());
            if (parsed === null || typeof parsed !== 'object') continue;
            const event = parsed as Record<string, unknown>;
            events.push(event);
            for (let i = waiters.length - 1; i >= 0; i--) {
              const w = waiters[i];
              if (w && w.match(event)) {
                waiters.splice(i, 1);
                w.resolve(event);
              }
            }
          }
          split = buffer.indexOf('\n\n');
        }
      }
    } catch {
      /* aborted, or the server closed the stream */
    }
  };
  void pump();

  return {
    events,
    waitFor(predicate, timeoutMs = 4000) {
      const already = events.find(predicate);
      if (already) return Promise.resolve(already);
      return new Promise((resolve, reject) => {
        const timer = setTimeout(
          () => reject(new Error(`no matching SSE frame within ${timeoutMs}ms; saw ${JSON.stringify(events)}`)),
          timeoutMs,
        );
        waiters.push({
          match: predicate,
          resolve: (e) => {
            clearTimeout(timer);
            resolve(e);
          },
        });
      });
    },
    close: () => controller.abort(),
  };
}
