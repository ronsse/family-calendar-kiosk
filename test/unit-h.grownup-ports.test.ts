/**
 * Unit H — the three admin calls the restyled grown-up screens add (2026-10-11).
 *
 * The routes are old; the wall never called them. `adjustLedger` is the Money screen's ± keys,
 * `fetchLedger` is its "lately" list, and `refreshCalendar` is Settings' "Fetch now". Each is
 * driven twice: against a recorder for its exact wire shape, and against a real server for what
 * it does. The queue's claim time (`atUtc`) is driven the same way, because "18 min ago" on a
 * row is only as true as the field it is read from.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PARENT_PIN_HEADER,
  approvalQueue,
  createAdminActions,
  refusalCodeOf,
} from '../web/src/app/adminActions.ts';
import {
  CHILD_FLUENT,
  CHILD_PRE_READER,
  PARENT_PIN,
  balanceOf,
  bestPendingCard,
  snapshot,
  startWall,
  wall,
} from './e2e/harness.ts';

interface Sent {
  url: string;
  init: RequestInit;
}

function recorder(reply: () => Response) {
  const sent: Sent[] = [];
  const fetchImpl = (url: string, init: RequestInit): Promise<Response> => {
    sent.push({ url, init });
    return Promise.resolve(reply());
  };
  return { sent, fetchImpl };
}

const ok = (body: unknown) => () => new Response(JSON.stringify(body), { status: 200 });

test('a ± tap is one POST carrying the child, the delta, its own request id and the PIN', async () => {
  const entry = { id: 1, childId: 'child-a', delta: 1, reason: 'adjustment', refId: 'r-1', note: null, createdAtUtc: '2026-10-11T14:00:00.000Z' };
  const { sent, fetchImpl } = recorder(ok(entry));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  const got = await actions.adjustLedger('child-a', -1, 'r-1', '1111');

  assert.equal(sent.length, 1);
  const [call] = sent as [Sent];
  assert.equal(call.url, '/api/admin/v1/ledger/adjust');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body, JSON.stringify({ childId: 'child-a', delta: -1, requestId: 'r-1' }));
  const headers = call.init.headers as Record<string, string>;
  assert.equal(headers[PARENT_PIN_HEADER], '1111');
  assert.equal(headers['authorization'], 'Device dev-token');
  assert.equal(headers['content-type'], 'application/json');
  assert.equal(got.delta, 1);
});

test('the history is a GET, and a child id cannot change the path it addresses', async () => {
  const { sent, fetchImpl } = recorder(ok({ childId: 'a/b', entries: [], total: 0 }));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  await actions.fetchLedger('a/b', '1111');

  const [call] = sent as [Sent];
  assert.equal(call.url, '/api/admin/v1/children/a%2Fb/ledger');
  assert.equal(call.init.method, 'GET');
  assert.equal(call.init.body, undefined);
  assert.equal((call.init.headers as Record<string, string>)[PARENT_PIN_HEADER], '1111');
});

test('Fetch now is a POST with no body and therefore no content-type', async () => {
  const outcome = { disposition: 'started', reason: null, lastCompletedAtUtc: null, lastEvents: null, lastFailed: null };
  const { sent, fetchImpl } = recorder(ok(outcome));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  const got = await actions.refreshCalendar('1111');

  const [call] = sent as [Sent];
  assert.equal(call.url, '/api/admin/v1/calendar/refresh');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body, undefined);
  assert.equal((call.init.headers as Record<string, string>)['content-type'], undefined);
  assert.equal(got.disposition, 'started');
});

test('none of the three reaches the network without a PIN', async () => {
  const { sent, fetchImpl } = recorder(ok({}));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });
  const badPin = (err: unknown) => refusalCodeOf(err) === 'bad_pin';
  await assert.rejects(actions.adjustLedger('child-a', 1, 'r-1', ''), badPin);
  await assert.rejects(actions.fetchLedger('child-a', ''), badPin);
  await assert.rejects(actions.refreshCalendar(''), badPin);
  assert.equal(sent.length, 0);
});

test('A ± TAP MOVES THE BALANCE ONCE PER REQUEST ID, end to end', async () => {
  const h = await startWall();
  try {
    const actions = createAdminActions({ baseUrl: h.base, deviceToken: h.token });
    const before = balanceOf(await snapshot(h), CHILD_FLUENT);

    await actions.adjustLedger(CHILD_FLUENT, 1, 'tap-1', PARENT_PIN);
    await actions.adjustLedger(CHILD_FLUENT, 1, 'tap-2', PARENT_PIN);
    assert.equal(balanceOf(await snapshot(h), CHILD_FLUENT), before + 2, 'two taps, two points');

    // A retried request — the same tap sent twice — pays once. This is why every tap mints its id.
    await actions.adjustLedger(CHILD_FLUENT, 1, 'tap-2', PARENT_PIN);
    assert.equal(balanceOf(await snapshot(h), CHILD_FLUENT), before + 2, 'a resend of one tap is still one tap');

    await actions.adjustLedger(CHILD_FLUENT, -1, 'tap-3', PARENT_PIN);
    const history = await actions.fetchLedger(CHILD_FLUENT, PARENT_PIN);
    assert.equal(history.total, before + 1);
    assert.deepEqual(
      history.entries.slice(-3).map((e) => [e.delta, e.runningTotal]),
      [
        [1, before + 1],
        [1, before + 2],
        [-1, before + 1],
      ],
      'oldest first, and the running total is what the list prints beside each line',
    );
  } finally {
    await h.stop();
  }
});

test('the pre-reader has no balance to move, and the refusal says so by code', async () => {
  const h = await startWall();
  try {
    const actions = createAdminActions({ baseUrl: h.base, deviceToken: h.token });
    await assert.rejects(
      actions.adjustLedger(CHILD_PRE_READER, 1, 'tap-c', PARENT_PIN),
      (err: unknown) => refusalCodeOf(err) === 'insufficient_points',
    );
    assert.equal((await actions.fetchLedger(CHILD_PRE_READER, PARENT_PIN)).entries.length, 0);
  } finally {
    await h.stop();
  }
});

test('Fetch now on a wall with no calendar upstream answers `unavailable`, which the screen words itself', async () => {
  const h = await startWall();
  try {
    const actions = createAdminActions({ baseUrl: h.base, deviceToken: h.token });
    await assert.rejects(actions.refreshCalendar(PARENT_PIN), (err: unknown) => {
      // `refusalCodeOf` folds it into 'unknown' — it is not a child-facing refusal — so the
      // Settings screen reads the raw code and says "No calendar is connected to this wall".
      assert.equal((err as { code?: unknown }).code, 'unavailable');
      assert.equal(refusalCodeOf(err), 'unknown');
      return true;
    });
    // And the settings read the screen draws its calendar line from carries the sources.
    const settings = await actions.fetchSettings(PARENT_PIN);
    assert.ok(Array.isArray(settings.calendar.sources));
    assert.ok(settings.calendar.sources.length > 0, 'the dev seed includes calendar sources');
    for (const s of settings.calendar.sources) {
      assert.deepEqual(Object.keys(s).sort(), ['goodAtUtc', 'label', 'last', 'triedAtUtc']);
    }
  } finally {
    await h.stop();
  }
});

test('a claimed chore and a cash-out both reach the queue with the time they were asked for', async () => {
  const h = await startWall();
  try {
    const card = bestPendingCard(await snapshot(h), CHILD_FLUENT);
    const claimed = await wall(h, 'POST', `/api/wall/v1/chores/${String(card.assignmentId)}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    assert.equal(claimed.status, 200, claimed.text);

    const actions = createAdminActions({ baseUrl: h.base, deviceToken: h.token });
    await actions.adjustLedger(CHILD_FLUENT, 5, 'seed-points', PARENT_PIN);
    const asked = await wall(h, 'POST', '/api/wall/v1/redemptions', { body: { childId: CHILD_FLUENT, pointsRequested: 1 } });
    assert.equal(asked.status, 200, asked.text);

    const queue = approvalQueue(await snapshot(h));
    const job = queue.find((item) => item.kind === 'chore');
    const cash = queue.find((item) => item.kind === 'redemption');
    assert.ok(job !== undefined && cash !== undefined);
    for (const item of [job, cash]) {
      assert.ok(item.atUtc !== null && !Number.isNaN(Date.parse(item.atUtc)), `${item.kind} has a real time`);
      assert.ok(Math.abs(Date.parse(item.atUtc) - h.now().getTime()) < 60_000, `${item.kind} was asked for just now`);
    }
  } finally {
    await h.stop();
  }
});

// ---------------------------------------------------------------------------
// Pass 2 — chore edit, retire, restore, and the PIN changed (2026-10-11)
// ---------------------------------------------------------------------------

test('edit sends only what changed, to an encoded path, behind the PIN', async () => {
  const { sent, fetchImpl } = recorder(ok({ chores: [], children: [] }));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  await actions.editChore('ch/x', { rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' }, '1111');

  const [call] = sent as [Sent];
  assert.equal(call.url, '/api/admin/v1/chores/ch%2Fx/edit');
  assert.equal(call.init.method, 'POST');
  assert.equal(call.init.body, JSON.stringify({ rrule: 'FREQ=WEEKLY;BYDAY=MO,TH' }));
  assert.equal((call.init.headers as Record<string, string>)[PARENT_PIN_HEADER], '1111');
});

test('retire and restore are bodiless POSTs behind the PIN', async () => {
  const { sent, fetchImpl } = recorder(ok({ chores: [], children: [] }));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  await actions.retireChore('ch-pet', '1111');
  await actions.restoreChore('ch-pet', '1111');

  assert.deepEqual(
    sent.map((s) => [s.url, s.init.method, s.init.body]),
    [
      ['/api/admin/v1/chores/ch-pet/retire', 'POST', undefined],
      ['/api/admin/v1/chores/ch-pet/restore', 'POST', undefined],
    ],
  );
  for (const s of sent) assert.equal((s.init.headers as Record<string, string>)[PARENT_PIN_HEADER], '1111');
});

test('a PIN change is authorised by the PIN just typed, and carries the new one in the body', async () => {
  const { sent, fetchImpl } = recorder(ok({}));
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  await actions.changePin('1111', '2468');

  const [call] = sent as [Sent];
  assert.equal(call.url, '/api/admin/v1/settings/pin');
  assert.equal(call.init.body, JSON.stringify({ newPin: '2468' }));
  assert.equal((call.init.headers as Record<string, string>)[PARENT_PIN_HEADER], '1111');
});

test('against the server: retire refuses a waiting claim, and the PIN change takes', async () => {
  const h = await startWall({ clock: '2026-09-15T13:00:00Z' });
  try {
    const actions = createAdminActions({ baseUrl: h.base, deviceToken: h.token });
    const snap = await snapshot(h);
    const card = bestPendingCard(snap, CHILD_FLUENT);
    assert.ok(card);
    await wall(h, 'POST', `/api/wall/v1/chores/${String(card.assignmentId)}/claim`, {
      body: { childId: CHILD_FLUENT },
    });
    await assert.rejects(actions.retireChore(card.choreId, PARENT_PIN), (err: unknown) => {
      assert.equal(refusalCodeOf(err), 'not_claimable');
      return true;
    });

    await assert.rejects(actions.changePin('0000', '2468'), (err: unknown) => {
      assert.equal(refusalCodeOf(err), 'bad_pin');
      return true;
    });
    await actions.changePin(PARENT_PIN, '2468');
    await actions.fetchSettings('2468');
    await assert.rejects(actions.fetchSettings(PARENT_PIN), (err: unknown) => {
      assert.equal(refusalCodeOf(err), 'bad_pin');
      return true;
    });
  } finally {
    await h.stop();
  }
});
