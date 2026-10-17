/**
 * Unit B - Home Assistant adapter. Wire shapes and their normalisation.
 *
 * INTERNAL TO THIS DIRECTORY. Every type in this file describes Home Assistant's REST
 * payloads, and none of them may cross `src/calendar/homeassistant/` (ADR-0004). The
 * adapter's only exports are the frozen `CalendarSource` types.
 *
 * Everything arriving here is untrusted `unknown`. It is validated field by field rather
 * than cast, because the failure mode of a bad cast is not a crash - it is an event that
 * renders on a wall with the wrong day and full confidence.
 *
 * ## The all-day rule, and why it is the whole point of this file
 *
 * HA emits two forms:
 *
 *   all-day  -- { "date": "2026-02-10" }                floating, end EXCLUSIVE
 *   timed    -- { "dateTime": "2026-02-10T14:00:00-07:00" }
 *
 * One upstream calendar has its timezone set to UTC instead of America/Denver. Its all-day
 * events arrive in the *second* form, as literal midnight-UTC instants:
 *
 *   { "dateTime": "2026-02-10T00:00:00Z" } .. { "dateTime": "2026-02-11T00:00:00Z" }
 *
 * Stored as instants that is 2026-02-09 17:00 .. 2026-02-10 17:00 in Denver, so the event
 * occupies two local days. It is already visible on the current wall (H3 finding #5).
 *
 * The normalisation is: recognise that wire form and read the dates back **in UTC**, which
 * is the zone the author was (unknowingly) writing in. `2026-02-10T00:00:00Z` becomes the
 * floating date `2026-02-10`, not `2026-02-09`. Converting it to a Denver local date would
 * also collapse it to one day - the *wrong* one - which is worse than the bug being fixed.
 *
 * The gate is the raw string, never the instant. `2026-02-09T17:00:00-07:00` is the same
 * instant as `2026-02-10T00:00:00Z`, but it is a real 5pm event and must stay timed. Only
 * a payload that literally says "T00:00:00" with a UTC designator is treated as all-day.
 */

import { createHash } from 'node:crypto';
import type { FetchedEvent, FetchedWhen } from '../CalendarSource.ts';
import type { LocalDate, Utc } from '../../types.ts';
import { addDays, isLocalDate } from '../../time.ts';
import { isUtcMidnight, utcCalendarDate } from './zoned.ts';

/** What HA writes when it means "midnight UTC" - the misconfigured-calendar signature. */
const UTC_MIDNIGHT_WIRE = /^\d{4}-\d{2}-\d{2}T00:00:00(\.0+)?(Z|\+00:00|\+0000)$/i;
/** An ISO-8601 datetime carrying an explicit offset. Anything else is unanchored. */
const HAS_OFFSET = /(Z|[+-]\d{2}:?\d{2})$/i;
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

export const NO_TITLE = '(no title)';

export interface HaContext {
  /** The entity id being read. Used only in messages that stay inside this directory. */
  readonly entityId: string;
  readonly utcMidnightIsAllDay: boolean;
}

/** A payload we could not make sense of. Never carries household content in its message. */
export class HaPayloadError extends Error {
  override readonly name = 'HaPayloadError';
}

// ---------------------------------------------------------------------------
// GET /api/calendars
// ---------------------------------------------------------------------------

export interface HaCalendarDescriptor {
  entityId: string;
  label: string;
}

export function normaliseCalendarList(raw: unknown): HaCalendarDescriptor[] {
  if (!Array.isArray(raw)) throw new HaPayloadError('calendar list was not an array');
  const out: HaCalendarDescriptor[] = [];
  for (const [i, entry] of raw.entries()) {
    if (!isRecord(entry)) throw new HaPayloadError(`calendar list entry ${i} was not an object`);
    const entityId = str(entry['entity_id']);
    if (!entityId) throw new HaPayloadError(`calendar list entry ${i} has no entity id`);
    assertEntityId(entityId);
    out.push({ entityId, label: str(entry['name']) ?? entityId });
  }
  return out;
}

/**
 * Rejects anything that is not a plain `calendar.<slug>` entity id.
 *
 * This is a safety check, not politeness: the id is interpolated into a URL path, so a
 * value containing `/`, `?`, `#` or whitespace would silently address a different endpoint.
 */
export function assertEntityId(value: string): void {
  if (!/^calendar\.[A-Za-z0-9_]+$/.test(value)) {
    throw new HaPayloadError('external ref is not a calendar entity id');
  }
}

// ---------------------------------------------------------------------------
// GET /api/states/<entity_id>
// ---------------------------------------------------------------------------

