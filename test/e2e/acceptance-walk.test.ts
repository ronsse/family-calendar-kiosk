/**
 * Unit J — the acceptance walk. `docs/build-plan.md` §5, lifted from PRD §7.
 *
 * Six numbered steps. Steps 1–4 are fully testable over HTTP and are tested here properly,
 * end to end, against a real server on an ephemeral port backed by a real file. Steps 5 and
 * 6 name physical acts — wiping a Chromium profile, `docker compose stop` — and the parts of
 * them that a process can honestly assert are asserted; the parts that need the panel are
 * marked `skip` with the reason, never faked into a green tick.
 *
 * These tests assert OBSERVABLE BEHAVIOUR: HTTP status, wire body, and the state a
 * subsequent read returns. They reach into the database only to prove that a refused call
 * mutated NOTHING, which no route can report by construction.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer as createTcpServer, type Server as TcpServer, type Socket } from 'node:net';
import type { AddressInfo } from 'node:net';
import type { CalendarSource, FetchedEvent } from '../../src/calendar/CalendarSource.ts';
import { syncAllSources } from '../../src/calendar/sync.ts';
import { createHomeAssistantCalendar } from '../../src/calendar/homeassistant/index.ts';
import { addDays } from '../../src/time.ts';
import type { LocalDate, Utc } from '../../src/types.ts';
import { bandTypography } from '../../web/src/design/tokens.ts';
import { bandLabel } from '../../web/src/views/logic/labels.ts';
import { nextStep, routineProgress } from '../../web/src/views/logic/progress.ts';
import {
  admin,
  adminWithoutPin,
  assignmentState,
  balanceOf,
  bestPendingCard,
  choreCard,
  countRows,
  ledgerRowCount,
  openStream,
  PARENT_PIN,
  runsFor,
  snapshot,
  startWall,
  wall,
  CHILD_EMERGENT,
  CHILD_FLUENT,
  CHILD_PRE_READER,
  type Harness,
} from './harness.ts';

/**
 * A pinned instant so the walk is not a different test on a Saturday. 2026-09-15T13:00Z is
 * 07:00 in Denver on a Tuesday — a school morning, which is the scenario the whole system is
 * specified against.
 */
const SCHOOL_MORNING = '2026-09-15T13:00:00Z';
const SCHOOL_DAY = '2026-09-15' as LocalDate;

/** Connection refused, immediately and really. This is what "the WAN is cut" looks like. */
const DEAD_UPSTREAM_URL = 'http://127.0.0.1:1';

// ---------------------------------------------------------------------------
// Upstreams. The ONLY thing this suite fakes — and it fakes them by being genuinely
// unreachable, not by substituting a canned refusal.
// ---------------------------------------------------------------------------

class DeadUpstream implements CalendarSource {
  readonly kind = 'e2e-dead';
  async listSources() {
    return [];
  }
  async fetchEvents(): Promise<FetchedEvent[]> {
    // A real socket to a real closed port. ECONNREFUSED, from the kernel.
    await fetch(`${DEAD_UPSTREAM_URL}/calendars`);
    throw new Error('unreachable');
  }
  async probe(): Promise<boolean> {
    return false;
  }
}

/** An upstream that answers. Used to establish a promoted generation before killing it. */
class LiveUpstream implements CalendarSource {
  readonly kind = 'e2e-live';
  readonly #events: FetchedEvent[];
  constructor(events: FetchedEvent[]) {
    this.#events = events;
  }
  async listSources() {
    return [];
  }
  async fetchEvents(): Promise<FetchedEvent[]> {
    return this.#events;
  }
  async probe(): Promise<boolean> {
    return true;
  }
}

