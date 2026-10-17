/**
 * Unit F — the snapshot builder. The single authoritative read behind
 * `GET /api/wall/v1/snapshot?localDate=YYYY-MM-DD`.
 *
 * There is no partial-state endpoint, because a client that stitches state together can
 * hold a half-stale view and render it with full confidence. One read returns everything
 * for a full render, for EVERY child — the client selects, and that selection lives in the
 * client's memory only. A server-held or persisted selection is what leaves the wrong
 * child's view up all night (H3, H2 Q3).
 *
 * ## The date is the client's, not ours
 *
 * `localDate` is required and is the CLIENT's view of today. Computing it here from the
 * server's clock is H1 lens 3 exactly: at local midnight one second of skew answers with
 * yesterday, nothing refires until the next boundary, and the wall is a day behind through
 * 6:00 AM. So the client asserts, the server builds what was asserted, and the response
 * echoes it as `requestedLocalDate` alongside `freshness.snapshotLocalDate` — which this
 * implementation always makes equal, because a date it cannot honour is refused with
 * `date_mismatch` rather than silently answered with a different one.
 *
 * ## Nothing here evaluates a clock into a flag
 *
 * Routine time boxes ship as `opensAtLocal`/`closesAtLocal` DATA. A snapshot built at 00:00
 * carrying a server-computed `locked` would never open at 06:00, because the wall only
 * refetches on SSE open and at the date boundary (H2 Q1's fatal flaw). The client computes
 * box state from its own clock.
 */

import type { Database as Db } from 'better-sqlite3';
import { listBalances, listActiveChildren, resolveAsset } from '../db/repo.ts';
import { choreStreakDays, displayStreak } from '../domain/chores/streaks.ts';
import { calendarIsConfigured, listPromotedEvents, promotedSyncAgeSeconds } from '../calendar/sync.ts';
import { choresForDate } from '../domain/chores/index.ts';
import { dogWeek, petEnabled } from '../domain/dog/index.ts';
import { todaysRoutinesWithStatus } from '../domain/routines/index.ts';
import { daysBetween, isLocalDate, localDate as serverLocalDate, nowUtc } from '../time.ts';
import type {
  CalendarEventView,
  CountdownView,
  LocalDate,
  MaterializationStatus,
  RedemptionRequest,
  RedemptionState,
  Utc,
  WallSnapshot,
} from '../types.ts';
import { API_VERSION, ApiError, MAX_DATE_SKEW_DAYS, MIN_CLIENT_BUILD } from './protocol.ts';
import { eventEmoji } from '../calendar/classify.ts';
import { activeScene } from '../domain/scenes/library.ts';
import { readDepartureRules } from '../domain/departures/index.ts';
import { readWallTheme } from '../domain/theme/index.ts';
import { readHousehold, toView } from '../config/household.ts';

/** `countdown` has no category column, so this is the fallback key for its icon. */
export const COUNTDOWN_ICON_CATEGORY = 'countdown';

/**
 * How far ahead events are carried.
 *
 * Past events are dropped because they can never be rendered as upcoming; the forward bound
 * exists so the payload a months-uptime kiosk re-parses on every refetch stays proportional
 * to what a family wall shows, rather than to whatever window the sync happened to fetch.
 */
export const DEFAULT_EVENT_HORIZON_DAYS = 60;

export interface SnapshotOptions {
  now?: Date | undefined;
  horizonDays?: number | undefined;
  /**
   * Where the scene pictures and their manifests live.
   *
   * Injected rather than resolved here for the reason the whole `src/http` boundary exists:
   * the route surface must stay testable against `:memory:` and a temp directory, and a module
   * that reached for a real path would decide where the household's data lives from inside the
   * layer that is supposed to decide nothing about it.
   *
   * Absent means "no scene" — every test that predates the library, and any deployment without
   * an asset root, gets `scene: null` and the information board. That is a correct screen, not
   * a broken one, which is why this can be optional at all.
   */
  assetRoot?: string | undefined;
}

/**
 * Validates the client's asserted date and returns it, or refuses.
 *
 * Inside the skew window the client's date WINS unconditionally — that is the whole point.
 * Outside it the date is refused rather than built, because building a date materializes it:
 * a kiosk with a dead clock asking for 2000-01-01 would write a routine run and a chore day
 * for a date nothing will ever read again. `date_mismatch` is the frozen code for exactly
 * this, and the client's contracted response to it is to refetch.
 */
