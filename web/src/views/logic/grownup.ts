/**
 * The grown-up portal, minus its pixels (2026-10-11).
 *
 * The portal used to be the approval queue with pills in its header — Worth, Routines, Chores,
 * Leaving — each a panel squeezed under the queue's title row. The redesign the household chose
 * from (the admin mockups (private notes)) makes it a place of its own: a PIN door, a Home of
 * six tiles that are doors, and five screens — Waiting, Chores, Routines, Money, Settings — with
 * Leave always in reach. This file is every decision those screens make that is not a pixel:
 * which words, which numbers, what a tap may do, and what fits in a strip.
 *
 * No React and no `.tsx` import (CLAUDE.md): the test runner strips `.ts` and not `.tsx`, so this
 * is the half of the portal a test can drive.
 */

import type { GlyphName } from '../contract.ts';
import {
  DAY_CODES,
  type AssetRef,
  type HouseholdView,
  type AssignmentModel,
  type Child,
  type ChoreAssignmentView,
  type ChoreKind,
  type DayCode,
  type DepartureRules,
  type LocalDate,
  type WallSnapshot,
  type WallThemeId,
} from '../../../../src/types.ts';
import {
  CENTS_PER_POINT_STEP,
  RATE_EXAMPLE_POINTS,
  REFUSAL_WORDS,
  approvalRowHeightPx,
  refusalCodeOf,
  sceneLabel,
  type ApprovalDecision,
  type ApprovalItem,
  type CalendarSourceHealth,
  type ChoreCatalog,
  type LedgerHistory,
  type RefreshOutcome,
  type RoutineCatalogEntry,
  type SceneCatalog,
} from '../../app/adminActions.ts';
import { fontSizePx, iconPx, spacePx, strokePx, tapPx } from '../../design/tokens.ts';
import { balanceFor, cashText, streakFor } from './balances.ts';
import { MODEL_WORDS } from './choreAssign.ts';
import { KIND_WORDS, POINTS_MAX, POINTS_MIN } from './choreDraft.ts';
import { clientLocalDate, localDateText, minutesOfDay } from './clock.ts';
import { localTimeText } from './departures.ts';
import { CALENDAR_STALE_AFTER_SECONDS } from './freshness.ts';
import { featureOn } from './features.ts';
import { counted, NOUN, nounFor } from './plural.ts';
import { avatarRef, orderedChildren } from './summary.ts';
import { firstThatFits, type FittedWords, type MeasureText } from './textFit.ts';
import { THEME_NAMES } from './themePicker.ts';

const SEPARATOR = ' · ';

// ---------------------------------------------------------------------------
// 1. The sections
// ---------------------------------------------------------------------------

/**
 * The portal's screens, in the order the nav draws them. Home is first because it is where the
 * door opens onto: the household's summary, and six doors to the rest.
 */
export type GrownupSection = 'home' | 'waiting' | 'chores' | 'routines' | 'money' | 'settings';

export const GROWNUP_SECTIONS: readonly GrownupSection[] = [
  'home',
  'waiting',
  'chores',
  'routines',
  'money',
  'settings',
];

/**
 * The sections this household's nav draws (2026-10-17): `GROWNUP_SECTIONS` less the screens of a
 * feature it turned off. Home, Waiting and Settings always stay — Waiting also carries the
 * picture candidates, and Settings is where a feature is turned back on. `features` undefined (a
 * server older than the setting) is everything on, through `featureOn`.
 */
export function grownupSectionsFor(h: Pick<HouseholdView, 'features'> | undefined | null): readonly GrownupSection[] {
  return GROWNUP_SECTIONS.filter((s) => {
    if (s === 'chores') return featureOn(h, 'chores');
    if (s === 'routines') return featureOn(h, 'routines');
    if (s === 'money') return featureOn(h, 'money');
    return true;
  });
}

/** The word on each section's tab or nav key. */
export const SECTION_WORDS: Readonly<Record<GrownupSection, string>> = {
  home: 'Home',
  waiting: 'Waiting',
  chores: 'Chores',
  routines: 'Routines',
  money: 'Money',
  settings: 'Settings',
};

/** The heading a side-nav look sets above the screen. Home's is the portal's own name. */
export const SECTION_TITLES: Readonly<Record<GrownupSection, string>> = {
  ...SECTION_WORDS,
  home: 'Grown-ups',
};

/**
 * One glyph per section, from the frozen set. `sun` stands in for a gear: GlyphName has none, and
 * a rayed disc is the nearest shape a parent already reads as "settings".
 */
export const SECTION_GLYPHS: Readonly<Record<GrownupSection, GlyphName>> = {
  home: 'grown-up',
  waiting: 'hourglass',
  chores: 'check',
  routines: 'clock',
  money: 'star',
  settings: 'sun',
};

/** Back to the wall. The house is the wall's own word for "home" everywhere else. */
export const LEAVE_WORD = 'Leave';
export const LEAVE_GLYPH: GlyphName = 'home';

/** What each screen reads before it can draw, so a pane fetches nothing it will not show. */
export interface SectionNeeds {
  readonly settings: boolean;
  readonly chores: boolean;
  readonly routines: boolean;
  readonly scenes: boolean;
}

export const SECTION_NEEDS: Readonly<Record<GrownupSection, SectionNeeds>> = {
  // Home's settings read is also the PIN's first real use: a wrong PIN is refused HERE, at the
  // door, instead of on the first decision an adult tries to make.
  home: { settings: true, chores: false, routines: false, scenes: true },
  waiting: { settings: false, chores: false, routines: false, scenes: false },
  chores: { settings: false, chores: true, routines: false, scenes: false },
  routines: { settings: false, chores: false, routines: true, scenes: false },
  money: { settings: true, chores: false, routines: false, scenes: false },
  settings: { settings: true, chores: false, routines: false, scenes: false },
};

// ---------------------------------------------------------------------------
// 2. Time, as an adult reads it in a list
// ---------------------------------------------------------------------------

