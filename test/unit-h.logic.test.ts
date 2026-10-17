/**
 * Unit H acceptance, part 4: the derivations the three bands share.
 *
 * Everything a renderer draws is computed once, here, in the domain layer — pips,
 * progress, label budgets, balances, what is coming up, and how stale the snapshot
 * is.  If any of it were computed inside a band renderer instead, the three
 * renderings could disagree about the same state, which is the failure mode the
 * whole Q3 architecture exists to make impossible.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  Balance,
  CalendarEventView,
  Child,
  ChoreAssignmentView,
  Freshness,
  LocalDate,
  RedemptionRequest,
  RoutineRunStepView,
  RoutineRunView,
  Utc,
} from '../src/types.ts';
import { bandTypography } from '../web/src/design/tokens.ts';
import { pipsForCount, pipsForProgress } from '../web/src/views/logic/pips.ts';
import { choreProgress, nextStep, routineProgress, sortedSteps } from '../web/src/views/logic/progress.ts';
import { bandLabel, truncateWords } from '../web/src/views/logic/labels.ts';
import { balanceFor, cashText } from '../web/src/views/logic/balances.ts';
import {
  ASSET_ROOT,
  avatarRef,
  balancesByChild,
  childById,
  childDayProgress,
  choresForChild,
  orderedChildren,
  pendingRedemptionFor,
  upcomingEvents,
} from '../web/src/views/logic/summary.ts';
import { freshnessStatus } from '../web/src/views/logic/freshness.ts';
import { choreKey, stepKey } from '../web/src/views/logic/tap.ts';
import {
  NULL_WALL_ACTIONS,
  createWallActions,
  isChoreInteractive,
  wallActionPaths,
} from '../web/src/app/actions.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ICON = { assetId: 'a1', url: '/assets/a1.png', isFallback: false };

const step = (id: number, position: number, done: boolean): RoutineRunStepView => ({
  runStepId: id,
  position,
  labelShort: 'Teeth',
  labelFull: 'Brush your teeth properly',
  icon: ICON,
  completedAtUtc: done ? ('2026-08-25T12:05:00Z' as Utc) : null,
});

const run = (steps: RoutineRunStepView[]): RoutineRunView => ({
  runId: 1,
  routineId: 'morning',
  childId: 'cleo',
  localDate: '2026-08-25' as LocalDate,
  labelShort: 'Morning',
  labelFull: 'The whole morning routine',
  icon: ICON,
  opensAtLocal: '06:00' as RoutineRunView['opensAtLocal'],
  closesAtLocal: '09:00' as RoutineRunView['closesAtLocal'],
  steps,
});

const chore = (
  id: number,
  childId: string,
  state: ChoreAssignmentView['state'],
  points = 3,
): ChoreAssignmentView => ({
  assignmentId: id,
  choreId: `c${String(id)}`,
  childId,
  localDate: '2026-08-25' as LocalDate,
  state,
  kind: 'duty',
  dueByLocal: null,
  claimedAtUtc: null,
  points,
  labelShort: 'Feed cat',
  labelFull: 'Feed the cat and refill her water',
  icon: ICON,
  category: 'pet',
});

const child = (id: string, sortOrder: number, band: Child['readingBand']): Child => ({
  id,
  displayName: `${id.toUpperCase()} Example`,
  readingBand: band,
  ledgerEnabled: band !== 'picture',
  avatarAssetId: `avatar-${id}`,
  sortOrder,
});

// ---------------------------------------------------------------------------
// Pips — quantity for a child who cannot read a numeral
// ---------------------------------------------------------------------------

test('a countable quantity is marks; an uncountable one is a heap', () => {
  assert.deepEqual(pipsForCount(3, 'picture'), { filled: 3, empty: 0, overflow: false, count: 3 });
  assert.deepEqual(pipsForCount(5, 'picture'), { filled: 5, empty: 0, overflow: false, count: 5 });
  const lots = pipsForCount(7, 'picture');
  assert.equal(lots.filled, bandTypography.picture.maxPips);
  assert.equal(lots.overflow, true, 'seven dots is no more countable at three than "7" is');
});

test('the fluent band gets no marks at all, only the number behind them', () => {
  const spec = pipsForCount(7, 'fluent');
  assert.deepEqual([spec.filled, spec.empty, spec.overflow], [0, 0, false]);
  assert.equal(spec.count, 7);
});

test('nonsense quantities produce nothing rather than throwing', () => {
  assert.equal(pipsForCount(-4, 'picture').filled, 0);
  assert.equal(pipsForCount(Number.NaN, 'emergent').filled, 0);
  assert.equal(pipsForCount(2.7, 'picture').filled, 2);
});

test('progress marks show what is done AND what is left', () => {
  assert.deepEqual(pipsForProgress(2, 5, 'picture'), { filled: 2, empty: 3, overflow: false, count: 2 });
});

test('a finished routine shows a full row, never a full row plus "and more"', () => {
  // 12 steps, all done, 5 marks: trailing a heap after the last tick would read as
  // "still going", and that is a thing a child acts on wrongly.
  const done = pipsForProgress(12, 12, 'picture');
  assert.equal(done.overflow, false);
  assert.equal(done.empty, 0);
  assert.equal(done.filled, 5);
  const partway = pipsForProgress(3, 12, 'picture');
  assert.equal(partway.overflow, true);
});

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

test('an EMPTY routine is not a finished routine', () => {
  const p = routineProgress(run([]));
  assert.deepEqual([p.total, p.done, p.fraction, p.allDone], [0, 0, 0, false]);
});

test('steps are ordered by position, and the snapshot is never mutated', () => {
  const steps = [step(3, 3, false), step(1, 1, true), step(2, 2, false)];
  const r = run(steps);
  assert.deepEqual(sortedSteps(r).map((s) => s.position), [1, 2, 3]);
  assert.deepEqual(steps.map((s) => s.position), [3, 1, 2], 'the input array is untouched');
  assert.equal(nextStep(r)?.runStepId, 2, 'the next step is the first undone one IN ORDER');
});

test('chore progress ignores the ones somebody else got to first', () => {
  const p = choreProgress([
    chore(1, 'ada', 'approved'),
    chore(2, 'ada', 'pending'),
    chore(3, 'ada', 'superseded'),
  ]);
  assert.deepEqual([p.total, p.done, p.allDone], [2, 1, false]);
});

// ---------------------------------------------------------------------------
// Labels
// ---------------------------------------------------------------------------

test('a label is cut to its band budget, with a mark that it was cut', () => {
  assert.equal(truncateWords('Brush your teeth properly', 2), 'Brush your…');
  assert.equal(truncateWords('Brush teeth', 2), 'Brush teeth');
  assert.equal(truncateWords('   spaced    out   ', 3), 'spaced out');
  assert.equal(truncateWords('anything', 0), '', 'zero words means no words');
});

test('chrome reads the field its band declares — and the picture band reads none', () => {
  const view = { labelShort: 'Morning', labelFull: 'The whole morning routine here now' };
  assert.equal(bandLabel(view, bandTypography.picture), '', 'no words at all for the pre-reader');
  assert.equal(
    bandLabel(view, bandTypography.fluent),
    'The whole morning routine here now',
    'the fluent reader gets the sentence',
  );
  // EMERGENT CHANGED 2026-09-09: `labelFull` capped at six words, where it was `labelShort`
  // capped at two. Her board read `Clear table` / `Dog` / `Fish` and the verdict from the
  // first real evening was that it told her nothing. The cap still bites — six words of a
  // longer sentence, truncated on a word boundary — which is what this asserts.
  // Six words exactly, so the cap does not bite and she gets the whole thing.
  assert.equal(bandLabel(view, bandTypography.emergent), 'The whole morning routine here now');
  // And it still bites past six — truncating on a WORD, which a reader can see, rather than
  // slicing a line, which just looks broken. This is the household's longest real chore.
  const long = {
    labelShort: 'Trash',
    labelFull: 'Collect the trash from around the house and take it out',
  };
  assert.equal(bandLabel(long, bandTypography.emergent), 'Collect the trash from around the…');
  // The fluent band has a cap too — eight words — so this one truncates for her as well, at a
  // later point. Worth knowing: the household's longest chore does not fit ANY band in full.
  assert.equal(
    bandLabel(long, bandTypography.fluent),
    'Collect the trash from around the house and…',
  );
});

// ---------------------------------------------------------------------------
// Balances
// ---------------------------------------------------------------------------

test('a child with no balance row still has a balance', () => {
  // The contract says balances holds one row per active child.  A renderer that
  // trusted that and hit `undefined.points` would blank the card instead.
  const balances: Balance[] = [{ childId: 'ada', points: 12, cashCents: 120 }];
  assert.deepEqual(balanceFor(balances, 'bea'), { childId: 'bea', points: 0, cashCents: null });
  assert.deepEqual(balanceFor(undefined, 'bea').points, 0);
  assert.equal(balanceFor(balances, 'ada').points, 12);
});

test('cash is only shown when there is a rate to show', () => {
  assert.equal(cashText(125), '$1.25');
  assert.equal(cashText(0), '$0.00');
  assert.equal(cashText(null), null);
  assert.equal(cashText(Number.NaN), null);
});

// ---------------------------------------------------------------------------
// Snapshot derivations
// ---------------------------------------------------------------------------

const SNAPSHOT = {
  routines: [run([step(1, 1, true), step(2, 2, false), step(3, 3, false)])],
  chores: [
    chore(10, 'cleo', 'pending'),
    chore(11, 'cleo', 'claimed'),
    chore(12, 'cleo', 'superseded'),
    chore(13, 'ada', 'pending'),
  ],
};

test('a day’s progress is routine steps plus live chores', () => {
  const p = childDayProgress(SNAPSHOT, 'cleo');
  assert.equal(p.total, 5, '3 steps + 2 live chores; the superseded one does not count');
  assert.equal(p.done, 2, '1 step done + 1 chore claimed');
});

test('a claimed chore counts as done for the child who claimed it', () => {
  // She has finished her part and is waiting on an adult.  A mark that refuses to
  // move until a parent walks past teaches her that tapping does nothing.
  const p = childDayProgress({ routines: [], chores: [chore(1, 'cleo', 'claimed')] }, 'cleo');
  assert.equal(p.done, 1);
});

test('progress moves under the finger, before the server has heard about it', () => {
  const optimistic = new Map<string, boolean>([[stepKey(2), true], [choreKey(10), true]]);
  const p = childDayProgress(SNAPSHOT, 'cleo', (key, server) => optimistic.get(key) ?? server);
  assert.equal(p.done, 4);
});

test('chores are filtered to the child whose screen this is', () => {
  assert.deepEqual(choresForChild(SNAPSHOT.chores, 'ada').map((c) => c.assignmentId), [13]);
});

test('finished events drop off the wall; all-day events lead it', () => {
  const events: CalendarEventView[] = [
    {
      id: 1,
      title: 'Soccer',
      when: { kind: 'timed', startsAtUtc: '2026-08-25T13:00:00Z' as Utc, endsAtUtc: '2026-08-25T14:00:00Z' as Utc },
      sourceId: 's',
      colourToken: '--c-id-1',
      childId: 'ada',
      icon: ICON,
      emoji: null,
      category: null,
    },
    {
      id: 2,
      title: 'Library day',
      when: { kind: 'allDay', startDate: '2026-08-25' as LocalDate, endDate: '2026-08-26' as LocalDate },
      sourceId: 's',
      colourToken: '--c-id-2',
      childId: null,
      icon: ICON,
      emoji: null,
      category: null,
    },
    {
      id: 3,
      title: 'Dentist',
      when: { kind: 'timed', startsAtUtc: '2026-08-25T20:00:00Z' as Utc, endsAtUtc: '2026-08-25T21:00:00Z' as Utc },
      sourceId: 's',
      colourToken: '--c-id-3',
      childId: 'bea',
      icon: ICON,
      emoji: null,
      category: null,
    },
  ];
  const nowMs = Date.parse('2026-08-25T15:00:00Z');
  const all = upcomingEvents(events, { childId: null, nowMs, limit: 10 });
  assert.deepEqual(all.map((e) => e.id), [2, 3], 'soccer already ended');

  const hers = upcomingEvents(events, { childId: 'bea', nowMs, limit: 10 });
  assert.deepEqual(hers.map((e) => e.id), [2, 3], 'household events belong to everyone');

  assert.equal(upcomingEvents(events, { childId: null, nowMs, limit: 1 }).length, 1);
});

/**
 * The regression from 2026-08-25, the day a real calendar was first connected.
 *
 * With no events wired up, `upcomingEvents` had never been asked to CHOOSE. The moment it
 * was, it put a birthday two months out at the top of the wall and never showed that
 * afternoon's appointments — because every all-day event outranked every timed one, and
 * all-day events tied on `id`, which is per-source insertion order rather than date.
 */
