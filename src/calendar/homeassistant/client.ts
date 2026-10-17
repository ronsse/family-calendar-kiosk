/**
 * Unit B - Home Assistant adapter. The HTTP layer.
 *
 * INTERNAL TO THIS DIRECTORY.
 *
 * Two rules shape this file, and both come from the prime invariant rather than from HTTP:
 *
 *  1. **A partial answer is worse than no answer.** Every request either produces a fully
 *     parsed body or throws. There is no path that returns "what we got so far": a short
 *     list would be staged, validated as internally consistent, promoted over yesterday's
 *     good data, and rendered as "no events today" with nothing anywhere reporting an
 *     error (H3 finding #7).
 *
 *  2. **Errors leaving this directory must not carry the deployment or the household.**
 *     A thrown message ends up in `sync_run.error`, which is a database column an admin
 *     surface may show. So the message carries the status, the attempt count and a
 *     REDACTED path; the host, the token and the entity id stay in `detail`, for a
 *     server-side log that never leaves the box.
 */

import type { HomeAssistantConfig } from './config.ts';

/** A request that could not be completed. `message` is safe to persist; `detail` is not. */
export class HaRequestError extends Error {
  override readonly name = 'HaRequestError';
  readonly status: number | undefined;
  readonly attempts: number;
  /** Full path and cause. For local logs only - never store this. */
  readonly detail: string;

  constructor(args: {
    message: string;
    status?: number | undefined;
    attempts: number;
    detail: string;
  }) {
    super(args.message);
    this.status = args.status;
    this.attempts = args.attempts;
    this.detail = args.detail;
  }
}

/** `/api/calendars/calendar.family` -> `/api/calendars/<entity>`. */
function redactPath(path: string): string {
  return path.replace(/\/api\/calendars\/[^/?]+/, '/api/calendars/<entity>');
}

/**
 * 5xx and 429 are transient; a 401/403/404 will not improve by being asked again, and
 * retrying it only delays a failure the wall needs to record.
 */
function isTransientStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export interface GetJsonOptions {
  /** Overrides `config.timeoutMs` - `probe()` wants a shorter leash than a full sync. */
  timeoutMs?: number;
  /** Overrides `config.retries`. */
  retries?: number;
  search?: Record<string, string>;
}

/**
 * GETs a JSON body from Home Assistant, with a timeout and bounded retries.
 *
 * Throws `HaRequestError` on transport failure, non-2xx status, or a body that is not
 * JSON. Never resolves with a partial or empty result standing in for a failure.
 */
export async function getJson(
  config: HomeAssistantConfig,
  path: string,
  options: GetJsonOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? config.timeoutMs;
  const maxAttempts = (options.retries ?? config.retries) + 1;

  const url = new URL(config.baseUrl + path);
  for (const [k, v] of Object.entries(options.search ?? {})) url.searchParams.set(k, v);

  let lastStatus: number | undefined;
  let lastDetail = 'no attempt was made';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (attempt > 1) await sleep(config.backoffMs * 2 ** (attempt - 2));

    let response: Response;
    try {
      response = await config.fetchImpl(url, {
        method: 'GET',
        headers: {
          // The token appears here and nowhere else. It is never interpolated into a
          // message, a URL, or a log line.
          Authorization: `Bearer ${config.token}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (cause) {
      lastStatus = undefined;
      lastDetail = `${redactPath(path)}: ${cause instanceof Error ? cause.message : String(cause)}`;
      continue; // transport failures are always worth one more try
    }

    lastStatus = response.status;

    if (!response.ok) {
      lastDetail = `${url.pathname}: HTTP ${response.status}`;
      if (isTransientStatus(response.status)) continue;
      throw new HaRequestError({
        message: `calendar request failed: HTTP ${response.status} on ${redactPath(path)}`,
        status: response.status,
        attempts: attempt,
        detail: lastDetail,
      });
    }

    const text = await response.text();
    try {
      return JSON.parse(text) as unknown;
    } catch {
      // A 200 whose body is not JSON is HA answering with a login page or a proxy error.
      // Retrying is pointless and parsing "as much as we can" is exactly rule 1's trap.
      throw new HaRequestError({
        message: `calendar request returned a non-JSON body on ${redactPath(path)}`,
        status: response.status,
        attempts: attempt,
        detail: `${url.pathname}: body was not JSON (${text.length} bytes)`,
      });
    }
  }

  throw new HaRequestError({
    message:
      lastStatus === undefined
        ? `calendar upstream unreachable after ${maxAttempts} attempt(s) on ${redactPath(path)}`
        : `calendar request failed: HTTP ${lastStatus} after ${maxAttempts} attempt(s) on ${redactPath(path)}`,
    status: lastStatus,
    attempts: maxAttempts,
    detail: lastDetail,
  });
}
