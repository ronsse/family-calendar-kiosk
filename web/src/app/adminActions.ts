/**
 * Unit H — the grown-up surface, minus its pixels.
 *
 * `actions.ts` is the wall's port: five writes a child may make, on a device token, none of
 * which can move a point.  This is its opposite number — the four writes only an adult may
 * make, each one carrying a PIN, each one the moment a claim becomes a permanent
 * append-only ledger fact (docs/api.md §Routes, admin surface).
 *
 * **The PIN is a per-request credential and this file is why that is structural rather than
 * a habit.**  Every method takes `parentPin` as an ordinary argument, so there is no shape
 * of this interface that approves anything without one, and nothing here holds a PIN
 * between calls — there is no field for one to live in.  `requireParentPin` on the server
 * is per request and never a session (src/http/server.ts); this is the client half of the
 * same sentence.
 *
 * Three things share the file because they are one unit — everything the grown-up
 * destination needs that is not a React component, and therefore everything about it that
 * can be tested without a browser:
 *
 *   1. **the port** — the four admin routes, behind an interface a view depends on;
 *   2. **the queue** — one list of everything waiting, across all children, derived from
 *      the snapshot the wall already has;
 *   3. **the geometry** — how many of those rows fit the pane, as arithmetic over Unit G's
 *      tokens rather than a number somebody counted on a screenshot.
 *
 * Failures are handled by CODE, never by matching the server's prose.  `REFUSAL_WORDS` is
 * keyed by the frozen error table, so adding a code there is a compile error here rather
 * than a refusal that renders as nothing.
 */

import type {
  AssetRef,
  AssignmentModel,
  Child,
  ChoreKind,
  DepartureRules,
  LedgerEntry,
  WallSnapshot,
  WallThemeId,
} from '../../../src/types.ts';
import { statusFor, type ContractErrorCode } from '../../../src/http/protocol.ts';
import { layoutPx, spacePx, strokePx } from '../design/tokens.ts';
import { avatarRef } from '../views/logic/summary.ts';
import type { WallActionError } from './actions.ts';

// ---------------------------------------------------------------------------
// 1. The port
// ---------------------------------------------------------------------------

export const ADMIN_API_PREFIX = '/api/admin/v1';

/**
 * The header docs/api.md's Auth table names, verbatim.  The server reads it with
 * `headerValue(req, 'x-parent-pin')`, which lower-cases; sending it lower-case keeps the
 * two spellings from looking like two different things.
 */
export const PARENT_PIN_HEADER = 'x-parent-pin';

/**
 * The shortest PIN `setParentPin` will store (src/http/auth.ts).  api.md does not state a
 * length, so this is the most restrictive reading available: below it no PIN can possibly
 * be the household's, and a request that cannot succeed is not worth a round trip in front
 * of somebody waiting.
 */
export const MIN_PARENT_PIN_LENGTH = 4;

export interface AdminActions {
  approveChore(assignmentId: number, parentPin: string): Promise<void>;
  rejectChore(assignmentId: number, parentPin: string): Promise<void>;
  approveRedemption(requestId: number, parentPin: string): Promise<void>;
  rejectRedemption(requestId: number, parentPin: string): Promise<void>;
  /**
   * Take a picture out of the library.  It stays in the catalog; the catalog is a history.
   * Still behind the PIN: it is the one control on the Pictures screen that REMOVES rather than
   * chooses.  APPROVING moved to `WallActions` on 2026-09-16 and asks for nothing.
   */
  retireScene(sceneId: string, parentPin: string): Promise<void>;
  /**
   * What a point is worth and what each chore pays.
   *
   * A READ that costs a PIN, which is the opposite of the trade `fetchScenes` makes on the
   * wall surface — and right, because nobody opens this screen to look. See docs/api.md.
   */
  fetchSettings(parentPin: string): Promise<HouseholdSettings>;
  setCentsPerPoint(centsPerPoint: number, parentPin: string): Promise<HouseholdSettings>;
  setChorePoints(
    choreId: string,
    basePoints: number,
    parentPin: string,
  ): Promise<HouseholdSettings>;
  /** The leave-by rules. A partial patch; the server refuses the whole of it on one bad field. */
  setDepartures(patch: DepartureRulesPatch, parentPin: string): Promise<HouseholdSettings>;
  /**
   * Which look the wall wears. The answer is the whole settings object like every settings
   * write, and the wall itself switches on the refetch the server pushes — the picker does not
   * repaint anything locally, so the screen can never show a look the server did not store.
   */
  setTheme(theme: WallThemeId, parentPin: string): Promise<HouseholdSettings>;
  /**
   * Who does which steps, in what order — the routine definitions, and the two writes that
   * change them from the wall.
   *
   * Each write answers with the WHOLE catalog, like the settings writes do, so the screen
   * renders what the server now holds rather than what it hoped for.  The server reconciles
   * TODAY's run in the same transaction (src/domain/routines/assign.ts): a step added at
   * 19:00 is in tonight's bedtime, not tomorrow's.
   */
  fetchRoutines(parentPin: string): Promise<RoutineCatalog>;
  assignRoutineStep(
    routineId: string,
    stepId: string,
    childId: string,
    assigned: boolean,
    parentPin: string,
  ): Promise<RoutineCatalog>;
  moveRoutineStep(
    routineId: string,
    stepId: string,
    childId: string,
    direction: 'up' | 'down',
    parentPin: string,
  ): Promise<RoutineCatalog>;
  /**
   * Who is asked to do each chore, and how — the chore definitions, and the three writes that
   * change them from the wall. Same shape of contract as the routines: every write answers
   * with the whole catalog. A roster change reaches TODAY's board (a pending row added or
   * removed, never a claim); a model change starts tomorrow, because today's day snapshotted
   * its model at breakfast (src/domain/chores/assign.ts).
   */
  fetchChores(parentPin: string): Promise<ChoreCatalog>;
  setChoreMember(choreId: string, childId: string, member: boolean, parentPin: string): Promise<ChoreCatalog>;
  moveChoreMember(
    choreId: string,
    childId: string,
    direction: 'up' | 'down',
    parentPin: string,
  ): Promise<ChoreCatalog>;
  setChoreModel(choreId: string, assignmentModel: AssignmentModel, parentPin: string): Promise<ChoreCatalog>;
  /**
   * A chore made on the wall. The server runs it through the same rules as the chores file
   * (`src/domain/chores/authoring.ts`), so a refusal comes back as one `bad_request` whose
   * message lists every reason — the sheet shows that message, it does not re-check.
   */
  createChore(draft: NewChoreRequest, parentPin: string): Promise<ChoreCatalog>;
  /**
   * A chore's name, picture or days (2026-10-11). Only the keys sent change; worth, model and
   * roster have their own doors above. The name and picture show on today's cards, new days start
   * tomorrow.
   */
  editChore(choreId: string, patch: ChoreEditRequest, parentPin: string): Promise<ChoreCatalog>;
  /**
   * Soft retire — off every board from now, history untouched — and its inverse. Retire is
   * refused `not_claimable` while a claim on the chore is still waiting.
   */
  retireChore(choreId: string, parentPin: string): Promise<ChoreCatalog>;
  restoreChore(choreId: string, parentPin: string): Promise<ChoreCatalog>;
  /**
   * Replace the household PIN. `currentPin` is the one the adult has JUST typed on the change
   * screen and is the request's authorisation — a wrong one is `bad_pin` and nothing is written.
   * Never the PIN the visit happens to be holding.
   */
  changePin(currentPin: string, newPin: string): Promise<HouseholdSettings>;
  /**
   * One manual point up or down for one child (Grown-ups → Money).
   *
   * `requestId` is the route's idempotency key and it is MANDATORY: one per tap, minted by the
   * caller, so a tap delivered twice pays once and a second tap is a second point. Never a
   * constant — that would make the second bonus a constraint violation that drops it.
   */
  adjustLedger(childId: string, delta: number, requestId: string, parentPin: string): Promise<LedgerEntry>;
  /** One child's ledger, oldest first, each entry with the running total after it. */
  fetchLedger(childId: string, parentPin: string): Promise<LedgerHistory>;
  /**
   * Ask the calendar scheduler for a sweep now (Grown-ups → Settings → Fetch now). A deployment
   * with no calendar upstream answers `unavailable`; the screen says that in its own words and
   * never shows the scheduler's `reason`, which is written for an operator.
   */
  refreshCalendar(parentPin: string): Promise<RefreshOutcome>;
}