test('soonest first: a distant all-day event never outranks today', () => {
  const ev = (
    id: number,
    title: string,
    when: CalendarEventView['when'],
  ): CalendarEventView => ({
    id,
    title,
    when,
    sourceId: 's',
    colourToken: '--c-id-1',
    childId: null,
    icon: ICON,
    emoji: null,
    category: null,
  });
  // id 1 on purpose: the birthdays calendar synced first, so its event held the lowest id
  // and won every tie-break outright.
  const events: CalendarEventView[] = [
    ev(1, 'Birthday in October', {
      kind: 'allDay',
      startDate: '2026-10-22' as LocalDate,
      endDate: '2026-10-23' as LocalDate,
    }),
    ev(4, 'Mountains', {
      kind: 'allDay',
      startDate: '2026-08-26' as LocalDate,
      endDate: '2026-08-31' as LocalDate,
    }),
    ev(20, 'Gymnastics', {
      kind: 'timed',
      startsAtUtc: '2026-08-25T22:30:00Z' as Utc,
      endsAtUtc: '2026-08-25T23:30:00Z' as Utc,
    }),
  ];
  // 11:48 local on the 25th: gymnastics is this afternoon, Mountains is tomorrow.
  const nowMs = Date.parse('2026-08-25T17:48:00Z');
  assert.deepEqual(
    upcomingEvents(events, { childId: null, nowMs, limit: 4 }).map((e) => e.id),
    [20, 4, 1],
    'today before tomorrow before October, whatever the kind',
  );
  assert.deepEqual(
    upcomingEvents(events, { childId: null, nowMs, limit: 1 }).map((e) => e.title),
    ['Gymnastics'],
    'the one slot goes to what happens next',
  );
});

