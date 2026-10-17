/**
 * Unit F acceptance — the snapshot builder.
 *
 * The assertions worth having are not "it returns JSON". They are the properties the design
 * review paid for and that a refactor could quietly undo: the CLIENT's date wins, a date the
 * server cannot honour is refused rather than silently swapped, and `balances` has a row for
 * a child who has never earned anything — which is every child on day one.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase } from '../src/db/connection.ts';
import { migrate, seedDev } from '../src/db/migrate.ts';
import { addDays, localDate } from '../src/time.ts';
import type { LocalDate, WallSnapshot } from '../src/types.ts';
import { issueDeviceToken } from '../src/http/auth.ts';
import { createWallServer, type WallServer } from '../src/http/server.ts';
import { COUNTDOWN_HORIZON_DAYS } from '../src/http/snapshot.ts';

function fresh(): Db {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  seedDev(db);
  return db;
}

interface Harness {
  db: Db;
  wall: WallServer;
  base: string;
  token: string;
  stop: () => Promise<void>;
}

async function start(): Promise<Harness> {
  const db = fresh();
  const { token } = issueDeviceToken(db, 'test-kiosk');
  const wall = createWallServer({ db, logger: () => {}, heartbeatMs: 60_000 });
  const addr = await wall.listen(0);
  const base = `http://127.0.0.1:${addr.port}`;
  return {
    db,
    wall,
    base,
    token,
    stop: async () => {
      await wall.close();
      db.close();
    },
  };
}

function auth(token: string): Record<string, string> {
  return { Authorization: `Device ${token}` };
}

async function snapshot(h: Harness, date: string): Promise<{ status: number; body: unknown }> {
  const res = await fetch(`${h.base}/api/wall/v1/snapshot?localDate=${date}`, {
    headers: auth(h.token),
  });
  return { status: res.status, body: await res.json() };
}

test('the snapshot is built for the CLIENT date, not the server clock', async () => {
  const h = await start();
  try {
    // Tomorrow, from the server's point of view. A wall a second past local midnight asks
    // for exactly this, and answering with the server's own date is H1 lens 3: the wall
    // then stays a day behind through 6:00 AM because nothing refires until the next
    // boundary.
    const tomorrow = addDays(localDate(), 1);
    const { status, body } = await snapshot(h, tomorrow);
    const snap = body as WallSnapshot;

    assert.equal(status, 200);
    assert.equal(snap.requestedLocalDate, tomorrow);
    assert.equal(snap.freshness.snapshotLocalDate, tomorrow);
    assert.notEqual(snap.freshness.snapshotLocalDate, localDate());
  } finally {
    await h.stop();
  }
});

test('a date the server cannot build is refused, never silently swapped', async () => {
  const h = await start();
  try {
    const far = addDays(localDate(), 5);
    const { status, body } = await snapshot(h, far);

    assert.equal(status, 409);
    assert.deepEqual((body as { error: string }).error, 'date_mismatch');
    // And critically: it did not materialize that date on the way to refusing. A kiosk with
    // a dead clock must not be able to write routine runs for dates nothing will read.
    const runs = h.db
      .prepare(`SELECT COUNT(*) AS n FROM routine_run WHERE local_date = ?`)
      .get(far) as { n: number };
    assert.equal(runs.n, 0);
  } finally {
    await h.stop();
  }
});

test('a missing localDate is date_mismatch, not the server answering for itself', async () => {
  const h = await start();
  try {
    const res = await fetch(`${h.base}/api/wall/v1/snapshot`, { headers: auth(h.token) });
    assert.equal(res.status, 409);
    assert.equal(((await res.json()) as { error: string }).error, 'date_mismatch');
  } finally {
    await h.stop();
  }
});

test('a malformed localDate is refused rather than parsed hopefully', async () => {
  const h = await start();
  try {
    for (const bad of ['today', '2026-13-40', '26-01-01', '']) {
      const { status, body } = await snapshot(h, encodeURIComponent(bad));
      assert.equal(status, 409, `expected refusal for ${bad}`);
      assert.equal((body as { error: string }).error, 'date_mismatch');
    }
  } finally {
    await h.stop();
  }
});

test('balances carry one row per ACTIVE child on a database with no ledger history', async () => {
  const h = await start();
  try {
    const entries = h.db.prepare(`SELECT COUNT(*) AS n FROM ledger_entry`).get() as { n: number };
    assert.equal(entries.n, 0, 'precondition: day one, nobody has earned anything');

    const { body } = await snapshot(h, localDate());
    const snap = body as WallSnapshot;

    assert.deepEqual(
      snap.balances.map((b) => b.childId).sort(),
      ['child-a', 'child-b', 'child-c'],
      'a bare aggregate over ledger_entry returns ZERO rows here, and a renderer doing ' +
        'balances.find() would get undefined on a kiosk that does not reload for months',
    );
    for (const balance of snap.balances) assert.equal(balance.points, 0);
    // The pre-reader has a completion history, not a balance.
    const preReader = snap.balances.find((b) => b.childId === 'child-c');
    assert.equal(preReader?.cashCents, null);
  } finally {
    await h.stop();
  }
});

test('every child is returned; the snapshot takes no child parameter', async () => {
  const h = await start();
  try {
    const { body } = await snapshot(h, localDate());
    const snap = body as WallSnapshot;
    assert.equal(snap.children.length, 3);
    // Selection is the client's, in memory. A server-held selection is what leaves the
    // wrong child's view up all night.
    const withChild = await fetch(
      `${h.base}/api/wall/v1/snapshot?localDate=${localDate()}&child=child-a`,
      { headers: auth(h.token) },
    );
    const filtered = (await withChild.json()) as WallSnapshot;
    assert.equal(filtered.children.length, 3, 'a child parameter must change nothing');
  } finally {
    await h.stop();
  }
});

test('the snapshot is complete: every field populated, every icon renderable', async () => {
  const h = await start();
  try {
    const { body } = await snapshot(h, localDate());
    const snap = body as WallSnapshot;

    for (const key of [
      'freshness',
      'requestedLocalDate',
      'children',
      'routines',
      'chores',
      'events',
      'countdowns',
      'balances',
      'redemptions',
      'apiVersion',
      'minClientBuild',
    ]) {
      assert.ok(key in snap, `WallSnapshot.${key} is missing`);
    }

    assert.ok(snap.chores.length > 0, 'the board materialized');
    assert.ok(snap.routines.length > 0, 'bedtime runs every day of the week');

    // For the pre-reader a missing icon IS a blank screen, so nothing may ship an empty url.
    const icons = [
      ...snap.chores.map((c) => c.icon),
      ...snap.routines.map((r) => r.icon),
      ...snap.routines.flatMap((r) => r.steps.map((s) => s.icon)),
      ...snap.countdowns.map((c) => c.icon),
    ];
    assert.ok(icons.length > 0);
    for (const icon of icons) assert.ok(icon.url.length > 0, 'an icon resolved to nothing');

    // The household's settings (2026-10-12). The dev seed writes none, so every one is the
    // default — which is the wall as it behaved before the settings existed.
    assert.ok('household' in snap, 'WallSnapshot.household is missing');
    assert.equal(snap.household.timezone, 'America/Denver');
    assert.equal(snap.household.features.chores, true);
    assert.equal(snap.household.boardWindows.length, 2);
    assert.equal(snap.household.pets.length, 0);
  } finally {
    await h.stop();
  }
});

test('the time box ships as data, never as a server-evaluated flag', async () => {
  const h = await start();
  try {
    const { body } = await snapshot(h, localDate());
    const snap = body as WallSnapshot;
    const run = snap.routines[0];
    assert.ok(run);
    assert.match(run.opensAtLocal, /^\d{2}:\d{2}$/);
    assert.match(run.closesAtLocal, /^\d{2}:\d{2}$/);
    // A snapshot built at 00:00 carrying `locked` would never open at 06:00: the wall only
    // refetches on SSE open and at the date boundary (H2 Q1's fatal flaw).
    assert.equal('locked' in run, false);
    assert.equal('open' in run, false);
  } finally {
    await h.stop();
  }
});

test('freshness reports provenance, and an unsynced calendar reads as unknown not fresh', async () => {
  const h = await start();
  try {
    const { body } = await snapshot(h, localDate());
    const snap = body as WallSnapshot;
    assert.equal(snap.freshness.routineMaterialization, 'ok');
    assert.match(snap.freshness.generatedAtUtc, /^\d{4}-\d{2}-\d{2}T/);
    // Nothing has ever been promoted in the seed, so the age is unknown. Zero would read as
    // "just synced", which is exactly the confident-and-stale failure freshness exists for.
    assert.equal(snap.freshness.calendarSyncAgeSeconds, null);
    // The dev seed DOES include calendar sources, so a sync is owed and never-synced is
    // genuinely stale. The distinction is the whole point of the field.
    assert.equal(snap.freshness.calendarConfigured, true);
    assert.deepEqual(snap.events, []);
  } finally {
    await h.stop();
  }
});

test('countdowns count SLEEPS as a local-date subtraction, and drop what is over', async () => {
  const h = await start();
  try {
    const today = localDate();
    const add = (id: string, target: string) =>
      h.db
        .prepare(
          `INSERT INTO countdown (id,label_short,label_full,icon_asset_id,emoji,target_date,annual_md,child_id,active)
           VALUES (?,?,?, 'ico-cake', NULL, ?, NULL, NULL, 1)`,
        )
        .run(id, id, id, target);

    // A fixed countdown already in the past: "-4 sleeps" is not a thing a wall shows.
    add('cd-past', addDays(today, -4));
    add('cd-soon', addDays(today, 3));
    add('cd-edge', addDays(today, COUNTDOWN_HORIZON_DAYS));
    add('cd-far', addDays(today, COUNTDOWN_HORIZON_DAYS + 1));

    const { body } = await snapshot(h, today);
    const snap = body as WallSnapshot;
    const seen = (id: string) => snap.countdowns.find((c) => c.id === id);

    assert.equal(seen('cd-past'), undefined, 'a countdown that has happened is not upcoming');

    // The horizon, asked for 2026-09-09: "I don't think we include the kid's birthdays unless
    // they're, like, two months out." Both sides of the boundary, because an off-by-one here
    // is the difference between a birthday appearing two months out and never appearing.
    assert.ok(seen('cd-soon'), 'inside the horizon');
    assert.ok(seen('cd-edge'), 'exactly ON the horizon is still inside it');
    assert.equal(seen('cd-far'), undefined, 'one day past the horizon is off the wire');

    assert.equal(seen('cd-soon')?.sleepsRemaining, 3);

    // Annual countdowns still roll forward rather than expiring — they are simply invisible
    // until they come within range. The dev seed's 03-15 birthday is the case in point.
    const annual = h.db
      .prepare(`SELECT annual_md FROM countdown WHERE id = 'cd-bday-a'`)
      .get() as { annual_md: string } | undefined;
    assert.ok(annual, 'the dev seed still carries an annual countdown');

    const winter = seen('cd-winter');
    if (winter) {
      assert.equal(winter.sleepsRemaining, daysBetweenDates(today, winter.targetDate));
    }
  } finally {
    await h.stop();
  }
});

test('an emoji is authored where there is one, and derived from the label where there is not', async () => {
  // Every countdown drew a birthday cake until 2026-09-09 — three birthdays and "Winter
  // holiday" all resolved to the one `celebration` icon, so the picture said nothing at all to
  // the two children who cannot read the label.
  const h = await start();
  try {
    const today = localDate();
    h.db
      .prepare(
        `INSERT INTO countdown (id,label_short,label_full,icon_asset_id,emoji,target_date,annual_md,child_id,active)
         VALUES ('cd-authored','A','Anything at all','ico-cake','🦕',?,NULL,NULL,1),
                ('cd-derived','D','Grandma visit','ico-cake',NULL,?,NULL,NULL,1),
                ('cd-unknown','U','Quarterly review','ico-cake',NULL,?,NULL,NULL,1)`,
      )
      .run(addDays(today, 5), addDays(today, 6), addDays(today, 7));

    const { body } = await snapshot(h, today);
    const snap = body as WallSnapshot;
    const seen = (id: string) => snap.countdowns.find((c) => c.id === id);

    assert.equal(seen('cd-authored')?.emoji, '🦕', 'the authored value wins outright');
    assert.equal(seen('cd-derived')?.emoji, '👋', 'and is derived from the label otherwise');
    // A guess is worse than nothing here: the readers it is for cannot check it.
    assert.equal(seen('cd-unknown')?.emoji, null);
  } finally {
    await h.stop();
  }
});

/** Deliberately recomputed here rather than imported, so the test is not the code. */
function daysBetweenDates(from: LocalDate, to: LocalDate): number {
  return Math.round(
    (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000,
  );
}

test('redemptions carry the pending requests only', async () => {
  const h = await start();
  try {
    h.db
      .prepare(
        `INSERT INTO redemption_request
           (child_id, points_requested, cents_per_point, cash_cents, state, requested_at_utc, decided_at_utc)
         VALUES ('child-a', 5, 10, 50, 'pending', '2026-09-01T10:00:00Z', NULL),
                ('child-b', 3, 10, 30, 'approved', '2026-08-30T10:00:00Z', '2026-08-30T11:00:00Z')`,
      )
      .run();

    const { body } = await snapshot(h, localDate());
    const snap = body as WallSnapshot;
    assert.equal(snap.redemptions.length, 1);
    assert.equal(snap.redemptions[0]?.childId, 'child-a');
    assert.equal(snap.redemptions[0]?.state, 'pending');
  } finally {
    await h.stop();
  }
});

/** Stages one generation and promotes it, the way src/calendar/sync.ts does. */
function promoteGeneration(
  db: Db,
  sourceId: string,
  events: {
    uid: string;
    title: string;
    startsAtUtc?: string;
    endsAtUtc?: string;
    allDayStart?: string;
    allDayEnd?: string;
  }[],
): void {
  const runId = Number(
    db
      .prepare(
        `INSERT INTO sync_run (source_id, state, started_at_utc) VALUES (?, 'running', ?)`,
      )
      .run(sourceId, '2026-08-01T00:00:00Z').lastInsertRowid,
  );
  const insert = db.prepare(
    `INSERT INTO calendar_event
       (sync_run_id, source_id, external_uid, title, starts_at_utc, ends_at_utc,
        all_day_start_date, all_day_end_date, icon_asset_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ico-cal')`,
  );
  for (const e of events) {
    insert.run(
      runId,
      sourceId,
      e.uid,
      e.title,
      e.startsAtUtc ?? null,
      e.endsAtUtc ?? null,
      e.allDayStart ?? null,
      e.allDayEnd ?? null,
    );
  }
  db.prepare(
    `UPDATE sync_run SET state='complete', completed_at_utc=?, event_count=? WHERE id=?`,
  ).run('2026-08-01T00:01:00Z', events.length, runId);
  db.prepare(`UPDATE sync_run SET state='promoted', promoted_at_utc=? WHERE id=?`).run(
    '2026-08-01T00:01:00Z',
    runId,
  );
  db.prepare(`UPDATE calendar_source SET current_sync_run_id=? WHERE id=?`).run(runId, sourceId);
}

test('events carry the promoted generation, and only what is still ahead', async () => {
  const h = await start();
  try {
    const today = localDate();
    // 12:00Z is early morning in Denver on either side of DST, so each of these lands on the
    // local date it is named for — which is the whole reason the filter goes through
    // src/time.ts rather than slicing an ISO string.
    promoteGeneration(h.db, 'cs-family', [
      { uid: 'now', title: 'Today timed', startsAtUtc: `${today}T12:00:00Z`, endsAtUtc: `${today}T13:00:00Z` },
      {
        uid: 'past',
        title: 'Three days ago',
        startsAtUtc: `${addDays(today, -3)}T12:00:00Z`,
        endsAtUtc: `${addDays(today, -3)}T13:00:00Z`,
      },
      {
        uid: 'far',
        title: 'Beyond the horizon',
        startsAtUtc: `${addDays(today, 90)}T12:00:00Z`,
        endsAtUtc: `${addDays(today, 90)}T13:00:00Z`,
      },
      { uid: 'allday-now', title: 'All day today', allDayStart: today, allDayEnd: addDays(today, 1) },
      {
        uid: 'allday-over',
        title: 'Ended at midnight',
        allDayStart: addDays(today, -1),
        allDayEnd: today,
      },
    ]);

    const { body } = await snapshot(h, today);
    const snap = body as WallSnapshot;

    assert.deepEqual(
      snap.events.map((e) => e.title).sort(),
      ['All day today', 'Today timed'],
      'an all-day end date is EXCLUSIVE, so one ending at midnight is already over',
    );
    for (const event of snap.events) assert.ok(event.icon.url.length > 0);
    assert.ok(
      (snap.freshness.calendarSyncAgeSeconds ?? -1) > 0,
      'a promoted generation has a measurable age',
    );
  } finally {
    await h.stop();
  }
});

test('a calendar that cannot be mapped costs the events strip, never the whole wall', async () => {
  const h = await start();
  try {
    const today = localDate();
    promoteGeneration(h.db, 'cs-family', [
      { uid: 'ok', title: 'Fine', startsAtUtc: `${today}T12:00:00Z`, endsAtUtc: `${today}T13:00:00Z` },
    ]);
    // Force the mapper to fail the way a corrupt row would. The schema CHECK makes this
    // unreachable through the migration, which is exactly why the fallback is worth a test:
    // a mapper throwing while building the wall's ONLY read is a blank wall (H1 finding #1).
    h.db.pragma('ignore_check_constraints = ON');
    h.db.prepare(`UPDATE calendar_event SET ends_at_utc = NULL WHERE external_uid = 'ok'`).run();
    h.db.pragma('ignore_check_constraints = OFF');

    const { status, body } = await snapshot(h, today);
    const snap = body as WallSnapshot;
    assert.equal(status, 200, 'the routine a three-year-old is working through still renders');
    assert.deepEqual(snap.events, []);
    assert.equal(snap.freshness.calendarSyncAgeSeconds, null, 'unknown, never "just synced"');
    assert.ok(snap.routines.length > 0);
    assert.ok(snap.chores.length > 0);
  } finally {
    await h.stop();
  }
});


test('calendarConfigured reflects whether any calendar is actually included', async () => {
  // Found on the first real deploy: a household with no calendar wired up read "Showing
  // older information" forever, because the client could not tell "never synced" from
  // "nothing to sync". Both are calendarSyncAgeSeconds: null; only this flag separates them.
  const h = await start();
  try {
    h.db.prepare('UPDATE calendar_source SET included = 0').run();
    const off = (await snapshot(h, localDate())).body as WallSnapshot;
    assert.equal(off.freshness.calendarConfigured, false, 'nothing included, nothing owed');
    assert.equal(off.freshness.calendarSyncAgeSeconds, null, 'still unknown, as before');

    h.db.prepare(`UPDATE calendar_source SET included = 1 WHERE id = 'cs-family'`).run();
    const on = (await snapshot(h, localDate())).body as WallSnapshot;
    assert.equal(on.freshness.calendarConfigured, true, 'one included source is enough');
  } finally {
    await h.stop();
  }
});
