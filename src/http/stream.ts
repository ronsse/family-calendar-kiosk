/**
 * Unit F — SSE. `GET /api/wall/v1/stream`.
 *
 * **This channel carries no state.** It emits `invalidate` and `heartbeat`, and nothing
 * else, because a client that can learn a fact from a push has a second source of truth to
 * diverge from the snapshot. The client refetches the whole snapshot on `open`, on any
 * `invalidate`, and at every local date boundary — that last one being the failure H3
 * finding #4 named: the kiosk never reloads, nothing emits an event at local midnight, so a
 * design without a client-side boundary refetch renders Monday at 06:00 on Tuesday, alive
 * and structurally valid and wrong. SSE cannot fix that for the client, and must not be
 * relied on to.
 *
 * ## Wire format
 *
 * Every message is a DEFAULT (`message`) event whose data is one `WallEvent` JSON object.
 * No `event:` name field. `WallEvent` is a discriminated union on `type`, so the
 * discriminant is already in the payload, and a named event would be invisible to a client
 * using `EventSource.onmessage` — a silent, total loss of invalidation that looks exactly
 * like a quiet house.
 *
 * A heartbeat is sent IMMEDIATELY on connect, before anything else, because it carries
 * `minClientBuild`: an obsolete bundle then hard-reloads before it ever parses a snapshot
 * shape it does not understand (H3 finding #9).
 */

import type { ServerResponse } from 'node:http';
import { nowUtc } from '../time.ts';
import type { WallEvent } from '../types.ts';
import { MIN_CLIENT_BUILD } from './protocol.ts';

/** Long enough not to be chatter, short enough to beat any idle proxy timeout. */
export const DEFAULT_HEARTBEAT_MS = 20_000;

/** Handed to the browser as `retry:`, so a dropped stream re-establishes on its own. */
export const DEFAULT_RETRY_MS = 3_000;

export type InvalidateScope = Extract<WallEvent, { type: 'invalidate' }>['scope'];

export interface StreamOptions {
  heartbeatMs?: number | undefined;
  retryMs?: number | undefined;
}

interface Client {
  res: ServerResponse;
}

/**
 * The fan-out. One shared timer for every client rather than a timer each: the wall is
 * normally the only subscriber, and a per-client interval turns a leaked connection into a
 * leaked timer.
 */
export class WallEventStream {
  readonly #clients = new Set<Client>();
  readonly #heartbeatMs: number;
  readonly #retryMs: number;
  #timer: NodeJS.Timeout | null = null;
  #nextId = 1;
  #closed = false;

  constructor(options: StreamOptions = {}) {
    this.#heartbeatMs = options.heartbeatMs ?? DEFAULT_HEARTBEAT_MS;
    this.#retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
  }

  get clientCount(): number {
    return this.#clients.size;
  }

  /** Takes ownership of `res`: it stays open until the peer leaves or `close()` is called. */
  attach(res: ServerResponse, onClose?: () => void): void {
    if (this.#closed) {
      res.writeHead(503).end();
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      // A cached event stream is a wall frozen at whatever the cache holds.
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      // Defeats proxy buffering, which otherwise holds heartbeats until the buffer fills
      // and makes a live stream indistinguishable from a dead one.
      'X-Accel-Buffering': 'no',
    });
    // Nagle would sit on a 60-byte heartbeat waiting for company.
    res.socket?.setNoDelay(true);
    // The wall's stream is idle by design; an inactivity timeout would kill it hourly.
    res.socket?.setTimeout(0);

    const client: Client = { res };
    this.#clients.add(client);

    res.write(`retry: ${this.#retryMs}\n\n`);
    // minClientBuild, immediately — before the client parses anything else.
    this.#writeTo(client, this.#heartbeat());

    const drop = (): void => {
      if (this.#clients.delete(client)) onClose?.();
      this.#stopTimerIfIdle();
    };
    res.on('close', drop);
    res.on('error', drop);

    this.#startTimer();
  }

  /**
   * A reason to refetch, never a fact. `scope` narrows what the client re-reads; a client
   * that ignores it and refetches the whole snapshot is still correct, which is the property
   * that keeps this channel from becoming load-bearing.
   */
  invalidate(scope: InvalidateScope): void {
    this.broadcast({ type: 'invalidate', scope });
  }

  broadcast(event: WallEvent): void {
    if (this.#closed) return;
    for (const client of [...this.#clients]) this.#writeTo(client, event);
  }

  /** Ends every stream and clears the timer, so a process (or a test) can exit. */
  close(): void {
    this.#closed = true;
    if (this.#timer) clearInterval(this.#timer);
    this.#timer = null;
    for (const client of [...this.#clients]) {
      this.#clients.delete(client);
      try {
        client.res.end();
      } catch {
        /* the peer is already gone */
      }
    }
  }

  #heartbeat(): WallEvent {
    return { type: 'heartbeat', generatedAtUtc: nowUtc(), minClientBuild: MIN_CLIENT_BUILD };
  }

  #writeTo(client: Client, event: WallEvent): void {
    try {
      // No `event:` line — see the wire-format note at the top of this file.
      client.res.write(`id: ${this.#nextId++}\ndata: ${JSON.stringify(event)}\n\n`);
    } catch {
      // A write to a half-closed socket must never propagate into a mutation handler that
      // already committed. Drop the client and carry on.
      this.#clients.delete(client);
      this.#stopTimerIfIdle();
    }
  }

  #startTimer(): void {
    if (this.#timer || this.#clients.size === 0) return;
    this.#timer = setInterval(() => this.broadcast(this.#heartbeat()), this.#heartbeatMs);
    // Never the reason a process stays alive: the http server owns that decision.
    this.#timer.unref?.();
  }

  #stopTimerIfIdle(): void {
    if (this.#clients.size > 0 || !this.#timer) return;
    clearInterval(this.#timer);
    this.#timer = null;
  }
}
