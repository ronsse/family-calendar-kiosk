/**
 * Unit H acceptance, part 5: the grown-up destination.
 *
 * Two things are on trial here and only one of them is a feature.
 *
 * The feature is the queue: one list of everything waiting, across all children, holding
 * both kinds of waiting thing, and reading as finished rather than broken when it is empty
 * — which is what it is nearly all day.
 *
 * The other is the invariant.  **`requireParentPin` is per request and never a session**
 * (docs/api.md §Auth), because children and guests touch this panel, and an approval is the
 * moment a claim becomes a permanent append-only ledger fact.  So the tests below insist on
 * three separate properties of the client: that no request can be built without a PIN, that
 * the PIN is held for one visit to the portal and forgotten the moment the wall leaves it,
 * and that nothing behind the door — the queue, the ledger, every balance, what each chore
 * pays — is drawn until a PIN has been accepted once (2026-10; until then the queue was
 * readable without one).  A guardrail is architectural or it is nothing (CLAUDE.md).
 *
 * No DOM and no JSX runtime is available here — `node --experimental-strip-types` strips
 * types, it does not transform `.tsx` — so the component's half of that invariant is proved
 * by SCANNING ITS SOURCE, in the same spirit as test/unit-h.sources.test.ts.  Every scanner
 * is checked against a synthetic violation first: a scan that has quietly stopped matching
 * anything reports green forever.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AssetRef,
  Child,
  ChoreAssignmentView,
  ChoreState,
  LocalDate,
  RedemptionRequest,
  RedemptionState,
  Utc,
} from '../src/types.ts';
import { bandTypography, layoutPx, spacePx } from '../web/src/design/tokens.ts';
import { AMBIENT_BAND } from '../web/src/views/logic/idle.ts';
import {
  ADMIN_API_PREFIX,
  APPROVAL_PANE_HEIGHT_PX,
  MIN_PARENT_PIN_LENGTH,
  NULL_ADMIN_ACTIONS,
  PARENT_PIN_HEADER,
  REFUSAL_WORDS,
  adminActionPaths,
  approvalQueue,
  approvalRowHeightPx,
  createAdminActions,
  performApproval,
  refusalCodeOf,
  refusalIsRetryable,
  refusalMessageOf,
  type AdminActions,
  type ApprovalDecision,
  type ApprovalKind,
  type RefusalCode,
} from '../web/src/app/adminActions.ts';
import {
  GROWNUP_DESTINATIONS,
  isGrownupDestination,
  visitPinAfterMove,
  type WallDestination,
} from '../web/src/app/grownupVisit.ts';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const APPROVALS = 'web/src/views/domain/ApprovalsView.tsx';
const SCENES = 'web/src/views/domain/ScenesView.tsx';
const WALL_APP = 'web/src/app/WallApp.tsx';
const VISIT = 'web/src/app/grownupVisit.ts';
const PIN_SHEET = 'web/src/views/domain/PinSheet.tsx';
const ADMIN_ACTIONS = 'web/src/app/adminActions.ts';
const SERVER = 'src/http/server.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = '2026-08-26' as LocalDate;
const T0 = '2026-08-26T01:00:00.000Z' as Utc;

function asset(id: string): AssetRef {
  return { assetId: id, url: `/assets/${id}`, isFallback: false };
}

function child(id: string, displayName: string, sortOrder: number, ledgerEnabled = true): Child {
  return {
    id,
    displayName,
    readingBand: 'fluent',
    ledgerEnabled,
    avatarAssetId: `${id}-face`,
    sortOrder,
  };
}

function chore(
  assignmentId: number,
  childId: string,
  state: ChoreState,
  points: number,
  labelFull: string,
): ChoreAssignmentView {
  return {
    assignmentId,
    choreId: `chore-${String(assignmentId)}`,
    childId,
    localDate: TODAY,
    state,
    kind: 'duty',
    countsTowardDay: true,
    dueByLocal: null,
    claimedAtUtc: null,
    points,
    labelShort: labelFull,
    labelFull,
    icon: asset(`icon-${String(assignmentId)}`),
    category: 'tidy',
  };
}

function redemption(
  id: number,
  childId: string,
  state: RedemptionState,
  pointsRequested: number,
  cashCents: number,
): RedemptionRequest {
  return {
    id,
    childId,
    pointsRequested,
    centsPerPoint: 10,
    cashCents,
    state,
    requestedAtUtc: T0,
    decidedAtUtc: null,
  };
}

const CHILD_A = child('child-a', 'Child A', 0);
const CHILD_B = child('child-b', 'Child B', 1);
/** The pre-reader.  Her chores run the full machine and write no ledger row. */
const CHILD_C = child('child-c', 'Child C', 2, false);
const ROSTER = [CHILD_A, CHILD_B, CHILD_C];

// ---------------------------------------------------------------------------
// 1. The queue
// ---------------------------------------------------------------------------

