/**
 * Unit F — the admin surface. Device token PLUS a PIN on every request, never a session.
 *
 * Everything that MOVES POINTS lives here, and nothing on the wall surface can reach it.
 * Approval is the moment a claim becomes a permanent, append-only ledger fact, so the
 * question this surface answers is not "is this the wall?" but "is an adult standing here
 * right now?" — which a session cookie stops answering the moment the adult walks away from
 * a panel three children can reach.
 *
 * **Approval is idempotent by construction, and that lives in Units C and D**, not here: in
 * one transaction, `UPDATE ... WHERE id=? AND state='claimed' RETURNING id`, and the ledger
 * row is written only if a row came back. A double tap or a browser retry therefore returns
 * `200` with the already-decided state and NOT a second entry (H3 finding #2). These
 * handlers must not add a guard of their own; a second guard is a second thing to get out
 * of step with the first.
 *
 * Neither reject route accepts a `{ note }`. api.md was amended on 2026-08-24 to remove the
 * promise rather than add the column: a rejected chore is a parent and a child standing at
 * the wall having a conversation, and the state change is the fact.
 */

import type { Database as Db } from 'better-sqlite3';
import type { Utc } from '../types.ts';
import {
  approveChore,
  createChore,
  editChore,
  moveChoreMember,
  readChoreCatalog,
  rejectChore,
  restoreChore,
  retireChore,
  setChoreMember,
  setChoreModel,
  type ChoreEditFailure,
} from '../domain/chores/index.ts';
import type { AssignmentModel } from '../types.ts';
import {
  adjust,
  approveRedemption,
  isLedgerError,
  ledgerHistory,
  rejectRedemption,
} from '../domain/ledger/index.ts';
import { assignStep, moveStep, readRoutineCatalog } from '../domain/routines/index.ts';
import { retireScene } from '../domain/scenes/library.ts';
import {
  MAX_CENTS_PER_POINT,
  MAX_CHORE_POINTS,
  MIN_CENTS_PER_POINT,
  MIN_CHORE_POINTS,
  readSettings,
  setCentsPerPoint,
  setChorePoints,
} from '../domain/settings/index.ts';
import {
  MAX_LEAD_MINUTES,
  MIN_LEAD_MINUTES,
  updateDepartureRules,
} from '../domain/departures/index.ts';
import { setWallTheme } from '../domain/theme/index.ts';
import { WALL_THEMES } from '../types.ts';
import { issueDeviceToken, revokeDevice, setParentPin } from './auth.ts';
import { NO_CONTENT, type RouteSpec } from './context.ts';
import { ApiError } from './protocol.ts';
import { requireRowId } from './router.ts';

function ledgerFailure(err: unknown): never {
  if (isLedgerError(err)) throw new ApiError(err.wireCode, err.message);
  throw err;
}

/**
 * The domain's refusal, as a status: a bad id is 404, the rest 400. `roster_empty` is a
 * `bad_request` rather than a code of its own because the frozen error table is the WALL
 * client's, and the screen that sends this request already knows the rule — it draws the last
 * child's toggle inert — so the server's refusal is a backstop, not a message.
 */
function choreEditFailure(reason: ChoreEditFailure): never {
  if (reason === 'roster_empty') throw new ApiError('bad_request', 'a chore needs at least one child');
  if (reason === 'bad_model') throw new ApiError('bad_request', 'no such assignment model');
  throw new ApiError('not_found', `no such ${reason.slice(8)}`);
}

function requireString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== 'string' || value.length === 0) {
    throw new ApiError('bad_request', `${key} is required`);
  }
  return value;
}

function requireChildRow(db: Db, childId: string): void {
  const row = db.prepare(`SELECT 1 AS present FROM child WHERE id = ?`).get(childId);
  if (!row) throw new ApiError('not_found', 'no such child');
}

