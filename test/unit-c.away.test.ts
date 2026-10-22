/**
 * Unit C — a child who is out when a rotating job is due sits that turn out (ADR-0006 §4).
 *
 * Three things are pinned here: the pure pass-along (and that it never moves tomorrow), whose
 * event an event is, and the half-hour window that makes an activity cost only the jobs it
 * overlaps. The last test runs the whole path through `materializeChoreDay` against SQLite.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import type { LocalDate } from '../src/types.ts';
import {
  JOB_MINUTES,
  awayForJob,
  awaySpans,
  childrenNamed,
  listChoreAssignments,
  materializeChoreDay,
  rotationAssignee,
  rotationAssigneeSkipping,
} from '../src/domain/chores/index.ts';
import type { CalendarEventView, Utc } from '../src/types.ts';

const d = (s: string) => s as LocalDate;
const KIDS = ['child-a', 'child-b', 'child-c'].map((childId, i) => ({ childId, position: i + 1 }));
const NAMED = [
  { id: 'child-a', name: 'Child A' },
  { id: 'child-b', name: 'Child B' },
  { id: 'child-c', name: 'Child C' },
];

function dates(from: string, days: number): LocalDate[] {
  const start = Date.parse(`${from}T00:00:00Z`);
  return Array.from({ length: days }, (_, i) => d(new Date(start + i * 86_400_000).toISOString().slice(0, 10)));
}

/** A timed event in America/Denver during MDT (UTC-6), which is the default zone. */
function timed(title: string, date: string, from: string, to: string, childId: string | null = null): CalendarEventView {
  const utc = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return new Date(Date.parse(`${date}T00:00:00Z`) + ((h! + 6) * 60 + m!) * 60_000).toISOString() as Utc;
  };
  return {
    id: 1,
    title,
    when: { kind: 'timed', startsAtUtc: utc(from), endsAtUtc: utc(to) },
    sourceId: 'cs-family',
    colourToken: 'blue',
    childId,
    icon: null as never,
    emoji: null,
    category: null,
  };
}

// ---------------------------------------------------------------------------
// The pass-along
// ---------------------------------------------------------------------------

test('with nobody away the turn is exactly rotationAssignee', () => {
  for (const date of dates('2026-10-01', 60)) {
    assert.equal(rotationAssigneeSkipping('ch-x', date, KIDS, new Set()), rotationAssignee('ch-x', date, KIDS));
  }
});

test('an away child passes the turn to the next child in the roster, wrapping', () => {
  for (const date of dates('2026-10-01', 30)) {
    const plain = rotationAssignee('ch-x', date, KIDS)!;
    const at = KIDS.findIndex((k) => k.childId === plain);
    const next = KIDS[(at + 1) % KIDS.length]!.childId;
    assert.equal(rotationAssigneeSkipping('ch-x', date, KIDS, new Set([plain])), next, date);
    // And past two away children to the third.
    const third = KIDS[(at + 2) % KIDS.length]!.childId;
    assert.equal(rotationAssigneeSkipping('ch-x', date, KIDS, new Set([plain, next])), third, date);
  }
});

test('a child who is not on turn being away changes nothing', () => {
  const date = d('2026-10-20');
  const plain = rotationAssignee('ch-x', date, KIDS)!;
  const other = KIDS.find((k) => k.childId !== plain)!.childId;
  assert.equal(rotationAssigneeSkipping('ch-x', date, KIDS, new Set([other])), plain);
});

test('everyone away keeps the plain assignee rather than handing the job to nobody', () => {
  const date = d('2026-10-20');
  const all = new Set(KIDS.map((k) => k.childId));
  assert.equal(rotationAssigneeSkipping('ch-x', date, KIDS, all), rotationAssignee('ch-x', date, KIDS));
});

// ---------------------------------------------------------------------------
// Whose event it is
// ---------------------------------------------------------------------------

test('a title names a child by whole word, in any case', () => {
  assert.deepEqual(childrenNamed('Child A and Child B dance', NAMED), ['child-a', 'child-b']);
  assert.deepEqual(childrenNamed('child c: swim', NAMED), ['child-c']);
  assert.deepEqual(childrenNamed('Child Ab practice', NAMED), [], 'a prefix of a longer word is not a name');
  assert.deepEqual(childrenNamed('Book club', NAMED), []);
});

test('a child-owned calendar counts even when the title names nobody', () => {
  const spans = awaySpans([timed('Swim', '2026-10-20', '17:00', '18:00', 'child-c')], NAMED, d('2026-10-20'));
  assert.deepEqual(spans.map((s) => s.childIds), [['child-c']]);
});