/** The body of `POST /api/admin/v1/chores` — what the sheet collected, nothing derived. */
export interface NewChoreRequest {
  readonly labelFull: string;
  readonly iconAssetId: string;
  readonly kind: ChoreKind;
  readonly basePoints: number;
  readonly assignmentModel: AssignmentModel;
  readonly rrule: string;
  readonly roster: readonly string[];
}

/** The body of `POST /api/admin/v1/chores/:choreId/edit` — only what changed is sent. */
export interface ChoreEditRequest {
  readonly labelFull?: string;
  readonly iconAssetId?: string;
  readonly rrule?: string;
}

/** Mirrors `ChoreCatalog` in src/domain/chores/assign.ts — the wire shape, nothing derived. */
export interface ChoreRosterEntry {
  readonly childId: string;
  readonly position: number;
}

export interface ChoreCatalogEntry {
  readonly id: string;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
  readonly category: string;
  readonly assignmentModel: AssignmentModel;
  readonly basePoints: number;
  readonly kind: ChoreKind;
  readonly rrule: string;
  readonly dueByLocal: string | null;
  readonly active: boolean;
  /** The EFFECTIVE roster: the server has already turned "nobody listed" into everyone. */
  readonly roster: readonly ChoreRosterEntry[];
  readonly rosterExplicit: boolean;
}

/** One icon the sheet may offer — a validated `kind = 'icon'` asset. */
export interface ChoreIconEntry {
  readonly assetId: string;
  readonly url: string;
  readonly category: string;
}

export interface ChoreCatalog {
  readonly chores: readonly ChoreCatalogEntry[];
  readonly icons: readonly ChoreIconEntry[];
}

/** Mirrors `RoutineCatalog` in src/domain/routines/assign.ts — the wire shape, nothing derived. */
export interface RoutineStepCatalogEntry {
  readonly id: string;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
  readonly active: boolean;
}

export interface RoutineStepAssignmentEntry {
  readonly childId: string;
  readonly stepId: string;
  readonly position: number;
}

export interface RoutineCatalogEntry {
  readonly id: string;
  readonly labelShort: string;
  readonly labelFull: string;
  readonly opensAtLocal: string;
  readonly closesAtLocal: string;
  /**
   * The days it runs, as the table stores them: two-letter LOCAL day codes joined by commas
   * (`'MO,TU,WE,TH,FR'`). This mirror said `number[]` until 2026-10-11; nothing read it, so
   * nothing noticed — the server has always sent the string.
   */
  readonly daysOfWeek: string;
  readonly active: boolean;
  readonly steps: readonly RoutineStepCatalogEntry[];
  readonly assignments: readonly RoutineStepAssignmentEntry[];
}

export interface RoutineCatalog {
  readonly routines: readonly RoutineCatalogEntry[];
}

/** Mirrors `HouseholdSettings` in src/domain/settings — the wire shape, nothing derived. */
export interface ChoreValue {
  readonly choreId: string;
  readonly labelFull: string;
  readonly kind: 'duty' | 'extra';
  readonly basePoints: number;
  readonly active: boolean;
}

export interface HouseholdSettings {
  readonly centsPerPoint: number;
  readonly chores: readonly ChoreValue[];
  readonly departures: DepartureRules;
  readonly theme: WallThemeId;
  /**
   * One row per included calendar (2026-10-11). Labels only: the server never sends the
   * adapter's handle or the upstream's error text, so neither can reach this screen.
   */
  readonly calendar: { readonly sources: readonly CalendarSourceHealth[] };
}