test('an all-day event that is under way ranks as today, and one that ended is gone', () => {
  const ev = (id: number, title: string, startDate: string, endDate: string): CalendarEventView => ({
    id,
    title,
    when: { kind: 'allDay', startDate: startDate as LocalDate, endDate: endDate as LocalDate },
    sourceId: 's',
    colourToken: '--c-id-1',
    childId: null,
    icon: ICON,
    emoji: null,
    category: null,
  });
  const events: CalendarEventView[] = [
    // Began two days ago, still running. Not a past event and not a future one.
    ev(1, 'Mountains', '2026-08-26', '2026-08-31'),
    // `endDate` is EXCLUSIVE, so this one is over ON the 28th. The sync window reaches a day
    // back, so nothing else expires it.
    ev(2, 'Yesterday', '2026-08-27', '2026-08-28'),
    ev(3, 'Next week', '2026-09-03', '2026-09-04'),
  ];
  const nowMs = Date.parse('2026-08-28T18:00:00Z'); // noon local on the 28th
  assert.deepEqual(
    upcomingEvents(events, { childId: null, nowMs, limit: 5 }).map((e) => e.id),
    [1, 3],
    'the one under way leads; the one that ended is dropped',
  );
});

test('an event we failed to parse is KEPT, not silently dropped', () => {
  const broken: CalendarEventView[] = [
    {
      id: 9,
      title: 'Orthodontist',
      when: { kind: 'timed', startsAtUtc: 'nope' as Utc, endsAtUtc: 'nope' as Utc },
      sourceId: 's',
      colourToken: '--c-id-1',
      childId: null,
      icon: ICON,
      emoji: null,
      category: null,
    },
  ];
  assert.equal(upcomingEvents(broken, { childId: null, nowMs: Date.now(), limit: 5 }).length, 1);
});