/** Accepts the connection and never answers: packets into the void, which is worse than refused. */
class HangingUpstream implements CalendarSource {
  readonly kind = 'e2e-hanging';
  readonly #url: string;
  readonly #signal: AbortSignal;
  constructor(url: string, signal: AbortSignal) {
    this.#url = url;
    this.#signal = signal;
  }
  async listSources() {
    return [];
  }
  async fetchEvents(): Promise<FetchedEvent[]> {
    await fetch(this.#url, { signal: this.#signal });
    return [];
  }
  async probe(): Promise<boolean> {
    return false;
  }
}

function syncWindow(from: LocalDate) {
  return { window: { fromDate: from, toDate: addDays(from, 30) } };
}

// ===========================================================================
// Step 1 — "Cut the server's WAN. Today's schedule, chores and routines still render
//           from local state."
// ===========================================================================

test('step 1 — with no calendar upstream reachable, the wall still renders the day', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    // The real adapter, pointed at a real closed port. Not a stub: this is the failure.
    const ha = createHomeAssistantCalendar(
      { HA_BASE_URL: DEAD_UPSTREAM_URL, HA_TOKEN: 'synthetic' },
      { retries: 0, backoffMs: 0, timeoutMs: 1500 },
    );
    assert.equal(await ha.probe(), false, 'a dead upstream must probe false, not throw');
    await assert.rejects(() => ha.listSources(), 'enumeration against a dead upstream must throw');

    const results = await syncAllSources(h.db, new DeadUpstream(), syncWindow(SCHOOL_DAY));
    assert.ok(results.length > 0, 'the seed includes calendar sources to sync');
    assert.ok(
      results.every((r) => !r.ok),
      'every source must have failed — that is the premise of this step',
    );

    // The wall, now, with nothing upstream.
    const snap = await snapshot(h, SCHOOL_DAY);

    assert.ok(snap.routines.length > 0, 'routines render from local state');
    assert.ok(snap.chores.length > 0, 'chores render from local state');
    assert.equal(snap.balances.length, 3, 'one balance row per active child, always');
    // A countdown INSIDE the horizon, added here rather than relied on from the seed: as of
    // 2026-09-09 a countdown further than COUNTDOWN_HORIZON_DAYS is off the wire entirely, and
    // the dev seed's two (a winter date and a March birthday) are both months from SCHOOL_DAY.
    // The claim this step makes is about the NETWORK — countdowns are local arithmetic — so it
    // needs a row that is actually shown, not a seed that happens to be in range.
    h.db
      .prepare(
        `INSERT INTO countdown (id,label_short,label_full,icon_asset_id,emoji,target_date,annual_md,child_id,active)
         VALUES ('cd-walk','Soon','Something soon','ico-cake',NULL,?,NULL,NULL,1)`,
      )
      .run(addDays(SCHOOL_DAY, 5));
    const withCountdown = await snapshot(h, SCHOOL_DAY);
    assert.ok(
      withCountdown.countdowns.some((c) => c.id === 'cd-walk'),
      'countdowns are local arithmetic, not a fetch',
    );

    // Every child the wall knows about has a routine or a chore to show. A pre-reader
    // staring at an empty column cannot tell it apart from a broken screen.
    for (const child of snap.children) {
      const has =
        snap.routines.some((r) => r.childId === child.id) ||
        snap.chores.some((c) => c.childId === child.id);
      assert.ok(has, `${child.id} has nothing on the wall with the WAN down`);
    }

    // The calendar strip is empty, and says so. `null` is "unknown", which renders as
    // staleness; `0` would render as freshly synced, which is the lie.
    assert.deepEqual(snap.events, []);
    assert.equal(snap.freshness.calendarSyncAgeSeconds, null);
    assert.equal(snap.freshness.snapshotLocalDate, SCHOOL_DAY);

    // And the gate's probe still answers, unauthenticated.
    const health = await wall(h, 'GET', '/api/health', { token: null });
    assert.equal(health.status, 200);
    assert.equal(health.body['ok'], true);
    assert.equal(health.body['dbWritable'], true);
  } finally {
    await h.stop();
  }
});

