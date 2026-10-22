/**
 * Who is out when a rotating job is due (ADR-0006 §4, built 2026-10-22).
 *
 * A child at dance when the table is set cannot set the table, and a wall that gives her the
 * job anyway hands her an unfinished duty for being somewhere her parents took her. So when a
 * ROTATION chore with a due time is materialized, any child with a timed calendar event
 * overlapping the job's own half-hour (`JOB_MINUTES` before its `due_by_local`) sits that turn
 * out, and `rotationAssigneeSkipping` passes it to the next child in the roster. The away
 * child gets no row for that job that day, so the day stays neutral for it rather than
 * unfilled.
 *
 * ## The job's own time, not the evening
 *
 * The first design sat a child out of the whole dinner rotation. Measured against the
 * household's calendar on 2026-10-22 (counts only), that was wrong: the two weekly dinner-time
 * activities end by 18:00 and both take the two older children, so "sit out dinner" would
 * have given the youngest — three — all three dinner jobs twice a week, when both children are
 * home again long before the table is cleared (19:00) or the dishwasher loaded (19:30). Keyed
 * to each job's time, the activity costs exactly the jobs it overlaps.
 *
 * ## Whose event it is
 *
 * An event is a child's when its calendar belongs to that child (`calendar_source.child_id`),
 * or when its title names the child — the child's display name as a whole word, any case. The
 * second rule is the one this household needs: every source here is household-wide and an
 * activity is written "<name> and <name> dance". All-day events never count; a day off is not
 * an absence. Only the promoted generation of an INCLUDED source is read, which is exactly
 * what the wall shows, so a grown-up can see on the calendar why a job moved.
 *
 * ## When it is decided
 *
 * Once, when the day is materialized, from SQLite — never from the network and never at
 * render. An activity added later the same day does not re-deal a turn already handed out;
 * re-dealing mid-day is how somebody loses one (CLAUDE.md, "Roster edits reach TODAY").
 */

import type { Database as Db } from 'better-sqlite3';
import { listPromotedEvents } from '../../calendar/sync.ts';
import { localDate, localTime } from '../../time.ts';
import type { CalendarEventView, LocalDate } from '../../types.ts';

/** How long before its due time a rotating job is being done. */
export const JOB_MINUTES = 30;

export interface AwayChild {
  id: string;
  name: string;
}

/** A timed event, reduced to the children it takes away and its span on one local day. */
interface Span {
  childIds: readonly string[];
  fromMinute: number;
  toMinute: number;
}

const MINUTES_PER_DAY = 24 * 60;

function minuteOf(hhmm: string): number | null {
  const m = /^([0-2]\d):([0-5]\d)$/.exec(hhmm);
  if (m === null) return null;
  const minute = Number(m[1]) * 60 + Number(m[2]);
  return minute < MINUTES_PER_DAY ? minute : null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The children an event title names, as whole words in any case. */
export function childrenNamed(title: string, children: readonly AwayChild[]): string[] {
  return children
    .filter((c) => c.name.trim().length > 0)
    .filter((c) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(c.name.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(title))
    .map((c) => c.id);
}

/**
 * The part of a timed event that falls on `date`, in household minutes; null when none does.
 * An event that started yesterday runs from 0, one that ends tomorrow runs to midnight.
 */
function spanOn(event: CalendarEventView, date: LocalDate): { from: number; to: number } | null {
  if (event.when.kind !== 'timed') return null;
  const start = new Date(event.when.startsAtUtc);
  const end = new Date(event.when.endsAtUtc);
  const startDate = localDate(start);
  const endDate = localDate(end);
  if (startDate > date || endDate < date) return null;
  const from = startDate < date ? 0 : minuteOf(localTime(start));
  const to = endDate > date ? MINUTES_PER_DAY : minuteOf(localTime(end));
  if (from === null || to === null || to <= from) return null;
  return { from, to };
}

/** Every child-attributed timed event on `date`, reduced to spans. */
export function awaySpans(
  events: readonly CalendarEventView[],
  children: readonly AwayChild[],
  date: LocalDate,
): Span[] {
  const known = new Set(children.map((c) => c.id));
  const spans: Span[] = [];
  for (const e of events) {
    const span = spanOn(e, date);
    if (span === null) continue;
    const ids = new Set(childrenNamed(e.title, children));
    if (e.childId !== null && known.has(e.childId)) ids.add(e.childId);
    if (ids.size === 0) continue;
    spans.push({ childIds: [...ids], fromMinute: span.from, toMinute: span.to });
  }
  return spans;
}

/** The children out at any point in the `JOB_MINUTES` before `dueByLocal`. */
export function awayForJob(spans: readonly Span[], dueByLocal: string): Set<string> {
  const due = minuteOf(dueByLocal);
  const away = new Set<string>();
  if (due === null) return away;
  const jobFrom = Math.max(0, due - JOB_MINUTES);
  for (const s of spans) {
    // Half-open on both sides: an activity ending at 17:30 does not take a child from a job
    // that starts at 17:30.
    if (s.fromMinute < due && s.toMinute > jobFrom) for (const id of s.childIds) away.add(id);
  }
  return away;
}

/** `awayForJob` against the wall's own promoted calendar and active children. */
export function childrenAwayForJob(db: Db, date: LocalDate, dueByLocal: string): Set<string> {
  const children = (
    db.prepare(`SELECT id, display_name AS name FROM child WHERE active = 1`).all() as AwayChild[]
  );
  return awayForJob(awaySpans(listPromotedEvents(db), children, date), dueByLocal);
}