test('one open redemption per child, and never a stray decided one', () => {
  const reqs: RedemptionRequest[] = [
    {
      id: 1,
      childId: 'ada',
      pointsRequested: 10,
      centsPerPoint: 10,
      cashCents: 100,
      state: 'approved',
      requestedAtUtc: '2026-08-24T00:00:00Z' as Utc,
      decidedAtUtc: '2026-08-24T01:00:00Z' as Utc,
    },
    {
      id: 2,
      childId: 'ada',
      pointsRequested: 4,
      centsPerPoint: 10,
      cashCents: 40,
      state: 'pending',
      requestedAtUtc: '2026-08-25T00:00:00Z' as Utc,
      decidedAtUtc: null,
    },
  ];
  assert.equal(pendingRedemptionFor(reqs, 'ada')?.id, 2);
  assert.equal(pendingRedemptionFor(reqs, 'bea'), null);
  assert.equal(pendingRedemptionFor(undefined, 'ada'), null);
});

test('children hold their fixed left-to-right order', () => {
  const kids = [child('cleo', 2, 'picture'), child('ada', 0, 'fluent'), child('bea', 1, 'emergent')];
  assert.deepEqual(orderedChildren(kids).map((c) => c.id), ['ada', 'bea', 'cleo']);
  assert.equal(childById(kids, 'bea')?.readingBand, 'emergent');
  assert.equal(childById(kids, 'nobody'), null);
  assert.equal(childById(kids, null), null);
  assert.equal(balancesByChild(undefined).size, 0);
});

