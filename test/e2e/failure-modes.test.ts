/**
 * Unit J — the failure modes, attempted end to end.
 *
 * H1, H2 and H3 each named a way this wall goes wrong at 6:00 AM. Every unit then built a
 * defence and tested it in isolation. This file attacks the ASSEMBLED system over HTTP,
 * because a defence that holds in a unit test and leaks at a seam is worse than no defence:
 * it is a green suite that lies.
 *
 * Each test is named for the failure it is trying to cause, not for the code it exercises.
 * If one of these ever goes red, read it as "the wall is wrong at 6:00 AM", not as "a test
 * broke".
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../../src/db/connection.ts';
import type { CalendarSource, FetchedEvent } from '../../src/calendar/CalendarSource.ts';
import { syncAllSources } from '../../src/calendar/sync.ts';
import { addDays } from '../../src/time.ts';
import type { LocalDate, WallSnapshot } from '../../src/types.ts';
import { routineProgress } from '../../web/src/views/logic/progress.ts';
import {
  admin,
  assignmentState,
  balanceOf,
  choreCard,
  countRows,
  ledgerRowCount,
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

const SCHOOL_MORNING = '2026-09-15T13:00:00Z';
const SCHOOL_DAY = '2026-09-15' as LocalDate;
const NEXT_MORNING = '2026-09-16T13:00:00Z';
const NEXT_DAY = '2026-09-16' as LocalDate;

/** Claim and approve one card, and return what it paid. */
async function earn(h: Harness, childId: string, assignmentId: number): Promise<void> {
  const claim = await wall(h, 'POST', `/api/wall/v1/chores/${assignmentId}/claim`, {
    body: { childId },
  });
  assert.equal(claim.status, 200, `claim failed: ${claim.text}`);
  const approve = await admin(h, 'POST', `/api/admin/v1/chores/${assignmentId}/approve`, PARENT_PIN);
  assert.equal(approve.status, 200, `approve failed: ${approve.text}`);
}

function materializedDays(h: Harness, date: LocalDate): number {
  return (
    countRows(h, `SELECT COUNT(*) AS n FROM chore_day WHERE local_date = ?`, [date]) +
    countRows(h, `SELECT COUNT(*) AS n FROM routine_run WHERE local_date = ?`, [date])
  );
}

// ===========================================================================
// The date the client asserts, and the date the server thinks it is
// ===========================================================================

test('a localDate the server disagrees with: inside the window the CLIENT wins', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    assert.equal(h.serverToday(), SCHOOL_DAY);

    for (const asked of [addDays(SCHOOL_DAY, -1), SCHOOL_DAY, addDays(SCHOOL_DAY, 1)]) {
      const res = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${asked}`);
      assert.equal(res.status, 200, `${asked} was refused: ${res.text}`);
      const snap = res.body as unknown as WallSnapshot;
      assert.equal(snap.requestedLocalDate, asked, 'the echo must be the date that was asked for');
      assert.equal(
        snap.freshness.snapshotLocalDate,
        asked,
        'the server must never quietly answer with a different day (H1 lens 3)',
      );
      assert.ok(snap.routines.every((r) => r.localDate === asked));
      assert.ok(snap.chores.every((c) => c.localDate === asked));
    }
  } finally {
    await h.stop();
  }
});

test('a localDate far outside the window is refused AND materializes nothing', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    // A kiosk with a dead RTC. Building the date it asks for would write a routine run and a
    // chore day for a date nothing will ever read again.
    for (const absurd of ['2000-01-01', '2099-12-31', addDays(SCHOOL_DAY, 2), addDays(SCHOOL_DAY, -2)]) {
      const res = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${absurd}`);
      assert.equal(res.status, 409, `${absurd} was built`);
      assert.equal(res.body['error'], 'date_mismatch');
      assert.equal(materializedDays(h, absurd as LocalDate), 0, `${absurd} was materialized anyway`);
    }
  } finally {
    await h.stop();
  }
});