test('an empty household produces an empty queue, not a failure', () => {
  assert.deepEqual(approvalQueue({ children: [], chores: [], redemptions: [] }), []);
});

test('a household with nothing waiting produces an empty queue', () => {
  const queue = approvalQueue({
    children: ROSTER,
    chores: [
      chore(1, 'child-a', 'pending', 5, 'Make your bed'),
      chore(2, 'child-b', 'approved', 5, 'Feed the dog'),
      chore(3, 'child-b', 'superseded', 5, 'Empty the bin'),
    ],
    redemptions: [
      redemption(10, 'child-a', 'approved', 40, 400),
      redemption(11, 'child-b', 'cancelled', 20, 200),
      redemption(12, 'child-b', 'rejected', 20, 200),
    ],
  });
  assert.deepEqual(queue, [], 'only claimed chores and pending requests are waiting on anybody');
});

test('a snapshot missing its arrays entirely does not throw', () => {
  // A wall that crashes on a shape it did not expect is a blank wall for months.
  const bare = {} as Parameters<typeof approvalQueue>[0];
  assert.deepEqual(approvalQueue(bare), []);
});

test('the queue holds BOTH kinds of waiting thing, in one list', () => {
  const queue = approvalQueue({
    children: ROSTER,
    chores: [chore(1, 'child-a', 'claimed', 5, 'Make your bed')],
    redemptions: [redemption(10, 'child-a', 'pending', 40, 400)],
  });

  assert.equal(queue.length, 2);
  assert.deepEqual(
    queue.map((item) => item.kind),
    ['redemption', 'chore'],
    'money leads: a request has been waiting since it was made and holds the one open slot',
  );

  const [cash, job] = queue as [(typeof queue)[number], (typeof queue)[number]];
  assert.equal(cash.id, 10);
  assert.equal(cash.points, 40);
  assert.equal(cash.cashCents, 400);
  assert.equal(cash.icon, null, 'a redemption has no picture of its own; it is drawn as a gift');
  assert.equal(cash.childName, 'Child A');
  assert.equal(cash.avatar.url, '/assets/child-a-face');

  assert.equal(job.id, 1);
  assert.equal(job.labelFull, 'Make your bed');
  assert.equal(job.points, 5);
  assert.equal(job.cashCents, null);
  assert.notEqual(job.icon, null);

  assert.equal(new Set(queue.map((item) => item.key)).size, 2, 'keys cannot collide across kinds');
});

test('it is ONE list across all children, in the household order the rail uses', () => {
  const queue = approvalQueue({
    children: ROSTER,
    chores: [
      chore(3, 'child-c', 'claimed', 5, 'Put shoes away'),
      chore(1, 'child-a', 'claimed', 5, 'Make your bed'),
      chore(2, 'child-b', 'claimed', 3, 'Feed the dog'),
    ],
    redemptions: [redemption(10, 'child-b', 'pending', 40, 400)],
  });

  assert.deepEqual(
    queue.map((item) => item.childId),
    ['child-a', 'child-b', 'child-b', 'child-c'],
    'every child in one list, grouped by the fixed slot the whole wall already uses',
  );
  assert.deepEqual(
    queue.map((item) => item.kind),
    ['chore', 'redemption', 'chore', 'chore'],
    "within a child, the redemption leads",
  );
});

test('the pre-reader appears in the queue and her chore pays nothing', () => {
  const queue = approvalQueue({
    children: ROSTER,
    chores: [chore(3, 'child-c', 'claimed', 5, 'Put shoes away')],
    redemptions: [],
  });
  assert.equal(queue.length, 1, 'ledgerEnabled=false still runs the full state machine');
  assert.equal(queue[0]?.points, 0, 'and writes no ledger row, so there is no number to approve');
});

test('a row whose child is off the roster is dropped, never shown unattributed', () => {
  const queue = approvalQueue({
    children: [CHILD_A],
    chores: [chore(9, 'departed', 'claimed', 5, 'Ghost job')],
    redemptions: [redemption(99, 'departed', 'pending', 10, 100)],
  });
  assert.deepEqual(queue, [], 'an approval that pays nobody must not be offerable');
});

test('the order is stable — the same snapshot twice is the same list twice', () => {
  const snapshot = {
    children: ROSTER,
    chores: [chore(2, 'child-a', 'claimed', 5, 'B'), chore(1, 'child-a', 'claimed', 5, 'A')],
    redemptions: [],
  };
  assert.deepEqual(
    approvalQueue(snapshot).map((item) => item.key),
    approvalQueue(snapshot).map((item) => item.key),
  );
  assert.deepEqual(approvalQueue(snapshot).map((item) => item.id), [1, 2]);
});

// ---------------------------------------------------------------------------
// 2. The PIN is carried per request, and no request exists without one
// ---------------------------------------------------------------------------

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

const OK = (): Response => new Response(JSON.stringify({ state: 'approved' }), { status: 200 });

function headersOf(sent: Sent): Record<string, string> {
  return (sent.init.headers ?? {}) as Record<string, string>;
}

