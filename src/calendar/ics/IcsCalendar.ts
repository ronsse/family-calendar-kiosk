/**
 * The iCal implementation of `CalendarSource`: reads Google's "secret address in iCal
 * format" for each calendar directly, with no Home Assistant and no OAuth.
 *
 * Why it exists: HA's Google login died about weekly (2026-08-31, 09-06, 09-15) because the
 * Google Cloud OAuth app sits in Testing, whose refresh tokens last seven days, and taking
 * it out of Testing wants a verified brand. A secret iCal address has no token to expire.
 * The trade is that it is a bearer credential — see config.ts.
 *
 * `externalRef` is the same opaque ref the HA adapter used (`calendar.school`), so the
 * `calendar_source` rows are untouched by the swap. Nothing outside this directory knows
 * the refs are mapped onto environment variables.
 */

import type {
  CalendarSource,
  CalendarSourceDescriptor,
  FetchedEvent,
  FetchWindow,
} from '../CalendarSource.ts';
import { isLocalDate } from '../../time.ts';
import { envNameFor, type IcsConfig, type IcsFeed } from './config.ts';
import { calendarName, eventsInWindow, IcsPayloadError, parseCalendar } from './parse.ts';

const PROBE_TIMEOUT_MS = 3_000;

/** A request that could not be completed. `message` is safe to persist and never holds the URL. */
export class IcsRequestError extends Error {
  override readonly name = 'IcsRequestError';
  readonly status: number | undefined;
  readonly attempts: number;

  constructor(message: string, status: number | undefined, attempts: number) {
    super(message);
    this.status = status;
    this.attempts = attempts;
  }
}

function isTransientStatus(status: number): boolean {
  return status === 429 || status === 408 || status >= 500;
}

const sleep = (ms: number): Promise<void> =>
  ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();

export class IcsCalendar implements CalendarSource {
  readonly kind = 'ics';

  /** Private so `JSON.stringify(adapter)` cannot reach the secret addresses. */
  readonly #config: IcsConfig;

  constructor(config: IcsConfig) {
    this.#config = config;
  }

  async listSources(): Promise<CalendarSourceDescriptor[]> {
    const out: CalendarSourceDescriptor[] = [];
    for (const feed of this.#config.feeds.values()) {
      const root = parseCalendar(await this.#getText(feed));
      out.push({ externalRef: feed.externalRef, label: calendarName(root) ?? feed.externalRef });
    }
    return out;
  }

  /**
   * Fetches the whole feed and expands it over `window`. Throws on any failure — no feed
   * configured for the ref, transport, status, a body that is not a complete calendar, or
   * an event this cannot represent. Never resolves with a short list.
   */
  async fetchEvents(externalRef: string, window: FetchWindow): Promise<FetchedEvent[]> {
    if (!isLocalDate(window.fromDate) || !isLocalDate(window.toDate)) {
      throw new IcsPayloadError('fetch window bounds are not calendar dates');
    }
    if (!(window.fromDate < window.toDate)) throw new IcsPayloadError('fetch window end must be after its start');

    const feed = this.#config.feeds.get(externalRef);
    if (!feed) {
      // A calendar included in the database with no address configured. Failing it (rather
      // than returning nothing) keeps its last good events on the wall, marked stale.
      throw new IcsRequestError(`no iCal address configured (${envNameFor(externalRef)} is not set)`, undefined, 0);
    }
    return eventsInWindow(parseCalendar(await this.#getText(feed)), window);
  }

  /** Liveness: can the first feed be fetched right now. Must not throw. */
  async probe(): Promise<boolean> {
    const first = this.#config.feeds.values().next();
    if (first.done) return false;
    try {
      const text = await this.#getText(first.value, { timeoutMs: PROBE_TIMEOUT_MS, retries: 0 });
      return /^\s*BEGIN:VCALENDAR/i.test(text);
    } catch {
      return false;
    }
  }

  /**
   * GET with a timeout and bounded retries. Every message names the feed's VARIABLE and
   * never its address, and no transport error's own text is copied in: an undici message
   * can carry the host, and a future one could carry the path, which is the secret.
   */
  async #getText(feed: IcsFeed, opts: { timeoutMs?: number; retries?: number } = {}): Promise<string> {
    const timeoutMs = opts.timeoutMs ?? this.#config.timeoutMs;
    const maxAttempts = (opts.retries ?? this.#config.retries) + 1;
    let lastStatus: number | undefined;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      if (attempt > 1) await sleep(this.#config.backoffMs * 2 ** (attempt - 2));
      let response: Response;
      try {
        response = await this.#config.fetchImpl(feed.url, {
          method: 'GET',
          headers: { Accept: 'text/calendar' },
          redirect: 'follow',
          signal: AbortSignal.timeout(timeoutMs),
        });
      } catch {
        lastStatus = undefined;
        continue;
      }
      lastStatus = response.status;
      if (!response.ok) {
        if (isTransientStatus(response.status)) continue;
        // 404 is what Google answers for a secret address that was reset.
        throw new IcsRequestError(
          `calendar feed request failed: HTTP ${response.status} on ${feed.envName}`,
          response.status,
          attempt,
        );
      }
      return await response.text();
    }
    throw new IcsRequestError(
      lastStatus === undefined
        ? `calendar feed unreachable after ${maxAttempts} attempt(s) on ${feed.envName}`
        : `calendar feed request failed: HTTP ${lastStatus} after ${maxAttempts} attempt(s) on ${feed.envName}`,
      lastStatus,
      maxAttempts,
    );
  }
}
