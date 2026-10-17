/**
 * iCal adapter. An RFC 5545 body -> the frozen `FetchedEvent` shape, over one window.
 *
 * INTERNAL TO THIS DIRECTORY.
 *
 * Home Assistant used to do the expansion for us; reading the feed directly means doing it
 * here, and the cases that matter are the ones that produce a wall that is WRONG rather
 * than broken:
 *
 *   - a weekly club must appear every week inside the window, minus its EXDATEs;
 *   - a single moved occurrence (a `RECURRENCE-ID` override) must appear at its NEW time
 *     and not also at its old one — including when the move crosses the window's edge;
 *   - a cancelled occurrence (`STATUS:CANCELLED` on the override) must vanish;
 *   - an all-day event is a floating date with an EXCLUSIVE end, never an instant;
 *   - `DTSTART;TZID=America/Denver:...` must land on the right instant on both sides of a
 *     DST change (ical.js leaves it floating; `zone.ts` anchors it).
 *
 * Anything this cannot represent throws. The caller promotes a generation only on success,
 * so a throw costs a stale calendar and a short list costs a wrong one.
 *
 * Overrides are handled by hand rather than through `Event.relateException`: the iterator
 * is walked only as far as the window, and an occurrence moved INTO the window from a date
 * past that point would otherwise never be visited. So every override is judged on its own
 * times, and the iterator just skips the slots overrides have claimed.
 */

import { createHash } from 'node:crypto';
import ICAL from 'ical.js';

import type { FetchedEvent, FetchedWhen, FetchWindow } from '../CalendarSource.ts';
import type { LocalDate, Utc } from '../../types.ts';
import { householdTimeZone, isLocalDate } from '../../time.ts';
import { isKnownZone, wallClockToUtc } from './zone.ts';

export const NO_TITLE = '(no title)';

/**
 * Per recurring series. A daily event started ten years ago is ~3,700 steps; this is the
 * ceiling past which a rule is pathological (a SECONDLY rule, say) rather than long.
 */
export const MAX_OCCURRENCES_WALKED = 50_000;

/** Days of slack past the window end before the walk stops, for zones east of the house. */
const WALK_SLACK_DAYS = 2;

export class IcsPayloadError extends Error {
  override readonly name = 'IcsPayloadError';
}

type ICalTime = InstanceType<typeof ICAL.Time>;
type ICalComponent = InstanceType<typeof ICAL.Component>;

interface Bounds {
  fromDate: LocalDate;
  toDate: LocalDate;
  fromMs: number;
  toMs: number;
  /** Stop walking a series once an occurrence's own date passes this. */
  walkUntil: string;
}

function digest(value: string, length: number): string {
  return createHash('sha256').update(value).digest('hex').slice(0, length);
}