export function requireBuildableDate(
  raw: string | null | undefined,
  now: Date = new Date(),
): LocalDate {
  if (typeof raw !== 'string' || raw.length === 0) {
    throw new ApiError(
      'date_mismatch',
      'localDate is required: the wall asserts its own view of today',
    );
  }
  if (!isLocalDate(raw)) {
    throw new ApiError('date_mismatch', 'localDate must be YYYY-MM-DD');
  }
  const skew = Math.abs(daysBetween(serverLocalDate(now), raw));
  if (skew > MAX_DATE_SKEW_DAYS) {
    throw new ApiError(
      'date_mismatch',
      'the requested date is too far from the household date to build',
    );
  }
  return raw;
}

/**
 * The whole wall, for one local date.
 *
 * Materializes as a side effect, via the domain units' own idempotent, self-repairing
 * entry points — `choresForDate` and `todaysRoutinesWithStatus`. Neither is reimplemented
 * here; a second materialization path is a second race.
 */
export function buildSnapshot(
  db: Db,
  requestedLocalDate: LocalDate,
  options: SnapshotOptions = {},
): WallSnapshot {
  const now = options.now ?? new Date();
  const horizon = options.horizonDays ?? DEFAULT_EVENT_HORIZON_DAYS;

  const children = listActiveChildren(db);
  const routines = todaysRoutinesWithStatus(db, requestedLocalDate);
  const chores = choresForDate(db, requestedLocalDate);
  // The household's surfaces. A surface that is OFF ships as an empty list; the materializers
  // above still run, so its rows exist and nothing is lost when it is turned back on. An older
  // client that does not know `household.features` sees empty lists, which it already renders
  // honestly.
  const features = readHousehold(db).features;

  // The calendar and the countdowns are isolated from the 6:00 AM critical path. Both map
  // rows into closed unions that THROW on a shape the union cannot represent (H1 finding
  // #1), and a mapper throwing while building the wall's only read is a blank wall. Losing
  // the events strip is a bad morning; losing the routine a three-year-old is working
  // through is the failure the prime invariant forbids.
  let events: CalendarEventView[] = [];
  let calendarOk = true;
  try {
    events = upcoming(listPromotedEvents(db), requestedLocalDate, horizon);
  } catch {
    calendarOk = false;
  }

  let countdowns: CountdownView[] = [];
  try {
    if (features.countdowns) countdowns = countdownsFor(db, requestedLocalDate);
  } catch {
    countdowns = [];
  }

  return {
    freshness: {
      snapshotLocalDate: requestedLocalDate,
      generatedAtUtc: nowUtc(now),
      // Null is the honest answer when the calendar could not be read at all: an age of
      // "unknown" renders as staleness, an age of 0 would render as freshly synced.
      calendarSyncAgeSeconds: calendarOk ? promotedSyncAgeSeconds(db, now) : null,
      // Whether a sync is OWED, which is not the same question as whether one has happened.
      // Without this the client cannot tell "never synced" from "nothing to sync".
      calendarConfigured: calendarIsConfigured(db),
      // The frozen `Freshness` has ONE materialization field and the chore board has no
      // other channel to report through. Reporting 'ok' while half the cards silently
      // failed to materialize is stale-and-confident, which H2 gap #3 exists to prevent —
      // so the worse of the two statuses is what ships. A routine-ok/chores-failed morning
      // is therefore labelled slightly imprecisely, and labelled, rather than precisely
      // silent.
      routineMaterialization: worst(routines.status, chores.materialization.status),
    },
    requestedLocalDate,
    children,
    routines: features.routines ? routines.routines : [],
    chores: features.chores ? chores.assignments : [],
    events,
    countdowns,
    // One entry per ACTIVE child, always — Unit A's LEFT JOIN from `child`, never a bare
    // aggregate over `ledger_entry`, which returns zero rows for a child with no history.
    // That is every child on day one and every new sibling before their first approval
    // (H1 lens 5).
    balances: features.money ? listBalances(db) : [],
    // Computed against the date the CLIENT asserted, like everything else here. The server
    // answering from its own clock is how the wall ends up a day behind through 6:00 AM.
    streaks: features.chores
      ? children.map((c) => ({
          childId: c.id,
          days: displayStreak(choreStreakDays(db, c.id, requestedLocalDate)),
        }))
      : [],
    redemptions: features.money ? listPendingRedemptions(db) : [],
    // Chosen HERE rather than in the browser, as of 2026-09-08. The bundle used to carry a
    // committed array of ids and take the first that parsed, which put "put a new picture up"
    // behind a redeploy — the reason a weekly generator could never actually reach the wall.
    // `null` is a real answer: the wall shows the information board, which is the screen the
    // 6:00 AM invariant is about.
    scene: options.assetRoot === undefined ? null : activeScene(db, options.assetRoot),
    // The dog's week, keyed by the client's date like everything else, so the list turns
    // over at the same boundary the rest of the wall does.
    dog: petEnabled(db) ? dogWeek(db, requestedLocalDate) : null,
    // The leave-by RULES only. Whether it is time to get ready is the wall's call, made from
    // its own clock and today's events — the same local-state judgement the idle gate makes,
    // and for the same reason: the server's clock is not the wall's.
    departures: readDepartureRules(db),
    // Which look the wall wears. In the snapshot rather than behind a request of its own so
    // that a change reaches every screen on the same refetch, and a wall that boots offline
    // from a cached snapshot still wears the household's choice.
    theme: readWallTheme(db),
    household: toView(readHousehold(db)),
    apiVersion: API_VERSION,
    minClientBuild: MIN_CLIENT_BUILD,
  };
}