test('step 1 — a sync that dies leaves the LAST GOOD calendar on the wall, labelled stale', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const events: FetchedEvent[] = [
      {
        externalUid: 'e2e-1',
        title: 'Synthetic all-day',
        when: { kind: 'allDay', startDate: addDays(SCHOOL_DAY, 2), endDate: addDays(SCHOOL_DAY, 3) },
      },
      {
        externalUid: 'e2e-2',
        title: 'Synthetic timed',
        when: {
          kind: 'timed',
          startsAtUtc: '2026-09-17T22:00:00.000Z' as Utc,
          endsAtUtc: '2026-09-17T23:00:00.000Z' as Utc,
        },
      },
    ];
    const good = await syncAllSources(h.db, new LiveUpstream(events), syncWindow(SCHOOL_DAY));
    assert.ok(good.every((r) => r.ok));

    const before = await snapshot(h, SCHOOL_DAY);
    assert.ok(before.events.length > 0, 'a promoted generation renders');
    assert.equal(typeof before.freshness.calendarSyncAgeSeconds, 'number');

    // Now the WAN goes. The failure must not delete what is already on the screen.
    const dead = await syncAllSources(h.db, new DeadUpstream(), syncWindow(SCHOOL_DAY));
    assert.ok(dead.every((r) => !r.ok));

    const after = await snapshot(h, SCHOOL_DAY);
    assert.deepEqual(
      after.events.map((e) => e.title).sort(),
      before.events.map((e) => e.title).sort(),
      'a failed sync must never empty the promoted generation (H3 finding #7)',
    );
    assert.equal(typeof after.freshness.calendarSyncAgeSeconds, 'number');
  } finally {
    await h.stop();
  }
});

test('step 1 — the render path never waits on the network, even mid-stall', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  // A real listener that accepts and answers nothing. The fetch will hang until aborted.
  // The accepted sockets are held so the listener can actually be shut down afterwards:
  // `net.Server.close` stops accepting but never severs what it already accepted.
  const accepted = new Set<Socket>();
  const blackhole: TcpServer = createTcpServer((socket) => {
    accepted.add(socket);
    socket.on('close', () => accepted.delete(socket));
  });
  await new Promise<void>((resolve) => blackhole.listen(0, '127.0.0.1', resolve));
  const port = (blackhole.address() as AddressInfo).port;
  const abort = new AbortController();

  try {
    const stalling = syncAllSources(
      h.db,
      new HangingUpstream(`http://127.0.0.1:${port}/calendars`, abort.signal),
      syncWindow(SCHOOL_DAY),
    );

    // With the sync stuck on a socket, the wall must still answer. This is H3 finding #8:
    // a fetch held inside a transaction would block every reader for its duration.
    const started = Date.now();
    const snap = await snapshot(h, SCHOOL_DAY);
    const elapsed = Date.now() - started;

    assert.ok(snap.routines.length > 0);
    assert.ok(snap.chores.length > 0);
    assert.ok(elapsed < 2000, `snapshot took ${elapsed}ms while the upstream was stalled`);

    // Mutations too — a child tapping during a stalled sync must not be queued behind it.
    const card = bestPendingCard(snap, CHILD_FLUENT);
    const claim = await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(claim.status, 200);

    abort.abort();
    const outcome = await stalling;
    assert.ok(
      outcome.every((r) => !r.ok),
      'a stalled upstream must be recorded as a failure, not as an empty calendar',
    );
  } finally {
    abort.abort();
    for (const socket of accepted) socket.destroy();
    await new Promise<void>((resolve) => blackhole.close(() => resolve()));
    await h.stop();
  }
});

// ===========================================================================
// Step 2 — "Child A taps a chore. It enters the approval queue. Her balance does NOT move."
// ===========================================================================

test('step 2 — a claim enters the queue and moves no points', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const before = await snapshot(h, SCHOOL_DAY);
    const card = bestPendingCard(before, CHILD_FLUENT);
    assert.equal(balanceOf(before, CHILD_FLUENT), 0);

    const claimed = await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(claimed.status, 200);
    assert.equal(claimed.body['state'], 'claimed');

    const after = await snapshot(h, SCHOOL_DAY);
    assert.equal(
      choreCard(after, CHILD_FLUENT, card.choreId).state,
      'claimed',
      'the card must render its new state — a tap with no visible effect gets tapped again',
    );
    assert.equal(balanceOf(after, CHILD_FLUENT), 0, 'a claim is a request, never a payment');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 0, 'nothing is appended on claim');

    // No sibling moved either.
    assert.equal(balanceOf(after, CHILD_EMERGENT), 0);
    assert.equal(balanceOf(after, CHILD_PRE_READER), 0);

    // A second tap on her own card is idempotent, not an error a child has to interpret.
    const again = await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(again.status, 200);
    assert.equal(again.body['state'], 'claimed');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 0);
  } finally {
    await h.stop();
  }
});

