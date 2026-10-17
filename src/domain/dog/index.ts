/**
 * The dog's week: what is on the list, what has been ticked, and the one write.
 *
 * Deliberately the smallest domain module in the tree.  No child id, no ledger entry, no
 * approval, no history beyond "when was it ticked" — the feature is a tap on the dog in the
 * picture and a checklist a five-year-old can read, and every extra thing it could carry is
 * a thing a guardrail would then have to guard.
 */

import type { Database as Db } from 'better-sqlite3';
import type { DogWeek, LocalDate, Utc } from '../../types.ts';
import { isoWeekKey } from '../../time.ts';
import { readHousehold } from '../../config/household.ts';
import { deedById, weekDeeds } from './deeds.ts';

export { DEED_POOL, DEEDS_PER_WEEK, weekDeeds } from './deeds.ts';

/**
 * Does this household have a pet at all?  The one seam the dog's week hangs off (2026-10-12):
 * the snapshot carries `dog: null` and the deeds route refuses when it does not, so a household
 * with `pets: []` — the default — gets no deeds, no sheet and no door.  Read from the rows on
 * every call, like the rest of `household_config`, so `provision --settings` reaches the next
 * snapshot without a restart.
 */
export function petEnabled(db: Db): boolean {
  return readHousehold(db).pets.length > 0;
}

/** The pet's name as the household wrote it, or `null` when there is no pet. */
export function petName(db: Db): string | null {
  return readHousehold(db).pets[0]?.name ?? null;
}

export function dogWeek(db: Db, date: LocalDate): DogWeek {
  const week = isoWeekKey(date);
  const done = new Set(
    (
      db.prepare(`SELECT deed_id FROM dog_deed_done WHERE week = ?`).all(week) as {
        deed_id: string;
      }[]
    ).map((r) => r.deed_id),
  );
  return {
    week,
    deeds: weekDeeds(week).map((d) => ({
      id: d.id,
      label: d.label,
      emoji: d.emoji,
      done: done.has(d.id),
    })),
  };
}

export type SetDogDeedResult =
  | { ok: true; changed: boolean }
  | { ok: false; reason: 'not_this_week' | 'unknown_deed' };

/**
 * Tick or untick one deed.  The client names the week it was looking at: a sheet left open
 * across midnight on Sunday would otherwise tick a deed that is not on Monday's list, and the
 * row would sit unread forever.  A deed that is in the pool but not in this week's draw is
 * refused for the same reason.
 */
export function setDogDeed(
  db: Db,
  input: { week: string; deedId: string; done: boolean },
  today: LocalDate,
  now: Utc,
): SetDogDeedResult {
  if (input.week !== isoWeekKey(today)) return { ok: false, reason: 'not_this_week' };
  if (deedById(input.deedId) === undefined) return { ok: false, reason: 'unknown_deed' };
  if (!weekDeeds(input.week).some((d) => d.id === input.deedId)) {
    return { ok: false, reason: 'unknown_deed' };
  }
  const changes = input.done
    ? db
        .prepare(
          `INSERT OR IGNORE INTO dog_deed_done (week, deed_id, done_at_utc) VALUES (?, ?, ?)`,
        )
        .run(input.week, input.deedId, now).changes
    : db
        .prepare(`DELETE FROM dog_deed_done WHERE week = ? AND deed_id = ?`)
        .run(input.week, input.deedId).changes;
  return { ok: true, changed: changes > 0 };
}
