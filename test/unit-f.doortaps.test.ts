/**
 * The door-tap instrument — the count that settles backlog item 5.1 (private notes), and the ways it could lie.
 *
 * Most of these are about the instrument being HONEST rather than about it working. A counter
 * that works but overstates demand would not fail; it would quietly argue for the feature it
 * is supposed to be neutral about, and nobody would ever know. So the tests that matter here
 * are the ones about a child hammering the button, about the two modes staying separable, and
 * about a bad body never reaching a wall as an error.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev, TARGET_VERSION } from '../src/db/migrate.ts';
import { issueDeviceToken } from '../src/http/auth.ts';
import { createWallServer } from '../src/http/server.ts';
import {
  DOOR_TARGETS,
  isDoorTarget,
  readDoorTaps,
  recordDoorTap,
} from '../src/domain/telemetry/doorTaps.ts';
import type { LocalDate, LocalTime } from '../src/types.ts';

function fresh() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

const DAY = '2026-08-27' as LocalDate;
const at = (hhmm: string) => hhmm as LocalTime;

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

test('a single tap is one tap and one reach', () => {
  const db = fresh();
  recordDoorTap(db, { target: 'calendar', scene: true, localDate: DAY, localTime: at('09:15') });
  const rows = readDoorTaps(db);
  assert.equal(rows.length, 1);
  assert.deepEqual(rows[0], {
    localDate: DAY,
    target: 'calendar',
    scene: true,
    taps: 1,
    minutes: 1,
  });
  db.close();
});

test('HAMMERING IS ONE REACH — the property the whole design exists for', () => {
  // A three-year-old drumming on the calendar button is not forty adults wanting a readout.
  // If `minutes` tracked `taps` here, the instrument would manufacture the conclusion that
  // the picture urgently needs the thing under argument.
  const db = fresh();
  for (let i = 0; i < 40; i++) {
    recordDoorTap(db, { target: 'calendar', scene: true, localDate: DAY, localTime: at('09:15') });
  }
  const [row] = readDoorTaps(db);
  assert.equal(row?.taps, 40);
  assert.equal(row?.minutes, 1, 'forty taps in one minute is ONE reach for the calendar');
  db.close();
});

test('taps in distinct minutes are distinct reaches', () => {
  const db = fresh();
  for (const t of ['09:15', '09:16', '11:02', '17:40']) {
    recordDoorTap(db, { target: 'calendar', scene: true, localDate: DAY, localTime: at(t) });
  }
  const [row] = readDoorTaps(db);
  assert.equal(row?.taps, 4);
  assert.equal(row?.minutes, 4);
  db.close();
});

test('a minute is only new when it CHANGES, not when it is unseen', () => {
  // Returning to a minute already counted must not count again — otherwise a wall whose clock
  // sat still for a moment would inflate the number it exists to report.
  const db = fresh();
  for (const t of ['09:15', '09:16', '09:15', '09:16', '09:15']) {
    recordDoorTap(db, { target: 'calendar', scene: true, localDate: DAY, localTime: at(t) });
  }
  const [row] = readDoorTaps(db);
  assert.equal(row?.taps, 5);
  assert.equal(row?.minutes, 5, 'alternating minutes are genuinely separate reaches');
  db.close();
});

// ---------------------------------------------------------------------------
// Keeping the four buckets apart — without this the comparison is meaningless
// ---------------------------------------------------------------------------

test('picture-up and picture-down are separate rows', () => {
  // This IS the evidence. A count that merged the two modes would answer a different question
  // from the one that was asked, while looking exactly as authoritative.
  const db = fresh();
  recordDoorTap(db, { target: 'calendar', scene: true, localDate: DAY, localTime: at('09:15') });
  recordDoorTap(db, { target: 'calendar', scene: false, localDate: DAY, localTime: at('09:15') });
  const rows = readDoorTaps(db);
  assert.equal(rows.length, 2);
  assert.equal(rows.filter((r) => r.scene).length, 1);
  assert.equal(rows.filter((r) => !r.scene).length, 1);
  db.close();
});

test('the two doors are separate rows — grown-ups is the control', () => {
  const db = fresh();
  recordDoorTap(db, { target: 'calendar', scene: true, localDate: DAY, localTime: at('09:15') });
  recordDoorTap(db, { target: 'grown-ups', scene: true, localDate: DAY, localTime: at('09:15') });
  const rows = readDoorTaps(db);
  assert.equal(rows.length, 2);
  assert.deepEqual([...new Set(rows.map((r) => r.target))].sort(), ['calendar', 'grown-ups']);
  db.close();
});

test('days are separate rows, so a hammering day is visible instead of averaged away', () => {
  const db = fresh();
  recordDoorTap(db, { target: 'calendar', scene: true, localDate: '2026-08-26' as LocalDate, localTime: at('09:15') });
  recordDoorTap(db, { target: 'calendar', scene: true, localDate: DAY, localTime: at('09:15') });
  const rows = readDoorTaps(db);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]?.localDate, DAY, 'newest first — the operator asks "what has been happening"');
  db.close();
});

test('reading from a date excludes what came before it', () => {
  const db = fresh();
  for (const d of ['2026-08-20', '2026-08-25', '2026-08-27']) {
    recordDoorTap(db, { target: 'calendar', scene: true, localDate: d as LocalDate, localTime: at('09:15') });
  }
  assert.equal(readDoorTaps(db).length, 3);
  assert.equal(readDoorTaps(db, '2026-08-25' as LocalDate).length, 2, 'the boundary is inclusive');
  assert.equal(readDoorTaps(db, '2026-08-28' as LocalDate).length, 0);
  db.close();
});

test('an empty table reads as empty rather than throwing', () => {
  const db = fresh();
  assert.deepEqual(readDoorTaps(db), []);
  db.close();
});

// ---------------------------------------------------------------------------
// The table cannot grow into a tap log
// ---------------------------------------------------------------------------

test('a third target is REFUSED by the table, not by a comment', () => {
  // The privacy property is that this is a counter on two named doors and cannot quietly
  // become a record of everything a family touches. A CHECK enforces that; a convention does
  // not. Written as raw SQL because the typed path would not compile — which is the point:
  // both layers have to refuse.
  const db = fresh();
  assert.throws(
    () =>
      db
        .prepare('INSERT INTO door_tap(local_date, target, scene, taps, minutes) VALUES (?,?,?,?,?)')
        .run(DAY, 'routines', 1, 1, 1),
    /CHECK/i,
  );
  db.close();
});

test('the row count is bounded by days, not by taps', () => {
  const db = fresh();
  for (let i = 0; i < 500; i++) {
    recordDoorTap(db, {
      target: i % 2 === 0 ? 'calendar' : 'grown-ups',
      scene: i % 3 === 0,
      localDate: DAY,
      localTime: at(`09:${String(i % 60).padStart(2, '0')}`),
    });
  }
  assert.ok(readDoorTaps(db).length <= 4, 'one day can never be more than 2 doors x 2 modes');
  db.close();
});

test('isDoorTarget accepts exactly the two doors', () => {
  for (const t of DOOR_TARGETS) assert.equal(isDoorTarget(t), true);
  for (const junk of ['routines', 'chores', '', null, undefined, 7, {}, ['calendar']]) {
    assert.equal(isDoorTarget(junk), false);
  }
});

// ---------------------------------------------------------------------------
// Migration — the half that only a live database would have found
// ---------------------------------------------------------------------------

test('an EXISTING database gains the table, and lands identical to a fresh one', () => {
  // v2 could not carry its CHECKs across a migration because ALTER TABLE ADD COLUMN cannot
  // add one. v3 is a new table, so both paths must produce the same shape — and if they ever
  // stop doing so, the constraint above is enforced on exactly one of the two databases that
  // exist, the household's being the wrong one.
  const old = openDatabase({ path: ':memory:' });
  old.exec(`
    CREATE TABLE schema_migration (version INTEGER PRIMARY KEY, applied_at_utc TEXT NOT NULL) STRICT;
    INSERT INTO schema_migration(version, applied_at_utc) VALUES (1, '2026-08-24T00:00:00Z');
    CREATE TABLE chore (id TEXT PRIMARY KEY) STRICT;
    -- This fixture is a hand-rolled partial v1, so it has to carry every table an upgrade
    -- step TOUCHES — not every table the schema has. v5 adds a column to calendar_event, and
    -- without this the whole migration path fails here on "no such table" while the real
    -- household database, which has the table, upgrades fine.
    CREATE TABLE calendar_event (id INTEGER PRIMARY KEY, title TEXT NOT NULL) STRICT;
    CREATE TABLE countdown (id TEXT PRIMARY KEY) STRICT;
    CREATE TABLE calendar_source (id TEXT PRIMARY KEY) STRICT;
  `);
  const result = migrate(old);
  assert.equal(result.applied, true);
  assert.equal(result.version, TARGET_VERSION);

  recordDoorTap(old, { target: 'calendar', scene: true, localDate: DAY, localTime: at('09:15') });
  assert.equal(readDoorTaps(old)[0]?.taps, 1);
  assert.throws(
    () =>
      old
        .prepare('INSERT INTO door_tap(local_date, target, scene, taps, minutes) VALUES (?,?,?,?,?)')
        .run(DAY, 'routines', 1, 1, 1),
    /CHECK/i,
    'a migrated database must refuse a third target exactly as a fresh one does',
  );

  // Compared with COMMENTS STRIPPED, not byte for byte. SQLite stores the CREATE TABLE text
  // verbatim, comments included, and `schema.sql` is the documented contract so it carries
  // prose the migration's mechanical replay does not. Byte-matching would either force the
  // comment to be duplicated into `migrate.ts` — where it would drift — or break on any
  // reflow of the schema. What has to agree is the shape, and that is what this compares.
  const shape = (db: ReturnType<typeof openDatabase>) =>
    (db.prepare(`SELECT sql FROM sqlite_master WHERE name = 'door_tap'`).get() as { sql: string }).sql
      .split('\n')
      .map((line) => line.replace(/--.*$/, ''))
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim();
  const born = fresh();
  assert.equal(shape(old), shape(born), 'migrated and fresh must be the same table');

  // And the columns themselves, which is the half a DDL string comparison would still pass
  // if one path silently gained a different default.
  const columns = (db: ReturnType<typeof openDatabase>) =>
    JSON.stringify(db.pragma('table_info(door_tap)'));
  assert.equal(columns(old), columns(born));
  old.close();
  born.close();
});

// ---------------------------------------------------------------------------
// Through the real HTTP surface
// ---------------------------------------------------------------------------

const PATH = '/api/wall/v1/telemetry/door';

async function startServer() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  const device = issueDeviceToken(db, 'test-kiosk');
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs: 60_000 });
  const addr = await wall.listen(0);
  return {
    db,
    base: `http://127.0.0.1:${String(addr.port)}`,
    token: device.token,
    post: (body: unknown, token?: string) =>
      fetch(`http://127.0.0.1:${String(addr.port)}${PATH}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Device ${token ?? device.token}`,
        },
        body: JSON.stringify(body),
      }),
    stop: async () => {
      await wall.close();
      db.close();
    },
  };
}

test('a door tap posted by the wall is counted', async () => {
  const h = await startServer();
  const res = await h.post({ target: 'calendar', scene: true });
  assert.equal(res.status, 204, 'nothing to say back — the wall is not waiting on this');
  const rows = readDoorTaps(h.db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.target, 'calendar');
  assert.equal(rows[0]?.scene, true);
  await h.stop();
});

test('it needs a device token, like everything else on this surface', async () => {
  const h = await startServer();
  const res = await fetch(`${h.base}${PATH}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ target: 'calendar', scene: true }),
  });
  assert.ok(res.status === 401 || res.status === 403, `unauthenticated must be refused, got ${String(res.status)}`);
  assert.equal(readDoorTaps(h.db).length, 0);
  await h.stop();
});

test('the DATE IS THE SERVERS, so a wrong clock on the Pi cannot misfile the evidence', async () => {
  // The wall's own clock is the thing this codebase refuses to trust — a Pi that comes up
  // after a power cut may not have synced. Those are exactly the days you would most want to
  // read correctly, so the client is not allowed to say when a tap happened, and a client
  // that tries is simply ignored.
  const h = await startServer();
  await h.post({ target: 'calendar', scene: true, localDate: '1999-01-01', localTime: '03:00' });
  const rows = readDoorTaps(h.db);
  assert.equal(rows.length, 1);
  assert.notEqual(rows[0]?.localDate, '1999-01-01', 'the client does not get to choose the date');
  await h.stop();
});

test('a missing `scene` is counted as picture-DOWN, never as picture-up', async () => {
  // The direction matters: defaulting to `true` would credit every malformed tap to the side
  // of the argument that wants a readout, and the instrument would drift toward its own
  // conclusion without anybody editing a number.
  const h = await startServer();
  await h.post({ target: 'calendar' });
  await h.post({ target: 'calendar', scene: 'yes' });
  await h.post({ target: 'calendar', scene: 1 });
  const rows = readDoorTaps(h.db);
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.scene, false);
  assert.equal(rows[0]?.taps, 3);
  await h.stop();
});

test('an unknown or missing door is refused and nothing is written', async () => {
  const h = await startServer();
  for (const body of [{}, { target: 'routines' }, { target: '' }, { target: 42 }, { target: null }]) {
    const res = await h.post(body);
    assert.equal(res.status, 400, `${JSON.stringify(body)} must be refused`);
  }
  assert.equal(readDoorTaps(h.db).length, 0, 'a refused tap writes nothing');
  await h.stop();
});

test('it cannot approve, pay, or delete anything — it is a counter', async () => {
  // The wall surface can never move money, and a new route on it is the moment that could
  // quietly stop being true. Nothing outside `door_tap` may differ after a tap.
  const h = await startServer();
  const fingerprint = () =>
    JSON.stringify([
      h.db.prepare('SELECT COUNT(*) AS n, COALESCE(SUM(delta),0) AS s FROM ledger_entry').get(),
      h.db.prepare('SELECT COUNT(*) AS n FROM chore_assignment').get(),
      h.db.prepare('SELECT COUNT(*) AS n FROM redemption_request').get(),
      h.db.prepare('SELECT COUNT(*) AS n FROM routine_step_completion').get(),
      h.db.prepare('SELECT COUNT(*) AS n FROM device_token').get(),
    ]);
  const before = fingerprint();
  for (let i = 0; i < 5; i++) await h.post({ target: 'grown-ups', scene: true });
  assert.equal(fingerprint(), before, 'a door tap moved something other than its own counter');
  await h.stop();
});


// ---------------------------------------------------------------------------
// The instrument must not measure its own verification
// ---------------------------------------------------------------------------

test('a probe session is recognised only from an exact `probe=1` fragment', async () => {
  const { isProbeSession } = await import('../web/src/data/device.ts');
  assert.equal(isProbeSession('#probe=1'), true);
  assert.equal(isProbeSession('probe=1'), true, 'the leading # is optional');
  assert.equal(isProbeSession('#gate=http%3A%2F%2F127.0.0.1%3A18765&probe=1'), true);
  // Anything else is a real session. A wall that quietly stopped counting because a fragment
  // half-matched would look exactly like a wall nobody uses, which is the answer §5.1 is
  // trying to distinguish FROM.
  for (const h of [undefined, null, '', '#', '#probe', '#probe=', '#probe=0', '#probe=true',
                   '#probes=1', '#xprobe=1', '#gate=x']) {
    assert.equal(isProbeSession(h), false, String(h));
  }
});

test('a probe session records NOTHING, and an ordinary session still records', async () => {
  const { createWallActions } = await import('../web/src/app/actions.ts');
  const seen: string[] = [];
  const spy = ((url: string) => {
    seen.push(String(url));
    return Promise.resolve({ ok: true, status: 204, text: () => Promise.resolve('') });
  }) as unknown as typeof fetch;

  createWallActions({ fetchImpl: spy, countTaps: false }).recordDoorTap('calendar', true);
  assert.deepEqual(seen, [], 'a probe must not reach the instrument');

  createWallActions({ fetchImpl: spy }).recordDoorTap('calendar', true);
  assert.equal(seen.length, 1, 'counting is the DEFAULT — the flag can only ever subtract');
  assert.match(seen[0] ?? '', /telemetry\/door$/);
});