test('a missing or malformed localDate is date_mismatch, never a 5xx and never the server clock', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const paths = [
      '/api/wall/v1/snapshot',
      '/api/wall/v1/snapshot?localDate=',
      '/api/wall/v1/snapshot?localDate=today',
      '/api/wall/v1/snapshot?localDate=2026-13-45',
      '/api/wall/v1/snapshot?localDate=15-09-2026',
      '/api/wall/v1/snapshot?localDate=2026-09-15T13:00:00Z',
    ];
    for (const path of paths) {
      const res = await wall(h, 'GET', path);
      assert.equal(res.status, 409, `${path} returned ${res.status}`);
      assert.equal(res.body['error'], 'date_mismatch', path);
      assert.ok(res.status < 500, 'no 5xx is ever rendered to a child');
    }
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// Two children racing the same first_complete chore
// ===========================================================================

test('two children racing a first_complete chore: one claim, one refusal, one payment', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const a = choreCard(snap, CHILD_FLUENT, 'ch-pet');
    const b = choreCard(snap, CHILD_EMERGENT, 'ch-pet');
    const c = choreCard(snap, CHILD_PRE_READER, 'ch-pet');
    const value = a.points;

    const [resA, resB] = await Promise.all([
      wall(h, 'POST', `/api/wall/v1/chores/${a.assignmentId}/claim`, { body: { childId: CHILD_FLUENT } }),
      wall(h, 'POST', `/api/wall/v1/chores/${b.assignmentId}/claim`, { body: { childId: CHILD_EMERGENT } }),
    ]);

    const winners = [resA, resB].filter((r) => r.status === 200);
    const losers = [resA, resB].filter((r) => r.status !== 200);
    assert.equal(winners.length, 1, 'exactly one child may win the race');
    assert.equal(losers.length, 1);
    const winner = winners[0];
    const loser = losers[0];
    assert.ok(winner && loser);
    assert.equal(winner.body['state'], 'claimed');
    assert.equal(loser.status, 409);
    assert.equal(
      loser.body['error'],
      'already_claimed',
      'losing a race is expected, not "the button is broken"',
    );

    // The whole day resolved in one transaction: nobody is left pending.
    const states = [a, b, c].map((card) => assignmentState(h, card.assignmentId));
    assert.equal(states.filter((s) => s === 'claimed').length, 1);
    assert.equal(states.filter((s) => s === 'superseded').length, 2);
    assert.equal(states.filter((s) => s === 'pending').length, 0);

    // The losers' cards still RENDER. A card that vanishes is indistinguishable from a
    // broken board to a child who was looking straight at it.
    const after = await snapshot(h, SCHOOL_DAY);
    for (const card of [a, b, c]) {
      const rendered = after.chores.find((x) => x.assignmentId === card.assignmentId);
      assert.ok(rendered, `card ${card.assignmentId} disappeared from the wall`);
    }

    // Read back who actually won, then retry the loss: it must stay a loss.
    const held = [
      { card: a, childId: CHILD_FLUENT },
      { card: b, childId: CHILD_EMERGENT },
    ];
    const won = held.find((x) => assignmentState(h, x.card.assignmentId) === 'claimed');
    const lost = held.find((x) => assignmentState(h, x.card.assignmentId) === 'superseded');
    assert.ok(won && lost);

    const retry = await wall(h, 'POST', `/api/wall/v1/chores/${lost.card.assignmentId}/claim`, {
      body: { childId: lost.childId },
    });
    assert.equal(retry.status, 409);
    assert.equal(retry.body['error'], 'already_claimed');

    // Only the winner is paid, and only once.
    const approved = await admin(h, 'POST', `/api/admin/v1/chores/${won.card.assignmentId}/approve`, PARENT_PIN);
    assert.equal(approved.status, 200);

    const paid = await snapshot(h, SCHOOL_DAY);
    assert.equal(balanceOf(paid, won.childId), value, 'the winner was not paid the chore value');
    assert.equal(balanceOf(paid, lost.childId), 0, 'a loser of the race was paid');
    assert.equal(ledgerRowCount(h, lost.childId), 0);
    assert.equal(ledgerRowCount(h, CHILD_PRE_READER), 0);
  } finally {
    await h.stop();
  }
});