export const adminRoutes: RouteSpec[] = [
  {
    method: 'POST',
    surface: 'admin',
    /**
     * Force a calendar sweep now.
     *
     * POST, because it mutates — and on the ADMIN surface, which is what gates it. That gets
     * the guardrail for free and correctly: the admin surface already demands a device token
     * AND the parent PIN on EVERY request, never a session, precisely because children and
     * guests touch this screen. No new mechanism, and nothing here can be reached from the
     * wall's own surface.
     *
     * It cannot make the wall worse. The sweep writes into a fresh generation and promotes it
     * atomically; a failure leaves the promoted generation exactly where it was, so the wall
     * keeps rendering the schedule it already had. There is no path here that empties a table.
     */
    pattern: '/api/admin/v1/calendar/refresh',
    handler: (ctx) => {
      const outcome = ctx.calendarRefresh?.refresh() ?? null;
      if (outcome === null || outcome.disposition === 'not-configured') {
        // `unavailable` (503). `ApiErrorCode` is frozen and none of its members mean "this
        // deployment has no calendar upstream", which is an operational fact rather than a
        // contract violation — so it takes the operational code instead of the protocol
        // growing a member for one route. `reason` carries the scheduler's own words, so an
        // adult reads why rather than guessing from a status number.
        throw new ApiError(
          'unavailable',
          outcome?.reason ?? 'no calendar sync is running, so there is nothing to refresh',
        );
      }
      return outcome;
    },
  },
  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores/:assignmentId/approve',
    handler: (ctx, params) => {
      const assignmentId = requireRowId(params['assignmentId']);
      // No `childId`: api.md's admin route carries no body, so the credit is pinned to the
      // row's OWN child_id inside Unit C via the UPDATE's RETURNING clause. A
      // caller-supplied id can never redirect the points.
      const result = approveChore(ctx.db, { assignmentId });
      if (!result.ok) {
        throw new ApiError(
          result.reason === 'wrong_child' ? 'wrong_child' : 'not_claimable',
          'that chore cannot be approved',
        );
      }
      if (result.changed) ctx.stream.invalidate('ledger');
      // `ledgerEntryId` is null when the child has ledgerEnabled = false, or the chore is
      // worth zero: the state machine still ran, and the wall renders the stamp from
      // `chore_assignment.state`, never from ledger data.
      return { state: result.state, ledgerEntryId: result.ledgerEntryId };
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores/:assignmentId/reject',
    handler: (ctx, params) => {
      const assignmentId = requireRowId(params['assignmentId']);
      // Rejection returns the chore to `pending` so the child can redo it. There is no
      // `rejected` state: it had no producer and left the card un-redoable for the rest of
      // the day (H1 finding #8).
      const result = rejectChore(ctx.db, { assignmentId });
      if (!result.ok) {
        throw new ApiError('not_claimable', 'that chore cannot be sent back');
      }
      if (result.changed) ctx.stream.invalidate('chores');
      return { state: result.state };
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/redemptions/:id/approve',
    handler: (ctx, params) => {
      const id = requireRowId(params['id']);
      try {
        // Unit D re-reads the balance INSIDE the approving transaction, so two concurrent
        // approvals cannot overdraw. There is no `paid` transition, by decision (H2 Q2).
        const result = approveRedemption(ctx.db, id);
        ctx.stream.invalidate('ledger');
        return result;
      } catch (err) {
        ledgerFailure(err);
      }
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/redemptions/:id/reject',
    handler: (ctx, params) => {
      const id = requireRowId(params['id']);
      try {
        const result = rejectRedemption(ctx.db, id);
        ctx.stream.invalidate('ledger');
        return result;
      } catch (err) {
        ledgerFailure(err);
      }
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/ledger/adjust',
    handler: async (ctx) => {
      const body = await ctx.body();
      const childId = body['childId'];
      const delta = body['delta'];
      const requestId = body['requestId'];
      const note = body['note'];

      if (typeof childId !== 'string' || childId.length === 0) {
        throw new ApiError('bad_request', 'childId is required');
      }
      if (typeof delta !== 'number' || !Number.isInteger(delta) || delta === 0) {
        throw new ApiError('bad_request', 'delta must be a non-zero integer');
      }
      // MANDATORY, and it is the idempotency key. A manual adjustment has no natural key,
      // and both obvious substitutes are wrong: a constant makes the SECOND bonus a
      // constraint violation that silently drops points, while a fresh id per call lets a
      // double tap pay twice (H1 finding #10). One uuid per user action, stored verbatim.
      if (typeof requestId !== 'string' || requestId.length === 0) {
        throw new ApiError('bad_request', 'requestId is required and is the idempotency key');
      }
      requireChildRow(ctx.db, childId);

      try {
        const entry = adjust(ctx.db, {
          childId,
          delta,
          note: typeof note === 'string' && note.length > 0 ? note : null,
          requestId,
        });
        ctx.stream.invalidate('ledger');
        return entry;
      } catch (err) {
        ledgerFailure(err);
      }
    },
  },

  {
    method: 'GET',
    surface: 'admin',
    pattern: '/api/admin/v1/children/:id/ledger',
    handler: (ctx, params) => {
      const childId = params['id'] ?? '';
      requireChildRow(ctx.db, childId);
      // This is what settles "I had forty!" — by scrolling the entries, never by trusting a
      // cached number. Oldest first, because that is what makes `runningTotal` mean
      // anything.
      const entries = ledgerHistory(ctx.db, childId);
      const last = entries.at(-1);
      return { childId, entries, total: last?.runningTotal ?? 0 };
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/devices',
    handler: async (ctx) => {
      const body = await ctx.body();
      const label = body['label'];
      if (typeof label !== 'string' || label.trim().length === 0) {
        throw new ApiError('bad_request', 'label is required');
      }
      // The plaintext exists exactly once, in this response. Only the hash is stored, so a
      // lost token is re-issued rather than recovered.
      return issueDeviceToken(ctx.db, label);
    },
  },

  {
    method: 'DELETE',
    surface: 'admin',
    pattern: '/api/admin/v1/devices/:id',
    handler: (ctx, params) => {
      // Idempotent: revoking an already-revoked or unknown device is still 204. The
      // post-condition an adult asked for — "that panel is not trusted" — holds either way,
      // and a 404 here would invite a retry loop against the one route that removes trust.
      revokeDevice(ctx.db, params['id'] ?? '');
      return NO_CONTENT;
    },
  },
  // -------------------------------------------------------------------------
  // Scenes — the picture behind the wall
  // -------------------------------------------------------------------------
  //
  // CHANGING the picture is here, on the admin surface, by the operator's decision
  // (2026-09-08) and consistent with the rule that guardrails are architectural: the wall holds
  // no admin session and children and guests touch this screen, so there is no shape of the
  // wall API that can change which picture is up.
  //
  // READING the catalog is NOT here — it is `GET /api/wall/v1/scenes`. The PIN gates the
  // action, not the door, exactly as ApprovalsView already has it: a child may open the
  // grown-up screen and look at the pictures, and there is nothing on it she can change.
  // Putting the list behind the PIN would have meant entering it once to see the pictures and
  // again to choose one, for a list that is picture ids and nothing else.

  /**
   * WHAT A POINT IS WORTH, AND WHAT EACH CHORE PAYS — 2026-09-10.
   *
   * On the admin surface and therefore behind the PIN, which is not about secrecy: the numbers
   * are printed on the children's own screens. It is that these two values are the exchange
   * rate of the whole economy, and a child who can raise her own chore from 2 points to 99 has
   * been handed the ledger. Guardrails are architectural (CLAUDE.md), so this is a route a
   * child's screen has no way to call rather than a control it politely does not draw.
   *
   * A GET on the admin surface costs a PIN entry to READ. That is the right trade here and it
   * is the opposite of the one the scene catalog makes, where the list is on the wall surface
   * so that choosing a picture does not cost two entries for a list of ids. The difference is
   * that this screen exists to CHANGE things: nobody opens it to look.
   */
  {
    method: 'GET',
    surface: 'admin',
    pattern: '/api/admin/v1/settings',
    handler: (ctx) => readSettings(ctx.db),
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/settings/cents-per-point',
    handler: async (ctx) => {
      const body = await ctx.body();
      const cents = body['centsPerPoint'];
      if (typeof cents !== 'number') {
        throw new ApiError('bad_request', 'centsPerPoint must be a number');
      }
      if (setCentsPerPoint(ctx.db, cents) !== null) {
        throw new ApiError(
          'bad_request',
          `centsPerPoint must be a whole number between ${String(MIN_CENTS_PER_POINT)} and ${String(MAX_CENTS_PER_POINT)}`,
        );
      }
      // EVERY child's displayed balance just changed, because a balance is points times today's
      // rate. A pending redemption did NOT change — it carries the rate it was asked at — which
      // is the property this route must not break and does not: see domain/settings.
      ctx.stream.invalidate('ledger');
      return readSettings(ctx.db);
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/settings/chores/:choreId',
    handler: async (ctx, params) => {
      const body = await ctx.body();
      const points = body['basePoints'];
      if (typeof points !== 'number') {
        throw new ApiError('bad_request', 'basePoints must be a number');
      }
      const failure = setChorePoints(ctx.db, params['choreId'] ?? '', points);
      if (failure === 'not_found') throw new ApiError('not_found', 'no such chore');
      if (failure !== null) {
        throw new ApiError(
          'bad_request',
          `basePoints must be a whole number between ${String(MIN_CHORE_POINTS)} and ${String(MAX_CHORE_POINTS)}`,
        );
      }
      // DELIBERATELY NO INVALIDATION. `chore_day.points_each` was snapshotted at
      // materialization, so nothing a child can see changed today, and pushing a refresh would
      // tell every screen on the wall that something had — which is a lie that costs a redraw.
      // The change lands on the next day materialized; the screen says so.
      return readSettings(ctx.db);
    },
  },

  /**
   * The leave-by rules. Every present field is checked before anything is written, and the
   * domain refuses the whole patch on one bad field, so the wall never lands half a change.
   * The rules ride in the snapshot, so the calendar surface is invalidated: the banner is a
   * function of the rules and today's events, and it must redraw on every screen at once.
   */
  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/settings/departures',
    handler: async (ctx) => {
      const body = await ctx.body();
      const patch: Record<string, unknown> = {};
      for (const key of ['enabled', 'readyMinutes', 'travelMinutes', 'schoolLeaveAt'] as const) {
        if (body[key] !== undefined) patch[key] = body[key];
      }
      const result = updateDepartureRules(ctx.db, patch);
      if (!result.ok) {
        throw new ApiError(
          'bad_request',
          result.reason === 'out_of_range'
            ? `minutes must be a whole number between ${String(MIN_LEAD_MINUTES)} and ${String(MAX_LEAD_MINUTES)}`
            : 'enabled must be a boolean, minutes whole numbers, schoolLeaveAt HH:MM',
        );
      }
      ctx.stream.invalidate('calendar');
      return readSettings(ctx.db);
    },
  },

  /**
   * Which look the wall wears (2026-10-11). One of three ids; anything else is refused with
   * nothing written. The look rides in the snapshot and changes EVERY screen, so the scope is
   * `all` — and only when it actually changed, because tapping the look already up is not news.
   */
  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/settings/theme',
    handler: async (ctx) => {
      const body = await ctx.body();
      const result = setWallTheme(ctx.db, body['theme']);
      if (!result.ok) {
        throw new ApiError('bad_request', `theme must be one of ${WALL_THEMES.join(', ')}`);
      }
      if (result.changed) ctx.stream.invalidate('all');
      return readSettings(ctx.db);
    },
  },

  /**
   * Change the grown-ups' PIN (2026-10-11). The `x-parent-pin` header is the CURRENT PIN, typed
   * just now on the change screen — never the one the visit has been holding — so this route is
   * authorised exactly like every other: the guard verifies the header before the handler runs,
   * and a wrong one is the ordinary `bad_pin`. There is no session to rotate; the next request
   * simply has to carry the new PIN.
   *
   * Digits only, because the wall's only keyboard is a digit pad: a PIN with a letter in it
   * could be stored here and then never typed again, which locks the household out of its own
   * grown-up screens. 4 to 12, the floor being `setParentPin`'s. Answers with the settings, like
   * every other settings write; nothing in them describes the PIN.
   */
  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/settings/pin',
    handler: async (ctx) => {
      const body = await ctx.body();
      const newPin = body['newPin'];
      if (typeof newPin !== 'string' || !/^[0-9]{4,12}$/.test(newPin)) {
        throw new ApiError('bad_request', 'newPin must be 4 to 12 digits');
      }
      await setParentPin(ctx.db, newPin);
      return readSettings(ctx.db);
    },
  },

  // Approving — which is also SELECTING — moved to the wall surface on 2026-09-16.
  // See routes.wall.ts. Retiring stayed here.

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/scenes/:id/retire',
    handler: (ctx, params) => {
      if (!retireScene(ctx.db, params['id'] ?? '', ctx.now.toISOString() as Utc)) {
        throw new ApiError('not_found', 'no such scene');
      }
      ctx.stream.invalidate('all');
      return NO_CONTENT;
    },
  },

  // -------------------------------------------------------------------------
  // Routines — who does which steps
  // -------------------------------------------------------------------------
  //
  // Asked for 2026-09-13: *"The youngest doesn't have brushing his teeth as part of his bedtime
  // routine."* The definition lives in `routine_step_assignment`; the domain module rewrites
  // one child's sequence and then reconciles TODAY's run so the change is on the child's
  // screen now rather than tomorrow (see domain/routines/assign.ts for why routines differ
  // from chore points here). Behind the PIN like every other definition on this wall — a child
  // who can take her own steps away has been handed the routine.
  //
  // Every write answers with the whole catalog, the same shape as the GET: the screen renders
  // what the server said rather than what it hoped, exactly as the settings panel does.

  {
    method: 'GET',
    surface: 'admin',
    pattern: '/api/admin/v1/routines',
    handler: (ctx) => readRoutineCatalog(ctx.db),
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/routines/:routineId/steps/:stepId/assign',
    handler: async (ctx, params) => {
      const body = await ctx.body();
      const childId = requireString(body, 'childId');
      const assigned = body['assigned'];
      if (typeof assigned !== 'boolean') {
        throw new ApiError('bad_request', 'assigned must be true or false');
      }
      const result = assignStep(ctx.db, {
        routineId: params['routineId'] ?? '',
        stepId: params['stepId'] ?? '',
        childId,
        assigned,
      });
      if (!result.ok) throw new ApiError('not_found', `no such ${result.reason.slice(8)}`);
      // The wall's run changed only if today's run existed and moved; the snapshot re-reads
      // routines either way, which is cheap and keeps this honest against a run that was
      // materialized between the check and the write.
      if (result.changed) ctx.stream.invalidate('routines');
      return readRoutineCatalog(ctx.db);
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/routines/:routineId/steps/:stepId/move',
    handler: async (ctx, params) => {
      const body = await ctx.body();
      const childId = requireString(body, 'childId');
      const direction = body['direction'];
      if (direction !== 'up' && direction !== 'down') {
        throw new ApiError('bad_request', 'direction must be up or down');
      }
      const result = moveStep(ctx.db, {
        routineId: params['routineId'] ?? '',
        stepId: params['stepId'] ?? '',
        childId,
        direction,
      });
      if (!result.ok) throw new ApiError('not_found', `no such ${result.reason.slice(8)}`);
      if (result.changed) ctx.stream.invalidate('routines');
      return readRoutineCatalog(ctx.db);
    },
  },

  // -------------------------------------------------------------------------
  // Chores — who is asked, and how
  // -------------------------------------------------------------------------
  //
  // The routines block's sibling, over the two things a chore has that a step does not: a
  // ROSTER (which children) and a MODEL (each on their own, take turns, first one to do it).
  // `domain/chores/assign.ts` owns the rules — a roster is never emptied from the wall, a
  // rotation's turn today is never moved, a model change starts tomorrow — and, as with
  // routines, every write answers with the whole catalog.
  //

  {
    method: 'GET',
    surface: 'admin',
    pattern: '/api/admin/v1/chores',
    handler: (ctx) => readChoreCatalog(ctx.db),
  },

  // A chore made on the wall goes through the SAME rules as `--chores FILE`: `createChore`
  // is the parser, the referential checks and the writer from `domain/chores/authoring.ts`,
  // so the sheet cannot make a chore the file could not. Every reason it is refused comes
  // back in one 400, joined, because the sheet is behind a PIN on a wall and a parent should
  // not have to fix one thing at a time to find the next.
  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores',
    handler: async (ctx) => {
      const result = createChore(ctx.db, await ctx.body());
      if (!result.ok) throw new ApiError('bad_request', result.errors.join('; '));
      ctx.stream.invalidate('chores');
      return readChoreCatalog(ctx.db);
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores/:choreId/roster',
    handler: async (ctx, params) => {
      const body = await ctx.body();
      const childId = requireString(body, 'childId');
      const member = body['member'];
      if (typeof member !== 'boolean') {
        throw new ApiError('bad_request', 'member must be true or false');
      }
      const result = setChoreMember(ctx.db, { choreId: params['choreId'] ?? '', childId, member });
      if (!result.ok) choreEditFailure(result.reason);
      if (result.changed) ctx.stream.invalidate('chores');
      return readChoreCatalog(ctx.db);
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores/:choreId/roster/move',
    handler: async (ctx, params) => {
      const body = await ctx.body();
      const childId = requireString(body, 'childId');
      const direction = body['direction'];
      if (direction !== 'up' && direction !== 'down') {
        throw new ApiError('bad_request', 'direction must be up or down');
      }
      const result = moveChoreMember(ctx.db, { choreId: params['choreId'] ?? '', childId, direction });
      if (!result.ok) choreEditFailure(result.reason);
      if (result.changed) ctx.stream.invalidate('chores');
      return readChoreCatalog(ctx.db);
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores/:choreId/model',
    handler: async (ctx, params) => {
      const body = await ctx.body();
      const assignmentModel = requireString(body, 'assignmentModel') as AssignmentModel;
      const result = setChoreModel(ctx.db, { choreId: params['choreId'] ?? '', assignmentModel });
      if (!result.ok) choreEditFailure(result.reason);
      if (result.changed) ctx.stream.invalidate('chores');
      return readChoreCatalog(ctx.db);
    },
  },

  // A chore's NAME, PICTURE and DAYS, through the same parser and checks as creating one. The
  // body is folded over the chore as it stands, so a key not sent is a field not touched. Worth,
  // model and roster are NOT accepted here — each has its own route above, with its own rule
  // about when it reaches the board, and a second door to the same field is a second rule.
  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores/:choreId/edit',
    handler: async (ctx, params) => {
      const result = editChore(ctx.db, params['choreId'] ?? '', await ctx.body());
      if (!result.ok) {
        if (result.missing) throw new ApiError('not_found', 'no such chore');
        throw new ApiError('bad_request', result.errors.join('; '));
      }
      if (result.changed) ctx.stream.invalidate('chores');
      return readChoreCatalog(ctx.db);
    },
  },

  // Retire is SOFT — `active = 0`, never a DELETE — and refused with `not_claimable` while a
  // claim on the chore is still waiting, because retiring takes it off today's board too and the
  // claim would vanish unapproved. The wall words that refusal itself; the message carries the
  // count for anyone reading the wire.
  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores/:choreId/retire',
    handler: (ctx, params) => {
      const result = retireChore(ctx.db, params['choreId'] ?? '');
      if (!result.ok) {
        if (result.reason === 'unknown_chore') throw new ApiError('not_found', 'no such chore');
        throw new ApiError('not_claimable', `${String(result.waiting)} claim(s) on this chore are still waiting`);
      }
      if (result.changed) ctx.stream.invalidate('chores');
      return readChoreCatalog(ctx.db);
    },
  },

  {
    method: 'POST',
    surface: 'admin',
    pattern: '/api/admin/v1/chores/:choreId/restore',
    handler: (ctx, params) => {
      const result = restoreChore(ctx.db, params['choreId'] ?? '');
      if (!result.ok) throw new ApiError('not_found', 'no such chore');
      if (result.changed) ctx.stream.invalidate('chores');
      return readChoreCatalog(ctx.db);
    },
  },

];