/** Mirrors `CalendarSourceHealth` in src/calendar/sync.ts. */
export interface CalendarSourceHealth {
  readonly label: string;
  readonly last: 'ok' | 'failed' | 'running' | 'never';
  /** When the latest attempt finished (or started, while it runs). Null if never tried. */
  readonly triedAtUtc: string | null;
  /** When the events on the wall now arrived. Null if nothing ever has. */
  readonly goodAtUtc: string | null;
}

/** Mirrors the answer of `GET /api/admin/v1/children/:id/ledger`. */
export interface LedgerHistory {
  readonly childId: string;
  /** Oldest first, which is what makes `runningTotal` mean anything. */
  readonly entries: readonly (LedgerEntry & { readonly runningTotal: number })[];
  readonly total: number;
}

/** Mirrors `RefreshOutcome` in src/http/calendar-refresh.ts. */
export interface RefreshOutcome {
  readonly disposition: 'started' | 'already-running' | 'not-configured';
  /** Operator words. Never drawn: they can name a variable or a host. */
  readonly reason: string | null;
  readonly lastCompletedAtUtc: string | null;
  readonly lastEvents: number | null;
  readonly lastFailed: number | null;
}

/** Mirrors `DepartureRulesPatch` in src/domain/departures — what the wall may change. */
export interface DepartureRulesPatch {
  readonly enabled?: boolean;
  readonly readyMinutes?: number;
  readonly travelMinutes?: number;
  readonly schoolLeaveAt?: string;
}

/**
 * Structurally identical to `WallActionError` on purpose, so one guard reads both.  The two
 * surfaces differ in what they are allowed to do, not in how a refusal comes back.
 */
export type AdminActionError = WallActionError;

export function adminActionPaths(prefix: string = ADMIN_API_PREFIX) {
  return {
    approveChore: (assignmentId: number) => `${prefix}/chores/${String(assignmentId)}/approve`,
    rejectChore: (assignmentId: number) => `${prefix}/chores/${String(assignmentId)}/reject`,
    approveRedemption: (requestId: number) => `${prefix}/redemptions/${String(requestId)}/approve`,
    rejectRedemption: (requestId: number) => `${prefix}/redemptions/${String(requestId)}/reject`,
    // Encoded: a scene id comes from a filename, and the weekly runner builds one from an ISO
    // week and a setting id. Nothing stops a hand-registered scene carrying a character that
    // would change the path it addresses.
    retireScene: (sceneId: string) => `${prefix}/scenes/${encodeURIComponent(sceneId)}/retire`,
    settings: () => `${prefix}/settings`,
    centsPerPoint: () => `${prefix}/settings/cents-per-point`,
    // Encoded for the same reason a scene id is: a chore id is authored, not generated.
    chorePoints: (choreId: string) => `${prefix}/settings/chores/${encodeURIComponent(choreId)}`,
    departures: () => `${prefix}/settings/departures`,
    theme: () => `${prefix}/settings/theme`,
    routines: () => `${prefix}/routines`,
    // Routine and step ids are authored in the household file, like chore ids.
    assignRoutineStep: (routineId: string, stepId: string) =>
      `${prefix}/routines/${encodeURIComponent(routineId)}/steps/${encodeURIComponent(stepId)}/assign`,
    moveRoutineStep: (routineId: string, stepId: string) =>
      `${prefix}/routines/${encodeURIComponent(routineId)}/steps/${encodeURIComponent(stepId)}/move`,
    chores: () => `${prefix}/chores`,
    choreEdit: (choreId: string) => `${prefix}/chores/${encodeURIComponent(choreId)}/edit`,
    choreRetire: (choreId: string) => `${prefix}/chores/${encodeURIComponent(choreId)}/retire`,
    choreRestore: (choreId: string) => `${prefix}/chores/${encodeURIComponent(choreId)}/restore`,
    pin: () => `${prefix}/settings/pin`,
    choreRoster: (choreId: string) => `${prefix}/chores/${encodeURIComponent(choreId)}/roster`,
    choreRosterMove: (choreId: string) => `${prefix}/chores/${encodeURIComponent(choreId)}/roster/move`,
    choreModel: (choreId: string) => `${prefix}/chores/${encodeURIComponent(choreId)}/model`,
    ledgerAdjust: () => `${prefix}/ledger/adjust`,
    // A child id is authored in the household file, like a chore id.
    childLedger: (childId: string) => `${prefix}/children/${encodeURIComponent(childId)}/ledger`,
    calendarRefresh: () => `${prefix}/calendar/refresh`,
  };
}