test('a superseded card cannot be approved into a payment', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const a = choreCard(snap, CHILD_FLUENT, 'ch-pet');
    const b = choreCard(snap, CHILD_EMERGENT, 'ch-pet');

    await wall(h, 'POST', `/api/wall/v1/chores/${a.assignmentId}/claim`, { body: { childId: CHILD_FLUENT } });
    assert.equal(assignmentState(h, b.assignmentId), 'superseded');

    const res = await admin(h, 'POST', `/api/admin/v1/chores/${b.assignmentId}/approve`, PARENT_PIN);
    assert.equal(res.status, 409);
    assert.equal(res.body['error'], 'not_claimable');
    assert.equal(ledgerRowCount(h, CHILD_EMERGENT), 0, 'a loser must never be paid');
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// A tap landing on a sibling's card
// ===========================================================================

test('a tap on a sibling card mutates nothing and pays no one', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const hers = choreCard(snap, CHILD_EMERGENT, 'ch-bed');

    // The selected child is A; the tap landed a centimetre off, on B's card.
    const res = await wall(h, 'POST', `/api/wall/v1/chores/${hers.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(res.status, 403);
    assert.equal(res.body['error'], 'wrong_child');
    assert.equal(res.body['message'], 'that is not your card');
    assert.notEqual(res.body['error'], 'not_claimable', 'never a fallthrough — that reads as "broken"');

    assert.equal(assignmentState(h, hers.assignmentId), 'pending', 'the sibling row moved');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 0);
    assert.equal(ledgerRowCount(h, CHILD_EMERGENT), 0);

    // The refusal leaks nothing about the sibling it refused to touch.
    assert.deepEqual(Object.keys(res.body).sort(), ['error', 'message']);

    // And when the card's real owner does the work, the points reach HER, not the selection.
    await earn(h, CHILD_EMERGENT, hers.assignmentId);
    const after = await snapshot(h, SCHOOL_DAY);
    assert.equal(balanceOf(after, CHILD_EMERGENT), hers.points);
    assert.equal(balanceOf(after, CHILD_FLUENT), 0, 'the wrong child was paid');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 0);
  } finally {
    await h.stop();
  }
});

test('a tap on a sibling ROUTINE step completes nothing', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const run = runsFor(snap, CHILD_FLUENT)[0];
    assert.ok(run);
    const step = run.steps[0];
    assert.ok(step);

    for (const intruder of [CHILD_PRE_READER, CHILD_EMERGENT]) {
      const res = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
        body: { childId: intruder },
      });
      assert.equal(res.status, 403);
      assert.equal(res.body['error'], 'wrong_child');
    }

    const after = await snapshot(h, SCHOOL_DAY);
    const reread = runsFor(after, CHILD_FLUENT).find((r) => r.runId === run.runId);
    assert.ok(reread);
    assert.equal(routineProgress(reread).done, 0, 'a sibling completed her step');

    // Revoke is ownership-gated too: a sibling must not be able to UNDO her progress either.
    await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
      body: { childId: CHILD_FLUENT },
    });
    const undo = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/revoke`, {
      body: { childId: CHILD_EMERGENT },
    });
    assert.equal(undo.status, 403);
    assert.equal(undo.body['error'], 'wrong_child');

    const final = await snapshot(h, SCHOOL_DAY);
    const finalRun = runsFor(final, CHILD_FLUENT).find((r) => r.runId === run.runId);
    assert.ok(finalRun);
    assert.equal(routineProgress(finalRun).done, 1, 'a sibling undid her work');
  } finally {
    await h.stop();
  }
});

test('an unattributable tap is a silent no-op, not a validation error', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = choreCard(snap, CHILD_FLUENT, 'ch-bed');
    const run = runsFor(snap, CHILD_FLUENT)[0];
    assert.ok(run);
    const step = run.steps[0];
    assert.ok(step);

    const bodies = [{}, { childId: '' }, { childId: 42 }, { childId: null }, { childId: 'child-zzz' }];
    for (const body of bodies) {
      const chore = await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, { body });
      assert.equal(chore.status, 403, JSON.stringify(body));
      assert.equal(chore.body['error'], 'wrong_child');

      const stepRes = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, { body });
      assert.equal(stepRes.status, 403, JSON.stringify(body));
      assert.equal(stepRes.body['error'], 'wrong_child');
    }

    assert.equal(assignmentState(h, card.assignmentId), 'pending');
    assert.equal(countRows(h, `SELECT COUNT(*) AS n FROM routine_step_completion`), 0);
  } finally {
    await h.stop();
  }
});