test('the four admin paths are the frozen table, verbatim', () => {
  const paths = adminActionPaths();
  assert.equal(ADMIN_API_PREFIX, '/api/admin/v1');
  assert.equal(paths.approveChore(7), '/api/admin/v1/chores/7/approve');
  assert.equal(paths.rejectChore(7), '/api/admin/v1/chores/7/reject');
  assert.equal(paths.approveRedemption(3), '/api/admin/v1/redemptions/3/approve');
  assert.equal(paths.rejectRedemption(3), '/api/admin/v1/redemptions/3/reject');
});

test('the PIN header is the one the server actually reads', () => {
  assert.equal(PARENT_PIN_HEADER, 'x-parent-pin');
  // Not a matter of taste: server.ts calls headerValue(req, 'x-parent-pin') on every admin
  // route. If that spelling ever moves, this fails here rather than at the wall.
  const server = readFileSync(path.join(ROOT, SERVER), 'utf8');
  assert.match(server, /headerValue\(req, 'x-parent-pin'\)/);
  assert.match(server, /requireParentPin\(/);
});

test('an approval carries the PIN and the device token, and no body at all', async () => {
  const { sent, fetchImpl } = recorder(OK);
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  await actions.approveChore(7, '1111');

  assert.equal(sent.length, 1);
  const [call] = sent as [Sent];
  assert.equal(call.url, '/api/admin/v1/chores/7/approve');
  assert.equal(call.init.method, 'POST');
  assert.equal(headersOf(call)[PARENT_PIN_HEADER], '1111');
  assert.equal(headersOf(call)['authorization'], 'Device dev-token');
  // Both reject routes lost `{ note? }` on 2026-08-24 and approve never had a body: sending
  // one would be a promise the server discards.
  assert.equal(call.init.body, undefined);
  assert.equal(headersOf(call)['content-type'], undefined);
});

test('NOTHING can approve without a PIN — an empty one never reaches the network', async () => {
  const { sent, fetchImpl } = recorder(OK);
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  for (const call of [
    () => actions.approveChore(7, ''),
    () => actions.rejectChore(7, ''),
    () => actions.approveRedemption(3, ''),
    () => actions.rejectRedemption(3, ''),
  ]) {
    await assert.rejects(call(), (err: unknown) => refusalCodeOf(err) === 'bad_pin');
  }

  assert.equal(sent.length, 0, 'a request with no authorisation at all must never be built');
});

test('the port holds no PIN between calls — each request carries its own', async () => {
  const { sent, fetchImpl } = recorder(OK);
  const actions = createAdminActions({ fetchImpl });

  await actions.approveChore(1, '1111');
  await actions.approveChore(2, '2222');
  await assert.rejects(actions.approveChore(3, ''), (err: unknown) => refusalCodeOf(err) === 'bad_pin');

  assert.deepEqual(
    sent.map((call) => headersOf(call)[PARENT_PIN_HEADER]),
    ['1111', '2222'],
    'no session, no cache: the third call had no PIN of its own and so did not happen',
  );
});

test('every kind and every decision routes to its own admin call, PIN and all', async () => {
  const seen: string[] = [];
  const spy: AdminActions = {
    approveChore: (id, pin) => {
      seen.push(`approveChore:${String(id)}:${pin}`);
      return Promise.resolve();
    },
    rejectChore: (id, pin) => {
      seen.push(`rejectChore:${String(id)}:${pin}`);
      return Promise.resolve();
    },
    // Not exercised here — this test is about the approval QUEUE — but the interface is
    // exhaustive on purpose, so a new admin verb is a compile error in every implementation
    // of it rather than a silently missing branch.
    retireScene: (id, pin) => {
      seen.push(`retireScene:${id}:${pin}`);
      return Promise.resolve();
    },
    approveRedemption: (id, pin) => {
      seen.push(`approveRedemption:${String(id)}:${pin}`);
      return Promise.resolve();
    },
    rejectRedemption: (id, pin) => {
      seen.push(`rejectRedemption:${String(id)}:${pin}`);
      return Promise.resolve();
    },
    // The settings and routine ports are not on trial in this test; they exist so the spy
    // satisfies the interface, and a call to one here would be a test failure by inspection.
    fetchSettings: () => Promise.reject(new Error('not part of this test')),
    setCentsPerPoint: () => Promise.reject(new Error('not part of this test')),
    setChorePoints: () => Promise.reject(new Error('not part of this test')),
    setDepartures: () => Promise.reject(new Error('not part of this test')),
    setTheme: () => Promise.reject(new Error('not part of this test')),
    fetchRoutines: () => Promise.reject(new Error('not part of this test')),
    assignRoutineStep: () => Promise.reject(new Error('not part of this test')),
    moveRoutineStep: () => Promise.reject(new Error('not part of this test')),
    fetchChores: () => Promise.reject(new Error('not part of this test')),
    setChoreMember: () => Promise.reject(new Error('not part of this test')),
    moveChoreMember: () => Promise.reject(new Error('not part of this test')),
    setChoreModel: () => Promise.reject(new Error('not part of this test')),
    createChore: () => Promise.reject(new Error('not part of this test')),
    editChore: () => Promise.reject(new Error('not part of this test')),
    retireChore: () => Promise.reject(new Error('not part of this test')),
    restoreChore: () => Promise.reject(new Error('not part of this test')),
    changePin: () => Promise.reject(new Error('not part of this test')),
    adjustLedger: () => Promise.reject(new Error('not part of this test')),
    fetchLedger: () => Promise.reject(new Error('not part of this test')),
    refreshCalendar: () => Promise.reject(new Error('not part of this test')),
  };

  const kinds: ApprovalKind[] = ['chore', 'redemption'];
  const decisions: ApprovalDecision[] = ['approve', 'reject'];
  for (const kind of kinds) {
    for (const decision of decisions) {
      await performApproval(spy, { kind, id: 5 }, decision, 'pin-5');
    }
  }

  assert.deepEqual(seen, [
    'approveChore:5:pin-5',
    'rejectChore:5:pin-5',
    'approveRedemption:5:pin-5',
    'rejectRedemption:5:pin-5',
  ]);
});

test('a screen with no port wired refuses rather than reporting a phantom approval', async () => {
  await assert.rejects(
    NULL_ADMIN_ACTIONS.approveChore(1, '1234'),
    (err: unknown) => refusalCodeOf(err) === 'unknown',
  );
});

// ---------------------------------------------------------------------------
// 3. A rejected PIN, handled by code and worded for a child
// ---------------------------------------------------------------------------

test('a rejected PIN comes back as a CODE, and the wall says something calm', async () => {
  const { fetchImpl } = recorder(
    () => new Response(JSON.stringify({ error: 'bad_pin', message: 'ask a grown-up' }), { status: 401 }),
  );
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });

  await assert.rejects(actions.approveChore(7, '0000'), (err: unknown) => {
    const code = refusalCodeOf(err);
    assert.equal(code, 'bad_pin', 'branch on the code, never on the server prose');
    assert.equal(REFUSAL_WORDS[code], 'Ask a grown-up.');
    assert.ok(refusalIsRetryable(code), 'a wrong PIN is the one refusal worth another go');
    return true;
  });
});