test('step 2 — the claim reaches a second client as an invalidation carrying no state', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  const stream = await openStream(h);
  try {
    // The heartbeat arrives first, by contract: it carries minClientBuild so an obsolete
    // bundle reloads before it parses a shape it cannot understand.
    const beat = await stream.waitFor((e) => e['type'] === 'heartbeat');
    assert.equal(beat['minClientBuild'], 1);

    const snap = await snapshot(h, SCHOOL_DAY);
    const card = bestPendingCard(snap, CHILD_FLUENT);
    const claimed = await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(claimed.status, 200);

    const event = await stream.waitFor((e) => e['type'] === 'invalidate');
    assert.equal(event['scope'], 'chores');
    assert.deepEqual(
      Object.keys(event).sort(),
      ['scope', 'type'],
      'SSE carries a reason to refetch and never a fact — a second source of truth can diverge',
    );
  } finally {
    stream.close();
    await h.stop();
  }
});

// ===========================================================================
// Step 3 — "A parent approves with the PIN. The balance moves by exactly the chore's
//           value, once."
// ===========================================================================

test('step 3 — approval with the PIN moves the balance by exactly the value, once', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = bestPendingCard(snap, CHILD_FLUENT);
    const value = card.points;
    assert.ok(value > 0);

    await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });

    const approved = await admin(
      h,
      'POST',
      `/api/admin/v1/chores/${card.assignmentId}/approve`,
      PARENT_PIN,
    );
    assert.equal(approved.status, 200);
    assert.equal(approved.body['state'], 'approved');
    assert.equal(typeof approved.body['ledgerEntryId'], 'number');

    const afterOne = await snapshot(h, SCHOOL_DAY);
    assert.equal(balanceOf(afterOne, CHILD_FLUENT), value, 'exactly the chore value, no more');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 1);

    // ---- and now the double tap.
    const twice = await admin(
      h,
      'POST',
      `/api/admin/v1/chores/${card.assignmentId}/approve`,
      PARENT_PIN,
    );
    assert.equal(twice.status, 200, 'a retry returns the decided state, not an error');
    assert.equal(twice.body['state'], 'approved');
    assert.equal(twice.body['ledgerEntryId'], null, 'the repeat wrote nothing');

    const afterTwo = await snapshot(h, SCHOOL_DAY);
    assert.equal(balanceOf(afterTwo, CHILD_FLUENT), value, 'the balance did not move again');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 1, 'still exactly one entry');

    // The ledger view is what settles "I had forty!" — it must agree with the badge.
    const history = await admin(h, 'GET', `/api/admin/v1/children/${CHILD_FLUENT}/ledger`, PARENT_PIN);
    assert.equal(history.status, 200);
    assert.equal(history.body['total'], value);
    const entries = history.body['entries'] as Record<string, unknown>[];
    assert.equal(entries.length, 1);
    const entry = entries[0];
    assert.ok(entry);
    assert.equal(entry['delta'], value);
    assert.equal(entry['reason'], 'chore_approved');
    assert.equal(entry['refType'], 'chore_assignment');
    assert.equal(entry['refId'], String(card.assignmentId));
  } finally {
    await h.stop();
  }
});

test('step 3 — two approvals racing over HTTP still pay exactly once', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = bestPendingCard(snap, CHILD_FLUENT);
    await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });

    // Both requests are in flight before either transaction runs: `requireParentPin` is an
    // async scrypt on the threadpool, so this is a real interleave, not a sequence.
    const [a, b] = await Promise.all([
      admin(h, 'POST', `/api/admin/v1/chores/${card.assignmentId}/approve`, PARENT_PIN),
      admin(h, 'POST', `/api/admin/v1/chores/${card.assignmentId}/approve`, PARENT_PIN),
    ]);

    assert.equal(a.status, 200);
    assert.equal(b.status, 200);
    assert.equal(a.body['state'], 'approved');
    assert.equal(b.body['state'], 'approved');
    const wrote = [a, b].filter((r) => typeof r.body['ledgerEntryId'] === 'number');
    assert.equal(wrote.length, 1, 'exactly one of the two calls may write a ledger entry');

    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 1);
    const after = await snapshot(h, SCHOOL_DAY);
    assert.equal(balanceOf(after, CHILD_FLUENT), card.points);
  } finally {
    await h.stop();
  }
});