/**
 * "18 min ago", for a claim or a fetch. `null` when there is no instant to read, so a row from
 * an older server loses one phrase rather than printing "NaN min ago". A claim stamped a moment
 * AHEAD of the wall's clock (the server's clock and the Pi's disagree by a second) is "just
 * now", never "-1 min ago".
 */
export function agoText(atUtc: string | null | undefined, nowMs: number): string | null {
  if (typeof atUtc !== 'string' || atUtc.length === 0 || !Number.isFinite(nowMs)) return null;
  const at = Date.parse(atUtc);
  if (Number.isNaN(at)) return null;
  const seconds = Math.floor((nowMs - at) / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${counted(minutes, NOUN.min)} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${counted(hours, NOUN.hour)} ago`;
  return `${counted(Math.floor(hours / 24), NOUN.day)} ago`;
}

const DAY_MS = 86_400_000;

/**
 * A ledger line's day: "Today", "Yesterday", the weekday within the week, a date before that.
 * Both dates are household-local; parsed at noon UTC for the reason `localDateText` gives.
 */
export function dayWords(date: LocalDate, today: LocalDate): string {
  const a = Date.parse(`${date}T12:00:00Z`);
  const b = Date.parse(`${today}T12:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return '';
  const back = Math.round((b - a) / DAY_MS);
  if (back === 0) return 'Today';
  if (back === 1) return 'Yesterday';
  if (back >= 2 && back <= 6) return localDateText(date, 'weekday');
  return localDateText(date, 'monthDay');
}

// ---------------------------------------------------------------------------
// 3. The door
// ---------------------------------------------------------------------------

export const DOOR_HEAD_WORDS = 'Grown-ups only';
export const DOOR_BACK_WORDS = 'Back to the wall';
export const DOOR_BACK_GLYPH: GlyphName = 'back';

/** The door's sentence: what is behind it, and how long the PIN lasts. */
export function doorDetail(waiting: number): string {
  const what =
    waiting <= 0
      ? 'Nothing is waiting.'
      : `${counted(waiting, NOUN.thing)} ${waiting === 1 ? 'is' : 'are'} waiting to be looked at.`;
  return `${what} Type the PIN once; it lasts until you leave.`;
}

// ---------------------------------------------------------------------------
// 4. Waiting
// ---------------------------------------------------------------------------

/** What a row says when the chore pays nothing — a duty, or the child with no ledger. */
export const NO_POINTS_WORDS = 'no points';

/** The line under a queue row's name: who, what it pays, and how long it has waited. */
export function approvalMeta(item: ApprovalItem, nowMs: number): string {
  const parts: string[] = [item.childName];
  if (item.points > 0) parts.push(counted(item.points, NOUN.point));
  else if (item.kind === 'chore') parts.push(NO_POINTS_WORDS);
  const cash = cashText(item.cashCents);
  if (cash !== null) parts.push(cash);
  const ago = agoText(item.atUtc, nowMs);
  if (ago !== null) parts.push(ago);
  return parts.join(SEPARATOR);
}

const DECIDED_WORDS: Readonly<Record<ApprovalItem['kind'], Readonly<Record<ApprovalDecision, string>>>> = {
  chore: { approve: 'Approved', reject: 'Sent back' },
  redemption: { approve: 'Paid out', reject: 'Not yet' },
};

/** The strip at the bottom after a decision: "Approved — Augusta · Tidy the playroom · 2 points". */
export function decidedWords(
  item: Pick<ApprovalItem, 'kind' | 'childName' | 'labelFull' | 'points' | 'cashCents'>,
  decision: ApprovalDecision,
): string {
  const parts: string[] = [item.childName, item.labelFull];
  if (decision === 'approve') {
    if (item.kind === 'chore' && item.points > 0) parts.push(counted(item.points, NOUN.point));
    const cash = cashText(item.cashCents);
    if (cash !== null) parts.push(cash);
  }
  return `${DECIDED_WORDS[item.kind][decision]} — ${parts.join(SEPARATOR)}`;
}

// ---------------------------------------------------------------------------
// 5. The strip: what happened, and what went wrong
// ---------------------------------------------------------------------------

export type ToastTone = 'ok' | 'trouble';

export interface Toast {
  readonly tone: ToastTone;
  readonly words: string;
  /** When it went up, on the wall's clock — the key that replaces one strip with the next. */
  readonly atMs: number;
}

/**
 * How long a GOOD outcome stays up. A refusal does not go on its own: the old screens put "Not
 * now" in a corner for a moment and an adult who looked away never knew the tap had failed. It
 * stays until it is closed, replaced, or the adult moves to another screen.
 */
export const TOAST_OK_MS = 5000;

/** When the strip should go by itself, or null for never. */
export function toastExpiresAtMs(toast: Toast): number | null {
  return toast.tone === 'ok' ? toast.atMs + TOAST_OK_MS : null;
}

/**
 * The strip is one row at the tap floor, because the WHOLE strip is the control that closes it:
 * a refusal stays up until somebody taps it, so it has to be something a finger can find.
 */
export const TOAST_HEIGHT_PX = tapPx.min;

/**
 * Every section draws on one SHEET — the body as a card, padded — so what a list gets is the
 * body less that padding and the heaviest card edge any theme draws (felt's 3px; the others
 * draw 2). Arithmetic rather than a measurement, so a test can hold the queue to it.
 */
export const SHEET_PAD_PX = spacePx.md;

export function sheetInnerHeightPx(bodyPx: number): number {
  return bodyPx - 2 * (SHEET_PAD_PX + strokePx.medium);
}

/**
 * How many queue rows are in view before the fold, with the strip up or not. The queue scrolls,
 * so this is not a cap — it is how much of the queue an adult sees without touching it: four
 * rows on the 412px body, and three while a strip stands under them. The strip costs a row
 * rather than covering one, because a strip drawn OVER the last row hides the very decision it
 * might be reporting on.
 */
export function waitingRowsInView(bodyPx: number, minTapPx: number, toastUp: boolean): number {
  const room = sheetInnerHeightPx(bodyPx) - (toastUp ? TOAST_HEIGHT_PX + spacePx.tapGap : 0);
  const rowPx = approvalRowHeightPx(minTapPx);
  if (room < rowPx) return 0;
  return Math.floor((room + spacePx.tapGap) / (rowPx + spacePx.tapGap));
}

// ---------------------------------------------------------------------------
// 6. Money
// ---------------------------------------------------------------------------

/**
 * The rate's rails. The SERVER's are `MIN_CENTS_PER_POINT` / `MAX_CENTS_PER_POINT` in
 * src/domain/settings; that module reads the database, so it cannot be imported into the bundle,
 * and a test holds these two to it instead.
 */
export const RATE_MIN_CENTS = 1;
export const RATE_MAX_CENTS = 500;

/** "10¢" under a dollar, "$1.25" from a dollar up. */
export function centsWords(cents: number): string {
  if (cents < 100) return `${String(cents)}¢`;
  return cashText(cents) ?? `${String(cents)}¢`;
}

export interface RateWords {
  /** "1 point = 10¢" */
  readonly head: string;
  /** "10 points = $1.00" — the worked example, because "10¢" alone is arithmetic. */
  readonly example: string;
}

export const NO_RATE_WORDS: RateWords = { head: 'No rate set', example: 'Points are not money yet' };

export function rateWords(centsPerPoint: number | null | undefined): RateWords {
  if (typeof centsPerPoint !== 'number' || !Number.isFinite(centsPerPoint) || centsPerPoint <= 0) {
    return NO_RATE_WORDS;
  }
  const c = Math.trunc(centsPerPoint);
  return {
    head: `${counted(1, NOUN.point)} = ${centsWords(c)}`,
    example: `${counted(RATE_EXAMPLE_POINTS, NOUN.point)} = ${cashText(c * RATE_EXAMPLE_POINTS) ?? ''}`,
  };
}

/**
 * Where the rate's two keys go, or null where a key is inert.
 *
 * In nickels, snapped: 7¢ goes up to 10¢ and down to 5¢, not to 12¢ and 2¢ — a stepper that
 * walks off the grid it walks on is one an adult has to correct by hand. Below a nickel the only
 * step is to the floor, 1¢, and from the floor the only step is back up to 5¢. At either rail
 * that key is drawn inert, which is the honest picture of a press the server would refuse.
 */
export function rateStep(cents: number): { readonly down: number | null; readonly up: number | null } {
  const c = Number.isFinite(cents) ? Math.trunc(cents) : 0;
  const step = CENTS_PER_POINT_STEP;
  const up =
    c >= RATE_MAX_CENTS ? null : Math.min(RATE_MAX_CENTS, c < step ? step : Math.floor(c / step) * step + step);
  const down =
    c <= RATE_MIN_CENTS
      ? null
      : c <= step
        ? RATE_MIN_CENTS
        : Math.min(RATE_MAX_CENTS, Math.ceil(c / step) * step - step);
  return { down, up };
}

/** The sentence under the rate: what a change does, and what it does not. */
export const RATE_RULE_WORDS = 'Changes what every balance shows. A cash-out already asked for keeps its rate.';

/** A child with no ledger: her chores run, and pay in stickers rather than points. */
export const STICKERS_ONLY_WORDS = 'No points — stickers only';

export interface MoneyRow {
  readonly childId: string;
  readonly name: string;
  readonly avatar: AssetRef;
  readonly sortOrder: number;
  readonly ledger: boolean;
  readonly points: number;
  /** "12 points · $1.20 · 4 days in a row", or the stickers sentence. */
  readonly line: string;
  /** The minus key: a balance at zero has nothing to take, and the server does not stop it. */
  readonly canTakeOff: boolean;
  readonly canAdd: boolean;
}

export function moneyRows(snapshot: Pick<WallSnapshot, 'children' | 'balances' | 'streaks'>): readonly MoneyRow[] {
  return orderedChildren(snapshot.children).map((child) => {
    const balance = balanceFor(snapshot.balances, child.id);
    const streak = streakFor(snapshot.streaks, child.id);
    const streakWords = streak !== null && streak > 0 ? `${counted(streak, NOUN.day)} in a row` : null;
    const parts: string[] = [];
    if (child.ledgerEnabled) {
      parts.push(counted(balance.points, NOUN.point));
      const cash = cashText(balance.cashCents);
      if (cash !== null) parts.push(cash);
    } else {
      parts.push(STICKERS_ONLY_WORDS);
    }
    if (streakWords !== null) parts.push(streakWords);
    return {
      childId: child.id,
      name: child.displayName,
      avatar: avatarRef(child),
      sortOrder: child.sortOrder,
      ledger: child.ledgerEnabled,
      points: balance.points,
      line: parts.join(SEPARATOR),
      canTakeOff: child.ledgerEnabled && balance.points > 0,
      canAdd: child.ledgerEnabled,
    };
  });
}

/** How many lines of a child's ledger the screen keeps; the rest is older than anyone asks about. */
export const LEDGER_LINES_MAX = 30;

export type LedgerTone = 'up' | 'down' | 'none';

export interface LedgerLine {
  readonly id: number;
  readonly day: string;
  readonly words: string;
  /** "+4", "−10" (a real minus sign), "0". */
  readonly delta: string;
  readonly tone: LedgerTone;
}

export const LEDGER_EMPTY_WORDS = 'Nothing yet. Approved chores and cash-outs land here.';
const CHORE_FALLBACK_WORDS = 'Chore approved';
const CASH_OUT_WORDS = 'Cash out';
const ADDED_WORDS = 'Added by a grown-up';
const TAKEN_WORDS = 'Taken off by a grown-up';

/** "Augusta, lately" — the heading over her ledger. */
export function ledgerHeading(name: string): string {
  return `${name}, lately`;
}

function deltaText(delta: number): string {
  if (delta > 0) return `+${String(delta)}`;
  if (delta < 0) return `−${String(Math.abs(delta))}`;
  return '0';
}

/**
 * One child's ledger, newest first, as lines a parent reads.
 *
 * A chore line is named from TODAY's chores when it can be — the ledger row carries the
 * assignment id, and today's snapshot carries the label. An older chore says "Chore approved":
 * naming it needs the server to join the ledger to the chore it paid for, which this read does
 * not do yet.
 */
export function ledgerLines(
  history: LedgerHistory | null,
  todayChores: readonly ChoreAssignmentView[],
  today: LocalDate,
): readonly LedgerLine[] {
  if (history === null) return [];
  const labels = new Map<string, string>();
  for (const chore of todayChores) labels.set(String(chore.assignmentId), chore.labelFull);
  const newestFirst = [...history.entries].reverse().slice(0, LEDGER_LINES_MAX);
  return newestFirst.map((entry) => {
    const ms = Date.parse(entry.createdAtUtc);
    const day = Number.isNaN(ms) ? '' : dayWords(clientLocalDate(ms), today);
    const note = entry.note !== null && entry.note.trim().length > 0 ? entry.note.trim() : null;
    const words =
      entry.reason === 'chore_approved'
        ? (labels.get(entry.refId) ?? CHORE_FALLBACK_WORDS)
        : entry.reason === 'redemption_approved'
          ? CASH_OUT_WORDS
          : (note ?? (entry.delta < 0 ? TAKEN_WORDS : ADDED_WORDS));
    return {
      id: entry.id,
      day,
      words,
      delta: deltaText(entry.delta),
      tone: entry.delta > 0 ? 'up' : entry.delta < 0 ? 'down' : 'none',
    };
  });
}

/**
 * A fresh idempotency key for one tap on a ± key. One per TAP, never per child or per screen:
 * the server pays a repeated key once, so a constant would make the second bonus vanish.
 */
export function newRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c !== undefined && typeof c.randomUUID === 'function') return c.randomUUID();
  return `adj-${String(Date.now())}-${Math.random().toString(36).slice(2)}`;
}