test('a malformed row id fails inside the frozen table, not as a bad_request', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    for (const id of ['abc', '0', '-1', '1.5', '999999']) {
      const res = await wall(h, 'POST', `/api/wall/v1/chores/${id}/claim`, {
        body: { childId: CHILD_FLUENT },
      });
      assert.equal(res.status, 409, `id ${id} returned ${res.status}`);
      assert.equal(res.body['error'], 'not_claimable', `id ${id}`);
    }
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// Redemption
// ===========================================================================

test('a redemption for more points than she holds is refused and does NOT take the slot', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = choreCard(snap, CHILD_FLUENT, 'ch-bed');
    await earn(h, CHILD_FLUENT, card.assignmentId);

    const held = balanceOf(await snapshot(h, SCHOOL_DAY), CHILD_FLUENT);
    assert.ok(held > 0);

    const greedy = await wall(h, 'POST', '/api/wall/v1/redemptions', {
      body: { childId: CHILD_FLUENT, pointsRequested: held + 500 },
    });
    assert.equal(greedy.status, 409);
    assert.equal(greedy.body['error'], 'insufficient_points');
    assert.equal(
      countRows(h, `SELECT COUNT(*) AS n FROM redemption_request`),
      0,
      'an impossible ask must never occupy the one pending slot (H1 finding #9)',
    );

    // A well-formed ask does take it, is visible, and moves nothing yet.
    const ok = await wall(h, 'POST', '/api/wall/v1/redemptions', {
      body: { childId: CHILD_FLUENT, pointsRequested: held },
    });
    assert.equal(ok.status, 200);
    assert.equal(ok.body['state'], 'pending');
    const requestId = ok.body['id'] as number;

    const pending = await snapshot(h, SCHOOL_DAY);
    assert.equal(pending.redemptions.length, 1, 'a request that vanishes gets tapped again');
    assert.equal(balanceOf(pending, CHILD_FLUENT), held, 'points move at approval, not at request');

    const listed = await wall(h, 'GET', '/api/wall/v1/redemptions?state=pending');
    assert.equal(listed.status, 200);

    // One open request per child.
    const second = await wall(h, 'POST', '/api/wall/v1/redemptions', {
      body: { childId: CHILD_FLUENT, pointsRequested: 1 },
    });
    assert.equal(second.status, 409);
    assert.equal(second.body['error'], 'pending_redemption_exists');

    // She can clear her own mis-tap without an adult.
    const cancelled = await wall(h, 'POST', `/api/wall/v1/redemptions/${requestId}/cancel`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(cancelled.status, 200);
    assert.equal(cancelled.body['state'], 'cancelled');
    const cleared = await snapshot(h, SCHOOL_DAY);
    assert.deepEqual(cleared.redemptions, []);
    assert.equal(balanceOf(cleared, CHILD_FLUENT), held);
  } finally {
    await h.stop();
  }
});

test('approving a redemption destroys exactly the points asked for, once', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    for (const chore of ['ch-bed', 'ch-pet']) {
      await earn(h, CHILD_FLUENT, choreCard(snap, CHILD_FLUENT, chore).assignmentId);
    }
    const held = balanceOf(await snapshot(h, SCHOOL_DAY), CHILD_FLUENT);
    assert.ok(held >= 2);

    const asked = held - 1;
    const request = await wall(h, 'POST', '/api/wall/v1/redemptions', {
      body: { childId: CHILD_FLUENT, pointsRequested: asked },
    });
    const requestId = request.body['id'] as number;

    const approved = await admin(h, 'POST', `/api/admin/v1/redemptions/${requestId}/approve`, PARENT_PIN);
    assert.equal(approved.status, 200);
    assert.equal(approved.body['state'], 'approved');
    const entryId = approved.body['ledgerEntryId'];
    assert.equal(typeof entryId, 'number');

    const after = await snapshot(h, SCHOOL_DAY);
    assert.equal(balanceOf(after, CHILD_FLUENT), held - asked);
    assert.deepEqual(after.redemptions, [], 'a decided request is history, not wall furniture');

    // The retry path returns the SAME entry, never a second withdrawal.
    const retry = await admin(h, 'POST', `/api/admin/v1/redemptions/${requestId}/approve`, PARENT_PIN);
    assert.equal(retry.status, 200);
    assert.equal(retry.body['ledgerEntryId'], entryId);
    assert.equal(balanceOf(await snapshot(h, SCHOOL_DAY), CHILD_FLUENT), held - asked);
  } finally {
    await h.stop();
  }
});

