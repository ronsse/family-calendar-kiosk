/**
 * Unit F — the server. `node:http`, one dispatcher, two authenticated surfaces.
 *
 * The `Database` handle is INJECTED rather than opened here, so the whole route surface is
 * testable against `:memory:` and so nothing in this file decides where the household's data
 * lives.
 *
 * ## The catch-all is a feature, not hygiene
 *
 * "No 5xx is ever rendered to a child." Every handler runs inside a catch that converts an
 * unexpected failure into a small JSON body the client is contracted to treat as "keep the
 * last good snapshot and mark it stale". The status code is for the client; what the child
 * sees is yesterday's wall with a staleness mark, which satisfies the prime invariant —
 * stale-and-labelled does, blank-and-honest does not. The cause is logged server-side and
 * never serialised: a stack trace or a SQL fragment on a wall in a living room is both
 * useless to the household and readable by a guest.
 */

import { createServer as createHttpServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { Database as Db } from 'better-sqlite3';
import { authenticateDevice, requireParentPin } from './auth.ts';
import { HANDLED, NO_CONTENT, type RequestContext, type RouteSpec } from './context.ts';
import { probeHealth, type ProbeOptions } from './health.ts';
import { ApiError, CLIENT_BUILD_HEADER, isApiError, MIN_CLIENT_BUILD } from './protocol.ts';
import {
  compile,
  matchPath,
  MAX_BODY_BYTES,
  readJsonBody,
  sendError,
  sendJson,
  sendNoContent,
} from './router.ts';
import { adminRoutes } from './routes.admin.ts';
import type { CalendarRefresher } from './calendar-refresh.ts';
import { wallRoutes } from './routes.wall.ts';
import type { SnapshotOptions } from './snapshot.ts';
import { WallEventStream } from './stream.ts';

export interface ServerLogEvent {
  kind: 'unexpected' | 'refused';
  method: string;
  path: string;
  code: string;
  error?: unknown;
}

export interface WallServerOptions {
  db: Db;
  stream?: WallEventStream | undefined;
  heartbeatMs?: number | undefined;
  maxBodyBytes?: number | undefined;
  snapshot?: SnapshotOptions | undefined;
  /**
   * Lets `POST /api/admin/v1/calendar/refresh` reach the sweep.
   *
   * Passed as an object rather than a callback because the composition root has to build the
   * server BEFORE it starts the scheduler — the scheduler wants `server.stream` — so the thing
   * the route triggers does not exist yet at this point. See `calendar-refresh.ts`.
   */
  calendarRefresh?: CalendarRefresher | undefined;
  healthProbe?: ProbeOptions | undefined;
  /** Overridable so tests can pin a date; production reads the real clock per request. */
  clock?: (() => Date) | undefined;
  logger?: ((event: ServerLogEvent) => void) | undefined;
  /**
   * Last chance to answer a request this router does not own — the seam through which the
   * built SPA is served by the same process, without anything outside `src/http/` being
   * edited. Returns true if it responded.
   */
  fallback?:
    | ((req: IncomingMessage, res: ServerResponse) => boolean | Promise<boolean>)
    | undefined;
}

export interface WallServer {
  server: Server;
  stream: WallEventStream;
  listen(port?: number, host?: string): Promise<AddressInfo>;
  close(): Promise<void>;
}

interface CompiledRoute extends RouteSpec {
  segments: ReturnType<typeof compile>;
}

const HEALTH_PATH = '/api/health';

export function createWallServer(options: WallServerOptions): WallServer {
  const { db } = options;
  const stream =
    options.stream ?? new WallEventStream({ heartbeatMs: options.heartbeatMs });
  const clock = options.clock ?? (() => new Date());
  const maxBodyBytes = options.maxBodyBytes ?? MAX_BODY_BYTES;
  const log = options.logger ?? defaultLogger;

  const routes: CompiledRoute[] = [...wallRoutes, ...adminRoutes].map((r) => ({
    ...r,
    segments: compile(r.pattern),
  }));

  const server = createHttpServer((req, res) => {
    void handle(req, res).catch((err: unknown) => {
      // Nothing above may throw, but if it ever does the socket must still be closed with a
      // body the client can parse rather than left hanging until the kiosk's own timeout.
      log({ kind: 'unexpected', method: req.method ?? '?', path: req.url ?? '?', code: 'unavailable', error: err });
      if (!res.headersSent) {
        sendError(res, new ApiError('unavailable', 'the wall service is briefly unavailable'));
      } else if (!res.writableEnded) {
        res.end();
      }
    });
  });

  // The kiosk holds one connection for months and refetches over it; a short idle timeout
  // buys nothing here and races a client that is about to reuse the socket. headersTimeout
  // must stay above keepAliveTimeout, per Node's own guidance.
  server.keepAliveTimeout = 65_000;
  server.headersTimeout = 70_000;
  // `requestTimeout` bounds RECEIVING a request, not the life of a response. Verified: an
  // SSE response outlives it comfortably, while a half-sent request that will never finish
  // still gets closed.
  server.requestTimeout = 30_000;

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    // A kiosk that walks away mid-request must not surface as a process-level error.
    res.on('error', () => {});

    const url = new URL(req.url ?? '/', 'http://wall.invalid');
    const method = (req.method ?? 'GET').toUpperCase();
    const pathname = url.pathname;

    // Health first: no auth, no build check. `kiosk-gate.py` probes THIS path, not `/`,
    // and it must keep answering even when every other precondition has failed.
    if (pathname === HEALTH_PATH) {
      if (method !== 'GET') return sendError(res, new ApiError('not_found', 'no such route'));
      return sendJson(res, 200, probeHealth(db, options.healthProbe ?? {}));
    }

    let matched: { route: CompiledRoute; params: Record<string, string> } | null = null;
    for (const route of routes) {
      const hit = matchPath(route.segments, pathname);
      if (!hit) continue;
      // Keep scanning on a method mismatch: two routes can share a shape.
      if (route.method !== method) continue;
      matched = { route, params: hit.params };
      break;
    }

    if (!matched) {
      if (options.fallback) {
        const served = await options.fallback(req, res);
        if (served) return;
      }
      return sendError(res, new ApiError('not_found', 'no such route'));
    }

    const ctx = buildContext(matched.route, req, res, url);

    try {
      // BEFORE auth, deliberately. A bundle too old to parse today's shapes is also too old
      // to render `device_revoked` correctly; it must reload first and then discover
      // whatever is actually wrong.
      assertClientBuild(req);

      if (matched.route.surface !== 'public') {
        ctx.device = authenticateDevice(db, headerValue(req, 'authorization'));
      }
      if (matched.route.surface === 'admin') {
        // Per request. Never a session: children and guests touch this screen.
        await requireParentPin(db, headerValue(req, 'x-parent-pin'));
      }

      const result = await matched.route.handler(ctx, matched.params);
      if (result === HANDLED) return;
      if (result === NO_CONTENT) return sendNoContent(res);
      return sendJson(res, 200, result);
    } catch (err) {
      if (isApiError(err)) {
        log({ kind: 'refused', method, path: pathname, code: err.code });
        return sendError(res, err);
      }
      log({ kind: 'unexpected', method, path: pathname, code: 'unavailable', error: err });
      return sendError(
        res,
        new ApiError('unavailable', 'the wall service is briefly unavailable'),
      );
    }
  }

  function buildContext(
    _route: CompiledRoute,
    req: IncomingMessage,
    res: ServerResponse,
    url: URL,
  ): RequestContext {
    let body: Promise<Record<string, unknown>> | null = null;
    return {
      db,
      stream,
      req,
      res,
      url,
      // One clock reading per request: two reads inside a handler must not straddle a
      // second boundary and disagree about when "now" was.
      now: clock(),
      device: null,
      body: () => (body ??= readJsonBody(req, maxBodyBytes)),
      snapshotOptions: options.snapshot ?? {},
      calendarRefresh: options.calendarRefresh ?? null,
    };
  }

  return {
    server,
    stream,
    listen(port = 0, host = '127.0.0.1'): Promise<AddressInfo> {
      return new Promise((resolve, reject) => {
        server.once('error', reject);
        server.listen(port, host, () => {
          server.removeListener('error', reject);
          resolve(server.address() as AddressInfo);
        });
      });
    },
    close(): Promise<void> {
      // Streams first: an open SSE response keeps `server.close` pending forever.
      stream.close();
      return new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      });
    },
  };
}

function headerValue(req: IncomingMessage, name: string): string | undefined {
  const raw = req.headers[name];
  if (Array.isArray(raw)) return raw[0];
  return raw;
}

/**
 * `426 stale_client` when the bundle declares a build below the minimum.
 *
 * A client that sends no build header is not refused: the header is how a bundle opts IN to
 * being told to reload, and refusing its absence would lock out `curl`, the kiosk gate and
 * any first-boot bundle predating the header itself.
 */
function assertClientBuild(req: IncomingMessage): void {
  const raw = headerValue(req, CLIENT_BUILD_HEADER);
  if (raw === undefined) return;
  const build = Number(raw);
  if (!Number.isFinite(build)) return;
  if (build < MIN_CLIENT_BUILD) {
    throw new ApiError('stale_client', 'this display needs to reload');
  }
}

function defaultLogger(event: ServerLogEvent): void {
  if (event.kind !== 'unexpected') return;
  const cause = event.error instanceof Error ? event.error.stack : String(event.error);
  process.stderr.write(`[wall] ${event.method} ${event.path} -> ${event.code}\n${cause}\n`);
}