/**
 * Throws unless the calendar entity is live.
 *
 * `GET /api/calendars/<entity>` keeps answering 200 from HA's local copy after the Google
 * integration underneath it has stopped syncing. The only place that admits it is the
 * entity's STATE, which goes `unavailable`. Measured 2026-10-02: every calendar had been
 * `unavailable` since 2026-09-15 (Google refused HA's refresh token), the events endpoint
 * still served the 09-15 snapshot, and the wall logged "4 ok, 0 failed" for seventeen days.
 * Anything added to Google after that date never reached the wall. Nothing about this was
 * visible: no error, no stale label, just a calendar that stopped changing.
 *
 * Only `unavailable` is refused. `on`/`off` are the live states, and `unknown` is what an
 * entity reads for a moment after HA starts. Refusing that would fail a sync over a restart.
 */
export function assertEntityLive(raw: unknown): void {
  if (!isRecord(raw)) throw new HaPayloadError('entity state was not an object');
  const state = str(raw['state']);
  if (state === undefined) throw new HaPayloadError('entity state has no state field');
  if (state === 'unavailable') {
    throw new HaPayloadError(
      'calendar upstream is unavailable - its events are a frozen copy (check the Google integration in Home Assistant)',
    );
  }
}

// ---------------------------------------------------------------------------
// GET /api/calendars/<entity_id>
// ---------------------------------------------------------------------------

export type WireSlot =
  | { form: 'date'; date: LocalDate }
  | { form: 'dateTime'; instant: Date; raw: string };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim() !== '' ? v : undefined;
}

/**
 * Reads one `start`/`end` slot.
 *
 * Accepts the documented object form and, defensively, a bare string - an HA release that
 * flattens the field must not blank the wall. Returns null when the slot is absent.
 */
function readSlot(v: unknown, field: string): WireSlot | null {
  if (v === undefined || v === null) return null;

  let dateStr: string | undefined;
  let dateTimeStr: string | undefined;

  if (isRecord(v)) {
    dateStr = str(v['date']);
    dateTimeStr = str(v['dateTime']);
  } else if (typeof v === 'string') {
    if (DATE_ONLY.test(v)) dateStr = v;
    else dateTimeStr = v;
  } else {
    throw new HaPayloadError(`${field} was neither an object nor a string`);
  }

  if (dateStr && dateTimeStr) {
    throw new HaPayloadError(`${field} carried both a date and a dateTime`);
  }

  if (dateStr) {
    if (!isLocalDate(dateStr)) throw new HaPayloadError(`${field}.date is not a calendar date`);
    return { form: 'date', date: dateStr };
  }

  if (dateTimeStr) {
    // An offset-less datetime cannot be anchored. Date.parse would silently read it in the
    // SERVER's zone, which is the "confidently wrong" failure the PRD forbids outright.
    if (!HAS_OFFSET.test(dateTimeStr)) {
      throw new HaPayloadError(`${field}.dateTime carries no UTC offset`);
    }
    const ms = Date.parse(dateTimeStr);
    if (Number.isNaN(ms)) throw new HaPayloadError(`${field}.dateTime is not a valid instant`);
    return { form: 'dateTime', instant: new Date(ms), raw: dateTimeStr };
  }

  return null;
}

/** True for the wire form the misconfigured upstream calendar produces. */
export function isUtcMidnightWireForm(slot: WireSlot): boolean {
  return (
    slot.form === 'dateTime' && UTC_MIDNIGHT_WIRE.test(slot.raw) && isUtcMidnight(slot.instant)
  );
}

/** All-day span from two floating dates, with the end forced exclusive and non-empty. */
function allDaySpan(startDate: LocalDate, rawEnd: LocalDate | null): FetchedWhen {
  // Some upstreams (and some CalDAV bridges) omit the end, or send it INCLUSIVE. Both
  // produce start >= end, which the schema's CHECK rejects - failing the whole generation
  // over one event. Clamping is mechanical and loses nothing: a one-day event is [d, d+1).
  const endDate = rawEnd !== null && rawEnd > startDate ? rawEnd : addDays(startDate, 1);
  return { kind: 'allDay', startDate, endDate };
}

function whenFor(start: WireSlot, end: WireSlot | null, ctx: HaContext): FetchedWhen {
  if (start.form === 'date') {
    if (end && end.form !== 'date') {
      throw new HaPayloadError('event mixes an all-day start with a timed end');
    }
    return allDaySpan(start.date, end ? end.date : null);
  }

  if (!end) throw new HaPayloadError('timed event has no end');
  if (end.form !== 'dateTime') {
    throw new HaPayloadError('event mixes a timed start with an all-day end');
  }

  // The misconfigured-UTC calendar. Both ends must say midnight UTC literally; a real
  // event whose instant merely coincides with midnight UTC is written with a local
  // offset and does not match.
  if (
    ctx.utcMidnightIsAllDay &&
    isUtcMidnightWireForm(start) &&
    isUtcMidnightWireForm(end) &&
    end.instant.getTime() > start.instant.getTime()
  ) {
    return allDaySpan(utcCalendarDate(start.instant), utcCalendarDate(end.instant));
  }

  const startMs = start.instant.getTime();
  const endMs = end.instant.getTime();
  if (endMs < startMs) throw new HaPayloadError('timed event ends before it starts');
  // A zero-length event is legal upstream and unrepresentable here (the schema requires
  // start < end). One minute keeps it renderable without inventing a duration that means
  // anything; dropping it would be a silently short list.
  const endsAt = endMs === startMs ? new Date(startMs + 60_000) : end.instant;

  return {
    kind: 'timed',
    startsAtUtc: start.instant.toISOString() as Utc,
    endsAtUtc: endsAt.toISOString() as Utc,
  };
}