function adminError(code: string, status: number, message?: string): AdminActionError {
  const err = new Error(`admin action failed: ${code}`) as AdminActionError;
  err.code = code;
  err.status = status;
  if (message !== undefined) err.message = message;
  return err;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface AdminActionsOptions {
  /** Same-origin by default: the kiosk loads the bundle from the same server. */
  baseUrl?: string | undefined;
  /** `Authorization: Device <token>`.  The admin surface needs the token AS WELL AS the PIN. */
  deviceToken?: string | undefined;
  fetchImpl?: FetchLike | undefined;
}

/**
 * Refuses, loudly, rather than doing nothing quietly.
 *
 * `NULL_WALL_ACTIONS` succeeds at nothing because a child's tap that should do nothing must
 * look like it did nothing.  The opposite is true here: a screen with no port wired that
 * reported success would show an adult an approval that never happened, and an approval is
 * the one thing on this wall that pays money.
 */
export const NULL_ADMIN_ACTIONS: AdminActions = {
  approveChore: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  rejectChore: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  approveRedemption: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  rejectRedemption: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  retireScene: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  fetchSettings: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  setCentsPerPoint: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  setChorePoints: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  setDepartures: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  setTheme: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  fetchRoutines: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  assignRoutineStep: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  moveRoutineStep: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  fetchChores: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  setChoreMember: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  moveChoreMember: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  setChoreModel: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  createChore: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  editChore: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  retireChore: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  restoreChore: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  changePin: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  adjustLedger: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  fetchLedger: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
  refreshCalendar: () => Promise.reject(adminError('unavailable', statusFor('unavailable'))),
};

export function createAdminActions(options: AdminActionsOptions = {}): AdminActions {
  const base = options.baseUrl ?? '';
  const paths = adminActionPaths();
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  async function post(path: string, parentPin: string): Promise<void> {
    // The PIN is the WHOLE of the authorisation for this one request.  An empty one cannot
    // be the household's, so it never reaches the network — and it fails with the same code
    // the server would have answered, so the wall renders one thing either way.
    if (typeof parentPin !== 'string' || parentPin.length === 0) {
      throw adminError('bad_pin', statusFor('bad_pin'));
    }

    const headers: Record<string, string> = { [PARENT_PIN_HEADER]: parentPin };
    if (options.deviceToken !== undefined && options.deviceToken.length > 0) {
      headers['authorization'] = `Device ${options.deviceToken}`;
    }

    // NO BODY, and therefore no content-type.  All four routes take none: approve never
    // did, and `{ note? }` was struck from both reject routes on 2026-08-24 because neither
    // table could persist it.  Sending a body the server discards is a promise nobody kept.
    const res = await doFetch(`${base}${path}`, { method: 'POST', headers });

    if (!res.ok) {
      let code = 'unknown';
      let message: string | undefined;
      try {
        const parsed: unknown = await res.json();
        if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
          code = String((parsed as { error: unknown }).error);
          const m = (parsed as { message?: unknown }).message;
          if (typeof m === 'string' && m.length > 0) message = m;
        }
      } catch {
        // A non-JSON body from a proxy or a dead server is still just "it failed".
      }
      throw adminError(code, res.status, message);
    }
  }

  /**
   * The same request, with a body and an answer.
   *
   * A separate function rather than options on `post`, and the split is the point: `post` sends
   * NO BODY and returns nothing, and that is asserted by a test — all six of its routes take
   * none. Bolting a body onto it would make "this surface sends no body" a runtime condition
   * instead of a property of the function, on the one surface where every request moves money.
   *
   * The PIN guard, the device header and the refusal decoding are identical, so they are shared
   * through `headersFor` and `refuse` and cannot drift apart.
   */
  async function call<T>(path: string, parentPin: string, method: string, body?: unknown): Promise<T> {
    if (typeof parentPin !== 'string' || parentPin.length === 0) {
      throw adminError('bad_pin', statusFor('bad_pin'));
    }
    const headers: Record<string, string> = { [PARENT_PIN_HEADER]: parentPin };
    if (options.deviceToken !== undefined && options.deviceToken.length > 0) {
      headers['authorization'] = `Device ${options.deviceToken}`;
    }
    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      init.body = JSON.stringify(body);
    }
    const res = await doFetch(`${base}${path}`, init);
    if (!res.ok) {
      let code = 'unknown';
      let message: string | undefined;
      try {
        const parsed: unknown = await res.json();
        if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
          code = String((parsed as { error: unknown }).error);
          const m = (parsed as { message?: unknown }).message;
          if (typeof m === 'string' && m.length > 0) message = m;
        }
      } catch {
        // A non-JSON body from a proxy or a dead server is still just "it failed".
      }
      throw adminError(code, res.status, message);
    }
    return (await res.json()) as T;
  }

  return {
    approveChore: (assignmentId, parentPin) => post(paths.approveChore(assignmentId), parentPin),
    rejectChore: (assignmentId, parentPin) => post(paths.rejectChore(assignmentId), parentPin),
    approveRedemption: (requestId, parentPin) =>
      post(paths.approveRedemption(requestId), parentPin),
    rejectRedemption: (requestId, parentPin) => post(paths.rejectRedemption(requestId), parentPin),
    retireScene: (sceneId, parentPin) => post(paths.retireScene(sceneId), parentPin),
    fetchSettings: (parentPin) => call<HouseholdSettings>(paths.settings(), parentPin, 'GET'),
    setCentsPerPoint: (centsPerPoint, parentPin) =>
      call<HouseholdSettings>(paths.centsPerPoint(), parentPin, 'POST', { centsPerPoint }),
    setChorePoints: (choreId, basePoints, parentPin) =>
      call<HouseholdSettings>(paths.chorePoints(choreId), parentPin, 'POST', { basePoints }),
    setDepartures: (patch, parentPin) =>
      call<HouseholdSettings>(paths.departures(), parentPin, 'POST', { ...patch }),
    setTheme: (theme, parentPin) =>
      call<HouseholdSettings>(paths.theme(), parentPin, 'POST', { theme }),
    fetchRoutines: (parentPin) => call<RoutineCatalog>(paths.routines(), parentPin, 'GET'),
    assignRoutineStep: (routineId, stepId, childId, assigned, parentPin) =>
      call<RoutineCatalog>(paths.assignRoutineStep(routineId, stepId), parentPin, 'POST', {
        childId,
        assigned,
      }),
    moveRoutineStep: (routineId, stepId, childId, direction, parentPin) =>
      call<RoutineCatalog>(paths.moveRoutineStep(routineId, stepId), parentPin, 'POST', {
        childId,
        direction,
      }),
    fetchChores: (parentPin) => call<ChoreCatalog>(paths.chores(), parentPin, 'GET'),
    setChoreMember: (choreId, childId, member, parentPin) =>
      call<ChoreCatalog>(paths.choreRoster(choreId), parentPin, 'POST', { childId, member }),
    moveChoreMember: (choreId, childId, direction, parentPin) =>
      call<ChoreCatalog>(paths.choreRosterMove(choreId), parentPin, 'POST', { childId, direction }),
    setChoreModel: (choreId, assignmentModel, parentPin) =>
      call<ChoreCatalog>(paths.choreModel(choreId), parentPin, 'POST', { assignmentModel }),
    createChore: (draft, parentPin) => call<ChoreCatalog>(paths.chores(), parentPin, 'POST', draft),
    editChore: (choreId, patch, parentPin) =>
      call<ChoreCatalog>(paths.choreEdit(choreId), parentPin, 'POST', { ...patch }),
    retireChore: (choreId, parentPin) => call<ChoreCatalog>(paths.choreRetire(choreId), parentPin, 'POST'),
    restoreChore: (choreId, parentPin) => call<ChoreCatalog>(paths.choreRestore(choreId), parentPin, 'POST'),
    changePin: (currentPin, newPin) =>
      call<HouseholdSettings>(paths.pin(), currentPin, 'POST', { newPin }),
    adjustLedger: (childId, delta, requestId, parentPin) =>
      call<LedgerEntry>(paths.ledgerAdjust(), parentPin, 'POST', { childId, delta, requestId }),
    fetchLedger: (childId, parentPin) => call<LedgerHistory>(paths.childLedger(childId), parentPin, 'GET'),
    // A POST with no body, through `call` because it answers: the outcome says whether a sweep
    // started or one was already running.
    refreshCalendar: (parentPin) => call<RefreshOutcome>(paths.calendarRefresh(), parentPin, 'POST'),
  };
}