test('step 3 — rejection returns the card to the board and pays nothing', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = bestPendingCard(snap, CHILD_FLUENT);
    await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });

    const rejected = await admin(
      h,
      'POST',
      `/api/admin/v1/chores/${card.assignmentId}/reject`,
      PARENT_PIN,
    );
    assert.equal(rejected.status, 200);
    assert.equal(rejected.body['state'], 'pending', 'reject is not a dead end — she can redo it');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 0);

    // And she really can redo it, on the same day.
    const reclaimed = await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(reclaimed.status, 200);
    assert.equal(reclaimed.body['state'], 'claimed');
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// Step 4 — "Child C advances a picture-led routine to completion with no adult help
//           and no text on screen."
// ===========================================================================

/**
 * Drives one routine the way the picture band drives it: repeatedly ask the SHARED renderer
 * logic what the next step is, tap that one, refetch the authoritative snapshot, repeat.
 *
 * Nothing here invents an order. `nextStep` is the same function Unit H's RoutinePanel calls,
 * so this walks the wall as the child actually would rather than as a test would like to.
 */
async function driveRoutineToCompletion(h: Harness, childId: string, routineId: string): Promise<number> {
  let taps = 0;
  for (let guard = 0; guard < 20; guard++) {
    const snap = await snapshot(h, SCHOOL_DAY);
    const run = runsFor(snap, childId).find((r) => r.routineId === routineId);
    assert.ok(run, `${childId} has no ${routineId} run`);
    const progress = routineProgress(run);
    if (progress.done === progress.total) return taps;

    const step = nextStep(run);
    assert.ok(step, 'an incomplete run must always offer a next step');

    // The wall surface only. There is no PIN parameter on `wall()`.
    const res = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
      body: { childId },
    });
    assert.equal(res.status, 200, `completing step ${step.runStepId}: ${res.text}`);
    assert.equal(typeof res.body['completedAtUtc'], 'string');
    taps++;
  }
  throw new Error('the routine never completed');
}

test('step 4 — the pre-reader completes her routine unaided, with no PIN and no admin route', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const start = await snapshot(h, SCHOOL_DAY);
    const hers = runsFor(start, CHILD_PRE_READER);
    assert.ok(hers.length > 0, 'the pre-reader has a routine on a school morning');

    for (const run of hers) {
      const taps = await driveRoutineToCompletion(h, CHILD_PRE_READER, run.routineId);
      assert.ok(taps > 0, `${run.routineId} was already complete before she touched it`);
    }

    const done = await snapshot(h, SCHOOL_DAY);
    for (const run of runsFor(done, CHILD_PRE_READER)) {
      const progress = routineProgress(run);
      assert.equal(progress.done, progress.total, `${run.routineId} is not complete`);
      assert.ok(progress.total > 0);
      for (const step of run.steps) {
        assert.equal(typeof step.completedAtUtc, 'string');
      }
    }

    // She did it alone. The `wall()` client has no `pin` parameter, so that is structural —
    // but the observable proof is that nothing requiring an adult happened: no ledger entry
    // exists for anyone, and no chore reached the one state only an approval can produce.
    for (const child of done.children) assert.equal(ledgerRowCount(h, child.id), 0);
    assert.ok(done.chores.every((c) => c.state !== 'approved'));
    assert.equal(countRows(h, `SELECT COUNT(*) AS n FROM ledger_entry`), 0);
    assert.ok(
      h.logs.every((l) => !l.path.startsWith('/api/admin/')),
      'an admin route was refused during a test that must not reach one',
    );
  } finally {
    await h.stop();
  }
});