test('an all-day event and an event on another day take nobody away', () => {
  const allDay: CalendarEventView = {
    ...timed('Child A at camp', '2026-10-20', '00:00', '01:00'),
    when: { kind: 'allDay', startDate: d('2026-10-20'), endDate: d('2026-10-21') } as never,
  };
  const yesterday = timed('Child A dance', '2026-10-19', '17:15', '18:00');
  assert.deepEqual(awaySpans([allDay, yesterday], NAMED, d('2026-10-20')), []);
});

// ---------------------------------------------------------------------------
// The job's own half-hour
// ---------------------------------------------------------------------------

test('the window is the half-hour before the due time, open at both ends', () => {
  assert.equal(JOB_MINUTES, 30);
  const on = d('2026-10-21');
  // The household's shape: an activity 16:30-17:30, and dinner jobs due 17:30, 18:00, 19:00.
  const spans = awaySpans([timed('Child A and Child B gym', '2026-10-21', '16:30', '17:30')], NAMED, on);
  assert.deepEqual([...awayForJob(spans, '17:30')].sort(), ['child-a', 'child-b'], 'setting the table');
  assert.deepEqual([...awayForJob(spans, '18:00')], [], 'ends as the 17:30-18:00 job starts');
  assert.deepEqual([...awayForJob(spans, '19:00')], [], 'clearing up, long after');
  assert.deepEqual([...awayForJob(spans, '16:30')], [], 'a job finished as the activity starts');
  assert.deepEqual([...awayForJob(spans, 'not a time')], []);
});

// ---------------------------------------------------------------------------
// End to end, through SQLite
// ---------------------------------------------------------------------------

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

function promote(db: ReturnType<typeof fresh>, sourceId: string, events: { uid: string; title: string; from: string; to: string }[]) {
  const runId = Number(
    db.prepare(`INSERT INTO sync_run (source_id, state, started_at_utc) VALUES (?, 'running', ?)`).run(sourceId, '2026-10-01T00:00:00Z')
      .lastInsertRowid,
  );
  const insert = db.prepare(
    `INSERT INTO calendar_event (sync_run_id, source_id, external_uid, title, starts_at_utc, ends_at_utc, icon_asset_id)
     VALUES (?, ?, ?, ?, ?, ?, 'ico-cal')`,
  );
  for (const e of events) insert.run(runId, sourceId, e.uid, e.title, e.from, e.to);
  db.prepare(`UPDATE sync_run SET state='complete', completed_at_utc=?, event_count=? WHERE id=?`).run('2026-10-01T00:01:00Z', events.length, runId);
  db.prepare(`UPDATE sync_run SET state='promoted', promoted_at_utc=? WHERE id=?`).run('2026-10-01T00:01:00Z', runId);
  db.prepare(`UPDATE calendar_source SET current_sync_run_id=? WHERE id=?`).run(runId, sourceId);
}

function assignees(db: ReturnType<typeof fresh>, choreId: string, date: LocalDate): string[] {
  return listChoreAssignments(db, date)
    .filter((a) => a.choreId === choreId)
    .map((a) => a.childId);
}

test('materialization passes the table to the child who is home, and only on that day', () => {
  const db = fresh();
  db.prepare(`UPDATE chore SET due_by_local = '17:30' WHERE id = 'ch-table'`).run();
  const members = [
    { childId: 'child-a', position: 1 },
    { childId: 'child-b', position: 2 },
  ];
  const day = dates('2026-10-05', 14).find((x) => rotationAssignee('ch-table', x, members) === 'child-a')!;
  const nextDay = d(new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));
  // 17:15-18:00 MDT on `day`.
  promote(db, 'cs-family', [
    { uid: 'dance', title: 'Child A dance', from: `${day}T23:15:00Z`, to: `${nextDay}T00:00:00Z` },
  ]);

  materializeChoreDay(db, 'ch-table', day);
  assert.deepEqual(assignees(db, 'ch-table', day), ['child-b'], 'child-a is at dance at 17:15');

  materializeChoreDay(db, 'ch-table', nextDay);
  assert.deepEqual(
    assignees(db, 'ch-table', nextDay),
    [rotationAssignee('ch-table', nextDay, members)],
    'the next day is the plain rotation: being away moved nothing forward',
  );
  db.close();
});

test('a rotation chore with no due time ignores the calendar', () => {
  const db = fresh();
  const members = [
    { childId: 'child-a', position: 1 },
    { childId: 'child-b', position: 2 },
  ];
  const day = dates('2026-10-05', 14).find((x) => rotationAssignee('ch-table', x, members) === 'child-a')!;
  promote(db, 'cs-family', [
    { uid: 'all-day-long', title: 'Child A away', from: `${day}T06:00:00Z`, to: `${day}T23:59:00Z` },
  ]);
  materializeChoreDay(db, 'ch-table', day);
  assert.deepEqual(assignees(db, 'ch-table', day), ['child-a']);
  db.close();
});
