/**
 * Unit H — the grown-up portal's words and numbers (web/src/views/logic/grownup.ts, 2026-10-11).
 *
 * Every screen behind the door is drawn from this module: the Home tiles, the queue's lines, the
 * Money screen's rate and balances, the chore list, the routine pills and the calendar's health.
 * The tests DRIVE the functions — a rate stepper walked from rail to rail, a schedule read by
 * both this module and the server's evaluator — because the failure this wall keeps shipping is
 * a control that looks right and does nothing.
 *
 * Synthetic household only: Augusta, Benedict and Cordelia (who earns stickers, not points).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type {
  AssetRef,
  Child,
  ChoreAssignmentView,
  ChoreState,
  DepartureRules,
  LocalDate,
  RoutineRunView,
  Utc,
} from '../src/types.ts';
import { evaluateRrule } from '../src/domain/chores/recurrence.ts';
import {
  MAX_CENTS_PER_POINT,
  MAX_CHORE_POINTS,
  MIN_CENTS_PER_POINT,
  MIN_CHORE_POINTS,
} from '../src/domain/settings/index.ts';
import {
  APPROVAL_PANE_HEIGHT_PX,
  CENTS_PER_POINT_STEP,
  REFUSAL_WORDS,
  approvalRowHeightPx,
  type ApprovalItem,
  type CalendarSourceHealth,
  type ChoreCatalog,
  type ChoreCatalogEntry,
  type LedgerHistory,
  type SceneCatalog,
} from '../web/src/app/adminActions.ts';
import { POINTS_MAX, POINTS_MIN } from '../web/src/views/logic/choreDraft.ts';
import {
  FETCH_UNAVAILABLE_WORDS,
  GROWNUP_SECTIONS,
  HOME_TILES,
  HOME_TILE_DOORS,
  HOME_TILE_GLYPHS,
  HOME_TILE_WORDS,
  LEDGER_LINES_MAX,
  NO_RATE_WORDS,
  NO_WORTH_MARK,
  RATE_MAX_CENTS,
  RATE_MIN_CENTS,
  SECTION_GLYPHS,
  SECTION_NEEDS,
  SECTION_TITLES,
  SECTION_WORDS,
  STICKERS_ONLY_WORDS,
  TOAST_HEIGHT_PX,
  TOAST_OK_MS,
  UNKNOWN_SCHEDULE_WORDS,
  addedChoreId,
  agoText,
  approvalMeta,
  calendarLine,
  centsWords,
  choreListRows,
  choreListSummary,
  dayWords,
  daysWords,
  decidedWords,
  doorDetail,
  facesInTurnOrder,
  fetchOutcomeToast,
  fetchRefusalWords,
  grownupSectionsFor,
  headerClockFit,
  homeTileDoorFor,
  homeTilesFor,
  leaveBySummary,
  ledgerLines,
  moneyRows,
  moneyTile,
  newRequestId,
  rateStep,
  rateWords,
  routineGlyph,
  routineWhenLine,
  sceneTile,
  scheduleWords,
  settingsTile,
  sheetInnerHeightPx,
  tabWidthPx,
  tabWordsFit,
  tileBigFit,
  toastExpiresAtMs,
  todayTile,
  waitingTile,
  waitingRowsInView,
  windowText,
  withWorths,
  type ChoreListRow,
  type GrownupSection,
} from '../web/src/views/logic/grownup.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TODAY = '2026-10-11' as LocalDate;
/** 4:30 PM in Denver on TODAY. */
const NOW = Date.parse('2026-10-11T22:30:00.000Z');

function asset(id: string): AssetRef {
  return { assetId: id, url: `/assets/${id}`, isFallback: false };
}

function child(id: string, displayName: string, sortOrder: number, ledgerEnabled = true): Child {
  return { id, displayName, readingBand: 'fluent', ledgerEnabled, avatarAssetId: `${id}-face`, sortOrder };
}

const AUGUSTA = child('child-a', 'Augusta', 0);
const BENEDICT = child('child-b', 'Benedict', 1);
const CORDELIA = child('child-c', 'Cordelia', 2, false);
/** Deliberately out of household order: every list must sort by sortOrder, not arrival. */
const HOUSEHOLD = [CORDELIA, AUGUSTA, BENEDICT];

function minutesAgo(n: number): string {
  return new Date(NOW - n * 60_000).toISOString();
}

function item(over: Partial<ApprovalItem> = {}): ApprovalItem {
  return {
    key: 'chore:1',
    kind: 'chore',
    id: 1,
    childId: 'child-a',
    childName: 'Augusta',
    avatar: asset('child-a-face'),
    sortOrder: 0,
    labelFull: 'Tidy the playroom',
    icon: asset('icon-1'),
    points: 2,
    cashCents: null,
    atUtc: minutesAgo(18),
    ...over,
  };
}

function choreView(assignmentId: number, childId: string, state: ChoreState, labelFull = 'Feed the fish'): ChoreAssignmentView {
  return {
    assignmentId,
    choreId: `chore-${String(assignmentId)}`,
    childId,
    localDate: TODAY,
    state,
    kind: 'extra',
    dueByLocal: null,
    claimedAtUtc: null,
    points: 2,
    labelShort: labelFull,
    labelFull,
    icon: asset(`icon-${String(assignmentId)}`),
    category: 'tidy',
  };
}

function routineRun(runId: number, childId: string, done: readonly boolean[]): RoutineRunView {
  return {
    runId,
    routineId: 'morning',
    childId,
    localDate: TODAY,
    labelShort: 'Morning',
    labelFull: 'Morning routine',
    icon: asset('routine-morning'),
    opensAtLocal: '06:00',
    closesAtLocal: '08:00',
    steps: done.map((d, i) => ({
      runStepId: runId * 10 + i,
      position: i,
      labelShort: `Step ${String(i)}`,
      labelFull: `Step ${String(i)}`,
      icon: asset(`step-${String(i)}`),
      completedAtUtc: d ? (minutesAgo(30) as Utc) : null,
    })),
  } as RoutineRunView;
}