test('a request that outgrew the balance before approval stays PENDING, never silently consumed', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    for (const chore of ['ch-bed', 'ch-pet']) {
      await earn(h, CHILD_FLUENT, choreCard(snap, CHILD_FLUENT, chore).assignmentId);
    }
    const held = balanceOf(await snapshot(h, SCHOOL_DAY), CHILD_FLUENT);

    const request = await wall(h, 'POST', '/api/wall/v1/redemptions', {
      body: { childId: CHILD_FLUENT, pointsRequested: held },
    });
    const requestId = request.body['id'] as number;

    // The points went elsewhere between the ask and the approval.
    const clawback = await admin(h, 'POST', '/api/admin/v1/ledger/adjust', PARENT_PIN, {
      body: { childId: CHILD_FLUENT, delta: -1, note: 'synthetic clawback', requestId: 'e2e-clawback-1' },
    });
    assert.equal(clawback.status, 200);

    const refused = await admin(h, 'POST', `/api/admin/v1/redemptions/${requestId}/approve`, PARENT_PIN);
    assert.equal(refused.status, 409);
    assert.equal(refused.body['error'], 'insufficient_points');

    const after = await snapshot(h, SCHOOL_DAY);
    assert.equal(after.redemptions.length, 1, 'the request must survive so a parent can decide');
    const still = after.redemptions[0];
    assert.ok(still);
    assert.equal(still.state, 'pending');
    assert.equal(balanceOf(after, CHILD_FLUENT), held - 1, 'nothing was withdrawn by the failed approval');
  } finally {
    await h.stop();
  }
});

test('a manual adjustment is idempotent on its requestId — a double tap cannot pay twice', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const body = { childId: CHILD_FLUENT, delta: 7, note: 'synthetic bonus', requestId: 'e2e-bonus-1' };
    const first = await admin(h, 'POST', '/api/admin/v1/ledger/adjust', PARENT_PIN, { body });
    assert.equal(first.status, 200);
    const second = await admin(h, 'POST', '/api/admin/v1/ledger/adjust', PARENT_PIN, { body });
    assert.equal(second.status, 200);
    assert.equal(second.body['id'], first.body['id'], 'the retry returned a second entry');

    assert.equal(balanceOf(await snapshot(h, SCHOOL_DAY), CHILD_FLUENT), 7);
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 1);

    // A DIFFERENT user action, with its own key, is a second bonus and must not collide.
    const another = await admin(h, 'POST', '/api/admin/v1/ledger/adjust', PARENT_PIN, {
      body: { ...body, requestId: 'e2e-bonus-2' },
    });
    assert.equal(another.status, 200);
    assert.equal(balanceOf(await snapshot(h, SCHOOL_DAY), CHILD_FLUENT), 14);

    // And a missing key is refused rather than guessed at.
    const keyless = await admin(h, 'POST', '/api/admin/v1/ledger/adjust', PARENT_PIN, {
      body: { childId: CHILD_FLUENT, delta: 5 },
    });
    assert.equal(keyless.status, 400);
    assert.equal(balanceOf(await snapshot(h, SCHOOL_DAY), CHILD_FLUENT), 14);
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// The pre-reader has a history, not a balance
// ===========================================================================