// ---------------------------------------------------------------------------
// 7. Chores — every chore, one list
// ---------------------------------------------------------------------------

/** The worth column for a chore that pays nothing. A dash, not "0 points": it is a duty. */
export const NO_WORTH_MARK = '–';

/** A rule the server will never put on the board. Said, because silence would look like a bug. */
export const UNKNOWN_SCHEDULE_WORDS = 'Schedule not understood';

/**
 * The two rules an open chore row says out loud, because each is the surprising half of a tap.
 * A roster change reaches today's materialized day at once; worth and sharing are snapshotted
 * when the day is built (`chore_day.points_each`, the model), so they land on tomorrow's — and
 * they are the chore's, not a child's. `tomorrow` is drawn on the line that holds the worth and
 * the sharing pills, so it names neither: it says what is true of both, in a width that still
 * holds a fourth pill.
 */
export const CHORE_RULE_WORDS = {
  roster: 'Who does it changes today’s list.',
  tomorrow: 'For everyone, from tomorrow’s list.',
} as const;

export interface ChoreFace {
  readonly child: Child;
  readonly member: boolean;
  /** 1-based place in the rotation, for a chore that takes turns. */
  readonly turn: number | null;
  /**
   * False only for the last child on the chore. The server reads an empty roster as EVERYONE and
   * refuses to write one, so the face is drawn inert instead of tapped into a refusal.
   */
  readonly canToggle: boolean;
  /** A turn may move one place earlier: the rotation's order is the only order that matters. */
  readonly canMoveEarlier: boolean;
}