test('an avatar id becomes a URL in exactly one place', () => {
  // Every other image arrives as a resolved AssetRef; Child carries a bare id, and
  // docs/api.md documents no asset route, so this assumption lives in one function.
  const ref = avatarRef({ avatarAssetId: 'ada avatar.png' });
  assert.equal(ref.url, `${ASSET_ROOT}ada%20avatar.png`);
  assert.equal(avatarRef({ avatarAssetId: '' }).url, '', 'an empty id draws the shape, not a broken image');
});

// ---------------------------------------------------------------------------
// Freshness — wrongness is rendered, not hidden
// ---------------------------------------------------------------------------

const freshness = (over: Partial<Freshness> = {}): Freshness => ({
  snapshotLocalDate: '2026-08-25' as LocalDate,
  generatedAtUtc: '2026-08-25T12:00:00Z' as Utc,
  calendarSyncAgeSeconds: 120,
  calendarConfigured: true,
  routineMaterialization: 'ok',
  ...over,
});

test('a fresh snapshot for today reads as ok', () => {
  const s = freshnessStatus(freshness(), '2026-08-25' as LocalDate, '2026-08-25' as LocalDate);
  assert.equal(s.tone, 'ok');
  assert.equal(s.dayMismatch, false);
});

test('a snapshot built for YESTERDAY is labelled, never presented with confidence', () => {
  const s = freshnessStatus(
    freshness({ snapshotLocalDate: '2026-08-24' as LocalDate }),
    '2026-08-25' as LocalDate,
    '2026-08-25' as LocalDate,
  );
  assert.equal(s.tone, 'stale');
  assert.equal(s.dayMismatch, true);
  assert.equal(s.requestMismatch, true);
});

test('a failed materialization outranks everything else', () => {
  const s = freshnessStatus(
    freshness({ routineMaterialization: 'error' }),
    '2026-08-25' as LocalDate,
    '2026-08-25' as LocalDate,
  );
  assert.equal(s.tone, 'error');
  assert.match(s.words.full, /grown-up/);
});

test('a CONFIGURED calendar that has never synced is stale, not silently fine', () => {
  const s = freshnessStatus(
    freshness({ calendarSyncAgeSeconds: null, calendarConfigured: true }),
    '2026-08-25' as LocalDate,
    '2026-08-25' as LocalDate,
  );
  assert.equal(s.tone, 'stale');
});