function catalogEntry(over: Partial<ChoreCatalogEntry> & Pick<ChoreCatalogEntry, 'id'>): ChoreCatalogEntry {
  return {
    labelShort: over.id,
    labelFull: over.id,
    icon: asset(`icon-${over.id}`),
    category: 'tidy',
    assignmentModel: 'individual',
    basePoints: 0,
    kind: 'duty',
    rrule: 'FREQ=DAILY',
    dueByLocal: null,
    active: true,
    roster: [
      { childId: 'child-a', position: 0 },
      { childId: 'child-b', position: 1 },
      { childId: 'child-c', position: 2 },
    ],
    rosterExplicit: false,
    ...over,
  };
}

const RULES: DepartureRules = {
  enabled: true,
  readyMinutes: 25,
  travelMinutes: 10,
  school: { leaveAt: '07:35', days: ['MO', 'TU', 'WE', 'TH', 'FR'], label: 'School' },
  eventCategories: ['dance', 'sport'],
} as DepartureRules;

/** A ruler a test can reason about: 8 px a character at 17 px, proportional elsewhere. */
const ruler = (words: string, sizePx: number): number => words.length * 8 * (sizePx / 17);

// ---------------------------------------------------------------------------
// 1. The sections
// ---------------------------------------------------------------------------

test('six sections, Home first, and every one has a word, a title, a glyph and its needs', () => {
  assert.deepEqual(GROWNUP_SECTIONS, ['home', 'waiting', 'chores', 'routines', 'money', 'settings']);
  for (const s of GROWNUP_SECTIONS) {
    assert.ok(SECTION_WORDS[s].length > 0, s);
    assert.ok(SECTION_TITLES[s].length > 0, s);
    assert.ok(SECTION_GLYPHS[s].length > 0, s);
    assert.ok(SECTION_NEEDS[s] !== undefined, s);
  }
  assert.equal(SECTION_TITLES.home, 'Grown-ups', 'Home is headed by the portal’s own name');
  assert.equal(SECTION_NEEDS.home.settings, true, 'Home reads settings — the PIN is checked at the door');
  assert.equal(SECTION_NEEDS.waiting.settings, false, 'the queue is in the snapshot and needs no read');
});

test('every Home tile is a door to a real section, and the picture tile leaves the shell', () => {
  for (const t of HOME_TILES) {
    assert.ok(HOME_TILE_WORDS[t].length > 0);
    assert.ok(HOME_TILE_GLYPHS[t].length > 0);
    const door = HOME_TILE_DOORS[t];
    if (door.kind === 'section') assert.ok(GROWNUP_SECTIONS.includes(door.section), t);
  }
  assert.deepEqual(HOME_TILE_DOORS.scene, { kind: 'pictures' });
  assert.deepEqual(HOME_TILE_DOORS.calendar, { kind: 'section', section: 'settings' });
});

// ---------------------------------------------------------------------------
// 2. Time
// ---------------------------------------------------------------------------

test('a claim says how long it has waited, and never a negative or a NaN', () => {
  assert.equal(agoText(null, NOW), null);
  assert.equal(agoText('not a date', NOW), null);
  assert.equal(agoText(minutesAgo(0), NOW), 'just now');
  assert.equal(agoText(new Date(NOW + 5_000).toISOString(), NOW), 'just now', 'a clock a second ahead');
  assert.equal(agoText(minutesAgo(1), NOW), '1 min ago');
  assert.equal(agoText(minutesAgo(18), NOW), '18 min ago');
  assert.equal(agoText(minutesAgo(60), NOW), '1 hour ago');
  assert.equal(agoText(minutesAgo(150), NOW), '2 hours ago');
  assert.equal(agoText(minutesAgo(24 * 60), NOW), '1 day ago');
  assert.equal(agoText(minutesAgo(3 * 24 * 60 + 5), NOW), '3 days ago');
});

test('a ledger day is Today, Yesterday, a weekday this week, then a date', () => {
  assert.equal(dayWords(TODAY, TODAY), 'Today');
  assert.equal(dayWords('2026-10-10' as LocalDate, TODAY), 'Yesterday');
  assert.equal(dayWords('2026-10-08' as LocalDate, TODAY), 'Thu');
  assert.equal(dayWords('2026-10-05' as LocalDate, TODAY), 'Mon');
  assert.equal(dayWords('2026-10-04' as LocalDate, TODAY), 'Oct 4');
  assert.equal(dayWords('garbage' as LocalDate, TODAY), '');
});

// ---------------------------------------------------------------------------
// 3. The door and the queue
// ---------------------------------------------------------------------------

test('the door says what is behind it, and how long the PIN lasts', () => {
  assert.match(doorDetail(0), /^Nothing is waiting\. /);
  assert.match(doorDetail(1), /^1 thing is waiting to be looked at\. /);
  assert.match(doorDetail(3), /^3 things are waiting to be looked at\. /);
  assert.match(doorDetail(3), /it lasts until you leave\.$/);
});

test('a queue row names the child, what it pays and how long it has waited', () => {
  assert.equal(approvalMeta(item(), NOW), 'Augusta · 2 points · 18 min ago');
  assert.equal(approvalMeta(item({ points: 1 }), NOW), 'Augusta · 1 point · 18 min ago');
  assert.equal(
    approvalMeta(item({ points: 0, childName: 'Cordelia' }), NOW),
    'Cordelia · no points · 18 min ago',
    'a chore that pays nothing says so rather than "0 points"',
  );
  assert.equal(
    approvalMeta(item({ kind: 'redemption', points: 40, cashCents: 400, atUtc: null }), NOW),
    'Augusta · 40 points · $4.00',
    'an older server with no instant loses one phrase, not the row',
  );
});

test('the strip after a decision says what was decided, in the key’s own words', () => {
  assert.equal(decidedWords(item(), 'approve'), 'Approved — Augusta · Tidy the playroom · 2 points');
  assert.equal(decidedWords(item(), 'reject'), 'Sent back — Augusta · Tidy the playroom');
  const cash = item({ kind: 'redemption', labelFull: 'Cash out', points: 40, cashCents: 400 });
  assert.equal(decidedWords(cash, 'approve'), 'Paid out — Augusta · Cash out · $4.00');
  assert.equal(decidedWords(cash, 'reject'), 'Not yet — Augusta · Cash out');
});