test('the ledger-disabled child accrues nothing across many approvals, on either day', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    let approvals = 0;

    for (const [clock, date] of [
      [SCHOOL_MORNING, SCHOOL_DAY],
      [NEXT_MORNING, NEXT_DAY],
    ] as const) {
      h.setNow(clock);
      const snap = await snapshot(h, date);
      const hers = snap.chores.filter((c) => c.childId === CHILD_PRE_READER);
      assert.ok(hers.length > 0, `no chores for the pre-reader on ${date}`);

      for (const card of hers) {
        const claim = await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
          body: { childId: CHILD_PRE_READER },
        });
        if (claim.status !== 200) continue; // she can lose a first_complete race like anyone
        const approve = await admin(
          h,
          'POST',
          `/api/admin/v1/chores/${card.assignmentId}/approve`,
          PARENT_PIN,
        );
        assert.equal(approve.status, 200);
        assert.equal(approve.body['state'], 'approved', 'the state machine must still run for her');
        assert.equal(
          approve.body['ledgerEntryId'],
          null,
          'the pre-reader must never be credited a ledger row',
        );
        approvals++;
      }
    }

    assert.ok(approvals >= 4, `only ${approvals} approvals — the sweep proved too little`);

    const final = await snapshot(h, NEXT_DAY);
    const balance = final.balances.find((b) => b.childId === CHILD_PRE_READER);
    assert.ok(balance);
    assert.equal(balance.points, 0);
    assert.equal(balance.cashCents, null);
    assert.equal(ledgerRowCount(h, CHILD_PRE_READER), 0);

    const history = await admin(h, 'GET', `/api/admin/v1/children/${CHILD_PRE_READER}/ledger`, PARENT_PIN);
    assert.equal(history.status, 200);
    assert.deepEqual(history.body['entries'], []);
    assert.equal(history.body['total'], 0);

    // Her completions ARE real — the stamp comes from the chore state, not from ledger data.
    assert.ok(
      final.chores.some((c) => c.childId === CHILD_PRE_READER && c.state === 'approved'),
      'her approved cards must still render as approved',
    );

    // And she cannot ask to cash out something she never had.
    const cashOut = await wall(h, 'POST', '/api/wall/v1/redemptions', {
      body: { childId: CHILD_PRE_READER, pointsRequested: 1 },
    });
    assert.equal(cashOut.status, 409);
    assert.equal(cashOut.body['error'], 'insufficient_points');
    assert.equal(countRows(h, `SELECT COUNT(*) AS n FROM redemption_request`), 0);
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// The wall reaching for an adult's authority
// ===========================================================================

/** The real PIN with its last digit changed — one key off, the likeliest wrong guess. */
const nearMiss = (pin: string): string => pin.slice(0, -1) + (pin.endsWith('0') ? '1' : '0');

test('a wrong PIN refuses, mutates nothing, and never locks the real PIN out', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = choreCard(snap, CHILD_FLUENT, 'ch-bed');
    await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });

    // A child mashing the pad. There is deliberately no lockout: it would convert a
    // nuisance into an outage for the one credential that can approve anything.
    for (const guess of ['0000', '1234', '', 'notapin', nearMiss(PARENT_PIN)]) {
      const res = await admin(h, 'POST', `/api/admin/v1/chores/${card.assignmentId}/approve`, guess);
      assert.equal(res.status, 401, `PIN "${guess}" was accepted`);
      assert.equal(res.body['error'], 'bad_pin');
      assert.equal(res.body['message'], 'ask a grown-up');
    }
    assert.equal(assignmentState(h, card.assignmentId), 'claimed');
    assert.equal(ledgerRowCount(h, CHILD_FLUENT), 0);

    const real = await admin(h, 'POST', `/api/admin/v1/chores/${card.assignmentId}/approve`, PARENT_PIN);
    assert.equal(real.status, 200, 'the parent was locked out by the child mashing the pad');
  } finally {
    await h.stop();
  }
});

test('the device check comes before the PIN check, so a stranger sees the offline card', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    // An unknown panel with a correct PIN is still not this household's wall.
    const res = await admin(h, 'POST', '/api/admin/v1/chores/1/approve', PARENT_PIN, {
      token: 'a-token-from-nowhere',
    });
    assert.equal(res.status, 403);
    assert.equal(res.body['error'], 'device_revoked');
    assert.notEqual(res.body['error'], 'bad_pin', 'a revoked panel must not render a login form');
  } finally {
    await h.stop();
  }
});