test('a bad_request carries the server’s words for the parent, and nothing else does', async () => {
  const { fetchImpl, sent } = recorder(
    () =>
      new Response(JSON.stringify({ error: 'bad_request', message: 'chore: no asset "ico-x"' }), {
        status: 400,
      }),
  );
  const actions = createAdminActions({ deviceToken: 'dev-token', fetchImpl });
  const body = {
    labelFull: 'Sweep',
    iconAssetId: 'ico-x',
    kind: 'duty' as const,
    basePoints: 1,
    assignmentModel: 'individual' as const,
    rrule: 'FREQ=DAILY',
    roster: ['child-a'],
  };
  await assert.rejects(actions.createChore(body, '1234'), (err: unknown) => {
    assert.equal(refusalMessageOf(err), 'chore: no asset "ico-x"');
    return true;
  });
  assert.equal(sent[0]?.init.method, 'POST');
  assert.equal(sent[0]?.url, '/api/admin/v1/chores');
  assert.deepEqual(JSON.parse(String(sent[0]?.init.body)), body);

  const pin = recorder(
    () => new Response(JSON.stringify({ error: 'bad_pin', message: 'ask a grown-up' }), { status: 401 }),
  );
  const refused = createAdminActions({ deviceToken: 'dev-token', fetchImpl: pin.fetchImpl });
  await assert.rejects(refused.createChore(body, '0000'), (err: unknown) => {
    assert.equal(refusalMessageOf(err), null, 'only a bad_request is worded for the parent');
    return true;
  });
});

test('a refusal with no JSON body is still a code, not a crash', async () => {
  const { fetchImpl } = recorder(() => new Response('<html>gateway</html>', { status: 502 }));
  const actions = createAdminActions({ fetchImpl });
  await assert.rejects(
    actions.approveRedemption(3, '1234'),
    (err: unknown) => refusalCodeOf(err) === 'unknown',
  );
});

test('every code in the frozen error table has words, and none of them alarm a child', () => {
  // The table, transcribed from docs/api.md §Errors. Adding a code there is a compile error
  // in REFUSAL_WORDS; this asserts the other direction — that nothing was left unworded.
  const FROZEN: readonly RefusalCode[] = [
    'bad_pin',
    'device_revoked',
    'not_claimable',
    'already_claimed',
    'insufficient_points',
    'pending_redemption_exists',
    'stale_client',
    'date_mismatch',
    'wrong_child',
  ];
  for (const code of FROZEN) {
    assert.equal(typeof REFUSAL_WORDS[code], 'string', `${code} has no words`);
  }
  assert.deepEqual(
    Object.keys(REFUSAL_WORDS).sort(),
    [...FROZEN, 'unknown'].sort(),
    'exactly the frozen table plus the catch-all — no invented codes',
  );

  // A child reads this screen over an adult's shoulder. Nothing here may accuse or shout.
  const ALARMING = /!|\berror\b|\bfailed\b|\binvalid\b|\bdenied\b|\bincorrect\b|\bwrong\b/i;
  for (const [code, words] of Object.entries(REFUSAL_WORDS)) {
    assert.ok(!ALARMING.test(words), `${code} reads as an alarm: ${words}`);
  }
});