const RANK: Record<MaterializationStatus, number> = { ok: 0, stale: 1, error: 2 };

function worst(a: MaterializationStatus, b: MaterializationStatus): MaterializationStatus {
  return RANK[a] >= RANK[b] ? a : b;
}

// ---------------------------------------------------------------------------
// Redemptions
// ---------------------------------------------------------------------------

const REQUEST_COLUMNS =
  'id, child_id, points_requested, cents_per_point, cash_cents, state, requested_at_utc, decided_at_utc';

interface RedemptionRow {
  id: number;
  child_id: string;
  points_requested: number;
  cents_per_point: number;
  cash_cents: number;
  state: RedemptionState;
  requested_at_utc: string;
  decided_at_utc: string | null;
}

/**
 * PENDING requests only, oldest first.
 *
 * A plain table read, not a second copy of Unit D's rules: nothing here decides, transitions
 * or computes money. Unit D exposes `getRedemption` for one row but no list, and its row
 * mapper is module-internal, so the mapping is repeated rather than reached into — see the
 * note in the unit report.
 *
 * Decided requests are deliberately absent. They are history and belong in the ledger view;
 * the wall shows what is still outstanding, which is what a child taps "did she see it?"
 * about and what a parent approves from.
 */
export function listPendingRedemptions(db: Db): RedemptionRequest[] {
  const rows = db
    .prepare(
      `SELECT ${REQUEST_COLUMNS} FROM redemption_request
        WHERE state = 'pending' ORDER BY requested_at_utc, id`,
    )
    .all() as RedemptionRow[];
  return rows.map((r) => ({
    id: r.id,
    childId: r.child_id,
    pointsRequested: r.points_requested,
    centsPerPoint: r.cents_per_point,
    cashCents: r.cash_cents,
    state: r.state,
    requestedAtUtc: r.requested_at_utc as Utc,
    decidedAtUtc: r.decided_at_utc as Utc | null,
  }));
}

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

/**
 * Drops what is already over and what is beyond the horizon.
 *
 * A timed event's local day comes from `Intl` via `src/time.ts`, never from
 * `toISOString().slice(0,10)` — the UTC date is tomorrow's from 17:00 Denver onwards, which
 * would retire today's evening events during dinner (H3 finding #6). An all-day event's
 * `endDate` is EXCLUSIVE, so it survives while `endDate > today`.
 */
function upcoming(
  events: CalendarEventView[],
  today: LocalDate,
  horizonDays: number,
): CalendarEventView[] {
  return events.filter((e) => {
    if (e.when.kind === 'allDay') {
      return (
        daysBetween(today, e.when.endDate) > 0 &&
        daysBetween(today, e.when.startDate) <= horizonDays
      );
    }
    const endsOn = serverLocalDate(new Date(e.when.endsAtUtc));
    const startsOn = serverLocalDate(new Date(e.when.startsAtUtc));
    return daysBetween(today, endsOn) >= 0 && daysBetween(today, startsOn) <= horizonDays;
  });
}

// ---------------------------------------------------------------------------
// Countdowns
// ---------------------------------------------------------------------------

interface CountdownRow {
  id: string;
  label_short: string;
  label_full: string;
  icon_asset_id: string;
  emoji: string | null;
  target_date: string | null;
  annual_md: string | null;
  child_id: string | null;
}

