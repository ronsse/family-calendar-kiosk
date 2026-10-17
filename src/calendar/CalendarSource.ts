/**
 * family-calendar — Phase 0 contract: the calendar boundary.
 *
 * FROZEN 2026-08-24 (H1 review passed). Interface only — no implementation in this file.
 *
 * THIS BOUNDARY IS LOAD-BEARING (ADR-0004). Home Assistant is kept solely because its
 * Google OAuth is already finished and in production; it is not the architecture. The
 * moment an HA entity id, URL, or response shape leaks outside `src/calendar/<impl>/`,
 * swapping to the Google API stops being a config change and becomes a migration.
 *
 * Concretely, outside this directory nothing may:
 *   - parse or construct `CalendarSourceDescriptor.externalRef` (it is opaque),
 *   - know that "calendar.family" is an entity id, or that 8123 is a port,
 *   - import anything from `src/calendar/homeassistant/`.
 *
 * Implementations:
 *   src/calendar/homeassistant/  — today
 *   src/calendar/google/         — later, direct API; selected by config alone
 */

import type { LocalDate, Utc } from '../types.js';

/** A calendar as the upstream describes it. `externalRef` is opaque to every caller. */
export interface CalendarSourceDescriptor {
  externalRef: string;
  label: string;
}

/**
 * An event exactly as fetched, before persistence.
 *
 * All-day events MUST arrive as floating local dates with `endDate` EXCLUSIVE, never as
 * UTC midnight instants. One upstream calendar is misconfigured to UTC and emits all-day
 * events that span two local days (H3 finding #5, already visible on the current wall);
 * normalising that is the ADAPTER'S job and must not leak downstream.
 */
export type FetchedWhen =
  | { kind: 'timed'; startsAtUtc: Utc; endsAtUtc: Utc }
  | { kind: 'allDay'; startDate: LocalDate; endDate: LocalDate };

export interface FetchedEvent {
  /** Stable upstream identifier, used to recognise the same event across syncs. */
  externalUid: string;
  title: string;
  when: FetchedWhen;
  /** Free-form upstream category, mapped to an icon at sync time — never at render time. */
  category?: string;
}

export interface FetchWindow {
  /** Inclusive. */
  fromDate: LocalDate;
  /** Exclusive. */
  toDate: LocalDate;
}

/**
 * Read-only for v1. Writing back to the upstream calendar is out of scope; if it is ever
 * added it belongs behind a separate interface, so that a read-only implementation
 * cannot silently become a write path.
 */
export interface CalendarSource {
  /** Stable identifier for the implementation, e.g. "homeassistant" | "google". */
  readonly kind: string;

  /**
   * Enumerate available calendars. Called by admin/config flows, never on the render path.
   */
  listSources(): Promise<CalendarSourceDescriptor[]>;

  /**
   * Fetch events for one source over a window.
   *
   * MUST throw on partial failure rather than returning a short list. The caller stages
   * results into a new generation and promotes atomically only on success; a silently
   * truncated result would be promoted over good data and render as "no events today"
   * with no error anywhere (H3 finding #7).
   */
  fetchEvents(externalRef: string, window: FetchWindow): Promise<FetchedEvent[]>;

  /**
   * Cheap liveness probe for the freshness fields on the wall snapshot. Must not throw;
   * resolves false when the upstream is unreachable.
   */
  probe(): Promise<boolean>;
}