function addDays(date: string, days: number): string {
  const t = Date.parse(`${date}T00:00:00Z`) + days * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

/** `YYYY-MM-DD` of an ICAL.Time's own (wall-clock) fields. */
function dateOf(t: ICalTime): string {
  return `${String(t.year).padStart(4, '0')}-${String(t.month).padStart(2, '0')}-${String(t.day).padStart(2, '0')}`;
}

function asLocalDate(s: string, what: string): LocalDate {
  if (!isLocalDate(s)) throw new IcsPayloadError(`${what} is not a calendar date`);
  return s;
}

/** The TZID parameter on a date-time property, if any. */
function tzidOf(component: ICalComponent, propName: string): string | undefined {
  const prop = component.getFirstProperty(propName);
  const tzid = prop?.getParameter('tzid');
  return typeof tzid === 'string' && tzid !== '' ? tzid : undefined;
}

function isUtcTime(t: ICalTime): boolean {
  return t.zone?.tzid === 'UTC';
}

/**
 * The instant an ICAL.Time names. `Z` times are UTC; a TZID'd time is anchored in that
 * zone; a floating time (neither) is the household's, which is what RFC 5545 means by
 * "the attendee's local time" on a wall in one house.
 */
function instantOf(t: ICalTime, tzid: string | undefined): number {
  if (isUtcTime(t)) {
    return Date.UTC(t.year, t.month - 1, t.day, t.hour, t.minute, t.second);
  }
  const zone = tzid ?? householdTimeZone();
  if (!isKnownZone(zone)) throw new IcsPayloadError('an event names a time zone this runtime does not know');
  return wallClockToUtc(
    { year: t.year, month: t.month, day: t.day, hour: t.hour, minute: t.minute, second: t.second },
    zone,
  ).getTime();
}

/** A stable key for "which slot of the series is this", comparable across overrides. */
function slotKey(t: ICalTime, tzid: string | undefined): string {
  return t.isDate ? `D${dateOf(t)}` : `T${instantOf(t, tzid)}`;
}

/** The compact RFC form, used in identifiers: `20261007T150000` or `20261007`. */
function compactTime(t: ICalTime): string {
  return t.toICALString();
}

interface Timing {
  start: ICalTime;
  end: ICalTime | null;
  startTz: string | undefined;
  endTz: string | undefined;
}

/** Turns one occurrence's times into the contract's `FetchedWhen`. */
function whenFor(x: Timing): FetchedWhen {
  if (x.start.isDate) {
    const startDate = asLocalDate(dateOf(x.start), 'an all-day start');
    // No DTEND on an all-day event means one day (RFC 5545 §3.6.1). An end on or before
    // the start is a malformed feed; render it as the one day rather than as nothing.
    let endDate = x.end && x.end.isDate ? dateOf(x.end) : addDays(startDate, 1);
    if (endDate <= startDate) endDate = addDays(startDate, 1);
    return { kind: 'allDay', startDate, endDate: asLocalDate(endDate, 'an all-day end') };
  }
  const startMs = instantOf(x.start, x.startTz);
  let endMs = x.end ? instantOf(x.end, x.endTz ?? x.startTz) : startMs;
  if (endMs < startMs) endMs = startMs;
  return {
    kind: 'timed',
    startsAtUtc: new Date(startMs).toISOString() as Utc,
    endsAtUtc: new Date(endMs).toISOString() as Utc,
  };
}

function inWindow(when: FetchedWhen, b: Bounds): boolean {
  if (when.kind === 'allDay') return when.startDate < b.toDate && when.endDate > b.fromDate;
  const s = Date.parse(when.startsAtUtc);
  const e = Date.parse(when.endsAtUtc);
  // A zero-length event is "at" its start, so it counts when the start is inside.
  return e === s ? s >= b.fromMs && s < b.toMs : s < b.toMs && e > b.fromMs;
}

function isCancelled(c: ICalComponent): boolean {
  const status = c.getFirstPropertyValue('status');
  return typeof status === 'string' && status.toUpperCase() === 'CANCELLED';
}

function titleOf(c: ICalComponent): string {
  const s = c.getFirstPropertyValue('summary');
  return typeof s === 'string' && s.trim() !== '' ? s.trim() : NO_TITLE;
}

function timingOf(c: ICalComponent): Timing {
  const ev = new ICAL.Event(c);
  const start = ev.startDate;
  if (!start) throw new IcsPayloadError('an event has no start');
  // `Event.endDate` derives DTEND from DURATION when only that is present.
  const hasEnd = c.hasProperty('dtend') || c.hasProperty('duration');
  return {
    start,
    end: hasEnd ? ev.endDate : null,
    startTz: tzidOf(c, 'dtstart'),
    endTz: tzidOf(c, 'dtend') ?? tzidOf(c, 'dtstart'),
  };
}

interface Staged {
  base: string;
  title: string;
  when: FetchedWhen;
}

function contentKey(title: string, when: FetchedWhen): string {
  return when.kind === 'allDay'
    ? `D|${when.startDate}|${when.endDate}|${title}`
    : `T|${when.startsAtUtc}|${when.endsAtUtc}|${title}`;
}

/** Throws if the body is not a calendar; returns the parsed VCALENDAR otherwise. */
export function parseCalendar(text: string): ICalComponent {
  // Google answers a revoked secret address with an HTML page in some paths; a proxy might
  // answer with anything. Neither is "a calendar with no events".
  if (!/^\s*BEGIN:VCALENDAR/i.test(text)) throw new IcsPayloadError('feed did not return an iCalendar body');
  let root: ICalComponent;
  try {
    root = new ICAL.Component(ICAL.parse(text));
  } catch {
    throw new IcsPayloadError('feed returned an iCalendar body that does not parse');
  }
  if (root.name !== 'vcalendar') throw new IcsPayloadError('feed returned an iCalendar body that is not a VCALENDAR');
  if (!/END:VCALENDAR\s*$/i.test(text)) throw new IcsPayloadError('feed returned a truncated iCalendar body');
  return root;
}

/**
 * Expands one calendar over `window`. `window.fromDate`/`toDate` are household-local dates
 * (inclusive / exclusive), anchored to instants in the household zone (`householdTimeZone()`) for timed events.
 */
export function eventsInWindow(root: ICalComponent, window: FetchWindow): FetchedEvent[] {
  const household = householdTimeZone();
  const fromMs = wallClockToUtc({ ...ymd(window.fromDate), hour: 0, minute: 0, second: 0 }, household).getTime();
  const toMs = wallClockToUtc({ ...ymd(window.toDate), hour: 0, minute: 0, second: 0 }, household).getTime();
  const b: Bounds = {
    fromDate: window.fromDate,
    toDate: window.toDate,
    fromMs,
    toMs,
    walkUntil: addDays(window.toDate, WALK_SLACK_DAYS),
  };

  const masters = new Map<string, ICalComponent>();
  const overrides: ICalComponent[] = [];
  const staged: Staged[] = [];

  for (const ve of root.getAllSubcomponents('vevent')) {
    const uid = ve.getFirstPropertyValue('uid');
    const hasUid = typeof uid === 'string' && uid !== '';
    if (hasUid && ve.hasProperty('recurrence-id')) {
      overrides.push(ve);
      continue;
    }
    if (hasUid) {
      // Two masters for one UID is a feed carrying two SEQUENCE versions; keep the later.
      const prior = masters.get(uid);
      const seq = (c: ICalComponent): number => Number(c.getFirstPropertyValue('sequence') ?? 0) || 0;
      if (!prior || seq(ve) >= seq(prior)) masters.set(uid, ve);
      continue;
    }
    // No UID at all: a one-off, identified by its content.
    if (isCancelled(ve)) continue;
    const when = whenFor(timingOf(ve));
    if (!inWindow(when, b)) continue;
    const title = titleOf(ve);
    staged.push({ base: `syn:${digest(contentKey(title, when), 32)}`, title, when });
  }

  // Slots an override has claimed, per series: the iterator must not emit them.
  const claimed = new Map<string, Set<string>>();
  for (const ov of overrides) {
    const uid = String(ov.getFirstPropertyValue('uid'));
    const rid = ov.getFirstPropertyValue('recurrence-id') as ICalTime;
    const master = masters.get(uid);
    const ridTz = tzidOf(ov, 'recurrence-id') ?? (master ? tzidOf(master, 'dtstart') : undefined);
    const set = claimed.get(uid) ?? new Set<string>();
    set.add(slotKey(rid, ridTz));
    claimed.set(uid, set);

    if (isCancelled(ov) || (master && isCancelled(master))) continue;
    const when = whenFor(timingOf(ov));
    if (!inWindow(when, b)) continue;
    staged.push({ base: `${uid}::${compactTime(rid)}`, title: titleOf(ov), when });
  }

  for (const [uid, master] of masters) {
    if (isCancelled(master)) continue;
    const title = titleOf(master);
    const ev = new ICAL.Event(master);

    if (!ev.isRecurring()) {
      const when = whenFor(timingOf(master));
      if (inWindow(when, b)) staged.push({ base: uid, title, when });
      continue;
    }

    const timing = timingOf(master);
    // Each occurrence keeps the master's length. When DTSTART and DTEND share a zone (the
    // normal case) the length is wall-clock, so a 15:00-16:00 club stays 15:00-16:00 across
    // DST; when they do not, it is the master's length in real time.
    const durationMs =
      timing.end && !timing.start.isDate && timing.startTz !== timing.endTz
        ? instantOf(timing.end, timing.endTz) - instantOf(timing.start, timing.startTz)
        : undefined;
    const skip = claimed.get(uid);
    const it = ev.iterator();
    let walked = 0;
    for (let next = it.next(); next; next = it.next()) {
      if (++walked > MAX_OCCURRENCES_WALKED) {
        throw new IcsPayloadError(`a recurring event expands past ${MAX_OCCURRENCES_WALKED} occurrences`);
      }
      if (dateOf(next) > b.walkUntil) break;
      if (skip?.has(slotKey(next, timing.startTz))) continue;

      const details = ev.getOccurrenceDetails(next);
      const when =
        durationMs === undefined
          ? whenFor({
              start: details.startDate,
              end: timing.end ? details.endDate : null,
              startTz: timing.startTz,
              endTz: timing.startTz,
            })
          : timedWithDuration(details.startDate, timing.startTz, durationMs);
      if (!inWindow(when, b)) continue;
      staged.push({ base: `${uid}::${compactTime(next)}`, title, when });
    }
  }

  return settleIdentifiers(staged);
}

function timedWithDuration(start: ICalTime, tz: string | undefined, durationMs: number): FetchedWhen {
  const s = instantOf(start, tz);
  return {
    kind: 'timed',
    startsAtUtc: new Date(s).toISOString() as Utc,
    endsAtUtc: new Date(s + Math.max(0, durationMs)).toISOString() as Utc,
  };
}

function ymd(date: LocalDate): { year: number; month: number; day: number } {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return { year: y, month: m, day: d };
}

/**
 * `UNIQUE(sync_run_id, external_uid)` must hold, and an id must not depend on the order
 * the feed happened to list things in. A verbatim repeat is dropped; two DIFFERENT events
 * that resolved to one id each get a content digest appended. Same rule as the HA adapter.
 */
function settleIdentifiers(staged: Staged[]): FetchedEvent[] {
  const variants = new Map<string, Set<string>>();
  for (const s of staged) {
    const set = variants.get(s.base) ?? new Set<string>();
    set.add(contentKey(s.title, s.when));
    variants.set(s.base, set);
  }
  const emitted = new Map<string, string>();
  const out: FetchedEvent[] = [];
  for (const s of staged) {
    const content = contentKey(s.title, s.when);
    const id = (variants.get(s.base)?.size ?? 0) > 1 ? `${s.base}::${digest(content, 16)}` : s.base;
    const previous = emitted.get(id);
    if (previous !== undefined) {
      if (previous === content) continue;
      throw new IcsPayloadError('two events resolved to one identifier with different content');
    }
    emitted.set(id, content);
    out.push({ externalUid: id, title: s.title, when: s.when });
  }
  return out;
}

/** The calendar's display name, when the feed carries one. */
export function calendarName(root: ICalComponent): string | undefined {
  const name = root.getFirstPropertyValue('x-wr-calname');
  return typeof name === 'string' && name.trim() !== '' ? name.trim() : undefined;
}
