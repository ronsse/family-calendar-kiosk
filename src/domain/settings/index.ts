/**
 * What a point is worth, and what each chore pays.
 *
 * Two numbers the household could not change without a shell and a SQL statement, asked for
 * after the first real evening at the wall: *"let's have an option in there or a button to say,
 * like, adjust points — so we can adjust how much a point is worth, and also how much chores
 * are worth."* Both live in tables that already existed; what was missing was a way in.
 *
 * ## Neither change is retroactive, and both are already structurally safe
 *
 * That property is not added here — it was designed in months ago, and this module's job is to
 * not break it.
 *
 * **`cents_per_point`** is snapshotted onto `redemption_request.cents_per_point` when a child
 * ASKS. Changing the rate afterwards cannot change what a pending request pays out: the child
 * is paid what she was shown (`domain/ledger/redemption.ts`). Raising the rate does change every
 * child's displayed balance immediately, which is correct — a balance is points times today's
 * rate — and is why this invalidates the ledger stream.
 *
 * **`chore.base_points`** is snapshotted onto `chore_day.points_each` at materialization.
 * Editing it therefore cannot change what TODAY'S chores pay, however the day has gone; it
 * lands on the next day materialized. That is the right behaviour and it is also surprising, so
 * the screen says so out loud rather than leaving an adult to discover it by watching a number
 * not move.
 *
 * ## Why the bounds are what they are
 *
 * They are sanity rails on a touchscreen with no keyboard, not policy. Every edit here is a
 * stepper on a wall, so the realistic failure is a stuck finger, not a typo: the bounds stop a
 * repeated tap from reaching an absurd number, and nothing else. A household that genuinely
 * wants a dollar a point can change the ceiling in one line.
 */

import type { Database as Db } from 'better-sqlite3';
import type { DepartureRules, WallThemeId } from '../../types.ts';
import { calendarHealth, type CalendarSourceHealth } from '../../calendar/sync.ts';
import { readDepartureRules } from '../departures/index.ts';
import { readWallTheme } from '../theme/index.ts';

/** A point is worth at least a cent and at most five dollars. */
export const MIN_CENTS_PER_POINT = 1;
export const MAX_CENTS_PER_POINT = 500;

/** A chore pays nothing (a duty) up to ninety-nine points. */
export const MIN_CHORE_POINTS = 0;
export const MAX_CHORE_POINTS = 99;

export interface ChoreValue {
  readonly choreId: string;
  readonly labelFull: string;
  /** `duty` pays nothing by convention; `extra` is chosen and earns. Presentational. */
  readonly kind: 'duty' | 'extra';
  readonly basePoints: number;
  /** An inactive chore is not materialized, so its value cannot be earned. */
  readonly active: boolean;
}

export interface HouseholdSettings {
  readonly centsPerPoint: number;
  readonly chores: readonly ChoreValue[];
  /** The leave-by rules, edited from Grown-ups → Settings → Leave-by alerts. See `domain/departures`. */
  readonly departures: DepartureRules;
  /** Which look the wall wears. See `domain/theme`. */
  readonly theme: WallThemeId;
  /**
   * How each calendar's last fetch went — LABELS and times only (see `calendarHealth`). Read,
   * never written: the one action on it is the existing refresh route.
   */
  readonly calendar: { readonly sources: readonly CalendarSourceHealth[] };
}

export function readSettings(db: Db): HouseholdSettings {
  const rate = db
    .prepare(`SELECT value_text FROM household_config WHERE key = 'cents_per_point'`)
    .get() as { value_text: string } | undefined;
  const parsed = rate === undefined ? Number.NaN : Number.parseInt(rate.value_text, 10);
  const rows = db
    .prepare(
      `SELECT id, label_full, kind, base_points, active
         FROM chore
        ORDER BY active DESC, kind DESC, label_full`,
    )
    .all() as {
    id: string;
    label_full: string;
    kind: string;
    base_points: number;
    active: number;
  }[];
  return {
    // A missing or unreadable rate reads as 0 rather than throwing. This route is how an adult
    // FIXES that, so it is the one caller that must survive it — unlike `getCentsPerPoint`,
    // whose null makes a redemption refuse rather than pay a guessed amount.
    centsPerPoint: Number.isInteger(parsed) && parsed > 0 ? parsed : 0,
    chores: rows.map((r) => ({
      choreId: r.id,
      labelFull: r.label_full,
      kind: r.kind === 'extra' ? 'extra' : 'duty',
      basePoints: r.base_points,
      active: r.active === 1,
    })),
    departures: readDepartureRules(db),
    theme: readWallTheme(db),
    calendar: { sources: calendarHealth(db) },
  };
}

export type SettingsFailure = 'out_of_range' | 'not_found';

export function setCentsPerPoint(db: Db, cents: number): SettingsFailure | null {
  if (!Number.isInteger(cents) || cents < MIN_CENTS_PER_POINT || cents > MAX_CENTS_PER_POINT) {
    return 'out_of_range';
  }
  db.prepare(
    `INSERT INTO household_config (key, value_text) VALUES ('cents_per_point', ?)
     ON CONFLICT(key) DO UPDATE SET value_text = excluded.value_text`,
  ).run(String(cents));
  return null;
}

export function setChorePoints(db: Db, choreId: string, points: number): SettingsFailure | null {
  if (!Number.isInteger(points) || points < MIN_CHORE_POINTS || points > MAX_CHORE_POINTS) {
    return 'out_of_range';
  }
  const done = db.prepare(`UPDATE chore SET base_points = ? WHERE id = ?`).run(points, choreId);
  return done.changes === 0 ? 'not_found' : null;
}