/**
 * "3 sleeps until" — a LOCAL DATE SUBTRACTION, never an instant delta.
 *
 * An instant delta is wrong twice a year: a 23-hour day rounds a countdown down and a
 * 25-hour day rounds it up, so the number a child is watching jumps or stalls across a DST
 * boundary (H3 finding #6). `daysBetween` operates on the date parts only.
 *
 * A fixed countdown whose date has passed is dropped: "-4 sleeps" is not a thing a wall
 * should ever show. An annual one rolls to its next occurrence instead.
 *
 * `childId` is NULL for a household-wide countdown. It was missing from `CountdownView`
 * until 2026-08-24, so a birthday scoped to one child rendered as everyone's; the field was
 * added as a contract amendment once this was reported.
 */
/**
 * How far ahead a countdown is worth drawing.
 *
 * *"I don't think we include the kid's birthdays unless they're, like, two months out."*
 * (2026-09-09.) Every countdown is annual or a fixed date, so without a horizon the sidebar
 * carries all of them all year — three birthdays and a winter holiday sitting at 259, 295 and
 * 108 sleeps, which is not information, it is furniture. A number that large also does not
 * mean anything to the children this wall is for: "295 sleeps" and "never" are the same
 * sentence to a five-year-old.
 *
 * Applied to every countdown rather than to birthdays alone. A rule that reads "hide the ones
 * with a child attached" would be a second concept to hold, and the reason he gave — the
 * number is too far away to mean anything — is not about whose birthday it is.
 */
export const COUNTDOWN_HORIZON_DAYS = 60;

export function countdownsFor(db: Db, today: LocalDate): CountdownView[] {
  const rows = db
    .prepare(
      `SELECT id, label_short, label_full, icon_asset_id, emoji, target_date, annual_md, child_id
         FROM countdown WHERE active = 1 ORDER BY id`,
    )
    .all() as CountdownRow[];

  const views: CountdownView[] = [];
  for (const row of rows) {
    const target = targetFor(row, today);
    if (target === null) continue;
    const sleeps = daysBetween(today, target);
    // Off the wire entirely, not hidden by a renderer: three bands would each have to apply
    // the same rule and one of them would eventually not. Same reasoning as `displayStreak`.
    if (sleeps > COUNTDOWN_HORIZON_DAYS) continue;
    views.push({
      id: row.id,
      labelShort: row.label_short,
      labelFull: row.label_full,
      icon: resolveAsset(db, row.icon_asset_id, COUNTDOWN_ICON_CATEGORY),
      // Authored first, derived second. The fallback runs the calendar's own matcher over the
      // label, so a countdown nobody has given an emoji still gets a right one where the words
      // allow — and `null` where they do not, which draws nothing rather than a guess.
      emoji: row.emoji ?? eventEmoji(row.label_full),
      targetDate: target,
      sleepsRemaining: sleeps,
      childId: row.child_id,
    });
  }
  return views.sort((a, b) => a.sleepsRemaining - b.sleepsRemaining);
}

function targetFor(row: CountdownRow, today: LocalDate): LocalDate | null {
  if (row.target_date !== null) {
    if (!isRealDate(row.target_date)) return null;
    const target = row.target_date as LocalDate;
    return daysBetween(today, target) >= 0 ? target : null;
  }
  if (row.annual_md === null) return null;
  return nextAnnual(row.annual_md, today);
}

/**
 * The next occurrence of an MM-DD on or after `today`.
 *
 * The loop rather than "this year or next" is for 02-29: it exists in only one year in four,
 * and `Date.parse('2027-02-29T00:00:00Z')` does NOT fail — V8 rolls it to March 1st. A
 * leap-day countdown would otherwise silently show the wrong day for three years running.
 */
function nextAnnual(md: string, today: LocalDate): LocalDate | null {
  if (!/^\d{2}-\d{2}$/.test(md)) return null;
  const startYear = Number.parseInt(today.slice(0, 4), 10);
  if (!Number.isInteger(startYear)) return null;
  for (let year = startYear; year <= startYear + 8; year++) {
    const candidate = `${String(year).padStart(4, '0')}-${md}`;
    if (!isRealDate(candidate)) continue;
    if (daysBetween(today, candidate as LocalDate) >= 0) return candidate as LocalDate;
  }
  return null;
}

/**
 * A calendar date that actually exists.
 *
 * `isLocalDate` accepts 2026-02-29 because `Date.parse` rolls it forward instead of failing,
 * so the round trip is the only real check. The `toISOString` here is comparing a UTC-anchored
 * string against itself — it is NOT deriving a local date from an instant, which is the banned
 * pattern; `src/time.ts:addDays` anchors the same way for the same reason.
 */
function isRealDate(candidate: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(candidate)) return false;
  const t = Date.parse(`${candidate}T00:00:00Z`);
  if (Number.isNaN(t)) return false;
  return new Date(t).toISOString().slice(0, 10) === candidate;
}
