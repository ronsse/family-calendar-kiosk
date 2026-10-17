/**
 * Unit F — HTTP plumbing: matching, body reading, responses.
 *
 * Built on `node:http` rather than a framework. The route surface is fourteen paths and the
 * kiosk is the only client, so a router is thirty lines; what a framework would add here is
 * a dependency to keep current on a box that must still boot a wall in five years.
 */

import type { IncomingMessage, ServerResponse } from 'node:http';
import { ApiError, API_VERSION, API_VERSION_HEADER, MIN_CLIENT_BUILD, MIN_CLIENT_BUILD_HEADER } from './protocol.ts';

export type Surface = 'wall' | 'admin' | 'public';

export interface RouteMatch {
  params: Record<string, string>;
}

type Segment = { kind: 'literal'; value: string } | { kind: 'param'; name: string };

export interface Route<Ctx> {
  method: string;
  surface: Surface;
  pattern: string;
  segments: Segment[];
  handler: (ctx: Ctx, params: Record<string, string>) => Promise<unknown> | unknown;
}

export function compile(pattern: string): Segment[] {
  return pattern
    .split('/')
    .filter((s) => s.length > 0)
    .map((s) =>
      s.startsWith(':')
        ? ({ kind: 'param', name: s.slice(1) } as const)
        : ({ kind: 'literal', value: s } as const),
    );
}

export function matchPath(segments: Segment[], pathname: string): RouteMatch | null {
  const parts = pathname.split('/').filter((s) => s.length > 0);
  if (parts.length !== segments.length) return null;
  const params: Record<string, string> = {};
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const part = parts[i];
    if (seg === undefined || part === undefined) return null;
    if (seg.kind === 'literal') {
      if (seg.value !== part) return null;
    } else {
      params[seg.name] = decodeURIComponent(part);
    }
  }
  return { params };
}

/** 64 KiB. Every body on this API is a handful of fields; anything larger is a mistake. */
export const MAX_BODY_BYTES = 64 * 1024;

export async function readJsonBody(
  req: IncomingMessage,
  maxBytes: number = MAX_BODY_BYTES,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buf.length;
    if (size > maxBytes) throw new ApiError('bad_request', 'request body is too large');
    chunks.push(buf);
  }
  if (size === 0) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new ApiError('bad_request', 'request body is not JSON');
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new ApiError('bad_request', 'request body must be a JSON object');
  }
  return parsed as Record<string, unknown>;
}

/**
 * A path id that must be a positive integer.
 *
 * A malformed id on the WALL surface is `not_claimable`, not `bad_request`: the frozen table
 * has a code for "this row cannot make that transition", a non-numeric id names no row, and
 * keeping the refusal inside the table means the wall renders a state it already knows how
 * to render.
 */
export function requireRowId(raw: string | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0) {
    throw new ApiError('not_claimable', 'no such row');
  }
  return n;
}

/**
 * The acting child on a wall mutation.
 *
 * A missing or non-string `childId` is `wrong_child` — a SILENT NO-OP — rather than a
 * validation error. No child owns a row when no child was named, and the wall's contract for
 * `wrong_child` is to render nothing at all, which is the safe outcome for a request that
 * cannot be attributed. A visible error would read to a child as "the button is broken"
 * (api.md, H1 lens 5).
 */
export function requireActingChild(body: Record<string, unknown>): string {
  const childId = body['childId'];
  if (typeof childId !== 'string' || childId.length === 0) {
    throw new ApiError('wrong_child', 'that is not your card');
  }
  return childId;
}

export function standardHeaders(): Record<string, string> {
  return {
    // On EVERY response, so a stale bundle learns it must reload from whatever it happened
    // to call first — not only from a snapshot it may already be unable to parse.
    [MIN_CLIENT_BUILD_HEADER]: String(MIN_CLIENT_BUILD),
    [API_VERSION_HEADER]: String(API_VERSION),
    'Cache-Control': 'no-store',
  };
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded) return;
  const payload = JSON.stringify(body ?? null);
  res.writeHead(status, {
    ...standardHeaders(),
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

export function sendNoContent(res: ServerResponse): void {
  if (res.writableEnded) return;
  res.writeHead(204, standardHeaders());
  res.end();
}

/** The uniform error shape from docs/api.md: `{ error, message }`. Nothing else. */
export function sendError(res: ServerResponse, error: ApiError): void {
  sendJson(res, error.status, { error: error.code, message: error.message });
}