test('a good outcome goes by itself; a refusal stays until it is dealt with', () => {
  assert.equal(toastExpiresAtMs({ tone: 'ok', words: 'x', atMs: 1000 }), 1000 + TOAST_OK_MS);
  assert.equal(toastExpiresAtMs({ tone: 'trouble', words: 'x', atMs: 1000 }), null);
});

// ---------------------------------------------------------------------------
// 4. Money
// ---------------------------------------------------------------------------

test('the rate’s rails and the worth stepper’s are the server’s, or inside them', () => {
  assert.equal(RATE_MIN_CENTS, MIN_CENTS_PER_POINT);
  assert.equal(RATE_MAX_CENTS, MAX_CENTS_PER_POINT);
  assert.equal(POINTS_MIN, MIN_CHORE_POINTS);
  assert.ok(POINTS_MAX <= MAX_CHORE_POINTS, 'the wall may ask for less than the server allows, never more');
});

test('the rate stepper snaps to nickels, and its keys go inert at the rails', () => {
  const cases: readonly [number, number | null, number | null][] = [
    [0, null, 5],
    [1, null, 5],
    [3, 1, 5],
    [5, 1, 10],
    [7, 5, 10],
    [10, 5, 15],
    [498, 495, 500],
    [500, 495, null],
    [600, 500, null],
  ];
  for (const [cents, down, up] of cases) {
    assert.deepEqual(rateStep(cents), { down, up }, `${String(cents)}¢`);
  }
});

test('walking the rate from rail to rail stays on the grid and inside the bounds', () => {
  let at = RATE_MIN_CENTS;
  const seen: number[] = [at];
  for (let i = 0; i < 200; i += 1) {
    const next = rateStep(at).up;
    if (next === null) break;
    assert.ok(next > at && next <= RATE_MAX_CENTS);
    at = next;
    seen.push(at);
  }
  assert.equal(at, RATE_MAX_CENTS, 'up reaches the top rail');
  assert.ok(seen.slice(1).every((c) => c % CENTS_PER_POINT_STEP === 0), 'every stop above the floor is a nickel');
  for (let i = 0; i < 200; i += 1) {
    const next = rateStep(at).down;
    if (next === null) break;
    assert.ok(next < at && next >= RATE_MIN_CENTS);
    at = next;
  }
  assert.equal(at, RATE_MIN_CENTS, 'down reaches the floor');
});

test('the rate reads as money, with a worked example', () => {
  assert.equal(centsWords(10), '10¢');
  assert.equal(centsWords(99), '99¢');
  assert.equal(centsWords(100), '$1.00');
  assert.equal(centsWords(125), '$1.25');
  assert.deepEqual(rateWords(10), { head: '1 point = 10¢', example: '10 points = $1.00' });
  assert.deepEqual(rateWords(125), { head: '1 point = $1.25', example: '10 points = $12.50' });
  assert.equal(rateWords(0), NO_RATE_WORDS);
  assert.equal(rateWords(null), NO_RATE_WORDS);
});

test('a money row says points, cash and streak — and stickers for the child with no ledger', () => {
  const rows = moneyRows({
    children: HOUSEHOLD,
    balances: [
      { childId: 'child-a', points: 12, cashCents: 120 },
      { childId: 'child-b', points: 0, cashCents: 0 },
      { childId: 'child-c', points: 0, cashCents: null },
    ],
    streaks: [
      { childId: 'child-a', days: 4 },
      { childId: 'child-b', days: null },
      { childId: 'child-c', days: 1 },
    ],
  });
  assert.deepEqual(
    rows.map((r) => r.name),
    ['Augusta', 'Benedict', 'Cordelia'],
    'household order, not arrival order',
  );
  const [a, b, c] = rows as [(typeof rows)[number], (typeof rows)[number], (typeof rows)[number]];
  assert.equal(a.line, '12 points · $1.20 · 4 days in a row');
  assert.equal(a.canAdd, true);
  assert.equal(a.canTakeOff, true);
  assert.equal(b.line, '0 points · $0.00');
  assert.equal(b.canTakeOff, false, 'nothing to take off a zero balance');
  assert.equal(c.line, `${STICKERS_ONLY_WORDS} · 1 day in a row`);
  assert.equal(c.canAdd, false, 'no ± at all for a child who earns stickers');
  assert.equal(c.canTakeOff, false);
});

test('a ledger reads newest first, names today’s chores and says who moved a balance', () => {
  const history: LedgerHistory = {
    childId: 'child-a',
    total: 6,
    entries: [
      { id: 1, childId: 'child-a', delta: 3, reason: 'chore_approved', refType: 'chore_assignment', refId: '7', note: null, createdAtUtc: '2026-10-04T15:00:00.000Z' as Utc, runningTotal: 3 },
      { id: 2, childId: 'child-a', delta: 10, reason: 'adjustment', refType: 'manual', refId: 'r1', note: null, createdAtUtc: '2026-10-09T15:00:00.000Z' as Utc, runningTotal: 13 },
      { id: 3, childId: 'child-a', delta: -10, reason: 'redemption_approved', refType: 'redemption_request', refId: '4', note: null, createdAtUtc: '2026-10-10T15:00:00.000Z' as Utc, runningTotal: 3 },
      { id: 4, childId: 'child-a', delta: -1, reason: 'adjustment', refType: 'manual', refId: 'r2', note: '  ', createdAtUtc: '2026-10-11T15:00:00.000Z' as Utc, runningTotal: 2 },
      { id: 5, childId: 'child-a', delta: 4, reason: 'chore_approved', refType: 'chore_assignment', refId: '42', note: null, createdAtUtc: '2026-10-11T16:00:00.000Z' as Utc, runningTotal: 6 },
      { id: 6, childId: 'child-a', delta: 0, reason: 'adjustment', refType: 'manual', refId: 'r3', note: 'Birthday', createdAtUtc: '2026-10-11T17:00:00.000Z' as Utc, runningTotal: 6 },
    ],
  } as LedgerHistory;
  const lines = ledgerLines(history, [choreView(42, 'child-a', 'approved', 'Water the plants')], TODAY);
  assert.deepEqual(
    lines.map((l) => [l.day, l.words, l.delta, l.tone]),
    [
      ['Today', 'Birthday', '0', 'none'],
      ['Today', 'Water the plants', '+4', 'up'],
      ['Today', 'Taken off by a grown-up', '−1', 'down'],
      ['Yesterday', 'Cash out', '−10', 'down'],
      ['Fri', 'Added by a grown-up', '+10', 'up'],
      ['Oct 4', 'Chore approved', '+3', 'up'],
    ],
  );
  assert.deepEqual(ledgerLines(null, [], TODAY), []);
});

