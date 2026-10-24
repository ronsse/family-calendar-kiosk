/**
 * Unit C — the chore streak, and the four ways it must refuse to punish a child.
 *
 * A streak is the one number on this wall that can go DOWN, on a screen a five-year-old's
 * sibling can walk over and read. So most of what follows is about what must NOT break it:
 * a parent who did not tap, a Sunday with nothing assigned, a shared chore somebody else got
 * to first, and a morning that has simply not happened yet.
 *
 * The rules and the reasoning are in `src/domain/chores/streaks.ts` and
 * docs/decisions/0005-streaks.md.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { Database as Db } from 'better-sqlite3';

import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import {
  choreStreakDays,
  dayCounts,
  displayStreak,
  DUTIES_A_DAY_MAY_MISS,
  STREAK_DISPLAY_MIN,
} from '../src/domain/chores/streaks.ts';
import type { LocalDate } from '../src/types.ts';

const CHILD = 'child-a';
const OTHER = 'child-b';

function freshDb(): { db: Db; cleanup: () => void } {
  const dir = mkdtempSync(join(tmpdir(), 'streaks-'));
  const db = openDatabase({ path: join(dir, 'wall.db') });
  migrate(db);
  seedDev(db);
  // Start from a clean slate: the dev seed's own chores would otherwise write history that
  // every arithmetic assertion below would have to account for.
  db.exec('DELETE FROM chore_assignment; DELETE FROM chore_day;');
  return { db, cleanup: () => { db.close(); rmSync(dir, { recursive: true, force: true }); } };
}

/** Give a chore a `kind`, creating it if the seed has none of that kind. */
function choreOf(db: Db, kind: 'duty' | 'extra'): string {
  const row = db.prepare(`SELECT id FROM chore WHERE kind = ? LIMIT 1`).get(kind) as
    | { id: string }
    | undefined;
  if (row) return row.id;
  const donor = db.prepare(`SELECT * FROM chore LIMIT 1`).get() as Record<string, unknown>;
  const id = `chore-${kind}`;
  db.prepare(
    `INSERT INTO chore (id, label_short, label_full, icon_asset_id, category, assignment_model,
                        base_points, rrule, active, kind)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
  ).run(
    id, kind, kind, donor['icon_asset_id'], donor['category'],
    donor['assignment_model'], 1, donor['rrule'], kind,
  );
  return id;
}

/** One chore on one day, assigned to one child in one state. */
function assign(
  db: Db,
  date: string,
  state: 'pending' | 'claimed' | 'approved' | 'superseded',
  opts: { kind?: 'duty' | 'extra'; child?: string; slot?: number } = {},
): void {
  const choreId = choreOf(db, opts.kind ?? 'duty');
  const slot = opts.slot ?? 0;
  // `chore_day` is UNIQUE(chore_id, local_date), so a second chore on the same day needs a
  // second chore row.
  const dayChore = slot === 0 ? choreId : `${choreId}-${String(slot)}`;
  if (slot !== 0) {
    const src = db.prepare(`SELECT * FROM chore WHERE id = ?`).get(choreId) as Record<string, unknown>;
    db.prepare(
      `INSERT OR IGNORE INTO chore (id, label_short, label_full, icon_asset_id, category,
                                    assignment_model, base_points, rrule, active, kind)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)`,
    ).run(
      dayChore, src['label_short'], src['label_full'], src['icon_asset_id'], src['category'],
      src['assignment_model'], src['base_points'], src['rrule'], src['kind'],
    );
  }
  db.prepare(
    `INSERT OR IGNORE INTO chore_day (chore_id, local_date, points_each, model, created_at_utc)
     VALUES (?, ?, 1, 'fixed', '2026-01-01T00:00:00Z')`,
  ).run(dayChore, date);
  const dayId = (
    db.prepare(`SELECT id FROM chore_day WHERE chore_id = ? AND local_date = ?`).get(dayChore, date) as {
      id: number;
    }
  ).id;
  db.prepare(
    `INSERT INTO chore_assignment (chore_day_id, child_id, state) VALUES (?, ?, ?)`,
  ).run(dayId, opts.child ?? CHILD, state);
}

const streak = (db: Db, today: string) => choreStreakDays(db, CHILD, today as LocalDate);

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

test('a run of finished days counts, and a missed day ends it', () => {
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    assign(db, '2026-03-02', 'pending'); // the miss
    assign(db, '2026-03-03', 'approved');
    assign(db, '2026-03-04', 'approved');
    assert.equal(streak(db, '2026-03-04'), 2, 'the run stops at the miss, it does not skip it');
  } finally {
    cleanup();
  }
});

test('no history at all is zero, not a crash', () => {
  const { db, cleanup } = freshDb();
  try {
    assert.equal(streak(db, '2026-03-04'), 0);
  } finally {
    cleanup();
  }
});

test('a day counts with one duty left undone, and not with two', () => {
  // ADR-0006 §4, 2026-10-24: one miss a day, the same allowance the week already gives.
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    assign(db, '2026-03-02', 'approved', { slot: 0 });
    assign(db, '2026-03-02', 'pending', { slot: 1 });
    assign(db, '2026-03-03', 'approved');
    assert.equal(streak(db, '2026-03-03'), 3, 'one of two duties done is a full day');

    assign(db, '2026-03-04', 'approved', { slot: 0 });
    assign(db, '2026-03-04', 'pending', { slot: 1 });
    assign(db, '2026-03-04', 'pending', { slot: 2 });
    assign(db, '2026-03-05', 'approved');
    // Asked from the 5th, so the 4th is a finished day in the past and rule 5 does not apply.
    assert.equal(streak(db, '2026-03-05'), 1, 'one of three is two misses, and ends the run');
  } finally {
    cleanup();
  }
});

test('the day rule: one miss allowed, but never zero done', () => {
  assert.equal(DUTIES_A_DAY_MAY_MISS, 1);
  assert.equal(dayCounts(0, 0), false, 'nothing asked is neutral, not full');
  assert.equal(dayCounts(0, 1), false, 'a lone duty still has to be done');
  assert.equal(dayCounts(1, 1), true);
  assert.equal(dayCounts(1, 2), true);
  assert.equal(dayCounts(3, 5), false);
  assert.equal(dayCounts(4, 5), true);
});

// ---------------------------------------------------------------------------
// The four refusals
// ---------------------------------------------------------------------------

test('CLAIMED counts — a parent who has not approved yet cannot break it', () => {
  // The rule that matters most. Approval is an adult tapping a button, and this project
  // already refused to build one number that depends on that (the ledger has no `paid`
  // state, H2 Q2). A streak broken because a parent was busy on Tuesday is that same
  // failure, aimed at a child who did everything she was asked.
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'claimed');
    assign(db, '2026-03-02', 'claimed');
    assign(db, '2026-03-03', 'approved');
    assert.equal(streak(db, '2026-03-03'), 3);
  } finally {
    cleanup();
  }
});

test('a day with NO duties is neutral — it neither extends nor breaks', () => {
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    // 2026-03-02: nothing assigned. A Sunday is not a failure.
    assign(db, '2026-03-03', 'approved');
    assert.equal(streak(db, '2026-03-03'), 2, 'two qualifying days, and the gap is not a miss');
    // And the honest consequence, asserted rather than hidden: this counts QUALIFYING days,
    // not calendar days, so a streak can span a gap of any width. The claim it makes is
    // "every day I was asked, I did it".
    assign(db, '2026-04-15', 'approved');
    assert.equal(streak(db, '2026-04-15'), 3);
  } finally {
    cleanup();
  }
});

test('an EXTRA left undone never breaks a duty streak', () => {
  // Extras are optional and pay points. Breaking a streak because a child declined something
  // the product calls optional is the system contradicting itself on her own screen.
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    assign(db, '2026-03-02', 'approved');
    assign(db, '2026-03-02', 'pending', { kind: 'extra' });
    assert.equal(streak(db, '2026-03-02'), 2);
  } finally {
    cleanup();
  }
});

test('SUPERSEDED leaves the day entirely — neither a win nor a loss', () => {
  // Losing a first-complete claim race is not a failure, and it is not work either.
  // Counting it done would award a streak day for losing; counting it missed would punish
  // a child for being second.
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    assign(db, '2026-03-02', 'superseded'); // her only duty that day; a sibling got there first
    assign(db, '2026-03-03', 'approved');
    assert.equal(streak(db, '2026-03-03'), 2, 'the superseded day is neutral, like an empty one');

    // And it must not mask a real miss sitting beside it on the same day.
    assign(db, '2026-03-04', 'superseded', { slot: 0 });
    assign(db, '2026-03-04', 'pending', { slot: 1 });
    assign(db, '2026-03-05', 'approved');
    assert.equal(streak(db, '2026-03-05'), 1, 'the pending duty on the 4th still ends the run');
  } finally {
    cleanup();
  }
});

test('an unfinished TODAY does not break the streak, it just has not extended it', () => {
  // At 06:30 nothing has been done by anyone. A number that reads 0 every morning and
  // recovers by lunchtime is a number that punishes a child for the time of day.
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    assign(db, '2026-03-02', 'approved');
    assign(db, '2026-03-03', 'pending'); // today, not yet done
    assert.equal(streak(db, '2026-03-03'), 2, 'reads through yesterday');
    db.prepare(`UPDATE chore_assignment SET state = 'claimed'`).run();
    assert.equal(streak(db, '2026-03-03'), 3, 'and moves the moment today completes');
  } finally {
    cleanup();
  }
});

test('a miss is only a miss once the day is OVER', () => {
  // Written the other way round first, and the module was right: three assertions expected an
  // unfinished day to break the streak while standing ON that day. Rule 5 forbids exactly
  // that, and it is the rule doing the most work here — at 07:00 every day looks like a
  // failure, and a number that reads 0 each morning and recovers by lunchtime punishes a
  // child for the time of day rather than for anything she did.
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    assign(db, '2026-03-02', 'approved');
    assign(db, '2026-03-03', 'pending');
    assert.equal(streak(db, '2026-03-03'), 2, 'on the day itself: unfinished, not failed');
    assert.equal(streak(db, '2026-03-04'), 0, 'the day after: now it is a miss');
  } finally {
    cleanup();
  }
});

test('a FUTURE day is not counted, however it is stated', () => {
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    assign(db, '2026-03-09', 'approved');
    assert.equal(streak(db, '2026-03-01'), 1, 'tomorrow being pre-approved changes nothing today');
  } finally {
    cleanup();
  }
});

test("one child's history is not another's", () => {
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved', { child: OTHER });
    assign(db, '2026-03-02', 'approved', { child: OTHER });
    assert.equal(streak(db, '2026-03-02'), 0);
    assert.equal(choreStreakDays(db, OTHER, '2026-03-02' as LocalDate), 2);
  } finally {
    cleanup();
  }
});

// ---------------------------------------------------------------------------
// The display rule, which is separate from the count on purpose
// ---------------------------------------------------------------------------

test('a streak too short to mean anything is shown as nothing at all', () => {
  assert.equal(displayStreak(0), null, 'never "0 day streak" — see ADR-0005');
  for (let n = 1; n < STREAK_DISPLAY_MIN; n += 1) assert.equal(displayStreak(n), null);
  assert.equal(displayStreak(STREAK_DISPLAY_MIN), STREAK_DISPLAY_MIN);
  assert.equal(displayStreak(STREAK_DISPLAY_MIN + 40), STREAK_DISPLAY_MIN + 40);
});

test('the display rule never changes what was COUNTED', () => {
  // Kept as two functions so that re-tuning the threshold — which is a taste call about
  // children, not arithmetic — cannot silently alter the history the number reports.
  const { db, cleanup } = freshDb();
  try {
    assign(db, '2026-03-01', 'approved');
    assert.equal(streak(db, '2026-03-01'), 1, 'one real day happened');
    assert.equal(displayStreak(streak(db, '2026-03-01')), null, 'and the wall says nothing yet');
  } finally {
    cleanup();
  }
});