// ---------------------------------------------------------------------------
// 1b. The scene catalog — a READ, and deliberately not behind the PIN
// ---------------------------------------------------------------------------

/**
 * One picture in the household's library, as `GET /api/wall/v1/scenes` returns it.
 *
 * `usable` is the field that earns its place. `activeScene` silently skips an approved scene
 * whose manifest will not parse, so without it the catalog would show a picture as live while
 * the wall showed a different one — and the reviewer would have no way to tell, because the
 * thing that is wrong is a file they cannot see from here.
 */
export interface SceneCatalogEntry {
  id: string;
  state: 'candidate' | 'approved' | 'retired';
  source: 'baseline' | 'generated';
  styleId: string | null;
  createdAtUtc: string;
  decidedAtUtc: string | null;
  image: string;
  regionCount: number;
  usable: boolean;
}

export interface SceneCatalog {
  activeSceneId: string | null;
  scenes: SceneCatalogEntry[];
}

export const SCENES_PATH = '/api/wall/v1/scenes';

/**
 * Fetches the catalog, or answers an EMPTY one.
 *
 * Total on purpose: this screen is reached by an adult standing at a wall, and an exception
 * here would take out the grown-up destination — which is also where the approval queue lives.
 * A catalog that cannot be read is a screen that says there are no pictures, which is wrong but
 * inert, rather than a blank destination behind a door a child has already opened.
 */
export async function fetchSceneCatalog(
  options: { baseUrl?: string; deviceToken?: string; fetchImpl?: FetchLike } = {},
): Promise<SceneCatalog> {
  const empty: SceneCatalog = { activeSceneId: null, scenes: [] };
  const doFetch: FetchLike = options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const headers: Record<string, string> = {};
  if (options.deviceToken !== undefined && options.deviceToken.length > 0) {
    headers['Authorization'] = `Device ${options.deviceToken}`;
  }
  try {
    const res = await doFetch(`${options.baseUrl ?? ''}${SCENES_PATH}`, { headers });
    if (!res.ok) return empty;
    const body: unknown = await res.json();
    if (typeof body !== 'object' || body === null) return empty;
    const o = body as { activeSceneId?: unknown; scenes?: unknown };
    return {
      activeSceneId: typeof o.activeSceneId === 'string' ? o.activeSceneId : null,
      scenes: Array.isArray(o.scenes) ? (o.scenes as SceneCatalogEntry[]) : [],
    };
  } catch {
    return empty;
  }
}

/**
 * The catalog in the order a reviewer wants it, which is not the order it arrives in.
 *
 * Candidates first, because they are the only rows that represent WORK: something was
 * generated on Sunday and is waiting to be looked at, and if a reviewer sees nothing else on
 * this screen it must be those. Then everything else newest-first.
 *
 * The active picture is NOT hoisted to the top. It is marked instead, and it stays where its
 * date puts it, because moving it would make the one row that must be unambiguous change
 * position depending on state.
 */
export function reviewOrder(catalog: SceneCatalog): SceneCatalogEntry[] {
  const rank = (s: SceneCatalogEntry): number =>
    s.state === 'candidate' ? 0 : s.state === 'approved' ? 1 : 2;
  return [...catalog.scenes].sort(
    (a, b) =>
      rank(a) - rank(b) ||
      (a.createdAtUtc < b.createdAtUtc ? 1 : a.createdAtUtc > b.createdAtUtc ? -1 : 0) ||
      (a.id < b.id ? -1 : 1),
  );
}

// ---------------------------------------------------------------------------
// 2. The queue
// ---------------------------------------------------------------------------

export type ApprovalKind = 'chore' | 'redemption';
export type ApprovalDecision = 'approve' | 'reject';

/**
 * One thing waiting on an adult, with everything a row needs already resolved.
 *
 * The row does no lookups of its own: a renderer that has to go and find the child is a
 * renderer that can be handed an id with no child behind it, and the answer to that on this
 * wall is a blank card.
 */
export interface ApprovalItem {
  /** Stable across the two kinds, so React keys cannot collide on a shared integer. */
  readonly key: string;
  readonly kind: ApprovalKind;
  /** The assignment id for a chore, the request id for a redemption. */
  readonly id: number;
  readonly childId: string;
  readonly childName: string;
  readonly avatar: AssetRef;
  /** The child's fixed household slot, which is also this list's first sort key. */
  readonly sortOrder: number;
  /** What they did.  A chore's own label, or the word for cashing out. */
  readonly labelFull: string;
  /** The chore's picture.  Null for a redemption, which is drawn as a gift instead. */
  readonly icon: AssetRef | null;
  /** What it pays.  Zero for the pre-reader, whose chores run the machine and pay nothing. */
  readonly points: number;
  /** Real money, for a redemption.  Null when there is none to name. */
  readonly cashCents: number | null;
  /**
   * When it was asked for: the claim for a chore, the request for a cash-out. Null when the
   * server did not say (an older server, or a row that is somehow not claimed). The row turns
   * it into "18 min ago".
   */
  readonly atUtc: string | null;
}