test('a long ledger is cut to the newest lines', () => {
  const entries = Array.from({ length: LEDGER_LINES_MAX + 5 }, (_, i) => ({
    id: i + 1,
    childId: 'child-a',
    delta: 1,
    reason: 'adjustment' as const,
    refType: 'manual' as const,
    refId: `r${String(i)}`,
    note: null,
    createdAtUtc: '2026-10-11T15:00:00.000Z' as Utc,
    runningTotal: i + 1,
  }));
  const lines = ledgerLines({ childId: 'child-a', total: entries.length, entries } as LedgerHistory, [], TODAY);
  assert.equal(lines.length, LEDGER_LINES_MAX);
  assert.equal(lines[0]?.id, LEDGER_LINES_MAX + 5, 'the newest survives the cut');
});

test('every tap on a ± key gets its own request id', () => {
  const a = newRequestId();
  const b = newRequestId();
  assert.ok(a.length > 0 && b.length > 0);
  assert.notEqual(a, b, 'a repeated id is paid once — the second bonus would vanish');
});

// ---------------------------------------------------------------------------
// 5. Chores
// ---------------------------------------------------------------------------

test('the schedule words and the server agree on which rules exist', () => {
  // A date inside every DTSTART/UNTIL below: the server returns early (supported) for a date
  // outside a bound, before it reads the rest of the rule.
  const date = '2026-10-12' as LocalDate;
  const rules = [
    'FREQ=DAILY',
    'RRULE:FREQ=DAILY',
    'freq=daily',
    ' FREQ=DAILY ; ',
    'FREQ=DAILY;INTERVAL=2',
    'FREQ=DAILY;INTERVAL=0',
    'FREQ=DAILY;INTERVAL=abc',
    'FREQ=DAILY;INTERVAL=3x',
    'FREQ=DAILY;BYDAY=MO',
    'FREQ=DAILY;COUNT=3',
    'FREQ=DAILY;FREQ=DAILY',
    'FREQ=DAILY;DTSTART=20260101',
    'FREQ=DAILY;DTSTART=20260101T000000Z',
    'FREQ=DAILY;UNTIL=2026-12-31',
    'FREQ=DAILY;DTSTART=garbage',
    'FREQ=WEEKLY',
    'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    'FREQ=WEEKLY;BYDAY=mo, we',
    'FREQ=WEEKLY;BYDAY=MO,XX',
    'FREQ=WEEKLY;BYDAY=',
    'FREQ=WEEKLY;BYDAY=1MO',
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=TU',
    'FREQ=WEEKLY;INTERVAL=3;BYDAY=SA,SU',
    'FREQ=WEEKLY;BYDAY=SA,SU;WKST=SU',
    'FREQ=WEEKLY;BYDAY=SA,SU;WKST=MO',
    'FREQ=MONTHLY;BYMONTHDAY=1',
    'FREQ=YEARLY',
    'INTERVAL=2',
    '',
    'FREQ',
    '=DAILY',
  ];
  for (const rule of rules) {
    const server = evaluateRrule(rule, date).supported;
    const words = scheduleWords(rule);
    assert.equal(words !== null, server, `${JSON.stringify(rule)}: words ${String(words)}, server ${String(server)}`);
  }
});

test('a schedule reads the way a parent would say it', () => {
  assert.equal(scheduleWords('FREQ=DAILY'), 'Every day');
  assert.equal(scheduleWords('FREQ=DAILY;INTERVAL=2'), 'Every 2 days');
  assert.equal(scheduleWords('FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR'), 'School days');
  assert.equal(scheduleWords('FREQ=WEEKLY;BYDAY=SU,SA'), 'Weekends');
  assert.equal(scheduleWords('FREQ=WEEKLY;BYDAY=TH,MO'), 'Mon, Thu');
  assert.equal(scheduleWords('FREQ=WEEKLY;INTERVAL=2;BYDAY=TU'), 'Tue, every other week');
  assert.equal(scheduleWords('FREQ=WEEKLY;INTERVAL=3;BYDAY=SA'), 'Sat, every 3 weeks');
  assert.equal(scheduleWords('FREQ=WEEKLY;BYDAY=SU,MO,TU,WE,TH,FR,SA'), 'Every day');
});

