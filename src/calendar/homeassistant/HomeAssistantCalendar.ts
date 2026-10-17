/**
 * Unit B - the Home Assistant implementation of `CalendarSource`.
 *
 * HA is kept solely because its Google OAuth is already finished and in production; it is
 * not the architecture (ADR-0004). This class, and the four modules beside it, are the
 * ONLY places that know HA exists. Nothing here appears in a signature: callers see
 * `CalendarSourceDescriptor`, `FetchedEvent` and an opaque `externalRef`.
 *
 * The REST surface used, in full:
 *
 *   GET /api/                                Bearer <token>  -> {"message":"API running."}
 *   GET /api/calendars                                       -> [{entity_id, name}, ...]
 *   GET /api/calendars/<entity_id>?start=&end=               -> [{summary, start, end, ...}]
 *   GET /api/states/<entity_id>                              -> {state: on|off|unavailable, ...}
 *
 * `externalRef` is the entity id. That is an implementation detail of this directory and
 * is why `calendar_source.external_ref` is documented as opaque: swapping to the Google
 * API directly must stay a config change, not a migration.
 */

import type {
  CalendarSource,
  CalendarSourceDescriptor,
  FetchedEvent,
  FetchWindow,
} from '../CalendarSource.ts';
import { isLocalDate } from '../../time.ts';
import type { HomeAssistantConfig } from './config.ts';
import { getJson } from './client.ts';
import {
  assertEntityId,
  assertEntityLive,
  normaliseCalendarList,
  normaliseEvents,
  HaPayloadError,
} from './wire.ts';
import { localMidnightUtc } from './zoned.ts';

/** `probe()` runs on the freshness path and must never be the slow thing on the page. */
const PROBE_TIMEOUT_MS = 3_000;

export class HomeAssistantCalendar implements CalendarSource {
  readonly kind = 'homeassistant';

  /** Private so `JSON.stringify(adapter)` cannot reach the token. */
  readonly #config: HomeAssistantConfig;

  constructor(config: HomeAssistantConfig) {
    this.#config = config;
  }

  async listSources(): Promise<CalendarSourceDescriptor[]> {
    const raw = await getJson(this.#config, '/api/calendars');
    return normaliseCalendarList(raw).map((c) => ({ externalRef: c.entityId, label: c.label }));
  }

  /**
   * Fetches one calendar over `window`, normalised into the frozen shape.
   *
   * Throws on any failure - transport, status, a payload field this adapter cannot
   * represent, or an entity HA itself reports as `unavailable`. It never resolves with a short list. The caller stages the result into a
   * new generation and promotes atomically, so a throw costs a stale calendar (visible
   * via `Freshness.calendarSyncAgeSeconds`) while a short list costs a wrong one.
   *
   * The window is a pair of floating LOCAL dates and HA filters by instant, so the bounds
   * are anchored through `localMidnightUtc`. Stepping by 24h of UTC instead would drop the
   * first or last local day of the window twice a year (H3 finding #6).
   */
  async fetchEvents(externalRef: string, window: FetchWindow): Promise<FetchedEvent[]> {
    assertEntityId(externalRef);
    assertWindow(window);

    const start = localMidnightUtc(window.fromDate);
    const end = localMidnightUtc(window.toDate);

    const raw = await getJson(this.#config, `/api/calendars/${encodeURIComponent(externalRef)}`, {
      search: { start: start.toISOString(), end: end.toISOString() },
    });

    const events = normaliseEvents(raw, {
      entityId: externalRef,
      utcMidnightIsAllDay: this.#config.utcMidnightIsAllDay,
    });

    // A 200 from the events endpoint does not mean the calendar is current: HA serves its
    // local copy long after Google has stopped answering it. The entity state is the only
    // honest signal, so a frozen copy throws here and is never promoted as a fresh sync.
    // Asked AFTER the events, so the state describes the copy we were just handed.
    assertEntityLive(await getJson(this.#config, `/api/states/${encodeURIComponent(externalRef)}`));
    return events;
  }

  /**
   * Liveness for the freshness fields. Contractually must not throw.
   *
   * False for anything short of an authenticated 2xx: a reachable HA that rejects the
   * token cannot answer a sync either, and reporting that as "up" would put a green
   * freshness indicator on a calendar that is quietly frozen (H3 finding #10).
   */
  async probe(): Promise<boolean> {
    try {
      const raw = await getJson(this.#config, '/api/', { timeoutMs: PROBE_TIMEOUT_MS, retries: 0 });
      return typeof raw === 'object' && raw !== null;
    } catch {
      return false;
    }
  }
}

function assertWindow(window: FetchWindow): void {
  if (!isLocalDate(window.fromDate) || !isLocalDate(window.toDate)) {
    throw new HaPayloadError('fetch window bounds are not calendar dates');
  }
  if (!(window.fromDate < window.toDate)) {
    throw new HaPayloadError('fetch window end must be after its start');
  }
}