test('wrong_child says NOTHING, because the contract says render nothing', () => {
  assert.equal(REFUSAL_WORDS['wrong_child'], '');
  assert.ok(!refusalIsRetryable('wrong_child'));
});

test('only a wrong PIN is worth retrying', () => {
  assert.ok(refusalIsRetryable('bad_pin'));
  for (const code of ['not_claimable', 'insufficient_points', 'device_revoked', 'unknown'] as const) {
    assert.ok(!refusalIsRetryable(code), `${code} needs a different fix, not another PIN`);
  }
});

test('an unrecognised code falls to the catch-all rather than to nothing', () => {
  assert.equal(refusalCodeOf({ code: 'teapot' }), 'unknown');
  assert.equal(refusalCodeOf(new Error('no code at all')), 'unknown');
  assert.equal(refusalCodeOf(null), 'unknown');
  assert.equal(refusalCodeOf({ code: 'toString' }), 'unknown', 'prototype keys are not codes');
  assert.equal(refusalCodeOf({ code: 'bad_pin' }), 'bad_pin');
});

// ---------------------------------------------------------------------------
// 4. The component, by source
// ---------------------------------------------------------------------------

/**
 * Comments stripped before every scan: the rules are about CODE, and a doc comment
 * explaining why the PIN is never held would otherwise trip the rule it documents.  A copy
 * of test/unit-h.sources.test.ts's stripper, which owns the shared one.
 */