test('days read Monday first, and the common sets have names', () => {
  assert.equal(daysWords(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']), 'Every day');
  assert.equal(daysWords(['MO', 'TU', 'WE', 'TH', 'FR']), 'School days');
  assert.equal(daysWords(['SA', 'SU']), 'Weekends');
  assert.equal(daysWords([' fr', 'mo', 'WE', 'WE', 'XX']), 'Mon, Wed, Fri');
  assert.equal(daysWords(['SU', 'MO']), 'Mon, Sun');
  assert.equal(daysWords([]), 'No days');
  assert.equal(daysWords(['']), 'No days');
});

test('the chore list: active chores, faces in household order, turns, and the last face inert', () => {
  const catalog: ChoreCatalog = {
    icons: [],
    chores: [
      catalogEntry({ id: 'bins', labelFull: 'Take out the bins', kind: 'duty', basePoints: 0, rrule: 'FREQ=WEEKLY;BYDAY=TH,MO', assignmentModel: 'rotation',
        roster: [ { childId: 'child-b', position: 1 }, { childId: 'child-a', position: 0 } ] }),
      catalogEntry({ id: 'fish', labelFull: 'Feed the fish', kind: 'extra', basePoints: 1, assignmentModel: 'first_complete',
        roster: [{ childId: 'child-c', position: 0 }] }),
      catalogEntry({ id: 'car', labelFull: 'Wash the car', kind: 'extra', basePoints: 25, rrule: 'FREQ=MONTHLY' }),
      catalogEntry({ id: 'old', labelFull: 'Retired', active: false }),
      catalogEntry({ id: 'beds', labelFull: 'Make your bed', kind: 'extra', basePoints: 20, rrule: 'FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR' }),
    ],
  };
  const rows = choreListRows(catalog, HOUSEHOLD);
  assert.deepEqual(rows.map((r) => r.choreId), ['bins', 'fish', 'car', 'beds'], 'a retired chore is not listed');

  const [bins, fish, car, beds] = rows as [(typeof rows)[number], (typeof rows)[number], (typeof rows)[number], (typeof rows)[number]];
  assert.equal(bins.howLine, 'Turns · Mon, Thu');
  assert.equal(bins.worthWords, NO_WORTH_MARK);
  assert.equal(bins.kindWord, 'Duty');
  assert.deepEqual(
    bins.faces.map((f) => [f.child.displayName, f.member, f.turn, f.canToggle, f.canMoveEarlier]),
    [
      ['Augusta', true, 1, true, false],
      ['Benedict', true, 2, true, true],
      ['Cordelia', false, null, true, false],
    ],
    'turns come from position, not from the order the rows arrived in',
  );

  assert.equal(fish.howLine, 'First · Every day');
  assert.equal(fish.worthWords, '1 point');
  assert.deepEqual(
    fish.faces.map((f) => [f.member, f.canToggle]),
    [ [false, true], [false, true], [true, false] ],
    'the last child on a chore cannot be tapped off — an empty roster means everyone',
  );

  assert.equal(car.howLine, `Each · ${UNKNOWN_SCHEDULE_WORDS}`);
  assert.equal(car.canWorthUp, false, 'a file may say more than the wall’s stepper; only down is live');
  assert.equal(car.canWorthDown, true);
  assert.equal(beds.canWorthUp, false, 'the top of the stepper');
  assert.equal(bins.canWorthDown, false, 'the bottom of the stepper');

  assert.deepEqual(choreListSummary(rows), { head: '4 chores', detail: '1 duty · 3 extras' });
  assert.deepEqual(choreListSummary([]), { head: 'No chores yet', detail: '' });
});

test('an open row draws a rotation in turn order, so an earlier-key points at the face it passes', () => {
  const catalog: ChoreCatalog = {
    icons: [],
    chores: [
      catalogEntry({ id: 'bins', assignmentModel: 'rotation',
        roster: [ { childId: 'child-a', position: 1 }, { childId: 'child-c', position: 0 } ] }),
      catalogEntry({ id: 'fish', assignmentModel: 'individual',
        roster: [ { childId: 'child-c', position: 0 }, { childId: 'child-a', position: 1 } ] }),
    ],
  };
  const [bins, fish] = choreListRows(catalog, HOUSEHOLD) as [ChoreListRow, ChoreListRow];
  assert.deepEqual(
    facesInTurnOrder(bins).map((f) => [f.child.displayName, f.turn, f.canMoveEarlier]),
    [
      ['Cordelia', 1, false],
      ['Augusta', 2, true],
      ['Benedict', null, false],
    ],
    'turns first, by turn; then whoever is not on it',
  );
  assert.deepEqual(
    facesInTurnOrder(fish).map((f) => f.child.displayName),
    ['Augusta', 'Benedict', 'Cordelia'],
    'a chore with no turns keeps household order',
  );
});

test('a chore the sheet just made is the one row the list opens', () => {
  const before = ['fish', 'bins'];
  const after: ChoreCatalog = {
    icons: [],
    chores: [catalogEntry({ id: 'bins' }), catalogEntry({ id: 'cat' }), catalogEntry({ id: 'fish' })],
  };
  assert.equal(addedChoreId(before, after), 'cat', 'found wherever the server sorted it');
  assert.equal(addedChoreId(['bins', 'cat', 'fish'], after), null, 'nothing new, nothing opens');
  const retired: ChoreCatalog = { icons: [], chores: [...after.chores, catalogEntry({ id: 'old', active: false })] };
  assert.equal(addedChoreId(['bins', 'cat', 'fish'], retired), null, 'a retired chore is never opened');
});

test('a worth just written shows on the row without a second read', () => {
  const catalog: ChoreCatalog = { icons: [], chores: [catalogEntry({ id: 'fish', basePoints: 1 }), catalogEntry({ id: 'bins', basePoints: 0 })] };
  const next = withWorths(catalog, [{ choreId: 'fish', basePoints: 3 }]);
  assert.deepEqual(next.chores.map((c) => c.basePoints), [3, 0]);
  assert.equal(next.chores[1], catalog.chores[1], 'an untouched chore is the same object');
});

// ---------------------------------------------------------------------------
// 6. Routines
// ---------------------------------------------------------------------------

test('a routine’s window shares its AM or PM, and says it once', () => {
  assert.equal(windowText('06:00', '08:00'), '6:00–8:00 AM');
  assert.equal(windowText('18:30', '20:00'), '6:30–8:00 PM');
  assert.equal(windowText('11:30', '13:00'), '11:30 AM–1:00 PM');
  assert.equal(windowText('12:00', '13:00'), '12:00–1:00 PM');
  assert.equal(windowText('bad', '08:00'), 'bad–08:00');
  assert.equal(
    routineWhenLine({ opensAtLocal: '06:30', closesAtLocal: '08:30', daysOfWeek: 'MO,TU,WE,TH,FR' }),
    '6:30–8:30 AM · School days',
  );
  assert.equal(
    routineWhenLine({ opensAtLocal: '18:45', closesAtLocal: '20:45', daysOfWeek: 'SU,MO,TU,WE,TH,FR,SA' }),
    '6:45–8:45 PM · Every day',
  );
});

test('a routine pill wears the time of day it opens at', () => {
  assert.equal(routineGlyph('06:30'), 'sun');
  assert.equal(routineGlyph('11:59'), 'sun');
  assert.equal(routineGlyph('12:00'), 'clock', 'noon is not morning');
  assert.equal(routineGlyph('15:30'), 'clock', 'after school is neither');
  assert.equal(routineGlyph('17:00'), 'moon');
  assert.equal(routineGlyph('18:45'), 'moon');
  assert.equal(routineGlyph('soon'), 'clock', 'a time it cannot read claims no part of the day');
});

// ---------------------------------------------------------------------------
// 7. Settings
// ---------------------------------------------------------------------------

function source(label: string, last: CalendarSourceHealth['last'], goodMinutesAgo: number | null): CalendarSourceHealth {
  return {
    label,
    last,
    triedAtUtc: minutesAgo(5),
    goodAtUtc: goodMinutesAgo === null ? null : minutesAgo(goodMinutesAgo),
  };
}

test('the calendar line leads with the most urgent thing', () => {
  assert.deepEqual(calendarLine([], NOW), { tone: 'idle', head: 'No calendars', detail: 'Nothing is connected' });
  assert.equal(calendarLine([source('Family', 'running', 3), source('School', 'ok', 3)], NOW).tone, 'busy');
  assert.deepEqual(calendarLine([source('Family', 'ok', 3), source('School', 'failed', 90)], NOW), {
    tone: 'trouble',
    head: 'Fetch failed',
    detail: 'School failed last time',
  });
  assert.equal(
    calendarLine([source('A', 'failed', null), source('B', 'failed', 9), source('C', 'ok', 2), source('D', 'ok', 2)], NOW).detail,
    '2 of 4 calendars failed last time',
  );
  assert.deepEqual(calendarLine([source('A', 'never', null), source('B', 'never', null)], NOW), {
    tone: 'trouble',
    head: 'Not fetched yet',
    detail: '0 of 2 calendars fetched',
  });
  assert.equal(calendarLine([source('A', 'ok', 2), source('B', 'never', null)], NOW).head, 'Partly fetched');
  assert.deepEqual(calendarLine([source('A', 'ok', 2), source('B', 'ok', 12)], NOW), {
    tone: 'ok',
    head: 'Fetched 12 min ago',
    detail: '2 of 2 calendars ok',
  });
  assert.equal(calendarLine([source('A', 'ok', 2)], NOW).detail, '1 of 1 calendar ok');
  assert.deepEqual(calendarLine([source('A', 'ok', 2), source('B', 'ok', 61)], NOW), {
    tone: 'trouble',
    head: 'Fetched 1 hour ago',
    detail: 'Older than it should be',
  });
});

test('Fetch now says what happened, and an unconfigured wall is never "try again"', () => {
  const outcome = { reason: 'operator words', lastCompletedAtUtc: null, lastEvents: null, lastFailed: null };
  assert.equal(fetchOutcomeToast({ ...outcome, disposition: 'started' }).tone, 'ok');
  assert.equal(fetchOutcomeToast({ ...outcome, disposition: 'already-running' }).tone, 'ok');
  assert.deepEqual(fetchOutcomeToast({ ...outcome, disposition: 'not-configured' }), {
    tone: 'trouble',
    words: FETCH_UNAVAILABLE_WORDS,
  });
  for (const d of ['started', 'already-running', 'not-configured'] as const) {
    assert.doesNotMatch(fetchOutcomeToast({ ...outcome, disposition: d }).words, /operator/, 'the reason is never drawn');
  }
  assert.equal(fetchRefusalWords({ code: 'unavailable' }), FETCH_UNAVAILABLE_WORDS);
  assert.equal(fetchRefusalWords({ code: 'bad_pin' }), REFUSAL_WORDS.bad_pin);
  assert.equal(fetchRefusalWords(new Error('boom')), REFUSAL_WORDS.unknown);
});

test('the leave-by row carries the numbers the Leaving screen sets', () => {
  assert.equal(leaveBySummary(RULES), 'Get ready 25 min · Drive 10 min · School 7:35 AM');
  assert.equal(
    leaveBySummary({ ...RULES, readyMinutes: 1, school: { ...RULES.school, days: [] } }),
    'Get ready 1 min · Drive 10 min',
    'no school rule, no school part',
  );
});

// ---------------------------------------------------------------------------
// 8. Home
// ---------------------------------------------------------------------------

test('the Waiting tile counts, and draws each child’s face once', () => {
  assert.deepEqual(waitingTile([]), { big: 'All sorted', small: 'Nothing is waiting', childIds: [] });
  assert.deepEqual(waitingTile([item()]), { big: '1', small: 'thing to look at', childIds: ['child-a'] });
  const three = waitingTile([
    item({ key: 'chore:1' }),
    item({ key: 'chore:2', childId: 'child-b', childName: 'Benedict' }),
    item({ key: 'redemption:3', kind: 'redemption' }),
  ]);
  assert.deepEqual(three, { big: '3', small: 'things to look at', childIds: ['child-a', 'child-b'] });
});

test('the Today tile counts a claimed chore as done and skips a superseded one', () => {
  const tile = todayTile({
    chores: [
      choreView(1, 'child-a', 'approved'),
      choreView(2, 'child-a', 'claimed'),
      choreView(3, 'child-b', 'pending'),
      choreView(4, 'child-b', 'superseded'),
    ],
    routines: [routineRun(1, 'child-a', [true, true]), routineRun(2, 'child-b', [true, false]), routineRun(3, 'child-c', [])],
  });
  assert.deepEqual(tile, { big: '2 of 3', small: 'chores done · 1 of 3 routines finished' });
  assert.deepEqual(todayTile({ chores: [choreView(1, 'child-a', 'pending')], routines: [] }), {
    big: '0 of 1',
    small: 'chore done',
  });
  assert.equal(todayTile({ chores: [], routines: [] }).big, 'No chores');
});

test('the Money tile totals in cash when there is a rate, in points when not', () => {
  const balances = [
    { childId: 'child-a', points: 12, cashCents: 120 },
    { childId: 'child-b', points: 7, cashCents: 70 },
    { childId: 'child-c', points: 0, cashCents: null },
  ];
  assert.deepEqual(moneyTile({ children: HOUSEHOLD, balances }, 10), {
    big: '$1.90',
    small: 'Augusta $1.20 · Benedict $0.70 · 1 point = 10¢',
  });
  const noRate = balances.map((b) => ({ ...b, cashCents: null }));
  assert.deepEqual(moneyTile({ children: HOUSEHOLD, balances: noRate }, null), {
    big: '19 points',
    small: 'Augusta 12 · Benedict 7',
  });
  assert.equal(moneyTile({ children: [CORDELIA], balances }, 10).big, 'Stickers only');
});

test('the Picture tile names the picture that is up and counts the new ones', () => {
  const catalog: SceneCatalog = {
    activeSceneId: '2026w41-harvest-market-gpt',
    scenes: [
      { id: '2026w41-harvest-market-gpt', state: 'approved', source: 'generated', styleId: null, createdAtUtc: '', decidedAtUtc: null, image: '', regionCount: 3, usable: true },
      { id: '2026w42-lamppost-wood-gpt', state: 'candidate', source: 'generated', styleId: null, createdAtUtc: '', decidedAtUtc: null, image: '', regionCount: 3, usable: true },
      { id: '2026w42-lamppost-wood-nb2', state: 'candidate', source: 'generated', styleId: null, createdAtUtc: '', decidedAtUtc: null, image: '', regionCount: 3, usable: true },
    ],
  };
  assert.deepEqual(sceneTile(catalog), { big: 'Harvest market', small: '2 new to look at' });
  assert.deepEqual(sceneTile({ activeSceneId: null, scenes: [] }), { big: 'No picture up', small: 'Nothing new to look at' });
  assert.deepEqual(sceneTile(null), { big: 'Pictures', small: '' });
});

test('the Settings tile names the look and the leave-by switch', () => {
  assert.deepEqual(settingsTile('felt', RULES), { big: 'Felt board', small: 'Theme · leave-by alerts on' });
  assert.deepEqual(settingsTile('gallery', { ...RULES, enabled: false }), { big: 'Gallery', small: 'Theme · leave-by alerts off' });
  assert.deepEqual(settingsTile('storybook', null), { big: 'Storybook', small: 'Theme' });
});

// ---------------------------------------------------------------------------
// 9. What fits
// ---------------------------------------------------------------------------

const ALL_ON = { features: { chores: true, money: true, routines: true, countdowns: true } };
const ALL_OFF = { features: { chores: false, money: false, routines: false, countdowns: true } };

test('an all-on household draws every section and every tile, unchanged', () => {
  assert.deepEqual(grownupSectionsFor(ALL_ON), GROWNUP_SECTIONS);
  assert.deepEqual(homeTilesFor(ALL_ON), HOME_TILES);
  for (const t of HOME_TILES) assert.deepEqual(homeTileDoorFor(t, ALL_ON), HOME_TILE_DOORS[t], t);
});

test('a missing features object is everything on, as it was before the setting existed', () => {
  assert.deepEqual(grownupSectionsFor(undefined), GROWNUP_SECTIONS);
  assert.deepEqual(grownupSectionsFor(null), GROWNUP_SECTIONS);
  assert.deepEqual(homeTilesFor(undefined), HOME_TILES);
  assert.deepEqual(homeTilesFor({} as never), HOME_TILES);
});

test('chores, routines and money off: their screens and tiles go, Home/Waiting/Settings stay', () => {
  assert.deepEqual(grownupSectionsFor(ALL_OFF), ['home', 'waiting', 'settings']);
  assert.deepEqual(homeTilesFor(ALL_OFF), ['waiting', 'calendar', 'scene', 'settings']);
});

test('each feature takes only its own screen, and Today stays while either half of it is on', () => {
  const only = (f: Partial<typeof ALL_ON.features>) => ({ features: { ...ALL_ON.features, ...f } });
  assert.deepEqual(grownupSectionsFor(only({ money: false })), ['home', 'waiting', 'chores', 'routines', 'settings']);
  assert.deepEqual(homeTilesFor(only({ money: false })), ['waiting', 'today', 'calendar', 'scene', 'settings']);
  assert.deepEqual(grownupSectionsFor(only({ chores: false })), ['home', 'waiting', 'routines', 'money', 'settings']);
  assert.deepEqual(homeTilesFor(only({ chores: false })), HOME_TILES);
  assert.deepEqual(homeTilesFor(only({ routines: false })), HOME_TILES);
  assert.deepEqual(homeTilesFor(only({ chores: false, routines: false })), ['waiting', 'money', 'calendar', 'scene', 'settings']);
});

test('every tile a household draws opens a section that household draws', () => {
  const flags = [true, false];
  for (const chores of flags) for (const routines of flags) for (const money of flags) {
    const h = { features: { chores, routines, money, countdowns: true } };
    const sections = grownupSectionsFor(h);
    for (const t of homeTilesFor(h)) {
      const door = homeTileDoorFor(t, h);
      if (door.kind === 'section') assert.ok(sections.includes(door.section), `${t} with ${JSON.stringify(h.features)}`);
    }
  }
  // Routines only: Today is a door to Routines, not to the hidden Chores screen.
  const routinesOnly = { features: { chores: false, routines: true, money: false, countdowns: true } };
  assert.deepEqual(homeTileDoorFor('today', routinesOnly), { kind: 'section', section: 'routines' });
});

/** The felt tab words as measured on the panel, 2026-10-11, at 17 px. */
const FELT_WIDTHS: Readonly<Record<string, number>> = {
  Home: 42,
  Waiting: 58,
  Chores: 53,
  Routines: 67,
  Money: 51,
  Settings: 62,
  Leave: 46,
  'Showing older information': 200,
};
const feltRuler = (words: string): number => FELT_WIDTHS[words] ?? 999;

test('a tab is at least a tap target wide', () => {
  assert.equal(tabWidthPx(null), 64);
  assert.equal(tabWidthPx(5), 64);
  assert.equal(tabWidthPx(42), 94);
  assert.equal(tabWidthPx(41.2), 94, 'a fractional word rounds up, never into the gap');
});

test('the felt row keeps every word when it can, and gives way around a stale chip', () => {
  const all = tabWordsFit('money', 912, feltRuler, null);
  assert.equal(all.worded.size, GROWNUP_SECTIONS.length);
  assert.equal(all.leaveWorded, true);

  const stale = tabWordsFit('money', 912, feltRuler, 'Showing older information');
  assert.deepEqual([...stale.worded], ['money'], 'only the tab you are on keeps its word');
  assert.equal(stale.leaveWorded, true, 'Leave keeps its word while it can');

  // Routines worded + Leave worded + the chip is 901 px; without Leave's word, 867.
  const tight = tabWordsFit('routines', 880, feltRuler, 'Showing older information');
  assert.deepEqual([...tight.worded], ['routines']);
  assert.equal(tight.leaveWorded, false);

  const none = tabWordsFit('home', 100, feltRuler, 'Showing older information');
  assert.equal(none.worded.size, 0);
  assert.equal(none.leaveWorded, false);
});

test('Home is the first tab to lose its word, unless you are on it', () => {
  // Room for everything worded but Home: Home goes to its glyph.
  const sum = (sections: readonly GrownupSection[]) =>
    sections.reduce((w, s) => w + tabWidthPx(feltRuler(SECTION_WORDS[s])) + 16, 0);
  const everyWord = sum(GROWNUP_SECTIONS) + tabWidthPx(46);
  const room = everyWord - 10;
  const fit = tabWordsFit('waiting', room, feltRuler, null);
  assert.equal(fit.worded.has('home'), false);
  assert.equal(fit.worded.has('settings'), true);
  const onHome = tabWordsFit('home', room, feltRuler, null);
  assert.deepEqual([...onHome.worded], ['home'], 'on Home, the next step is the chosen tab alone');
});

test('the felt row never measures a hidden section, and fits a short row with every word', () => {
  const asked: string[] = [];
  const measuring = (words: string): number => {
    asked.push(words);
    return feltRuler(words);
  };
  const three = grownupSectionsFor(ALL_OFF);
  // A room too small for all six worded but ample for three: the short row keeps every word.
  const sixWorded = (GROWNUP_SECTIONS as readonly GrownupSection[]).reduce(
    (w, s) => w + tabWidthPx(feltRuler(SECTION_WORDS[s])) + 16,
    tabWidthPx(46),
  );
  const fit = tabWordsFit('waiting', sixWorded - 10, measuring, null, three);
  assert.deepEqual([...fit.worded].sort(), ['home', 'settings', 'waiting']);
  assert.equal(fit.leaveWorded, true);
  for (const s of ['chores', 'routines', 'money'] as const) {
    assert.ok(!asked.includes(SECTION_WORDS[s]), `${s}'s word was measured`);
  }
});

test('a tile’s big line steps down a size before it would ellipse, and stops at the smallest', () => {
  // On this ruler a word is 8 px a character at 17 px, scaled with the size.
  // "$1.90" is 5 characters: 70.6 px at 30, so it sets at the top size in any tile.
  assert.deepEqual(tileBigFit('$1.90', 248, ruler), { words: '$1.90', sizePx: 30 });
  // "Lantern market" is 14 characters: 197.6 at 30, 158.1 at 24, 131.8 at 20.
  assert.equal(tileBigFit('Lantern market', 200, ruler).sizePx, 30, '197.6 + 2 of slack fits 200, just');
  assert.equal(tileBigFit('Lantern market', 199, ruler).sizePx, 24, 'and does not fit 199');
  assert.equal(tileBigFit('Lantern market', 160, ruler).sizePx, 20);
  assert.equal(tileBigFit('Lantern market', 134, ruler).sizePx, 20);
  // Nothing fits: the smallest size, the same words, and the line's own ellipsis does the rest.
  assert.deepEqual(tileBigFit('Lantern market', 100, ruler), { words: 'Lantern market', sizePx: 20 });
});

test('the header clock shortens its date before it drops it, and never halves it', () => {
  // Sunday, October 11 · 4:30 PM = 28 characters = 224 px on this ruler.
  assert.equal(headerClockFit(TODAY, '4:30 PM', 300, ruler)?.words, 'Sunday, October 11 · 4:30 PM');
  assert.equal(headerClockFit(TODAY, '4:30 PM', 200, ruler)?.words, 'Sun, Oct 11 · 4:30 PM');
  assert.equal(headerClockFit(TODAY, '4:30 PM', 140, ruler)?.words, 'Oct 11 · 4:30 PM');
  assert.equal(headerClockFit(TODAY, '4:30 PM', 60, ruler)?.words, '4:30 PM');
  assert.equal(headerClockFit(TODAY, '4:30 PM', 40, ruler), null);
});

test('the strip under the queue costs exactly one row, and four rows fit without it', () => {
  // The body every grown-up section draws on, at the desk's 64px tap floor.
  const body = APPROVAL_PANE_HEIGHT_PX;
  assert.equal(body, 412);
  assert.equal(sheetInnerHeightPx(body), 374, '412 less 16px of padding and a 3px edge, twice');
  assert.equal(approvalRowHeightPx(64), 78);
  // Four rows and three gaps: 4·78 + 3·16 = 360 ≤ 374; a fifth would need 454.
  assert.equal(waitingRowsInView(body, 64, false), 4);
  // The strip is a tap-floor row plus its gap: 374 − 80 = 294, which holds three (266), not four.
  assert.equal(TOAST_HEIGHT_PX, 64);
  assert.equal(waitingRowsInView(body, 64, true), 3);
  // Walked down to nothing rather than below it: a body too short for one row says zero.
  assert.equal(waitingRowsInView(2 * (16 + 3) + 77, 64, false), 0);
  assert.equal(waitingRowsInView(2 * (16 + 3) + 78, 64, false), 1);
});
