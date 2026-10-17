/**
 * How often somebody opens the calendar or the grown-ups door — the instrument, not the answer.
 *
 * ## Why this exists
 *
 * The search-and-find picture is up roughly eighteen hours a day and deliberately carries no
 * information: the clock, the date and today's events all live in the calendar view now. Two
 * independent reviewers split on whether that is right (backlog item 5.1 (private notes)) — one said the time box
 * already covers the hours that matter and adults have phones, the other said a small floating
 * chip with the next event. **They agreed on what would settle it: a tap count.** Frequent
 * reaches for the calendar while the picture is up argue for the chip; near-zero over two weeks
 * argues for leaving the picture alone.
 *
 * Nobody had that number and nothing recorded it, so the decision could not resolve however
 * long it waited. This records it. It does NOT decide anything — the cadence and the readout
 * are still the operator's calls, and this only makes them answerable.
 *
 * ## Two counts, because one of them lies
 *
 * `taps` is raw. A three-year-old drumming on the calendar button forty times is one reach for
 * the calendar, and a raw count would report it as overwhelming demand for exactly the readout
 * under argument — the evidence would manufacture its own conclusion.
 *
 * `minutes` counts distinct minutes in which at least one tap landed. Forty taps in one minute
 * is 1; forty taps across forty minutes is 40. The two together make a hammering day obvious
 * instead of letting it disappear into an average, and `minutes` is the number to read.
 *
 * ## What is deliberately not here
 *
 * No child id, no timestamps, no sequence — one aggregate row per (local date, door, picture),
 * so this cannot become a record of who touched what at which second. That would be
 * surveillance in a family's living room, to answer a question a daily count answers. The
 * schema's CHECK on `target` is what holds that line rather than this comment.
 */

import type { Database as Db } from 'better-sqlite3';
import type { LocalDate, LocalTime } from '../../types.ts';

/** The two doors, and only these two.  Matches the CHECK constraint in `db/schema.sql`. */
export const DOOR_TARGETS = ['calendar', 'grown-ups'] as const;
export type DoorTarget = (typeof DOOR_TARGETS)[number];

export function isDoorTarget(v: unknown): v is DoorTarget {
  return typeof v === 'string' && (DOOR_TARGETS as readonly string[]).includes(v);
}

export interface DoorTap {
  readonly target: DoorTarget;
  /** Was the search-and-find picture up when this door was opened? */
  readonly scene: boolean;
  readonly localDate: LocalDate;
  readonly localTime: LocalTime;
}

export interface DoorTapRow {
  readonly localDate: LocalDate;
  readonly target: DoorTarget;
  readonly scene: boolean;
  readonly taps: number;
  readonly minutes: number;
}

/**
 * Count one door opening.
 *
 * A single upsert, so two taps a frame apart cannot lose one another, and `minutes` advances
 * only when the clock minute differs from the last one counted. `last_local` is the whole
 * mechanism for that and is the only per-row state: it holds one "HH:MM", never a history.
 *
 * SQLite semantics worth being explicit about, because getting them backwards would silently
 * make `minutes` equal `taps`: inside `DO UPDATE SET`, a bare column name is the EXISTING row
 * and `excluded.` is the proposed one, and every right-hand side is evaluated against the row
 * as it was before the update — so `minutes` and `last_local` both see the same old value
 * regardless of the order they are written in.
 */
export function recordDoorTap(db: Db, tap: DoorTap): void {
  db.prepare(
    `INSERT INTO door_tap(local_date, target, scene, taps, minutes, last_local)
     VALUES (?, ?, ?, 1, 1, ?)
     ON CONFLICT(local_date, target, scene) DO UPDATE SET
       taps       = taps + 1,
       minutes    = minutes + (last_local IS NULL OR last_local <> excluded.last_local),
       last_local = excluded.last_local`,
  ).run(tap.localDate, tap.target, tap.scene ? 1 : 0, tap.localTime);
}

/**
 * Every counted day, newest first, optionally from a date onward.
 *
 * Ordered newest-first because the operator reading this is asking "what has been happening",
 * and by target and scene within a day so the two doors sit next to each other — the
 * grown-ups door is the control that makes the calendar number mean something. If both are
 * tapped equally often while the picture is up, that is people poking the wall, not people
 * hunting for the calendar.
 */
export function readDoorTaps(db: Db, sinceLocalDate?: LocalDate): DoorTapRow[] {
  const rows = (
    sinceLocalDate === undefined
      ? db
          .prepare(
            `SELECT local_date, target, scene, taps, minutes FROM door_tap
             ORDER BY local_date DESC, target ASC, scene DESC`,
          )
          .all()
      : db
          .prepare(
            `SELECT local_date, target, scene, taps, minutes FROM door_tap
             WHERE local_date >= ?
             ORDER BY local_date DESC, target ASC, scene DESC`,
          )
          .all(sinceLocalDate)
  ) as { local_date: string; target: string; scene: number; taps: number; minutes: number }[];

  return rows.map((r) => ({
    localDate: r.local_date as LocalDate,
    // The CHECK constraint guarantees this, on a fresh database and a migrated one alike;
    // the cast states the guarantee rather than re-testing it.
    target: r.target as DoorTarget,
    scene: r.scene === 1,
    taps: r.taps,
    minutes: r.minutes,
  }));
}