export interface ChoreListRow {
  readonly choreId: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
  readonly kind: ChoreKind;
  readonly kindWord: string;
  readonly model: AssignmentModel;
  readonly basePoints: number;
  readonly worthWords: string;
  /** "Turns · Mon, Thu" */
  readonly howLine: string;
  readonly faces: readonly ChoreFace[];
  /** The wall's worth stepper walks 0..20; a file may say more, and then only down is live. */
  readonly canWorthDown: boolean;
  readonly canWorthUp: boolean;
}

export function choreListRows(catalog: ChoreCatalog, children: readonly Child[]): readonly ChoreListRow[] {
  const household = orderedChildren(children);
  const rows: ChoreListRow[] = [];
  for (const chore of catalog.chores) {
    // A retired chore is on nobody's board, and nothing on this screen may build on it.
    if (!chore.active) continue;
    const rotates = chore.assignmentModel === 'rotation';
    // The rotation's order is `position`, not the order the rows arrived in.
    const roster = [...chore.roster].sort((a, b) => a.position - b.position);
    const faces = household.map((child): ChoreFace => {
      const at = roster.findIndex((m) => m.childId === child.id);
      const member = at >= 0;
      return {
        child,
        member,
        turn: member && rotates ? at + 1 : null,
        canToggle: !member || roster.length > 1,
        canMoveEarlier: member && rotates && at > 0,
      };
    });
    rows.push({
      choreId: chore.id,
      labelFull: chore.labelFull,
      icon: chore.icon,
      kind: chore.kind,
      kindWord: KIND_WORDS[chore.kind],
      model: chore.assignmentModel,
      basePoints: chore.basePoints,
      worthWords: chore.basePoints > 0 ? counted(chore.basePoints, NOUN.point) : NO_WORTH_MARK,
      howLine: `${MODEL_WORDS[chore.assignmentModel]}${SEPARATOR}${scheduleWords(chore.rrule) ?? UNKNOWN_SCHEDULE_WORDS}`,
      faces,
      canWorthDown: chore.basePoints > POINTS_MIN,
      canWorthUp: chore.basePoints < POINTS_MAX,
    });
  }
  return rows;
}

/**
 * The faces on an OPEN row, in the order its keys mean something. A chore that takes turns lists
 * the children on it in turn order, so the earlier-key beside a face points at the face it would
 * pass, and then everyone not on it in household order. Any other chore keeps household order —
 * the order every other row and the rail use.
 */