test('no calendar configured is NOT staleness — nothing is owed, so nothing is late', () => {
  // Shipped wrong for the whole of M1 and found on the first real deploy: with no calendar
  // wired up the wall read "Showing older information" permanently. A badge that never turns
  // off is a badge nobody reads, which costs exactly the signal this pill exists to carry.
  const s = freshnessStatus(
    freshness({ calendarSyncAgeSeconds: null, calendarConfigured: false }),
    '2026-08-25' as LocalDate,
    '2026-08-25' as LocalDate,
  );
  assert.equal(s.tone, 'ok');
});

test('an unconfigured calendar never masks a REAL problem', () => {
  // The fix must not become a way to go quiet. Routine trouble and a date mismatch are
  // reported on their own channels regardless of the calendar.
  const stale = freshnessStatus(
    freshness({ calendarConfigured: false, routineMaterialization: 'stale' }),
    '2026-08-25' as LocalDate,
    '2026-08-25' as LocalDate,
  );
  assert.equal(stale.tone, 'stale');

  const mismatch = freshnessStatus(
    freshness({ calendarConfigured: false, snapshotLocalDate: '2026-08-24' as LocalDate }),
    '2026-08-25' as LocalDate,
    '2026-08-25' as LocalDate,
  );
  assert.equal(mismatch.tone, 'stale');
  assert.equal(mismatch.dayMismatch, true);
});

// ---------------------------------------------------------------------------
// The action port
// ---------------------------------------------------------------------------

test('a pending chore is tappable, and so is a claimed one — that is the undo', () => {
  assert.equal(isChoreInteractive('pending'), true);
  // Until 2026-09-13 `claimed` was inert, which made the documented second-tap undo dead
  // code: the card stopped being a control in the same render that turned it to Waiting.
  assert.equal(isChoreInteractive('claimed'), true);
  for (const state of ['approved', 'superseded'] as const) {
    assert.equal(isChoreInteractive(state), false, `${state} is a grown-up's turn`);
  }
});

test('the wall speaks the documented device-token routes', () => {
  const p = wallActionPaths();
  assert.equal(p.claimChore(4), '/api/wall/v1/chores/4/claim');
  assert.equal(p.unclaimChore(4), '/api/wall/v1/chores/4/unclaim');
  assert.equal(p.completeStep(9), '/api/wall/v1/routines/steps/9/complete');
  assert.equal(p.revokeStep(9), '/api/wall/v1/routines/steps/9/revoke');
  assert.equal(p.requestRedemption(), '/api/wall/v1/redemptions');
  assert.equal(p.cancelRedemption(2), '/api/wall/v1/redemptions/2/cancel');
  assert.equal(p.setDogDeed('eat-underwear'), '/api/wall/v1/dog/deeds/eat-underwear');
});

test('an action POSTs the acting child and carries the device token', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const actions = createWallActions({
    deviceToken: 'tok',
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      return new Response('{}', { status: 200 });
    },
  });
  await actions.completeStep(9, 'cleo');
  const call = calls[0];
  assert.ok(call);
  assert.equal(call.url, '/api/wall/v1/routines/steps/9/complete');
  assert.equal(call.init.method, 'POST');
  assert.deepEqual(JSON.parse(String(call.init.body)), { childId: 'cleo' });
  assert.equal((call.init.headers as Record<string, string>)['authorization'], 'Device tok');
});

test('a rejected write surfaces its code so the tap can revert', async () => {
  const actions = createWallActions({
    fetchImpl: async () =>
      new Response(JSON.stringify({ error: 'already_claimed', message: 'lost the race' }), { status: 409 }),
  });
  await assert.rejects(
    () => actions.claimChore(1, 'bea'),
    (err: unknown) => (err as { code: string }).code === 'already_claimed',
  );
});

test('a non-JSON failure is still just a failure, not an exception in the parser', async () => {
  const actions = createWallActions({ fetchImpl: async () => new Response('<html>502</html>', { status: 502 }) });
  await assert.rejects(
    () => actions.requestRedemption('ada', 10),
    (err: unknown) => (err as { code: string }).code === 'unknown',
  );
});

test('the null port does nothing, successfully', async () => {
  await NULL_WALL_ACTIONS.claimChore(1, 'ada');
  await NULL_WALL_ACTIONS.cancelRedemption(1, 'ada');
});