test('an obsolete bundle is told to reload BEFORE it is told anything it cannot parse', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    // Below the minimum, with a valid token.
    const stale = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${SCHOOL_DAY}`, {
      headers: { 'x-client-build': '0' },
    });
    assert.equal(stale.status, 426);
    assert.equal(stale.body['error'], 'stale_client');

    // And with NO token: the build check runs first, because a bundle too old to parse
    // today's shapes is also too old to render `device_revoked` correctly.
    const staleAnon = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${SCHOOL_DAY}`, {
      token: null,
      headers: { 'x-client-build': '0' },
    });
    assert.equal(staleAnon.status, 426);
    assert.equal(staleAnon.body['error'], 'stale_client');

    // A bundle that declares nothing, or declares nonsense, is not locked out.
    const silent = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${SCHOOL_DAY}`);
    assert.equal(silent.status, 200);
    const nonsense = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${SCHOOL_DAY}`, {
      headers: { 'x-client-build': 'banana' },
    });
    assert.equal(nonsense.status, 200);

    // The reload trigger rides on EVERY response, including refusals — a stale bundle must
    // not have to reach the snapshot to learn it is stale.
    const refused = await wall(h, 'GET', '/api/wall/v1/snapshot?localDate=nope');
    assert.equal(refused.status, 409);
    assert.equal(refused.headers.get('x-min-client-build'), '1');
    assert.equal(refused.headers.get('x-api-version'), '1');
    assert.equal(refused.headers.get('cache-control'), 'no-store');
  } finally {
    await h.stop();
  }
});

test('an unrouted path is a small JSON refusal, not a page', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    const res = await wall(h, 'GET', '/api/wall/v1/nope');
    assert.equal(res.status, 404);
    assert.equal(res.body['error'], 'not_found');
    assert.deepEqual(Object.keys(res.body).sort(), ['error', 'message']);
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// The local date boundary — H3 finding #4, "the closest to the literal failure"
// ===========================================================================

test('a full local-date rollover: yesterday never renders as today', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    // ---- Monday's work.
    const day1 = await snapshot(h, SCHOOL_DAY);
    const run1 = runsFor(day1, CHILD_PRE_READER)[0];
    assert.ok(run1);
    for (const step of run1.steps) {
      const res = await wall(h, 'POST', `/api/wall/v1/routines/steps/${step.runStepId}/complete`, {
        body: { childId: CHILD_PRE_READER },
      });
      assert.equal(res.status, 200);
    }
    const card1 = choreCard(day1, CHILD_FLUENT, 'ch-bed');
    await earn(h, CHILD_FLUENT, card1.assignmentId);

    const earned = balanceOf(await snapshot(h, SCHOOL_DAY), CHILD_FLUENT);
    assert.ok(earned > 0);

    // ---- midnight passes. Nothing reloads; the kiosk simply asks for a new date.
    h.setNow(NEXT_MORNING);
    const day2 = await snapshot(h, NEXT_DAY);

    assert.equal(day2.freshness.snapshotLocalDate, NEXT_DAY);
    assert.ok(day2.routines.length > 0, 'the new day must materialize on first read');
    assert.ok(day2.chores.length > 0);

    const run2 = runsFor(day2, CHILD_PRE_READER).find((r) => r.routineId === run1.routineId);
    assert.ok(run2, 'her routine must exist on the new day');
    assert.notEqual(run2.runId, run1.runId, 'today reused yesterday\'s run');
    assert.equal(run2.localDate, NEXT_DAY);
    assert.equal(
      routineProgress(run2).done,
      0,
      "yesterday's completions rendered as today's — the 6:00 AM failure",
    );
    for (const step of run2.steps) {
      assert.equal(step.completedAtUtc, null);
      assert.ok(
        run1.steps.every((s) => s.runStepId !== step.runStepId),
        'a run step id was reused across days',
      );
    }

    for (const card of day2.chores) {
      assert.equal(card.localDate, NEXT_DAY);
      assert.equal(card.state, 'pending', `${card.choreId} carried yesterday's state into today`);
    }

    // The LEDGER is cumulative and must NOT reset — that is the one thing that crosses midnight.
    assert.equal(balanceOf(day2, CHILD_FLUENT), earned, 'the balance reset overnight');

    // ---- and yesterday is still yesterday, not overwritten.
    const revisited = await snapshot(h, SCHOOL_DAY);
    const revisitedRun = runsFor(revisited, CHILD_PRE_READER).find((r) => r.runId === run1.runId);
    assert.ok(revisitedRun);
    assert.ok(routineProgress(revisitedRun).allDone, 'yesterday lost its completions');
    assert.equal(choreCard(revisited, CHILD_FLUENT, 'ch-bed').state, 'approved');
  } finally {
    await h.stop();
  }
});

