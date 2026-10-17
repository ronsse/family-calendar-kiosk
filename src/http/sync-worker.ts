/**
 * Unit F — the calendar sync WORKER. Runs in its own thread, with its own connection.
 *
 * `better-sqlite3` is synchronous by design. A sync that stages a few thousand events in the
 * server process means the event loop cannot answer `/api/wall/v1/snapshot` or an SSE
 * heartbeat for the duration — and the process is not crashed, it is BUSY, so every health
 * check taken outside the window passes while the wall is frozen (H3 finding #8). At 05:58
 * that is the failure the prime invariant forbids, arriving through the one component that
 * looks healthy while causing it.
 *
 * So the loop lives here. A worker thread gets its own SQLite connection; WAL lets it write
 * while the server keeps reading, and the atomic generation promotion in `src/calendar/sync.ts`
 * means a reader sees the old generation or the new one, never a mix.
 *
 * The ADAPTER is imported by path from `workerData`, never named here. Nothing outside
 * `src/calendar/<impl>/` may know which upstream this is; hardcoding an import would put an
 * implementation choice in the HTTP layer and turn the Google-direct swap from a config
 * change into a migration (ADR-0004).
 */

import { parentPort, workerData } from 'node:worker_threads';
import { openDatabase } from '../db/connection.ts';
import { syncAllSources } from '../calendar/sync.ts';
import type { CalendarSource } from '../calendar/CalendarSource.ts';
import { addDays, configureTime, localDate } from '../time.ts';
import { readHousehold } from '../config/household.ts';

export interface SyncWorkerData {
  dbPath: string;
  /** Module specifier resolved by the worker at runtime. Opaque to this file. */
  adapterModule: string;
  /** Named export to use; defaults to `default`. */
  adapterExport: string;
  intervalMs: number;
  daysBack: number;
  daysForward: number;
  retain: number;
}

export type SyncWorkerMessage =
  | { type: 'synced'; ok: number; failed: number; events: number }
  | { type: 'error'; message: string };

if (parentPort) {
  const config = workerData as SyncWorkerData;
  const port = parentPort;
  const db = openDatabase({ path: config.dbPath });
  // This thread has its own module instances, so its own zone: the window it syncs and the
  // floating DTSTARTs it anchors must be the household's, exactly as on the server (2026-10-12).
  configureTime({ timeZone: readHousehold(db).timezone });

  let adapter: CalendarSource | null = null;
  let running = false;

  const loadAdapter = async (): Promise<CalendarSource> => {
    if (adapter) return adapter;
    const mod = (await import(config.adapterModule)) as Record<string, unknown>;
    const candidate = mod[config.adapterExport];
    const resolved = typeof candidate === 'function'
      ? ((candidate as () => CalendarSource)())
      : (candidate as CalendarSource | undefined);
    if (!resolved || typeof resolved.fetchEvents !== 'function') {
      throw new Error(`${config.adapterModule} does not export a CalendarSource`);
    }
    adapter = resolved;
    return resolved;
  };

  const runOnce = async (): Promise<void> => {
    // Never overlap. Two concurrent sweeps would contend on the write lock and, worse,
    // double the wall-clock time during which the disk is being filled with staged
    // generations.
    if (running) return;
    running = true;
    try {
      const source = await loadAdapter();
      // The window follows the LOCAL date and is recomputed every run, so a worker alive
      // across midnight does not keep fetching yesterday's window.
      const today = localDate();
      const results = await syncAllSources(db, source, {
        window: {
          fromDate: addDays(today, -Math.abs(config.daysBack)),
          toDate: addDays(today, Math.abs(config.daysForward)),
        },
        retain: config.retain,
      });
      const ok = results.filter((r) => r.ok).length;
      const events = results.reduce((n, r) => n + (r.ok ? r.eventCount : 0), 0);
      port.postMessage({
        type: 'synced',
        ok,
        failed: results.length - ok,
        events,
      } satisfies SyncWorkerMessage);
    } catch (err) {
      // Reported, never thrown: an unreachable upstream must not take the worker down and
      // leave the calendar frozen with nothing scheduled to unfreeze it. The promoted
      // generation is untouched, so the wall keeps yesterday's schedule — stale, and
      // labelled through `Freshness.calendarSyncAgeSeconds`.
      port.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      } satisfies SyncWorkerMessage);
    } finally {
      running = false;
    }
  };

  const timer = setInterval(() => void runOnce(), config.intervalMs);

  port.on('message', (msg: { type?: string }) => {
    if (msg?.type === 'sync-now') void runOnce();
    if (msg?.type === 'stop') {
      clearInterval(timer);
      try {
        db.close();
      } catch {
        /* closing a already-closed handle is not a failure */
      }
      port.close();
    }
  });

  // One sweep at startup, so a boot after a long outage does not wait a full interval
  // before the wall has today's calendar.
  void runOnce();
}