function stripComments(src: string): string {
  let out = '';
  let i = 0;
  let quote: string | null = null;
  while (i < src.length) {
    const c = src[i] ?? '';
    const next = src[i + 1] ?? '';
    if (quote !== null) {
      out += c;
      if (c === '\\') {
        out += next;
        i += 2;
        continue;
      }
      if (c === quote) quote = null;
      i += 1;
      continue;
    }
    if (c === '"' || c === "'" || c === '`') {
      quote = c;
      out += c;
      i += 1;
      continue;
    }
    if (c === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (c === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

function read(rel: string): string {
  return stripComments(readFileSync(path.join(ROOT, rel), 'utf8'));
}

test('the stripper actually strips (control)', () => {
  assert.equal(stripComments('const a = 1; // parentPin\n').includes('parentPin'), false);
  assert.equal(stripComments('/* parentPin */ const a = 1;').includes('parentPin'), false);
  assert.equal(stripComments("const a = '// parentPin';").includes('parentPin'), true);
});

test('the scan is reading real files, not empty ones (control)', () => {
  for (const rel of [APPROVALS, SCENES, PIN_SHEET, ADMIN_ACTIONS, WALL_APP, VISIT]) {
    assert.ok(read(rel).length > 500, `${rel} did not load`);
  }
});

test('the view reaches the server EXACTLY once, and only with a PIN in hand', () => {
  const code = read(APPROVALS);
  const calls = [...code.matchAll(/performApproval\(([^)]*)\)/g)].map((m) => (m[1] ?? '').trim());
  assert.equal(calls.length, 1, 'one path to the admin surface, or it is not a guardrail');
  assert.match(
    calls[0] ?? '',
    /,\s*parentPin$/,
    'the last argument is the PIN, and there is no arity that omits it',
  );
});

test('the PIN is held for a VISIT TO THE PORTAL, and the server still asks every request', () => {
  // CHANGED TWICE, and the test changed with it both times rather than being deleted.
  //
  // 2026-09-09: it used to be one pad entry per REQUEST. Four chores cost four pad entries —
  // "the grown-ups portal should just be a PIN to enter the grown-ups portal and not all of
  // them" — so the approvals screen began holding it while it was open.
  //
  // 2026-09-10: the portal is TWO screens, and the picture catalog was still asking per action,
  // so putting three new scenes up cost three entries on the screen the same complaint was
  // about. The PIN moved up to WallApp, which is what makes it one door.
  //
  // What must remain true, and is what this asserts: it is React state, never written down,
  // and it dies when the wall leaves the portal — which the idle decay does on its own.
  for (const rel of [APPROVALS, SCENES]) {
    const code = read(rel);
    assert.match(code, /onPin: \(pin: string \| null\) => void/, `${rel} does not take it as a port`);
    // A state binding NAMED for a PIN. Scoped by name rather than by type, because
    // `useState<string | null>` is also how this screen remembers which row is selected —
    // a scanner that cannot tell those apart is a scanner that gets deleted the first time
    // it cries wolf.
    assert.ok(
      !/const \[\w*[Pp]in\w*, set\w+\] = useState/.test(code),
      `${rel} kept a PIN of its own — then the two screens can disagree about the same door`,
    );
    // Cleared the moment the server says it is wrong, in BOTH screens: holding a rejected PIN
    // would turn one typo into every later decision failing for no visible reason.
    assert.match(code, /code === 'bad_pin'[\s\S]{0,200}onPin\(null\)/, `${rel} keeps a bad PIN`);
  }

  // It is owned exactly once, at the root, and its whole lifetime is one line.
  const app = read(WALL_APP);
  assert.match(app, /const \[visitPin, setVisitPin\] = useState<string \| null>\(null\)/);
  assert.match(
    app,
    /setVisitPin\(\(held\) => visitPinAfterMove\(held, destination\)\)/,
    'the lifetime rule must be the tested function, not an inline condition that can drift',
  );

  // The SERVER is untouched: per-request, never a session. That is the half that actually
  // guards anything, and neither change went near it.
  const server = read('src/http/server.ts');
  assert.match(server, /requireParentPin/);
  assert.ok(
    !/session|cookie|token.*pin/i.test(server.replace(/^.*device.*$/gim, '')),
    'the admin surface must not have grown a session',
  );
});

test('the PIN-in-a-screen scanner matches what it claims to (control)', () => {
  const FORBIDDEN = /const \[\w*[Pp]in\w*, set\w+\] = useState/;
  assert.ok(FORBIDDEN.test("const [pin, setPin] = useState<string | null>(null);"));
  assert.ok(FORBIDDEN.test("const [visitPin, setVisitPin] = useState(null);"));
  assert.ok(!FORBIDDEN.test("const [selectedId, setSelectedId] = useState<string | null>(null);"));
});

test('the portal is the two adult screens, and the calendar is not one of them', () => {
  assert.deepEqual([...GROWNUP_DESTINATIONS], ['approvals', 'scenes']);
  assert.ok(isGrownupDestination('approvals'));
  assert.ok(isGrownupDestination('scenes'));
  // The week board decides nothing. Counting it would keep a PIN alive behind a screen with no
  // adult surface on it at all.
  assert.ok(!isGrownupDestination('week'));
  assert.ok(!isGrownupDestination(null));
});

test('leaving the portal forgets the PIN — and the idle wall is leaving', () => {
  assert.equal(visitPinAfterMove('1111', 'scenes'), '1111', 'approve, then put a picture up');
  assert.equal(visitPinAfterMove('1111', 'approvals'), '1111');
  // `null` is the idle wall, the home button, and a child's own screen. All of them are out.
  const OUT: readonly WallDestination[] = ['week', null];
  for (const to of OUT) {
    assert.equal(visitPinAfterMove('1111', to), null, `${String(to)} must not hold a PIN`);
  }
  assert.equal(visitPinAfterMove(null, 'approvals'), null, 'it cannot invent one');
});

test('THE DOOR OPENS — a PIN entered with nothing decided yet is taken, not swallowed', () => {
  // The 2026-09-10 bug, in one assertion per screen. The door called `decide`, which returns
  // immediately when there is no intent, so the pad accepted four digits, cleared its own
  // buffer and sat there: "I hit green check and it just stays on that page." Nothing threw and
  // nothing was logged — the same shape as the seeder that never refreshed.
  for (const rel of [APPROVALS, SCENES]) {
    const code = read(rel);
    const at = code.indexOf('onSubmit={(entered) => {');
    assert.ok(at > -1, `${rel}: the sheet's submit is not a block, so it cannot branch`);
    const body = code.slice(at, code.indexOf('onCancel=', at));
    assert.match(
      body,
      /if \(intent === null\) \{\s*onPin\(entered\);\s*setPadOpen\(false\);\s*return;/,
      `${rel}: the door does not accept a PIN`,
    );
    assert.match(body, /decide\(entered\);/, `${rel}: and a decision still spends one`);
  }
  // CONTROL: the branch above is only load-bearing because `decide` bails without a target.
  // If this guard ever goes, the test above is asserting a redundancy rather than a fix.
  assert.match(read(APPROVALS), /if \(target === null \|\| busy\) return;/);
  assert.match(read(SCENES), /if \(target === null \|\| what === null \|\| busy\) return;/);
});

test('THE ADMIN DOOR IS UNCONDITIONAL — it does not come and go with the queue', () => {
  // REVERSED 2026-09-10, one day after it was written, by the household using it.
  //
  // It read `padOpen && waiting.length > 0`, on the reasoning that a pad in front of "Nothing
  // is waiting" is a lock on an empty room. True of a room containing only a queue. What it
  // produced: with nothing waiting, the admin tab asked for no PIN at all, and the only screen
  // in the building that put up a pad was the picture catalog — "it switched off of the admin
  // tab into the image switcher rather than staying on the admin tab."
  //
  // The room is not empty now. Behind this door are the exchange rate of the whole economy and
  // what every chore pays. A door that appears and disappears is also not a door: an adult
  // learns where the PIN is asked for, and it has to be the same place every time.
  const code = read(APPROVALS);
  assert.match(code, /const doorUp = padOpen;/);
  assert.ok(
    !/doorUp = padOpen &&/.test(code),
    'the admin door must not be conditional on anything',
  );
  // The picture catalog keeps its condition, and the difference is real: an empty catalog has
  // nothing behind it at all, so its pad would gate a sentence saying so.
  assert.match(read(SCENES), /padOpen && \(scenes\.length > 0 \|\| intent !== null\)/);
});

test('no PIN is ever put in state, in storage, or in a cookie', () => {
  for (const rel of [APPROVALS, SCENES, PIN_SHEET, ADMIN_ACTIONS, WALL_APP, VISIT]) {
    const code = read(rel);
    assert.ok(!/localStorage|sessionStorage|document\.cookie/.test(code), `${rel} persists something`);
    // A PIN in COMPONENT state is now allowed, and only there — see the visit test above.
    // What is still forbidden is any binding that OUTLIVES the screen: a module-level `let`,
    // a property hung off a global. Component state dies with the component; these do not.
    const moduleScope = code
      .split('\n')
      .filter((l) => /^(let|var|const)\s/.test(l) || /^\s*(globalThis|window)\.\w*[Pp]in/.test(l));
    assert.ok(
      !moduleScope.some((l) => /\b[Pp]in\b/.test(l) && !/HEADER|LENGTH|PATH|_WORD|paths|Props/.test(l)),
      `${rel} holds a PIN at module scope: ${moduleScope.find((l) => /\b[Pp]in\b/.test(l)) ?? ''}`,
    );
  }
  // The sheet's own buffer is the one place digits live, and it is called `digits` for that
  // reason: it holds keystrokes, not a credential, and it is emptied by the tap that spends it.
  const sheet = read(PIN_SHEET);
  assert.match(sheet, /const \[digits, setDigits\] = useState\(''\)/);
});

test('the sheet empties its buffer BEFORE handing the PIN over, not after', () => {
  const sheet = read(PIN_SHEET);
  const body = sheet.slice(sheet.indexOf('function submit()'));
  const cleared = body.indexOf("setDigits('')");
  const handed = body.indexOf('onSubmit(');
  assert.ok(cleared > -1 && handed > -1, 'the submit path did not parse');
  assert.ok(
    cleared < handed,
    'clear first: nothing may await, throw or re-render between the two',
  );
  assert.ok(!/\bsetTimeout\b|\bawait\b/.test(body), 'and nothing may sit between them either');
});

test('a row button opens the pad and does nothing else', () => {
  const code = read(APPROVALS);
  for (const line of code.split('\n')) {
    if (!/onDecide|onTap=/.test(line)) continue;
    assert.ok(
      !/performApproval|approveChore|approveRedemption|rejectChore|rejectRedemption/.test(line),
      `a control reaches the admin surface directly: ${line.trim()}`,
    );
  }
  // A row either records an intent and raises the pad, or HOLDS the decision with the PIN the
  // screen already has, for the undo window (pass 2). Both paths reach the server only through
  // `send`, the one function in this file that names the admin port, so there is still exactly
  // one path from this screen to the server.
  assert.match(code, /setIntent\(next\)/, 'a row records an intent');
  assert.match(code, /if \(pin !== null\) \{\s*setHeld\(holdDecision\(/, 'or holds the decision on the held PIN');
  assert.match(code, /setIntent\(next\);\s*setPadOpen\(true\);/, 'and otherwise asks for it');
  const spends = (code.match(/performApproval\(/g) ?? []).length;
  assert.equal(spends, 1, 'exactly one call site reaches the admin surface');
});

test('the sheet knows nothing about the server — it only produces digits', () => {
  const sheet = read(PIN_SHEET);
  for (const forbidden of ['performApproval', 'AdminActions', 'fetch', 'approveChore']) {
    assert.ok(!new RegExp(forbidden).test(sheet), `PinSheet reaches for ${forbidden}`);
  }
  // Pi OS Lite runs labwc with no on-screen keyboard: a text field here is a box on a wall
  // that nobody can type into.
  assert.ok(!/<input/.test(sheet), 'a PIN field on this panel is untypable');
  assert.ok(MIN_PARENT_PIN_LENGTH >= 4, 'src/http/auth.ts stores nothing shorter');
});

/**
 * Everything the portal draws once the door is open. The door's branch must RETURN, and close,
 * before the first of these is written.
 */
const PORTAL_MARKS = [
  '<GrownupChrome',
  '<GrownupHome',
  'queue.length === 0 ?',
  '<MoneyPanel',
  '<ChoresPanel',
  '<RoutinesPanel',
  '<SettingsPanel',
] as const;

function doorFirst(code: string): boolean {
  const gate = code.indexOf('if (behindDoor) {');
  const pad = code.indexOf('<PinSheet', gate);
  if (gate < 0 || pad < 0) return false;
  const marks = PORTAL_MARKS.map((m) => code.indexOf(m));
  // The portal has to be there for the door to be gating it.
  if (marks.some((at) => at < 0)) return false;
  const first = Math.min(...marks);
  if (first < pad) return false;
  return /return \(/.test(code.slice(gate, pad)) && /\);\s*\}/.test(code.slice(pad, first));
}

test('the portal is behind the door — nothing past it is drawn until a PIN has been accepted', () => {
  // REVERSED 2026-10. Until then the pad was an OVERLAY on a readable queue, on the reasoning
  // that a child may read what she is waiting on. The queue now shares a door with the ledger,
  // every balance and what each chore pays, and a child reads her own waiting chores on her own
  // card ("Waiting for a grown-up"), so the door went in front of all of it.
  const code = read(APPROVALS);
  assert.ok(doorFirst(code), 'the pad must be its own branch, returned before the portal is drawn');
  assert.match(code, /const behindDoor = doorUp \|\| pin === null/, 'no PIN, no portal');
  // And held is not enough: the settings read is the PIN's first real use, and the door stays
  // shut until it has answered, so a wrong PIN is refused AT the door.
  assert.match(code, /verifying && settings === null && !settingsFailed/);
  assert.match(code, /setVerifying\(intent === null\);/, 'the door, and only the door, verifies');
  // The door's way out leaves the portal. Behind a door there is nothing to step back to.
  assert.match(code, /onCancel=\{\(\) => \{\s*setPadOpen\(false\);[\s\S]{0,120}onLeave\(\);/);

  // CONTROL: the two ways this used to be, or could drift back to.
  const overlay = [
    'return (<GrownupChrome>{waiting.length === 0 ? <GrownupHome /> : <MoneyPanel />}',
    '<ChoresPanel /><RoutinesPanel /><SettingsPanel />',
    'if (behindDoor) {',
    '<PinSheet />',
    '}',
    ');',
  ].join('\n');
  assert.ok(!doorFirst(overlay), 'a pad drawn over the portal is not a door');
  const inside = [
    'if (behindDoor) {',
    '  return (<div><PinSheet /><GrownupChrome><GrownupHome />{waiting.length === 0 ? null : null}',
    '  <MoneyPanel /><ChoresPanel /><RoutinesPanel /><SettingsPanel /></GrownupChrome></div>);',
    '}',
  ].join('\n');
  assert.ok(!doorFirst(inside), 'a portal drawn inside the door branch is not behind it');
});

test('the empty queue says so in words, calmly (control included)', () => {
  const code = read(APPROVALS);
  // `queue`, not `waiting`: a row held in the undo window is drawn but no longer waiting (pass 2).
  assert.match(code, /queue\.length === 0 \?/, 'empty is a rendered state, not a fallthrough');
  assert.match(code, /EMPTY_HEAD_WORD/);
  assert.match(code, /EMPTY_BODY_WORD/);
  const words = [...code.matchAll(/EMPTY_\w+_WORD = '([^']*)'/g)].map((m) => m[1] ?? '');
  assert.equal(words.length, 2, 'both sentences are literals in this file');
  for (const sentence of words) {
    assert.ok(sentence.length > 0);
    assert.ok(!/!|\berror\b|\bnone\b/i.test(sentence), `an empty wall must not sound broken: ${sentence}`);
  }
});

// ---------------------------------------------------------------------------
// 5. The geometry — how many rows fit 420px
// ---------------------------------------------------------------------------

test('the pane is the one the grid gives every screen', () => {
  // 540 - 2x24 pad - 64 header - 16 gutter = 412. It was 420 against a 56px header; the
  // header grew on 2026-08-30 because it holds 64px tap targets and a bar that cannot hold
  // its own floor is a contradiction. Every pane on the wall is 8px shorter as a result,
  // which is the real cost and is why the row arithmetic below is now exact.
  assert.equal(APPROVAL_PANE_HEIGHT_PX, 412);
  assert.equal(layoutPx.wallHeight, 540);
  assert.equal(layoutPx.wallHeaderHeight, 64);
  assert.equal(layoutPx.wallPad, 24);
  assert.equal(layoutPx.wallGutter, 16);
});

test('the pad fits the pane it is drawn over', () => {
  const minTap = bandTypography[AMBIENT_BAND].minTapPx;
  const padHeight = minTap * 4 + spacePx.tapGap * 3;
  const padWidth = minTap * 3 + spacePx.tapGap * 2;
  assert.equal(padHeight, 304);
  assert.equal(padWidth, 224);
  assert.ok(
    padHeight + spacePx.md * 2 <= APPROVAL_PANE_HEIGHT_PX,
    'four rows of keys plus the sheet padding sit inside 420',
  );
});
