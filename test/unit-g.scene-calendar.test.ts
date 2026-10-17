/**
 * tools/scene-calendar.cjs — what the coming week's calendar may tell the picture, and above all
 * what it may NOT: a title never comes out, only category counts, `scene:` notes and at most one
 * HEADLINE id from tools/scene-headlines.json. Driven against a real schema in a temp file, the
 * same way scene_context.py runs it inside the container (WALL_DB stands in for the volume).
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';

const SCRIPT = join(import.meta.dirname, '..', 'tools', 'scene-calendar.cjs');
const RULES = JSON.parse(
  readFileSync(join(import.meta.dirname, '..', 'tools', 'scene-headlines.json'), 'utf8'),
).headlines;

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

function read(db: string, rules: unknown = RULES): { raw: string; out: Record<string, unknown> } {
  const raw = execFileSync(
    process.execPath,
    ['--no-warnings', SCRIPT, '2026-11-02', '2026-11-08', JSON.stringify(rules)],
    { env: { ...process.env, WALL_DB: db }, encoding: 'utf8' },
  ).trim();
  return { raw, out: JSON.parse(raw) };
}

const dir = mkdtempSync(join(tmpdir(), 'scene-calendar-'));
test.after(() => rmSync(dir, { recursive: true, force: true }));

test('an ordinary week has no headline, and the counts still come out', () => {
  const { out } = read(wall(dir, [
    { title: 'Soccer practice', day: '2026-11-04' },
    { title: 'Dentist', day: '2026-11-05' },
  ]));
  assert.equal(out.headline, null);
  assert.deepEqual(out.counts, { calendar: 2 });
});

test('a routine is not an event: a weekly ski lesson never chooses the picture', () => {
  const { out } = read(wall(dir, [
    { title: 'Ski lesson', day: '2026-11-07' },
    { title: 'Ski lesson', day: '2026-11-14' },
    { title: 'Ski lesson', day: '2026-11-21' },
  ]));
  assert.equal(out.headline, null);
});

test("a child's birthday, or anybody's birthday PARTY, is a party; an aunt's birthday is not", () => {
  assert.equal(read(wall(dir, [{ title: "Aunt Mo's birthday", day: '2026-11-03', allDay: true }])).out.headline, null);
  assert.deepEqual(read(wall(dir, [{ title: "Child A's Birthday!", day: '2026-11-03', allDay: true }])).out.headline,
    { id: 'birthday', setting: 'birthday-party', source: 'calendar' });
  assert.deepEqual(read(wall(dir, [{ title: 'Birthday party at the Smiths', day: '2026-11-07' }])).out.headline,
    { id: 'birthday', setting: 'birthday-party', source: 'calendar' });
});

test('the specific rule outranks the general one: a ski trip is a ski hill, not a station', () => {
  const { out } = read(wall(dir, [{ title: 'Ski trip', day: '2026-11-06', allDay: true, days: 3 }]));
  assert.deepEqual(out.headline, { id: 'ski', setting: 'snowy-hill', source: 'calendar' });
});

test('a multi-day vacation is one event and a trip', () => {
  const { out } = read(wall(dir, [{ title: 'Family vacation', day: '2026-11-05', allDay: true, days: 6 }]));
  assert.deepEqual(out.headline, { id: 'trip', setting: 'setting-off', source: 'calendar' });
});

test('words are whole words: "skip" is not "ski" and "tripod" is not "trip"', () => {
  const { out } = read(wall(dir, [
    { title: 'Skip rope club', day: '2026-11-04' },
    { title: 'Return the tripod', day: '2026-11-05' },
  ]));
  assert.equal(out.headline, null);
});

test('a scene: note outranks the calendar and needs no "party" beside "birthday"', () => {
  const { out } = read(wall(dir, [
    { title: 'Birthday party at the Smiths', day: '2026-11-07' },
    { title: 'scene: camping by a lake', day: '2026-11-02', allDay: true },
  ]));
  assert.deepEqual(out.headline, { id: 'camping', setting: 'night-camp', source: 'scene note' });
  assert.deepEqual(out.hints, ['camping by a lake']);
  assert.deepEqual(read(wall(dir, [{ title: 'scene: birthday', day: '2026-11-02', allDay: true }])).out.headline,
    { id: 'birthday', setting: 'birthday-party', source: 'scene note' });
});

test('no title and no child name ever leaves: only ids, counts and scene notes', () => {
  const { raw } = read(wall(dir, [
    { title: "Child B's birthday party with Rosalind", day: '2026-11-07' },
    { title: 'Orthodontist for Bartholomew', day: '2026-11-04' },
  ]));
  for (const secret of ['Rosalind', 'Bartholomew', 'Orthodontist', 'Child B', 'party with']) {
    assert.ok(!raw.toLowerCase().includes(secret.toLowerCase()), `${secret} leaked: ${raw}`);
  }
  assert.match(raw, /"birthday-party"/);
});

test('without a rules argument the output is exactly the old shape', () => {
  const raw = execFileSync(process.execPath, ['--no-warnings', SCRIPT, '2026-11-02', '2026-11-08'], {
    env: { ...process.env, WALL_DB: wall(dir, []) }, encoding: 'utf8',
  }).trim();
  assert.deepEqual(Object.keys(JSON.parse(raw)), ['counts', 'hints']);
});