export function facesInTurnOrder(row: Pick<ChoreListRow, 'model' | 'faces'>): readonly ChoreFace[] {
  if (row.model !== 'rotation') return row.faces;
  const turns = row.faces.filter((f) => f.member).sort((a, b) => (a.turn ?? 0) - (b.turn ?? 0));
  return [...turns, ...row.faces.filter((f) => !f.member)];
}

/** The heading over the list: "6 chores" and "2 duties · 4 extras". */
export function choreListSummary(rows: readonly ChoreListRow[]): { readonly head: string; readonly detail: string } {
  if (rows.length === 0) return { head: 'No chores yet', detail: '' };
  const duties = rows.filter((r) => r.kind === 'duty').length;
  return {
    head: counted(rows.length, NOUN.chore),
    detail: `${counted(duties, NOUN.duty)}${SEPARATOR}${counted(rows.length - duties, NOUN.extra)}`,
  };
}

/** Merge a settings answer's worths into the chore list, so a stepper shows what it just wrote. */
export function withWorths(
  catalog: ChoreCatalog,
  worths: readonly { readonly choreId: string; readonly basePoints: number }[],
): ChoreCatalog {
  const byId = new Map(worths.map((w) => [w.choreId, w.basePoints]));
  return {
    ...catalog,
    chores: catalog.chores.map((c) => {
      const next = byId.get(c.id);
      return next === undefined || next === c.basePoints ? c : { ...c, basePoints: next };
    }),
  };
}

/**
 * The chore a create just made: the first active chore in the answer whose id was not there
 * before. The list opens that row, because a chore made at the wall starts on ONE child — the
 * sheet has no roster step — and the open row is where the other faces are put on.
 */
export function addedChoreId(before: readonly string[], catalog: ChoreCatalog): string | null {
  const known = new Set(before);
  return catalog.chores.find((c) => c.active && !known.has(c.id))?.id ?? null;
}

// ---------------------------------------------------------------------------
// 8. Days and schedules, in words
// ---------------------------------------------------------------------------

const MONDAY_FIRST: readonly DayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

const DAY_SHORT: Readonly<Record<DayCode, string>> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

const SCHOOL_DAYS: readonly DayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR'];
const WEEKEND: readonly DayCode[] = ['SA', 'SU'];

function isDayCode(code: string): code is DayCode {
  return (DAY_CODES as readonly string[]).includes(code);
}

function sameDays(a: ReadonlySet<DayCode>, b: readonly DayCode[]): boolean {
  return a.size === b.length && b.every((d) => a.has(d));
}

/** "Every day", "School days", "Weekends", or "Mon, Wed, Fri" — Monday first, as a week is said. */
export function daysWords(codes: readonly string[]): string {
  const set = new Set<DayCode>();
  for (const raw of codes) {
    const code = raw.trim().toUpperCase();
    if (isDayCode(code)) set.add(code);
  }
  if (set.size === 0) return 'No days';
  if (set.size === 7) return 'Every day';
  if (sameDays(set, SCHOOL_DAYS)) return 'School days';
  if (sameDays(set, WEEKEND)) return 'Weekends';
  return MONDAY_FIRST.filter((d) => set.has(d))
    .map((d) => DAY_SHORT[d])
    .join(', ');
}

const KNOWN_RRULE_PARTS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'DTSTART', 'WKST']);

function rruleDate(value: string): boolean {
  return /^\d{8}/.test(value) || /^\d{4}-\d{2}-\d{2}/.test(value);
}

/**
 * A chore's schedule in words, or null for a rule the server will never put on the board.
 *
 * The subset is the SERVER's (`src/domain/chores/recurrence.ts`), re-read here rather than
 * imported because that module is the board's, not the bundle's — and a test runs both over the
 * same table so the two cannot disagree about which rules exist. `DTSTART` and `UNTIL` bound a
 * rule without changing its rhythm, so they are checked and not said.
 */
export function scheduleWords(rrule: string): string | null {
  const body = rrule.trim().replace(/^RRULE:/i, '');
  if (body.length === 0) return null;
  const parts = new Map<string, string>();
  for (const chunk of body.split(';')) {
    if (chunk.trim().length === 0) continue;
    const eq = chunk.indexOf('=');
    if (eq <= 0) return null;
    const key = chunk.slice(0, eq).trim().toUpperCase();
    if (!KNOWN_RRULE_PARTS.has(key) || parts.has(key)) return null;
    parts.set(key, chunk.slice(eq + 1).trim().toUpperCase());
  }
  const wkst = parts.get('WKST');
  if (wkst !== undefined && wkst !== 'MO') return null;
  for (const bound of ['DTSTART', 'UNTIL']) {
    const v = parts.get(bound);
    if (v !== undefined && !rruleDate(v)) return null;
  }
  const rawInterval = parts.get('INTERVAL');
  let interval = 1;
  if (rawInterval !== undefined) {
    interval = Number.parseInt(rawInterval, 10);
    if (!Number.isInteger(interval) || interval < 1) return null;
  }
  const freq = parts.get('FREQ');
  if (freq === 'DAILY') {
    if (parts.has('BYDAY')) return null;
    return interval === 1 ? 'Every day' : `Every ${counted(interval, NOUN.day)}`;
  }
  if (freq === 'WEEKLY') {
    const byday = parts.get('BYDAY');
    if (byday === undefined) return null;
    const codes = byday.split(',').map((c) => c.trim());
    if (codes.length === 0 || codes.some((c) => !isDayCode(c))) return null;
    const days = daysWords(codes);
    if (interval === 1) return days;
    if (interval === 2) return `${days}, every other week`;
    return `${days}, every ${counted(interval, NOUN.week)}`;
  }
  return null;
}

function clockText(minutes: number, withMeridiem: boolean): string {
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  const base = `${String(hour12)}:${String(mm).padStart(2, '0')}`;
  return withMeridiem ? `${base} ${hh < 12 ? 'AM' : 'PM'}` : base;
}