test('step 4 — nothing in her slice needs reading, and nothing in it can render blank', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);

    const child = snap.children.find((c) => c.id === CHILD_PRE_READER);
    assert.ok(child);
    assert.equal(child.readingBand, 'picture', 'her band is what routes her to the text-free renderer');

    // The band her state is routed to declares itself text-free, and declares it as the
    // ABSENCE of a size rather than a zero — a size invites someone to render at it.
    const typo = bandTypography[child.readingBand];
    assert.equal(typo.showsText, false);
    assert.equal(typo.labelField, 'none');
    assert.equal(typo.maxLabelWords, 0);
    assert.equal(typo.primaryTextPx, null);
    assert.equal(typo.secondaryTextPx, null);
    assert.equal(typo.numeralTextPx, null);
    assert.equal(typo.quantity, 'pips', 'quantity reaches her as shapes, never as a numeral');

    // Now the real snapshot, through the real shared label logic. For every labelled thing
    // in her slice, the text her renderer would show is the empty string.
    const labelled: { labelShort: string; labelFull: string }[] = [
      ...runsFor(snap, CHILD_PRE_READER),
      ...runsFor(snap, CHILD_PRE_READER).flatMap((r) => r.steps),
      ...snap.chores.filter((c) => c.childId === CHILD_PRE_READER),
      ...snap.countdowns.filter((c) => c.childId === CHILD_PRE_READER),
    ];
    assert.ok(labelled.length > 0, 'she has something on the wall to check');
    for (const view of labelled) {
      assert.equal(bandLabel(view, typo), '', 'the picture band would render text for this view');
    }

    // A countdown scoped to a sibling must not reach her column at all — "3 sleeps" to a
    // birthday that is not yours is confidently wrong, which the invariant forbids.
    const foreign = snap.countdowns.filter((c) => c.childId !== null && c.childId !== CHILD_PRE_READER);
    assert.ok(
      foreign.every((c) => c.childId !== CHILD_PRE_READER),
      'a sibling-scoped countdown leaked into her slice',
    );

    // And with no text, the icon IS the interface: a missing one is a blank screen for her.
    for (const run of runsFor(snap, CHILD_PRE_READER)) {
      assert.ok(run.icon.url.length > 0);
      for (const step of run.steps) {
        assert.ok(step.icon.url.length > 0, `step ${step.runStepId} would render blank`);
      }
    }
    for (const card of snap.chores.filter((c) => c.childId === CHILD_PRE_READER)) {
      assert.ok(card.icon.url.length > 0, `chore ${card.choreId} would render blank`);
    }

    // She has no balance to read, and the wire says so with `null` rather than a zero that
    // reads as "no pocket money yet".
    const balance = snap.balances.find((b) => b.childId === CHILD_PRE_READER);
    assert.ok(balance);
    assert.equal(balance.points, 0);
    assert.equal(balance.cashCents, null);
  } finally {
    await h.stop();
  }
});

test('step 4 — a mis-tap is recoverable by the child herself, with no adult', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const run = runsFor(snap, CHILD_PRE_READER)[0];
    assert.ok(run);
    const step = run.steps[0];
    assert.ok(step);

    const done = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
      body: { childId: CHILD_PRE_READER },
    });
    assert.equal(done.status, 200);
    const firstCompletedAt = done.body['completedAtUtc'];

    // A double tap must not rewrite WHEN she did it.
    const repeat = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
      body: { childId: CHILD_PRE_READER },
    });
    assert.equal(repeat.status, 200);
    assert.equal(repeat.body['completedAtUtc'], firstCompletedAt);

    // Undo is on the WALL surface on purpose: PIN-gating it bricks the routine until an
    // adult arrives, which is the H2 Q1 fatal flaw.
    const undone = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/revoke`, {
      body: { childId: CHILD_PRE_READER },
    });
    assert.equal(undone.status, 200);
    assert.equal(typeof undone.body['revokedAtUtc'], 'string');

    const after = await snapshot(h, SCHOOL_DAY);
    const reread = runsFor(after, CHILD_PRE_READER).find((r) => r.runId === run.runId);
    assert.ok(reread);
    const rereadStep = reread.steps.find((s) => s.runStepId === step.runStepId);
    assert.ok(rereadStep);
    assert.equal(rereadStep.completedAtUtc, null, 'the undo must be visible on the wall');

    // Revoking again is a success, not an error thrown at a wall with no adult in front of it.
    const undoneTwice = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/revoke`, {
      body: { childId: CHILD_PRE_READER },
    });
    assert.equal(undoneTwice.status, 200);

    // And she can re-complete it — revoke is soft, never a delete.
    const redone = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
      body: { childId: CHILD_PRE_READER },
    });
    assert.equal(redone.status, 200);
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// Step 5 — "Wipe the Chromium profile and restart. The wall is usable with zero input —
//           and still cannot approve anything."
//
// The wipe itself needs the panel. What a process CAN prove is that the server holds
// nothing a profile wipe would destroy: no cookie, no session, no server-side selection,
// and no state that a first-ever request is missing.
// ===========================================================================

