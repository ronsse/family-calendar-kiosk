/**
 * tools/scene-calendar.cjs — what the coming days' calendar may tell the picture, and above all
 * what it may NOT: by default a title never comes out, only category counts and `scene:` notes.
 * Titles of ONE-OFF events come out only with `titles: true` (household `scenes.shareTitles`),
 * and visitors come out as ids only. Driven against a real schema in a temp file, the same way
 * scene_context.py runs it inside the container (WALL_DB stands in for the volume).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';

const SCRIPT = join(import.meta.dirname, '..', 'tools', 'scene-calendar.cjs');

type Ev = { title: string; day: string; allDay?: boolean; days?: number };

/** One promoted generation holding `events`; returns the DB path. */
function wall(dir: string, events: Ev[]): string {
  const path = join(dir, `wall-${Math.random().toString(36).slice(2)}.db`);
  const db = openDatabase({ path });
  migrate(db);
  seedDev(db);
  db.prepare(
    `INSERT INTO calendar_source (id,label,external_ref,colour_token) VALUES ('cs-t','T','cal.t','blue')`,
  ).run();
  const run = Number(
    db
      .prepare(`INSERT INTO sync_run (source_id, state, started_at_utc) VALUES ('cs-t','running',?)`)
      .run('2026-10-01T00:00:00Z').lastInsertRowid,
  );
  const ins = db.prepare(
    `INSERT INTO calendar_event (sync_run_id, source_id, external_uid, title, starts_at_utc,
       ends_at_utc, all_day_start_date, all_day_end_date, icon_asset_id)
     VALUES (?, 'cs-t', ?, ?, ?, ?, ?, ?, 'ico-cal')`,
  );
  events.forEach((e, i) => {
    if (e.allDay) {
      const end = new Date(`${e.day}T00:00:00Z`);
      end.setUTCDate(end.getUTCDate() + (e.days ?? 1));
      ins.run(run, `u${i}`, e.title, null, null, e.day, end.toISOString().slice(0, 10));
    } else {
      ins.run(run, `u${i}`, e.title, `${e.day}T20:00:00Z`, `${e.day}T22:00:00Z`, null, null);
    }
  });
  db.prepare(`UPDATE sync_run SET state='complete', completed_at_utc=?, event_count=? WHERE id=?`).run(
    '2026-10-01T00:01:00Z', events.length, run);
  db.prepare(`UPDATE sync_run SET state='promoted', promoted_at_utc=? WHERE id=?`).run('2026-10-01T00:01:00Z', run);
  db.prepare(`UPDATE calendar_source SET current_sync_run_id=? WHERE id='cs-t'`).run(run);
  db.close();
  return path;
}

function read(db: string, opts?: unknown): { raw: string; out: Record<string, any> } {
  const args = ['--no-warnings', SCRIPT, '2026-11-02', '2026-11-08'];
  if (opts !== undefined) args.push(JSON.stringify(opts));
  const raw = execFileSync(process.execPath, args, { env: { ...process.env, WALL_DB: db }, encoding: 'utf8' }).trim();
  return { raw, out: JSON.parse(raw) };
}

const dir = mkdtempSync(join(tmpdir(), 'scene-calendar-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

const GUESTS = [
  { id: 'aunt', names: ['Sam', 'Smiths', 'the Smiths'] },
  { id: 'cousin-1', names: ['Robin', 'Smiths', 'the Smiths'] },
];

test('without options the output is counts and scene notes, nothing else', () => {
  const { out } = read(wall(dir, [
    { title: 'Soccer practice', day: '2026-11-04' },
    { title: 'Dentist', day: '2026-11-05' },
    { title: 'scene: a kite festival', day: '2026-11-03', allDay: true },
  ]));
  assert.deepEqual(Object.keys(out), ['counts', 'hints']);
  assert.deepEqual(out.counts, { calendar: 3 });
  assert.deepEqual(out.hints, ['a kite festival']);
});

test('no title and no name leaves by default, even with guests to match', () => {
  const { raw, out } = read(wall(dir, [
    { title: "Child B's birthday party with Rosalind", day: '2026-11-07' },
    { title: 'Orthodontist for Bartholomew', day: '2026-11-04' },
    { title: 'Sam and Robin visiting', day: '2026-11-05', allDay: true, days: 3 },
  ]), { titles: false, guests: GUESTS });
  for (const secret of ['Rosalind', 'Bartholomew', 'Orthodontist', 'Child B', 'party', 'Sam', 'Robin', 'visiting']) {
    assert.ok(!raw.toLowerCase().includes(secret.toLowerCase()), `${secret} leaked: ${raw}`);
  }
  assert.equal(out.events, undefined);
  assert.deepEqual(out.visitors, [
    { id: 'aunt', from: '2026-11-05', to: '2026-11-07' },
    { id: 'cousin-1', from: '2026-11-05', to: '2026-11-07' },
  ]);
});

test('with titles on, one-off events come out with their days; routines are only counted', () => {
  const { out } = read(wall(dir, [
    { title: 'Ski lesson', day: '2026-11-07' },
    { title: 'Ski lesson', day: '2026-11-14' },
    { title: 'Book fair', day: '2026-11-03', allDay: true, days: 3 },
    { title: 'Pumpkin carving', day: '2026-11-06' },
  ]), { titles: true });
  assert.deepEqual(out.events, [
    { title: 'Book fair', from: '2026-11-03', to: '2026-11-05', all_day: true },
    { title: 'Pumpkin carving', from: '2026-11-06', to: '2026-11-06', all_day: false },
  ]);
  assert.equal(out.routine, 1);
});

test('an event that began before the window and runs into it is still this week', () => {
  const { out } = read(wall(dir, [
    { title: 'Family vacation', day: '2026-10-30', allDay: true, days: 6 },
  ]), { titles: true, guests: GUESTS });
  assert.deepEqual(out.events, [{ title: 'Family vacation', from: '2026-10-30', to: '2026-11-04', all_day: true }]);
  assert.deepEqual(out.visitors, []);
});

test('a group name brings every member; names are whole words', () => {
  const { out } = read(wall(dir, [
    { title: 'The Smiths arrive', day: '2026-11-06', allDay: true, days: 2 },
    { title: 'Samba class visit', day: '2026-11-03' },
  ]), { guests: GUESTS });
  assert.deepEqual(out.visitors.map((v: { id: string }) => v.id), ['aunt', 'cousin-1']);
  const none = read(wall(dir, [{ title: 'Samba class', day: '2026-11-03' }]), { guests: GUESTS }).out;
  assert.deepEqual(none.visitors, []);
});

test("a name alone is not a visit: an aunt's birthday on the calendar brings nobody", () => {
  const { out } = read(wall(dir, [
    { title: "Sam Smith's birthday", day: '2026-11-04', allDay: true },
    { title: 'Call Robin', day: '2026-11-05' },
  ]), { guests: GUESTS });
  assert.deepEqual(out.visitors, []);
  const here = read(wall(dir, [{ title: 'Robin staying with us', day: '2026-11-05', allDay: true }]), { guests: GUESTS }).out;
  assert.deepEqual(here.visitors, [{ id: 'cousin-1', from: '2026-11-05', to: '2026-11-05' }]);
});