/** "6:00–8:00 AM", or "11:30 AM–1:00 PM" when the window crosses noon. Raw when a time is bad. */
export function windowText(opensAtLocal: string, closesAtLocal: string): string {
  const a = minutesOfDay(opensAtLocal);
  const b = minutesOfDay(closesAtLocal);
  if (a === null || b === null) return `${opensAtLocal}–${closesAtLocal}`;
  const sameHalf = a < 720 === b < 720;
  return `${clockText(a, !sameHalf)}–${clockText(b, true)}`;
}

/** The second line of a routine's pill: "6:00–8:00 AM · School days". */
export function routineWhenLine(
  routine: Pick<RoutineCatalogEntry, 'opensAtLocal' | 'closesAtLocal' | 'daysOfWeek'>,
): string {
  return `${windowText(routine.opensAtLocal, routine.closesAtLocal)}${SEPARATOR}${daysWords(routine.daysOfWeek.split(','))}`;
}

/**
 * A routine pill's mark: a sun for one that opens before noon, a moon for one that opens in the
 * evening, and a clock for anything between — an after-school routine is neither.
 */
export function routineGlyph(opensAtLocal: string): GlyphName {
  const m = minutesOfDay(opensAtLocal);
  if (m === null) return 'clock';
  if (m < 12 * 60) return 'sun';
  return m >= 17 * 60 ? 'moon' : 'clock';
}

/** Routines are read off the card as it is drawn, so an edit is on today's card at once. */
export const ROUTINE_RULE_WORDS = 'Changes show on today’s card straight away.';

/** The divider between a child's steps and the ones she could have. */
export function routinePoolHeading(childName: string, routineLabel: string): string {
  return `Add a step to ${childName}’s ${routineLabel.toLowerCase()}`;
}

// ---------------------------------------------------------------------------
// 9. Settings — the calendar, and leave-by
// ---------------------------------------------------------------------------

export type CalendarTone = 'idle' | 'ok' | 'trouble' | 'busy';

export interface CalendarLine {
  readonly tone: CalendarTone;
  readonly head: string;
  readonly detail: string;
}

/**
 * How the calendars are doing, in one head and one detail.
 *
 * Read from the server's per-source health (labels only — never an adapter handle or an error
 * text). The order of the tests is the order of urgency: a fetch in flight says so, then any
 * failure, then anything never fetched, then the age of the OLDEST good copy, because the wall
 * is exactly as current as its stalest calendar.
 */
export function calendarLine(sources: readonly CalendarSourceHealth[], nowMs: number): CalendarLine {
  const total = sources.length;
  if (total === 0) return { tone: 'idle', head: 'No calendars', detail: 'Nothing is connected' };
  if (sources.some((s) => s.last === 'running')) {
    return { tone: 'busy', head: 'Fetching now', detail: counted(total, NOUN.calendar) };
  }
  const failed = sources.filter((s) => s.last === 'failed');
  if (failed.length > 0) {
    const only = failed.length === 1 ? failed[0] : undefined;
    return {
      tone: 'trouble',
      head: 'Fetch failed',
      detail:
        only !== undefined
          ? `${only.label} failed last time`
          : `${String(failed.length)} of ${counted(total, NOUN.calendar)} failed last time`,
    };
  }
  const good = sources.filter((s) => s.last === 'ok' && s.goodAtUtc !== null);
  if (good.length < total) {
    return {
      tone: 'trouble',
      head: good.length === 0 ? 'Not fetched yet' : 'Partly fetched',
      detail: `${String(good.length)} of ${counted(total, NOUN.calendar)} fetched`,
    };
  }
  let oldest: string | null = null;
  let oldestMs = Number.POSITIVE_INFINITY;
  for (const s of good) {
    const ms = s.goodAtUtc === null ? Number.NaN : Date.parse(s.goodAtUtc);
    if (!Number.isNaN(ms) && ms < oldestMs) {
      oldestMs = ms;
      oldest = s.goodAtUtc;
    }
  }
  const ago = agoText(oldest, nowMs);
  const stale = Number.isFinite(oldestMs) && nowMs - oldestMs > CALENDAR_STALE_AFTER_SECONDS * 1000;
  return {
    tone: stale ? 'trouble' : 'ok',
    head: ago === null ? 'Fetched' : `Fetched ${ago}`,
    detail: stale ? 'Older than it should be' : `${String(total)} of ${counted(total, NOUN.calendar)} ok`,
  };
}

export const FETCH_WORDS = 'Fetch now';

/** Said when the calendar scheduler is not running on this wall at all. */
export const FETCH_UNAVAILABLE_WORDS = 'Calendar fetching isn’t running on this wall.';

/** What a Fetch now press came to, as the strip says it. */
export function fetchOutcomeToast(outcome: RefreshOutcome): { readonly tone: ToastTone; readonly words: string } {
  switch (outcome.disposition) {
    case 'started':
      return { tone: 'ok', words: 'Fetching the calendars now.' };
    case 'already-running':
      return { tone: 'ok', words: 'Already fetching — it will finish on its own.' };
    default:
      return { tone: 'trouble', words: FETCH_UNAVAILABLE_WORDS };
  }
}

/**
 * A refused Fetch now. The route answers `unavailable` when this deployment has no calendar
 * scheduler — a code outside the wall's frozen refusal table, which `refusalCodeOf` would fold
 * into "Not now. Try again", the one thing that will never help. So the RAW code is read here.
 */
export function fetchRefusalWords(err: unknown): string {
  const raw = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code: unknown }).code) : '';
  if (raw === 'unavailable') return FETCH_UNAVAILABLE_WORDS;
  return REFUSAL_WORDS[refusalCodeOf(err)];
}

export const LEAVE_BY_HEAD = 'Leave-by alerts';

/** "Get ready 25 min · Drive 10 min · School 7:35 AM" — the numbers the Leaving screen sets. */
export function leaveBySummary(rules: DepartureRules): string {
  const parts = [`Get ready ${counted(rules.readyMinutes, NOUN.min)}`, `Drive ${counted(rules.travelMinutes, NOUN.min)}`];
  if (rules.school.days.length > 0) parts.push(`${rules.school.label} ${localTimeText(rules.school.leaveAt)}`);
  return parts.join(SEPARATOR);
}