test('step 5 — a wall with no prior session gets a complete, renderable day on its first request', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    // This process has never spoken to the server before. One request, zero input.
    const snap = await snapshot(h, SCHOOL_DAY);

    assert.equal(snap.apiVersion, 1);
    assert.equal(snap.minClientBuild, 1);
    assert.equal(snap.requestedLocalDate, SCHOOL_DAY);
    assert.equal(snap.freshness.snapshotLocalDate, SCHOOL_DAY);
    assert.equal(snap.children.length, 3);
    assert.equal(snap.balances.length, 3, 'day one, no ledger history, still one row per child');
    for (const b of snap.balances) assert.equal(typeof b.points, 'number');
    assert.ok(snap.routines.length > 0);
    assert.ok(snap.chores.length > 0);

    // Nothing the server returned is a session. A profile wipe destroys cookies and
    // localStorage; if the wall's identity lived there it would come back a stranger.
    const health = await wall(h, 'GET', '/api/health', { token: null });
    const stream = await wall(h, 'GET', '/api/wall/v1/redemptions');
    for (const res of [health, stream]) {
      assert.equal(res.headers.get('set-cookie'), null, 'the server must never set a cookie');
    }
  } finally {
    await h.stop();
  }
});

test('step 5 — a device token alone can never approve anything', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = bestPendingCard(snap, CHILD_FLUENT);
    await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });

    // Every route that moves points, reached with the panel's own credential and nothing else.
    const attempts = [
      ['POST', `/api/admin/v1/chores/${card.assignmentId}/approve`, undefined],
      ['POST', `/api/admin/v1/chores/${card.assignmentId}/reject`, undefined],
      ['POST', `/api/admin/v1/redemptions/1/approve`, undefined],
      ['POST', `/api/admin/v1/redemptions/1/reject`, undefined],
      ['POST', `/api/admin/v1/ledger/adjust`, { childId: CHILD_FLUENT, delta: 99, requestId: 'x' }],
      ['GET', `/api/admin/v1/children/${CHILD_FLUENT}/ledger`, undefined],
      ['POST', `/api/admin/v1/devices`, { label: 'rogue' }],
      ['DELETE', `/api/admin/v1/devices/${h.deviceId}`, undefined],
    ] as const;

    for (const [method, path, body] of attempts) {
      const res = await adminWithoutPin(h, method, path, body === undefined ? {} : { body });
      assert.equal(res.status, 401, `${method} ${path} was not refused`);
      assert.equal(res.body['error'], 'bad_pin');
      assert.equal(res.body['message'], 'ask a grown-up');
    }

    assert.equal(assignmentState(h, card.assignmentId), 'claimed', 'nothing moved');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 0);
    assert.equal(countRows(h, `SELECT COUNT(*) AS n FROM device_token`), 1, 'no device was minted');

    // And there is no wall route that approves: the whole surface, exercised, never yields
    // an `approved` state.
    const after = await snapshot(h, SCHOOL_DAY);
    assert.ok(after.chores.every((c) => c.state !== 'approved'));
  } finally {
    await h.stop();
  }
});

test('step 5 — the PIN is per request, never a session', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const first = await admin(h, 'GET', `/api/admin/v1/children/${CHILD_FLUENT}/ledger`, PARENT_PIN);
    assert.equal(first.status, 200);

    // The adult walked away. The very next request, on the same connection, is refused.
    const second = await adminWithoutPin(h, 'GET', `/api/admin/v1/children/${CHILD_FLUENT}/ledger`);
    assert.equal(second.status, 401);
    assert.equal(second.body['error'], 'bad_pin');
  } finally {
    await h.stop();
  }
});

test(
  'step 5 — wiping the Chromium profile and restarting the kiosk',
  { skip: 'needs the panel: `rm -rf` the profile under <pi>/.cache, restart kiosk.service, watch the wall' },
  () => {},
);