const CASH_OUT_LABEL = 'Cash out';

/** Money before stars: see the ordering note in `approvalQueue`. */
const KIND_RANK: Record<ApprovalKind, number> = { redemption: 0, chore: 1 };

/**
 * Everything waiting on an adult, ACROSS ALL CHILDREN, as one list.
 *
 * ChoreOps ships two adult theories — a shared approval hub and a per-user approval
 * workspace — and the hub is the right one for a wall (H7 §4.3).  An adult standing here
 * for ninety seconds after dinner wants one list, not three screens to page through.
 *
 * **The order is by child, then money, then id, and every part of that is deliberate.**
 * Oldest-first is the obvious triage order and is still not the one used, even now that a
 * claim carries its time (`claimedAtUtc`, 2026-10-11): a parent clears this list a child at a
 * time ("right, Child A, all three"), so the household's own fixed left-to-right order — the
 * one the rail and every other surface use — keeps a child's items together. The age is on the
 * row instead (`atUtc`), which is where the breakfast claim needs to be seen. Within a child,
 * redemptions lead: a request has been waiting since it was made, possibly days, and it holds
 * that child's one open slot until it is decided, where a chore claim is same-day.
 *
 * A row whose child is not on the roster is dropped rather than shown.  An approval that
 * cannot be attributed to anybody is one that would move points to nobody, and the row is
 * already unreachable — the child it belonged to is gone.
 */
export function approvalQueue(
  snapshot: Pick<WallSnapshot, 'children' | 'chores' | 'redemptions'>,
): ApprovalItem[] {
  const roster = new Map<string, Child>();
  for (const child of snapshot.children ?? []) roster.set(child.id, child);

  const items: ApprovalItem[] = [];

  for (const chore of snapshot.chores ?? []) {
    if (chore.state !== 'claimed') continue;
    const child = roster.get(chore.childId);
    if (child === undefined) continue;
    items.push({
      key: `chore:${String(chore.assignmentId)}`,
      kind: 'chore',
      id: chore.assignmentId,
      childId: child.id,
      childName: child.displayName,
      avatar: avatarRef(child),
      sortOrder: child.sortOrder,
      labelFull: chore.labelFull,
      icon: chore.icon,
      // The pre-reader has ledgerEnabled = false; her chores run the full state machine and
      // write no ledger row, so the row must not offer an adult a number to approve.
      points: child.ledgerEnabled ? chore.points : 0,
      cashCents: null,
      // `?? null`: an older server sends no field, and that row simply carries no age.
      atUtc: chore.claimedAtUtc ?? null,
    });
  }

  // `WallSnapshot.redemptions` is contracted to carry pending requests only.  Filtered
  // anyway: a decided request rendered as waiting is an adult approving something twice.
  for (const request of snapshot.redemptions ?? []) {
    if (request.state !== 'pending') continue;
    const child = roster.get(request.childId);
    if (child === undefined) continue;
    items.push({
      key: `redemption:${String(request.id)}`,
      kind: 'redemption',
      id: request.id,
      childId: child.id,
      childName: child.displayName,
      avatar: avatarRef(child),
      sortOrder: child.sortOrder,
      labelFull: CASH_OUT_LABEL,
      icon: null,
      points: request.pointsRequested,
      cashCents: request.cashCents,
      atUtc: request.requestedAtUtc ?? null,
    });
  }

  return items.sort(
    (a, b) =>
      a.sortOrder - b.sortOrder ||
      KIND_RANK[a.kind] - KIND_RANK[b.kind] ||
      a.id - b.id ||
      a.key.localeCompare(b.key),
  );
}

type AdminCall = (actions: AdminActions, id: number, parentPin: string) => Promise<void>;

/**
 * A LOOKUP, not a chain of ifs.  The four admin routes are a two-by-two, and writing them
 * as a record makes a missing pairing a compile error rather than a button that silently
 * does nothing.  Every entry threads the PIN through; there is no arm of this table that
 * could reach the server without one.
 */
const CALLS: Record<ApprovalKind, Record<ApprovalDecision, AdminCall>> = {
  redemption: {
    approve: (actions, id, parentPin) => actions.approveRedemption(id, parentPin),
    reject: (actions, id, parentPin) => actions.rejectRedemption(id, parentPin),
  },
  chore: {
    approve: (actions, id, parentPin) => actions.approveChore(id, parentPin),
    reject: (actions, id, parentPin) => actions.rejectChore(id, parentPin),
  },
};

export function performApproval(
  actions: AdminActions,
  item: Pick<ApprovalItem, 'kind' | 'id'>,
  decision: ApprovalDecision,
  parentPin: string,
): Promise<void> {
  return CALLS[item.kind][decision](actions, item.id, parentPin);
}

// ---------------------------------------------------------------------------
// Refusals — by code, in words a child may read over a shoulder
// ---------------------------------------------------------------------------

export type RefusalCode = ContractErrorCode | 'unknown';

/**
 * What a refusal says out loud.
 *
 * Children and guests touch this screen, so none of these may read as an accusation or an
 * alarm.  `bad_pin` in particular gets the sentence docs/api.md's own error table
 * prescribes — "ask a grown-up" — which is calm, true, and the thing a child who has just
 * watched a wrong PIN should actually do.
 *
 * The empty string means SAY NOTHING.  `wrong_child` is contracted as a silent no-op that
 * renders nothing, because to a child "that is not your card" is not a failure and the
 * button is not broken.
 */