// ---------------------------------------------------------------------------
// 10. Home — six tiles, each a door
// ---------------------------------------------------------------------------

export type HomeTileId = 'waiting' | 'today' | 'money' | 'calendar' | 'scene' | 'settings';

export const HOME_TILES: readonly HomeTileId[] = ['waiting', 'today', 'money', 'calendar', 'scene', 'settings'];

export const HOME_TILE_WORDS: Readonly<Record<HomeTileId, string>> = {
  waiting: 'Waiting',
  today: 'Today',
  money: 'Money',
  calendar: 'Calendar',
  scene: 'Picture',
  settings: 'Settings',
};

export const HOME_TILE_GLYPHS: Readonly<Record<HomeTileId, GlyphName>> = {
  waiting: 'hourglass',
  today: 'check',
  money: 'star',
  calendar: 'calendar',
  scene: 'picture',
  settings: 'sun',
};

/**
 * Where each tile goes. The picture tile is the one that leaves the portal's shell: the picture
 * library is its own destination with its own door, and putting a picture up asks for no PIN.
 */
export type HomeTileDoor =
  | { readonly kind: 'section'; readonly section: GrownupSection }
  | { readonly kind: 'pictures' };

export const HOME_TILE_DOORS: Readonly<Record<HomeTileId, HomeTileDoor>> = {
  waiting: { kind: 'section', section: 'waiting' },
  today: { kind: 'section', section: 'chores' },
  money: { kind: 'section', section: 'money' },
  calendar: { kind: 'section', section: 'settings' },
  scene: { kind: 'pictures' },
  settings: { kind: 'section', section: 'settings' },
};

/**
 * The tiles this household's Home draws: `HOME_TILES` less Today when chores AND routines are
 * both off (it counts nothing then), and Money when money is off. Waiting, Calendar, Picture and
 * Settings always stay. The grid keeps its 3x2 shape; a dropped tile leaves an empty cell.
 */
export function homeTilesFor(h: Pick<HouseholdView, 'features'> | undefined | null): readonly HomeTileId[] {
  return HOME_TILES.filter((t) => {
    if (t === 'today') return featureOn(h, 'chores') || featureOn(h, 'routines');
    if (t === 'money') return featureOn(h, 'money');
    return true;
  });
}

/**
 * Where a tile goes for this household. Today opens Chores, and Routines when chores are off —
 * otherwise a household with routines only would get a tile whose door leads to a hidden screen,
 * which is a tap that does nothing.
 */
export function homeTileDoorFor(id: HomeTileId, h: Pick<HouseholdView, 'features'> | undefined | null): HomeTileDoor {
  if (id === 'today' && !featureOn(h, 'chores') && featureOn(h, 'routines')) {
    return { kind: 'section', section: 'routines' };
  }
  return HOME_TILE_DOORS[id];
}

/** What a tile says: one big line and one small one. */
export interface TileWords {
  readonly big: string;
  readonly small: string;
}

/** Waiting: how many, and whose faces. */
export function waitingTile(items: readonly ApprovalItem[]): TileWords & { readonly childIds: readonly string[] } {
  const childIds: string[] = [];
  for (const item of items) if (!childIds.includes(item.childId)) childIds.push(item.childId);
  if (items.length === 0) return { big: 'All sorted', small: 'Nothing is waiting', childIds };
  return { big: String(items.length), small: `${nounFor(items.length, NOUN.thing)} to look at`, childIds };
}

/**
 * Today: chores done across the household, and routines finished. A claimed chore counts as
 * done, exactly as it does on a child's own progress mark — her part is finished.
 */
export function todayTile(snapshot: Pick<WallSnapshot, 'chores' | 'routines'>): TileWords {
  const live = (snapshot.chores ?? []).filter((c) => c.state !== 'superseded');
  const done = live.filter((c) => c.state === 'claimed' || c.state === 'approved').length;
  const runs = snapshot.routines ?? [];
  const finished = runs.filter(
    (r) => (r.steps ?? []).length > 0 && (r.steps ?? []).every((s) => s.completedAtUtc !== null && s.completedAtUtc !== undefined),
  ).length;
  const parts: string[] = [];
  if (live.length > 0) parts.push(`${nounFor(live.length, NOUN.chore)} done`);
  if (runs.length > 0) parts.push(`${String(finished)} of ${counted(runs.length, NOUN.routine)} finished`);
  return {
    big: live.length === 0 ? 'No chores' : `${String(done)} of ${String(live.length)}`,
    small: parts.join(SEPARATOR),
  };
}

/** Money: what the household owes, in money when there is a rate and in points when not. */
export function moneyTile(snapshot: Pick<WallSnapshot, 'children' | 'balances'>, centsPerPoint: number | null): TileWords {
  const earners = orderedChildren(snapshot.children).filter((c) => c.ledgerEnabled);
  if (earners.length === 0) return { big: 'Stickers only', small: 'Nobody earns points yet' };
  const balances = earners.map((c) => ({ child: c, balance: balanceFor(snapshot.balances, c.id) }));
  const inCash = balances.every((b) => b.balance.cashCents !== null);
  const rate = centsPerPoint === null ? null : rateWords(centsPerPoint);
  const each = balances.map((b) =>
    inCash ? `${b.child.displayName} ${cashText(b.balance.cashCents) ?? ''}` : `${b.child.displayName} ${String(b.balance.points)}`,
  );
  if (rate !== null && rate !== NO_RATE_WORDS) each.push(rate.head);
  const big = inCash
    ? (cashText(balances.reduce((sum, b) => sum + (b.balance.cashCents ?? 0), 0)) ?? '')
    : counted(
        balances.reduce((sum, b) => sum + b.balance.points, 0),
        NOUN.point,
      );
  return { big, small: each.join(SEPARATOR) };
}