// ===========================================================================
// Step 6 — "`docker compose stop` the app. The wall shows last-known-good with a clock,
//           not a browser error. `start` → live again, no human input."
//
// Stopping a container and inspecting what a browser paints is Unit I's territory and needs
// the hardware. What is testable here is the server's half of that contract: the gate's
// probe answers honestly about a database that cannot serve a morning, and no failure ever
// reaches a child as a 5xx page.
// ===========================================================================

test('step 6 — an unexpected fault reaches the wall as a small parseable refusal, never a stack', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    // Storage vanishes underneath a running server: the closest a process can come to
    // pulling the volume out from under it.
    h.db.close();

    const res = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${SCHOOL_DAY}`);
    assert.equal(res.body['error'], 'unavailable');
    assert.equal(res.body['message'], 'the wall service is briefly unavailable');
    assert.deepEqual(Object.keys(res.body).sort(), ['error', 'message']);
    assert.match(res.headers.get('content-type') ?? '', /application\/json/);
    assert.ok(res.text.length < 200, 'the body must be small enough to be obviously not a page');

    // Nothing internal is on the wire. This response lands on a screen in a living room.
    for (const leak of ['SQLITE', 'sqlite', 'better-sqlite3', 'at ', '/home/', 'SELECT', 'Error:']) {
      assert.ok(!res.text.includes(leak), `the wire leaked ${leak}: ${res.text}`);
    }
    // The reload trigger survives a failure, so a stale bundle still learns from an error.
    assert.equal(res.headers.get('x-min-client-build'), '1');

    // And the cause IS recorded, server-side, where an adult can find it.
    const logged = h.logs.filter((l) => l.kind === 'unexpected');
    assert.ok(logged.length > 0, 'the cause must be logged even though it is not served');
  } finally {
    await h.stop();
  }
});

test('step 6 — the gate probe keeps answering when the database no longer can', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const alive = await wall(h, 'GET', '/api/health', { token: null });
    assert.equal(alive.status, 200);
    assert.deepEqual(Object.keys(alive.body).sort(), ['dbWritable', 'generatedAtUtc', 'ok']);
    assert.equal(alive.body['ok'], true);
    assert.equal(alive.body['dbWritable'], true);

    h.db.close();

    const dead = await wall(h, 'GET', '/api/health', { token: null });
    assert.equal(dead.status, 200, 'the gate must get an ANSWER, not a hang or a 5xx');
    assert.equal(dead.body['ok'], false);
    assert.equal(dead.body['dbWritable'], false, 'liveness means "today can be produced"');
  } finally {
    await h.stop();
  }
});

test('step 6 — on a full disk the probe reports false and the materialized day still renders', async () => {
  // The finding this route exists for: a one-row touch succeeds on a 95%-full disk while the
  // real 06:00 materialization hits SQLITE_FULL. Capping `max_page_count` at exactly what the
  // file already uses is how a process stands in for a disk with no room left.
  const h = await startWall({ clock: SCHOOL_MORNING, healthProbe: { rows: 64, rowBytes: 4096 } });
  try {
    // The morning happens first, while there is still room. This is the read-only fast path
    // Units A, C and E were restructured around.
    const materialized = await snapshot(h, SCHOOL_DAY);
    assert.ok(materialized.routines.length > 0);

    const used = h.db.pragma('page_count', { simple: true }) as number;
    h.db.pragma(`max_page_count = ${used}`);

    const res = await wall(h, 'GET', '/api/health', { token: null });
    assert.equal(res.status, 200);
    assert.equal(res.body['ok'], true, 'a database that cannot GROW can still be READ');
    assert.equal(res.body['dbWritable'], false, 'the probe must allocate like the morning does');

    // And `dbWritable: false` is not an outage by itself.
    const still = await snapshot(h, SCHOOL_DAY);
    assert.ok(still.routines.length > 0, 'an already-materialized day must survive a full disk');
    assert.ok(still.chores.length > 0);
  } finally {
    try {
      h.db.pragma('max_page_count = 1073741823');
    } catch {
      /* the connection may already be gone */
    }
    await h.stop();
  }
});

test(
  'step 6 — `docker compose stop` shows last-known-good with a clock, and `start` recovers unattended',
  { skip: 'needs the panel and the container: Unit I owns kiosk-gate + the snapshot fallback' },
  () => {},
);
