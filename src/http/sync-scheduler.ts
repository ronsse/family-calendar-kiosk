/**
 * Unit F — the parent side of calendar sync scheduling.
 *
 * `syncAllSources` MUST NOT run on the request path. This starts it in a worker thread and
 * turns each completed sweep into one `invalidate: 'calendar'` — a reason to refetch, never
 * the data itself, so the SSE channel stays stateless.
 *
 * It REFUSES to start rather than degrading quietly, and says why. A scheduler that silently
 * did nothing would present as "the calendar is just quiet today", which is the same shape as
 * every silent-staleness failure H3 finding #10 is about.
 */

import { Worker } from 'node:worker_threads';
import type { WallEventStream } from './stream.ts';
import type { SyncWorkerData, SyncWorkerMessage } from './sync-worker.ts';

export const DEFAULT_SYNC_INTERVAL_MS = 15 * 60_000;
export const DEFAULT_DAYS_BACK = 1;
export const DEFAULT_DAYS_FORWARD = 60;

export interface SyncSchedulerOptions {
  /** A real file. `:memory:` cannot be shared with a worker thread. */
  dbPath: string;
  /** Module specifier for a `CalendarSource`. Opaque here (ADR-0004). */
  adapterModule?: string | undefined;
  adapterExport?: string | undefined;
  stream?: WallEventStream | undefined;
  intervalMs?: number | undefined;
  daysBack?: number | undefined;
  daysForward?: number | undefined;
  retain?: number | undefined;
  onMessage?: ((message: SyncWorkerMessage) => void) | undefined;
}

export interface SyncScheduler {
  started: boolean;
  /** Populated when `started` is false: the reason, for a log an adult will read. */
  reason: string | null;
  syncNow(): void;
  stop(): Promise<void>;
}

function disabled(reason: string): SyncScheduler {
  return {
    started: false,
    reason,
    syncNow: () => {},
    stop: async () => {},
  };
}

/**
 * Starts the sweep, or explains why it did not.
 *
 * Deliberately not started for an in-memory database: a worker thread opening `:memory:`
 * gets its OWN empty database, syncs into it, and reports cheerful success against data
 * nothing will ever read. Refusing is the only honest option.
 */
export function startSyncScheduler(options: SyncSchedulerOptions): SyncScheduler {
  const { dbPath } = options;
  if (!dbPath || dbPath === ':memory:' || dbPath.startsWith('file::memory:')) {
    return disabled('calendar sync needs a file-backed database; an in-memory one cannot be shared with a worker');
  }
  if (!options.adapterModule) {
    return disabled('no calendar adapter is configured, so nothing is scheduled to sync');
  }

  const data: SyncWorkerData = {
    dbPath,
    adapterModule: options.adapterModule,
    adapterExport: options.adapterExport ?? 'default',
    intervalMs: options.intervalMs ?? DEFAULT_SYNC_INTERVAL_MS,
    daysBack: options.daysBack ?? DEFAULT_DAYS_BACK,
    daysForward: options.daysForward ?? DEFAULT_DAYS_FORWARD,
    retain: options.retain ?? 3,
  };

  // execArgv is inherited, which is what carries `--experimental-strip-types` into the
  // worker; the entry point is TypeScript for the same reason every other file here is.
  const worker = new Worker(new URL('./sync-worker.ts', import.meta.url), {
    workerData: data,
  });

  worker.on('message', (message: SyncWorkerMessage) => {
    options.onMessage?.(message);
    // A reason to refetch, not the events. The client re-reads the snapshot, which is the
    // only place calendar state is ever authoritative.
    if (message.type === 'synced') options.stream?.invalidate('calendar');
  });

  worker.on('error', (err) => {
    options.onMessage?.({ type: 'error', message: err.message });
  });

  // The worker must never be the reason the process stays up, and never the reason it dies:
  // a crashed sync leaves the promoted generation exactly where it was, so the wall keeps
  // rendering yesterday's schedule rather than nothing.
  worker.unref();

  return {
    started: true,
    reason: null,
    syncNow: () => worker.postMessage({ type: 'sync-now' }),
    async stop() {
      worker.postMessage({ type: 'stop' });
      await worker.terminate();
    },
  };
}