export const REFUSAL_WORDS: Record<RefusalCode, string> = {
  bad_pin: 'Ask a grown-up.',
  device_revoked: 'This screen needs setting up again.',
  not_claimable: 'That one has already been sorted.',
  already_claimed: 'That one has already been sorted.',
  insufficient_points: 'Not enough points for that just now.',
  pending_redemption_exists: 'That one has already been sorted.',
  stale_client: 'The wall is fetching a newer version.',
  date_mismatch: 'One moment — the wall is catching up.',
  wrong_child: '',
  unknown: 'Not now. Try again in a moment.',
};

/**
 * The server's own words for a `bad_request`, or null for every other failure.
 *
 * The one exception to "handle by code, never by prose": a `bad_request` from the authoring
 * route is a list of reasons written FOR the parent at the wall ("no asset \"ico-x\"", "a chore
 * needs at least one child"), and the sheet shows it verbatim. Nothing branches on the text.
 */
export function refusalMessageOf(err: unknown): string | null {
  if (!(err instanceof Error) || (err as Partial<AdminActionError>).code !== 'bad_request') return null;
  return err.message.length > 0 ? err.message : null;
}

/** Only `bad_pin` is worth another go at the pad; everything else needs a different fix. */
export function refusalIsRetryable(code: RefusalCode): boolean {
  return code === 'bad_pin';
}

/**
 * The code a refusal carries, mapped onto something with words.
 *
 * Anything outside the frozen table — a proxy's HTML, a dead socket, one of the three
 * operational codes — lands on `unknown` and gets the calm generic sentence.  Nothing here
 * reads the server's prose: a message is for a human, a code is for a program, and matching
 * on the first is how a reworded sentence silently changes behaviour.
 */
export function refusalCodeOf(err: unknown): RefusalCode {
  const raw =
    typeof err === 'object' && err !== null && 'code' in err
      ? String((err as { code: unknown }).code)
      : '';
  return Object.hasOwn(REFUSAL_WORDS, raw) ? (raw as RefusalCode) : 'unknown';
}

// ---------------------------------------------------------------------------
// 3. The geometry
// ---------------------------------------------------------------------------

/**
 * The content pane, on every screen: 960x540 less the padding, the header and one gutter.
 *
 * Written as arithmetic over Unit G's tokens rather than as the number 420, so a screen
 * cannot quietly disagree with the grid H7 §4.4 wrote down.  Move a token and this moves.
 */
export const APPROVAL_PANE_HEIGHT_PX =
  layoutPx.wallHeight - layoutPx.wallPad * 2 - layoutPx.wallHeaderHeight - layoutPx.wallGutter;

// ---------------------------------------------------------------------------
// 3b. The picture library's geometry
// ---------------------------------------------------------------------------
//
// Here rather than in ScenesView.tsx, and that is mechanical rather than tidy: the test runner
// is `node --experimental-strip-types`, which strips `.ts` and NOT `.tsx`, so a number that
// lives in a component cannot be asserted on at all. This screen's gutter shipped at 8px —
// half the mandatory inert gutter — and was caught by measuring the real panel, which is the
// expensive way to find a number that arithmetic could have checked for free.

/** The pane a destination gets: the wall, less its padding, header and one gutter. */
export const DESTINATION_PANE_HEIGHT_PX = APPROVAL_PANE_HEIGHT_PX;

/** The same, across: the wall, less its padding, the rail and one gutter. */
export const DESTINATION_PANE_WIDTH_PX =
  layoutPx.wallWidth - layoutPx.wallPad * 2 - layoutPx.railWidth - layoutPx.wallGutter;

/**
 * The space between two catalog rows, and now between the two COLUMNS as well.
 *
 * A RULE, not a spacing preference, which is why it is named. Two catalog rows closer than the
 * inert gutter are one mis-tap between putting up the wrong picture and retiring the right one —
 * and both are decisions an adult would then have to undo in front of whoever is waiting.
 */
export const SCENE_LIST_GAP_PX = spacePx.tapGap;

/**
 * THE CATALOG SCROLLS, since 2026-09-13, and is ONE column again.
 *
 * It was one column of four rows, then two columns of four when the fifth picture was simply
 * not drawn (*"I don't see the scenes in the pictures or image switcher"*), and the two columns
 * cost the preview 160px of its width — a 296px picture, on the screen whose whole purpose is
 * judging pictures. The next step up that ladder was three columns and a postage stamp.
 *
 * The wall-cannot-scroll rule is about the IDLE wall and a child's board: nobody scrolls a thing
 * they are reading from the kitchen. This is a management list an adult stands at, and the
 * household asked for it in those words: *"I want to be able to scroll through pictures. they
 * should be organized."* So: one 328px column, every picture in it, grouped by what a reviewer
 * is looking for (New, On the wall, Ready, Retired), and the preview back at 456px.
 */
export const SCENE_LIST_WIDTH_PX = 328;

/** One catalog row.  It is a tap target, so it is the tap floor and not a chosen height. */
export const SCENE_ROW_HEIGHT_PX = 64;

/** A group's heading in the list: a word and a count, not a control, so under the tap floor. */
export const SCENE_GROUP_HEADING_PX = 32;

/** The preview, at the picture's own 16:9 — a letterboxed preview judges the wrong thing. */
export const SCENE_PREVIEW_WIDTH_PX =
  DESTINATION_PANE_WIDTH_PX - SCENE_LIST_WIDTH_PX - layoutPx.wallGutter;
export const SCENE_PREVIEW_HEIGHT_PX = Math.round((SCENE_PREVIEW_WIDTH_PX * 9) / 16);

/**
 * How many catalog rows are in view before the list has to be scrolled.
 *
 * Not a limit any more — nothing is cut — but still a real number: it is how many pictures a
 * reviewer sees at a glance, and the scroll cue at the bottom edge only means something if at
 * least this many fit. Computed with the SAME gap that separates the rows.
 */
