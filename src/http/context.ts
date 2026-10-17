/**
 * Unit F — HTTP. What a handler is given, and what it may return.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database as Db } from 'better-sqlite3';
import type { DeviceIdentity } from './auth.ts';
import type { SnapshotOptions } from './snapshot.ts';
import type { WallEventStream } from './stream.ts';
import type { CalendarRefresher } from './calendar-refresh.ts';

/** The handler wrote the response itself (SSE). The dispatcher must not touch it. */
export const HANDLED = Symbol('handled');
/** 204, no body. */
export const NO_CONTENT = Symbol('no-content');

export interface RequestContext {
  db: Db;
  stream: WallEventStream;
  req: IncomingMessage;
  res: ServerResponse;
  url: URL;
  /** Fixed for the life of the request, so two reads in one handler cannot disagree. */
  now: Date;
  /** Null only on the public surface; both authenticated surfaces guarantee it. */
  device: DeviceIdentity | null;
  /** Parsed once, memoised, size-capped. */
  body: () => Promise<Record<string, unknown>>;
  snapshotOptions: SnapshotOptions;
  /**
   * The forced-refresh trigger, or null when this server was built without one.
   *
   * Null is a supported configuration, not an oversight: every route test constructs a server
   * against `:memory:`, where calendar sync deliberately refuses to start at all.
   */
  calendarRefresh: CalendarRefresher | null;
}

export type HandlerResult = unknown | typeof HANDLED | typeof NO_CONTENT;

export interface RouteSpec {
  method: 'GET' | 'POST' | 'DELETE';
  surface: 'wall' | 'admin' | 'public';
  pattern: string;
  handler: (
    ctx: RequestContext,
    params: Record<string, string>,
  ) => Promise<HandlerResult> | HandlerResult;
}