/** Everything about an occurrence that distinguishes it from another one. */
function contentKey(title: string, when: FetchedWhen): string {
  return when.kind === 'allDay'
    ? `D|${when.startDate}|${when.endDate}|${title}`
    : `T|${when.startsAtUtc}|${when.endsAtUtc}|${title}`;
}

function digest(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

/**
 * The base identity of an entry, before disambiguation.
 *
 * HA gives every instance of a recurring event the SAME `uid` and distinguishes them with
 * `recurrence_id`. Using `uid` alone would collapse a weekly practice to one row per
 * generation - or trip `UNIQUE(sync_run_id, external_uid)` and fail the sync outright.
 *
 * Some calendar platforms send no `uid` at all. A synthetic key is then derived from the
 * fields that actually identify the occurrence, hashed so that no household content is
 * written into a column that may end up in a log or on an admin screen.
 */
export function baseExternalUid(
  entry: Record<string, unknown>,
  when: FetchedWhen,
  title: string,
  ctx: HaContext,
): string {
  const uid = str(entry['uid']);
  const recurrenceId = str(entry['recurrence_id']);
  if (uid) return recurrenceId ? `${uid}::${recurrenceId}` : uid;
  return `syn:${digest(`${ctx.entityId} ${contentKey(title, when)}`, 32)}`;
}

/**
 * Normalises one HA calendar response into the frozen `FetchedEvent` shape.
 *
 * Throws on anything it cannot represent. That is deliberate and contractual: the caller
 * stages into a new generation and promotes only on success, so a throw preserves
 * yesterday's good data, while a short list would be promoted over it and render as "no
 * events today" with no error anywhere (H3 finding #7).
 *
 * ## Why identity needs a second pass
 *
 * `UNIQUE(sync_run_id, external_uid)` is the schema's guard against a retried page staging
 * the same event twice - which once rendered a practice twice on the wall (H1 finding #7).
 * Two upstream shapes reach that constraint from opposite directions, and both have to be
 * settled here rather than by the database:
 *
 *   - the SAME event repeated verbatim. One upstream event, one row: the repeat is dropped.
 *   - DIFFERENT occurrences sharing one `uid`, because the platform omits `recurrence_id`
 *     (older HA releases, and some CalDAV bridges, do exactly this). Letting that hit the
 *     constraint would fail the sync and freeze the calendar on a household whose only sin
 *     is having a weekly practice. Each distinct occurrence gets a content digest appended.
 *
 * The pass is over the whole response, not a running tally, so the ids do not depend on the
 * order HA happened to return the events in - a `external_uid` that reshuffles between
 * syncs is not an identifier.
 */
export function normaliseEvents(raw: unknown, ctx: HaContext): FetchedEvent[] {
  if (!Array.isArray(raw)) throw new HaPayloadError('event list was not an array');

  interface Staged {
    base: string;
    title: string;
    when: FetchedWhen;
    content: string;
  }

  const staged: Staged[] = [];
  const variants = new Map<string, Set<string>>();

  for (const [i, entry] of raw.entries()) {
    if (!isRecord(entry)) throw new HaPayloadError(`event ${i} was not an object`);

    const start = readSlot(entry['start'], `event ${i} start`);
    if (!start) throw new HaPayloadError(`event ${i} has no start`);
    const end = readSlot(entry['end'], `event ${i} end`);

    const when = whenFor(start, end, ctx);
    const title = str(entry['summary']) ?? NO_TITLE;
    const base = baseExternalUid(entry, when, title, ctx);
    const content = contentKey(title, when);

    staged.push({ base, title, when, content });
    const seen = variants.get(base) ?? new Set<string>();
    seen.add(content);
    variants.set(base, seen);
  }

  const emitted = new Map<string, string>();
  const out: FetchedEvent[] = [];

  for (const item of staged) {
    const shared = variants.get(item.base);
    const externalUid =
      shared && shared.size > 1 ? `${item.base}::${digest(item.content, 16)}` : item.base;

    const previous = emitted.get(externalUid);
    if (previous !== undefined) {
      if (previous === item.content) continue; // the verbatim repeat, dropped
      // Unreachable by construction: distinct content yields a distinct digest. Asserted
      // rather than assumed, because the cost of being wrong is a failed sync at 05:58.
      throw new HaPayloadError('two events resolved to one identifier with different content');
    }

    emitted.set(externalUid, item.content);
    out.push({ externalUid, title: item.title, when: item.when });
  }

  return out;
}