export function sceneRowsThatFit(paneHeightPx: number = DESTINATION_PANE_HEIGHT_PX): number {
  const available = paneHeightPx - layoutPx.agendaRowHeight - layoutPx.wallGutter;
  if (available < SCENE_ROW_HEIGHT_PX) return 0;
  return Math.max(
    1,
    Math.floor((available + SCENE_LIST_GAP_PX) / (SCENE_ROW_HEIGHT_PX + SCENE_LIST_GAP_PX)),
  );
}

// ---------------------------------------------------------------------------
// 1b. The catalog, organised
// ---------------------------------------------------------------------------

export type SceneGroupKey = 'new' | 'onWall' | 'ready' | 'retired';

export interface SceneGroup {
  readonly key: SceneGroupKey;
  readonly scenes: readonly SceneCatalogEntry[];
}

/** The order a reviewer reads the list in: work first, then what is up, then the shelf. */
export const SCENE_GROUP_ORDER: readonly SceneGroupKey[] = ['new', 'onWall', 'ready', 'retired'];

/**
 * The catalog cut into the groups a reviewer scans for, each newest first, empty groups
 * omitted. `reviewOrder` flattened is the same sequence; this is the shape that lets the list
 * draw a heading between them instead of a state word on every row.
 */
export function catalogGroups(catalog: SceneCatalog): SceneGroup[] {
  const ordered = reviewOrder(catalog);
  const keyOf = (s: SceneCatalogEntry): SceneGroupKey =>
    s.id === catalog.activeSceneId
      ? 'onWall'
      : s.state === 'candidate'
        ? 'new'
        : s.state === 'approved'
          ? 'ready'
          : 'retired';
  const buckets = new Map<SceneGroupKey, SceneCatalogEntry[]>();
  for (const scene of ordered) {
    const key = keyOf(scene);
    const bucket = buckets.get(key);
    if (bucket === undefined) buckets.set(key, [scene]);
    else bucket.push(scene);
  }
  return SCENE_GROUP_ORDER.flatMap((key) => {
    const scenes = buckets.get(key);
    return scenes === undefined ? [] : [{ key, scenes }];
  });
}

/**
 * What the Pictures screen's two keys may do for the picture in front of them.
 *
 * Putting up asks only that the picture is not already up and that its tap regions parse — a
 * picture with none would go up and leave three children nothing to find. Retiring asks that it
 * is not retired already AND that it is NOT THE ONE ON THE WALL. That second half is new
 * (2026-10-11) and it is not caution: retiring is a plain UPDATE and the wall shows the newest
 * approved picture, so retiring the live one silently put up whichever was approved before it —
 * a picture nobody chose this week, from a key labelled as a removal. Choose the next picture
 * first; then the old one can go.
 */
export function sceneDecisions(
  scene: Pick<SceneCatalogEntry, 'id' | 'state' | 'usable'> | null,
  activeSceneId: string | null,
): { readonly putUp: boolean; readonly retire: boolean } {
  if (scene === null) return { putUp: false, retire: false };
  const onWall = scene.id === activeSceneId;
  return { putUp: !onWall && scene.usable, retire: !onWall && scene.state !== 'retired' };
}

/**
 * A picture's name, for a person.
 *
 * Generated scenes are named by the pipeline as `{year}w{week}-{setting}-{model}` — which is a
 * perfect file name and, cut to "2026w38-lante…" in a 220px column, tells a reviewer nothing.
 * The setting is the title ("Lantern night market"); the week and the model are the detail,
 * because two candidates a week differ ONLY by model and the approver has to be able to say
 * which one she chose. Baseline art has no week: its detail says so.
 */
export function sceneLabel(scene: Pick<SceneCatalogEntry, 'id' | 'source'>): {
  title: string;
  detail: string;
} {
  const m = /^(\d{4})w(\d{2})-(.+?)(?:-(gpt|nb2))?$/.exec(scene.id);
  if (m === null || scene.source === 'baseline') {
    return { title: words(scene.id), detail: scene.source === 'baseline' ? HOUSE_ART_WORD : '' };
  }
  const [, , week, setting, model] = m;
  const parts = [`Week ${String(Number(week))}`];
  if (model !== undefined) parts.push(MODEL_WORD[model] ?? model.toUpperCase());
  return { title: words(setting ?? scene.id), detail: parts.join(' · ') };
}

const HOUSE_ART_WORD = 'House picture';
const MODEL_WORD: Record<string, string> = { gpt: 'GPT', nb2: 'Banana' };

function words(slug: string): string {
  const spaced = slug.replace(/[-_]+/g, ' ').trim();
  return spaced.length === 0 ? slug : spaced[0]!.toUpperCase() + spaced.slice(1);
}

// ---------------------------------------------------------------------------
// 3c. What a grown-up key moves a number by, and how tall a portal row is
// ---------------------------------------------------------------------------

/**
 * The step a tap moves each number by.
 *
 * A point is a whole point — the unit children count in, and a half is not a thing on this
 * wall. The rate moves by 5c because 25c is the household's number and 1c steps would mean
 * twenty-five taps to halve it; a nickel is also the smallest coin anybody thinks in.
 */
export const CHORE_POINTS_STEP = 1;
export const CENTS_PER_POINT_STEP = 5;

/**
 * What a balance is worth, in words, and it is DERIVED rather than stored.
 *
 * The panel shows what the rate means with a worked example — ten points at the current rate —
 * because "25" on its own is a number an adult has to do arithmetic on to feel. `cashText`
 * already renders cents as money everywhere else on this wall; this is what to hand it.
 */
export const RATE_EXAMPLE_POINTS = 10;

/**
 * One approval row.
 *
 * It is the chore card's row, ONE SIZE UP, and the extra size is not a preference: a chore
 * card IS a tap target, where this row CONTAINS two of them.  The band's floor therefore
 * has to fit inside the row rather than being the row, so the padding and the border are
 * added to it instead of eaten out of it.  Fluent: 64 + 8 + 6 = 78.
 */
export function approvalRowHeightPx(minTapPx: number): number {
  return minTapPx + spacePx.xxs * 2 + strokePx.medium * 2;
}