/** The picture tile: which picture is up, and whether anything new is waiting to be judged. */
export function sceneTile(catalog: SceneCatalog | null): TileWords {
  if (catalog === null) return { big: 'Pictures', small: '' };
  const active = catalog.scenes.find((s) => s.id === catalog.activeSceneId) ?? null;
  const fresh = catalog.scenes.filter((s) => s.state === 'candidate').length;
  return {
    big: active === null ? 'No picture up' : sceneLabel(active).title,
    small: fresh === 0 ? 'Nothing new to look at' : `${String(fresh)} new to look at`,
  };
}

/** Settings: the look the wall wears, and whether it says when to leave. */
export function settingsTile(theme: WallThemeId, rules: DepartureRules | null): TileWords {
  const leaveBy = rules === null ? null : rules.enabled ? 'leave-by alerts on' : 'leave-by alerts off';
  return { big: THEME_NAMES[theme], small: leaveBy === null ? 'Theme' : `Theme${SEPARATOR}${leaveBy}` };
}

/**
 * The sizes a tile's big line steps down through: a card title, then the two body sizes. A tile
 * is a third of the sheet, so "$1.90" sets at the top size and a picture's long title does not.
 */
export const TILE_BIG_SIZES_PX: readonly number[] = [fontSizePx.cardTitle, fontSizePx.bodyLarge, fontSizePx.body];

/**
 * A tile's big line at the largest size that holds it on one line. When even the smallest does
 * not, it is set at the smallest and the line's own ellipsis is the last resort — a tile's big
 * line is a summary of a screen one tap away, not the only place those words exist.
 */
export function tileBigFit(words: string, roomPx: number, measure: MeasureText): FittedWords {
  const sizes = TILE_BIG_SIZES_PX.map((sizePx): FittedWords => ({ words, sizePx }));
  const smallest = TILE_BIG_SIZES_PX[TILE_BIG_SIZES_PX.length - 1] ?? fontSizePx.body;
  return firstThatFits(sizes, roomPx, (c) => measure(c.words, c.sizePx)) ?? { words, sizePx: smallest };
}

// ---------------------------------------------------------------------------
// 11. What fits in the strips
// ---------------------------------------------------------------------------

/** The felt tab row: a pill per section, then the stale chip if any, then Leave. */
export const TAB_TEXT_PX = fontSizePx.small;
export const TAB_GLYPH_PX = iconPx.xs;
export const TAB_GLYPH_GAP_PX = spacePx.xxs;
export const TAB_PAD_X_PX = spacePx.sm;
export const TAB_GAP_PX = spacePx.tapGap;
/** Everything in a worded tab that is not its word. */
export const TAB_CHROME_PX = 2 * TAB_PAD_X_PX + TAB_GLYPH_PX + TAB_GLYPH_GAP_PX;

/** One tab's width: a square at the tap floor alone, or its word plus its chrome. */
export function tabWidthPx(wordWidthPx: number | null): number {
  if (wordWidthPx === null) return tapPx.min;
  return Math.max(tapPx.min, Math.ceil(wordWidthPx) + TAB_CHROME_PX);
}

export interface TabFit {
  /** The tabs that carry their word; the rest are a glyph alone. */
  readonly worded: ReadonlySet<GrownupSection>;
  readonly leaveWorded: boolean;
}

/**
 * Which tabs keep their words in the felt row, preferred first. A stale wall's chip (its short
 * words, "Old" or "Stuck") never shrinks — it is the honest label — so the tabs give way around it:
 * Home goes to a glyph first (it is the portal's own face, and the glyph is a person), then
 * every tab but the one you are on, then Leave's word, then the chosen tab's. `sections` is the
 * row the nav actually draws (`grownupSectionsFor`); a hidden section's word is never measured.
 */
export function tabWordsFit(
  selected: GrownupSection,
  roomPx: number,
  measure: MeasureText,
  chipWords: string | null,
  sections: readonly GrownupSection[] = GROWNUP_SECTIONS,
): TabFit {
  const all = new Set<GrownupSection>(sections);
  const notHome = new Set<GrownupSection>(sections.filter((s) => s !== 'home' || s === selected));
  const chosen = new Set<GrownupSection>([selected]);
  const none = new Set<GrownupSection>();
  const candidates: readonly TabFit[] = [
    { worded: all, leaveWorded: true },
    { worded: notHome, leaveWorded: true },
    { worded: chosen, leaveWorded: true },
    { worded: chosen, leaveWorded: false },
    { worded: none, leaveWorded: false },
  ];
  const chip = chipWords === null ? 0 : tabWidthPx(measure(chipWords, TAB_TEXT_PX)) + TAB_GAP_PX;
  const widthOf = (fit: TabFit): number => {
    let w = chip;
    for (const s of sections) {
      w += tabWidthPx(fit.worded.has(s) ? measure(SECTION_WORDS[s], TAB_TEXT_PX) : null) + TAB_GAP_PX;
    }
    return w + tabWidthPx(fit.leaveWorded ? measure(LEAVE_WORD, TAB_TEXT_PX) : null);
  };
  return firstThatFits(candidates, roomPx, widthOf) ?? { worded: none, leaveWorded: false };
}

/**
 * The side-nav looks' header: the date and the time, in the room the title and Leave leave it.
 * Shorter dates first, then the time alone, then nothing — never half of either.
 */
export function headerClockFit(
  date: LocalDate,
  timeText: string,
  roomPx: number,
  measure: MeasureText,
): FittedWords | null {
  const dates = [localDateText(date, 'full'), localDateText(date, 'short'), localDateText(date, 'monthDay')].filter(
    (d) => d.length > 0,
  );
  const lines = timeText.length === 0 ? dates : [...dates.map((d) => `${d}${SEPARATOR}${timeText}`), timeText];
  return firstThatFits(
    lines.map((words): FittedWords => ({ words, sizePx: fontSizePx.small })),
    roomPx,
    (c) => measure(c.words, c.sizePx),
  );
}
