/**
 * Unit I — serving the bundle through Unit F's `fallback` seam.
 *
 * `createWallServer` takes a `fallback(req, res) => boolean` that runs only when no route
 * matched. That is the whole integration surface: nothing in `src/http/**` is edited, the wall
 * and its API are one origin (so no CORS, no second port, no preflight on a tap), and the
 * static half can be replaced without touching the routed half.
 *
 * ## Three namespaces, three answers
 *
 *   /bundle/*   hashed build output   — immutable, cached for a year
 *   /assets/id  an avatar, by id      — resolved through the `asset` table, validated only
 *   everything  the SPA, or a file    — index.html, uncached
 *
 * `/assets/:assetId` is documented in the FROZEN contract and is not implemented in
 * `src/http/**`, so it lands here. It is implemented rather than left to 404 because
 * `Child.avatarAssetId` is a bare id and `web/src/views/logic/summary.ts` builds
 * `/assets/<id>` from it — without this, every child's face on the wall is a hole. An
 * unvalidated asset is a 404 and never a placeholder, exactly as api.md specifies: the
 * fallback chain is resolved server-side at snapshot time, and a client-side guess would
 * reintroduce the blank-icon hole that chain exists to close.
 *
 * ## index.html is `no-store`, and that is what makes the reload work
 *
 * The whole `minClientBuild` mechanism ends in `location.reload()`. If the document were
 * cacheable, that reload could be served the SAME stale bundle out of Chromium's disk cache,
 * and the wall would reload forever without ever getting newer code. `no-store` on the
 * document plus content-hashed URLs for everything else is the pairing that makes a reload
 * mean something.
 */

import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Database as Db } from 'better-sqlite3';

export interface StaticOptions {
  /** Vite's `outDir`. Contains index.html and `bundle/`. */
  webRoot: string;
  /** Where `asset.rel_path` is rooted. Household icons and avatars. */
  assetRoot: string;
  /** For the `/assets/:assetId` lookup. Omit to disable that route. */
  db?: Db | undefined;
  logger?: ((message: string) => void) | undefined;
}

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
};

function mimeFor(path: string): string {
  return MIME[extname(path).toLowerCase()] ?? 'application/octet-stream';
}

/**
 * Joins `rel` under `root` and returns null if the result escapes it.
 *
 * `..`, an absolute path, an encoded traversal and a symlink-shaped name all collapse to the
 * same check: after normalisation the result must still start with the root. This server binds
 * a LAN interface and holds a household's schedule; reading arbitrary files off it is not a
 * theoretical concern just because the only intended client is a kiosk.
 */
export function safeJoin(root: string, rel: string): string | null {
  const cleaned = decodeSafely(rel).replace(/^\/+/, '');
  if (cleaned.length === 0) return null;
  if (cleaned.includes('\0')) return null;
  const base = resolve(root);
  const target = normalize(join(base, cleaned));
  if (target !== base && !target.startsWith(base + sep)) return null;
  return target;
}

function decodeSafely(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function statFile(path: string): { size: number; mtimeMs: number } | null {
  try {
    const s = statSync(path);
    return s.isFile() ? { size: s.size, mtimeMs: s.mtimeMs } : null;
  } catch {
    return null;
  }
}

function send(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
  cacheControl: string,
): boolean {
  const info = statFile(path);
  if (info === null) return false;

  res.writeHead(200, {
    'Content-Type': mimeFor(path),
    'Content-Length': String(info.size),
    'Cache-Control': cacheControl,
    // The wall is one origin serving one app to one browser; none of these cost anything and
    // all of them close a door a guest device on the LAN could otherwise push on.
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  });
  if ((req.method ?? 'GET').toUpperCase() === 'HEAD') {
    res.end();
    return true;
  }
  const stream = createReadStream(path);
  // A kiosk that walks away mid-body must not surface as a process-level error.
  stream.on('error', () => {
    if (!res.writableEnded) res.end();
  });
  stream.pipe(res);
  return true;
}

/** `Cache-Control` for the hashed build output, and for everything else. */
export const IMMUTABLE = 'public, max-age=31536000, immutable';
export const NO_STORE = 'no-store, must-revalidate';
/** Household images change when an adult replaces one; a short revalidate is the right trade. */
export const ASSET_CACHE = 'public, max-age=300';

export function createStaticHandler(options: StaticOptions) {
  const webRoot = resolve(options.webRoot);
  const assetRoot = resolve(options.assetRoot);
  const indexHtml = join(webRoot, 'index.html');
  const log = options.logger ?? (() => {});

  const assetById = options.db
    ? options.db.prepare(
        `SELECT rel_path FROM asset WHERE id = ? AND validated_at_utc IS NOT NULL`,
      )
    : null;

  return function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
    const method = (req.method ?? 'GET').toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') return false;

    const url = new URL(req.url ?? '/', 'http://wall.invalid');
    const pathname = url.pathname;

    // Never answer an unrouted API path with the SPA. A bundle that received HTML where it
    // expected JSON would parse it as "malformed" and degrade — correct, but it would hide a
    // genuine 404 behind a staleness marker for as long as nobody looked.
    if (pathname === '/api' || pathname.startsWith('/api/')) return false;

    if (pathname === '/' || pathname === '/index.html') {
      return send(req, res, indexHtml, NO_STORE);
    }

    // Hashed build output. Immutable by construction: the hash IS the version.
    if (pathname.startsWith('/bundle/')) {
      const file = safeJoin(webRoot, pathname);
      if (file !== null && send(req, res, file, IMMUTABLE)) return true;
      return notFound(res);
    }

    // `GET /assets/:assetId` — the avatar route from the frozen contract.
    if (pathname.startsWith('/assets/')) {
      const id = decodeSafely(pathname.slice('/assets/'.length));
      if (id.length === 0 || id.includes('/')) return notFound(res);
      const row = assetById?.get(id) as { rel_path: string } | undefined;
      if (row === undefined) {
        // Unvalidated or unknown: 404, never a placeholder. api.md is explicit about this.
        log(`asset ${id} is unknown or unvalidated`);
        return notFound(res);
      }
      const file = safeJoin(assetRoot, row.rel_path);
      if (file !== null && send(req, res, file, ASSET_CACHE)) return true;
      return notFound(res);
    }

    // `AssetRef.url` is a path relative to the served asset root — `icons/teeth.svg` and the
    // like — so the asset root is mounted at `/`. A real build artefact wins if both exist,
    // which cannot happen while the bundle lives under /bundle/.
    const fromWeb = safeJoin(webRoot, pathname);
    if (fromWeb !== null && send(req, res, fromWeb, NO_STORE)) return true;

    const fromAssets = safeJoin(assetRoot, pathname);
    if (fromAssets !== null && send(req, res, fromAssets, ASSET_CACHE)) return true;

    // Anything left is a deep link into the SPA. Serve the document; the client routes.
    if (!extname(pathname)) return send(req, res, indexHtml, NO_STORE);

    return notFound(res);
  };
}

function notFound(res: ServerResponse): boolean {
  res.writeHead(404, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': NO_STORE,
    'X-Content-Type-Options': 'nosniff',
  });
  res.end('not found\n');
  return true;
}