test('a stale client asking for yesterday all morning gets yesterday, labelled as yesterday', async () => {
  const h = await startWall({ clock: NEXT_MORNING });
  try {
    // The kiosk that never rolled over. The server cannot fix that for it — but it must not
    // COMPOUND it by answering with today's data under yesterday's date, which would make the
    // mismatch undetectable by the client's own contracted check.
    const res = await wall(h, 'GET', `/api/wall/v1/snapshot?localDate=${SCHOOL_DAY}`);
    assert.equal(res.status, 200);
    const snap = res.body as unknown as WallSnapshot;
    assert.equal(snap.requestedLocalDate, SCHOOL_DAY);
    assert.equal(snap.freshness.snapshotLocalDate, SCHOOL_DAY);
    assert.ok(snap.chores.every((c) => c.localDate === SCHOOL_DAY));
    assert.ok(snap.routines.every((r) => r.localDate === SCHOOL_DAY));
    assert.notEqual(snap.freshness.snapshotLocalDate, h.serverToday());
  } finally {
    await h.stop();
  }
});

// ===========================================================================
// Properties a file-backed database has and `:memory:` does not
// ===========================================================================

test('a second connection to the same FILE sees the wall, and the wall sees it', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  // This is what the sync worker thread actually holds: its own handle on the same file.
  // `startSyncScheduler` refuses `:memory:` precisely because this seam cannot exist there.
  const worker = openDatabase({ path: h.dbPath });
  try {
    const snap = await snapshot(h, SCHOOL_DAY);
    const card = choreCard(snap, CHILD_FLUENT, 'ch-bed');
    await wall(h, 'POST', `/api/wall/v1/chores/${card.assignmentId}/claim`, {
      body: { childId: CHILD_FLUENT },
    });

    const seen = worker
      .prepare(`SELECT state FROM chore_assignment WHERE id = ?`)
      .get(card.assignmentId) as { state: string };
    assert.equal(seen.state, 'claimed', 'a committed tap was invisible to a second connection');

    // Now the other direction: the worker promotes a calendar generation, and the wall
    // renders it without restarting or being told.
    const events: FetchedEvent[] = [
      {
        externalUid: 'e2e-worker-1',
        title: 'Synthetic from the worker',
        when: { kind: 'allDay', startDate: addDays(SCHOOL_DAY, 1), endDate: addDays(SCHOOL_DAY, 2) },
      },
    ];
    const upstream: CalendarSource = {
      kind: 'e2e-worker',
      listSources: async () => [],
      fetchEvents: async () => events,
      probe: async () => true,
    };
    const results = await syncAllSources(worker, upstream, {
      window: { fromDate: SCHOOL_DAY, toDate: addDays(SCHOOL_DAY, 30) },
    });
    assert.ok(results.every((r) => r.ok));

    const after = await snapshot(h, SCHOOL_DAY);
    assert.ok(
      after.events.some((e) => e.title === 'Synthetic from the worker'),
      'the wall did not see a generation promoted on another connection',
    );
    assert.equal(typeof after.freshness.calendarSyncAgeSeconds, 'number');
  } finally {
    worker.close();
    await h.stop();
  }
});

test('a child with no ledger history still has a balance row — including one added today', async () => {
  const h = await startWall({ clock: SCHOOL_MORNING });
  try {
    // Day one: nobody has ever been approved. A bare aggregate over ledger_entry returns
    // ZERO ROWS here, and a renderer doing balances.find(...) gets undefined (H1 finding #13).
    const day1 = await snapshot(h, SCHOOL_DAY);
    assert.equal(day1.balances.length, day1.children.length);
    for (const child of day1.children) {
      const row = day1.balances.find((b) => b.childId === child.id);
      assert.ok(row, `${child.id} has no balance row on day one`);
      assert.equal(row.points, 0);
    }

    // A new sibling, added before their first approval.
    h.db
      .prepare(
        `INSERT INTO child (id, display_name, reading_band, ledger_enabled, avatar_asset_id, sort_order, active)
         VALUES ('child-d', 'Child D', 'emergent', 1, 'av-a', 4, 1)`,
      )
      .run();

    const day2 = await snapshot(h, SCHOOL_DAY);
    assert.equal(day2.children.length, 4);
    const fresh = day2.balances.find((b) => b.childId === 'child-d');
    assert.ok(fresh, 'a newly added sibling has no balance row');
    assert.equal(fresh.points, 0);
    assert.equal(day2.balances.length, 4);
  } finally {
    await h.stop();
  }
});
