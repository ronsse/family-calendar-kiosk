/**
 * Unit F — the wall surface. Device token, no human login, and it can never approve
 * anything.
 *
 * ## Every mutation carries the ownership predicate
 *
 * The body's `childId` is the SELECTED child; the URL's id names a row that already carries
 * its own `child_id`. The two can disagree, and on this hardware they routinely will: three
 * children's cards sit on one 21.5" panel at child height with adjacent 64px targets, so a
 * tap a centimetre off lands on a sibling's card while the body still says the selected
 * child. Without the predicate the transition applies to the wrong sibling's row, and once a
 * parent approves it that is a permanent append-only ledger fact — a chore paid to a child
 * who did not do it, and a confidently-wrong entry in her history (H1 lens 5).
 *
 * The predicate itself lives on the UPDATE, inside Units C, D and E. Nothing here
 * re-implements it; these handlers only translate the refusal. `wrong_child` is `403` and a
 * SILENT NO-OP — never a fallthrough to `not_claimable`, which reads to a child as "the
 * button is broken" rather than "that is not your card".
 *
 * ## Undo lives here on purpose
 *
 * Step revoke and redemption cancel are on the WALL surface, not admin. A three-year-old
 * mis-tapping a capacitive panel is certain; PIN-gating the undo bricks the routine, or the
 * one pending redemption slot, until an adult intervenes — the fatal flaw H2 Q1 and H1
 * finding #9 each found independently. A mis-tap must be recoverable by the child.
 */

import type { Utc } from '../types.ts';
import { isLedgerError } from '../domain/ledger/index.ts';
import type { ChoreTransitionError } from '../domain/chores/index.ts';
import { claimChore, unclaimChore } from '../domain/chores/index.ts';
import { petEnabled, setDogDeed } from '../domain/dog/index.ts';
import {
  activeScene,
  approveScene,
  listScenes,
  readSceneManifest,
  sceneHistory,
} from '../domain/scenes/library.ts';
import {
  cancelRedemption,
  requestRedemption,
} from '../domain/ledger/index.ts';
import { completeStep, revokeStep } from '../domain/routines/index.ts';
import { isDoorTarget, recordDoorTap } from '../domain/telemetry/doorTaps.ts';
import type { StepRefusalReason } from '../domain/routines/index.ts';
import { HANDLED, NO_CONTENT, type RouteSpec } from './context.ts';
import { ApiError } from './protocol.ts';
import { requireActingChild, requireRowId } from './router.ts';
import { localDate, localTime, nowUtc } from '../time.ts';
import {
  buildSnapshot,
  listPendingRedemptions,
  requireBuildableDate,
} from './snapshot.ts';

/**
 * Child-safe wording. The `message` is a human string that reaches a screen children and
 * guests can read, so refusals are phrased once, here, rather than passing a domain
 * exception's text (which names ids and row states) through to a wall.
 */
type RefusalCode =
  | 'wrong_child'
  | 'already_claimed'
  | 'not_claimable'
  | 'insufficient_points'
  | 'pending_redemption_exists';

const MESSAGE: Record<RefusalCode, string> = {
  wrong_child: 'that is not your card',
  already_claimed: 'someone else got there first',
  not_claimable: 'that card cannot change right now',
  insufficient_points: 'not enough points yet',
  pending_redemption_exists: 'there is already a request waiting',
};

function refuse(code: RefusalCode): ApiError {
  return new ApiError(code, MESSAGE[code]);
}

function fromChore(reason: ChoreTransitionError): ApiError {
  if (reason === 'wrong_child') return refuse('wrong_child');
  if (reason === 'already_claimed') return refuse('already_claimed');
  // `not_found` collapses into `not_claimable`: the frozen table has no separate code, and a
  // stale bundle pointing at yesterday's assignment id should render the same nothing as a
  // card that has already moved on.
  return refuse('not_claimable');
}

function fromStep(reason: StepRefusalReason): ApiError {
  return reason === 'wrong_child' ? refuse('wrong_child') : refuse('not_claimable');
}

/** Any domain refusal from Unit D, mapped through its own frozen `wireCode`. */
function rethrowLedger(err: unknown): never {
  if (isLedgerError(err)) throw refuse(err.wireCode);
  throw err;
}

export const wallRoutes: RouteSpec[] = [
  {
    method: 'GET',
    surface: 'wall',
    pattern: '/api/wall/v1/snapshot',
    handler: (ctx) => {
      const date = requireBuildableDate(ctx.url.searchParams.get('localDate'), ctx.now);
      return buildSnapshot(ctx.db, date, { ...ctx.snapshotOptions, now: ctx.now });
    },
  },

  {
    method: 'GET',
    surface: 'wall',
    pattern: '/api/wall/v1/stream',
    handler: (ctx) => {
      ctx.stream.attach(ctx.res);
      return HANDLED;
    },
  },

  {
    method: 'GET',
    surface: 'wall',
    // The scene catalog: every picture the household has, and which one is up.
    //
    // A wall READ rather than an admin one, on the same principle ApprovalsView already
    // encodes — the PIN gates the action, not the door. An adult opens the grown-up screen and
    // sees the pictures; approving one asks for the PIN, once, for that one request. Behind the
    // PIN this would have cost two entries to change a background, for a list that is picture
    // ids and states and carries nothing about the household at all.
    //
    // Not in `/snapshot`, for the reason `redemptions` is a route as well: the snapshot is
    // TODAY, refetched on every SSE beat and every date boundary, and a catalog that only one
    // screen ever reads does not belong in the payload a kiosk re-parses all day.
    pattern: '/api/wall/v1/scenes',
    handler: (ctx) => {
      const assetRoot = ctx.snapshotOptions.assetRoot;
      // Computed with the same function the snapshot uses, never re-derived: a review screen
      // that disagreed with the wall about which picture is showing would be worse than none.
      const active = assetRoot === undefined ? null : activeScene(ctx.db, assetRoot);
      // How long each picture has been THE picture, and how often it was chosen — the
      // household's favourites, from the decision log rather than from anybody's memory.
      const history = sceneHistory(ctx.db, ctx.now.toISOString() as Utc);
      return {
        activeSceneId: active?.id ?? null,
        scenes: listScenes(ctx.db).map((row) => {
          // `usable` is the honest question a reviewer cannot answer by looking. An approved
          // scene whose manifest is unreadable is silently skipped by `activeScene`, so without
          // this the catalog would show it as live while the wall showed something else.
          const regions = assetRoot === undefined ? null : readSceneManifest(assetRoot, row.id);
          return {
            id: row.id,
            state: row.state,
            source: row.source,
            styleId: row.styleId,
            createdAtUtc: row.createdAtUtc,
            decidedAtUtc: row.decidedAtUtc,
            image: encodeURI(`/${row.relPath.replace(/^\/+/, '')}`),
            regionCount: regions?.length ?? 0,
            usable: regions !== null,
            upMs: history.get(row.id)?.upMs ?? 0,
            timesChosen: history.get(row.id)?.timesChosen ?? 0,
          };
        }),
      };
    },
  },

  {
    method: 'GET',
    surface: 'wall',
    pattern: '/api/wall/v1/redemptions',
    handler: (ctx) => {
      const state = ctx.url.searchParams.get('state');
      if (state !== null && state !== 'pending') {
        // Decided requests are history and belong in the ledger view. Refusing is better
        // than answering an empty list, which would read as "she never asked".
        throw new ApiError('bad_request', 'only pending redemptions are on the wall surface');
      }
      return listPendingRedemptions(ctx.db);
    },
  },

  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/chores/:assignmentId/claim',
    handler: async (ctx, params) => {
      const assignmentId = requireRowId(params['assignmentId']);
      const childId = requireActingChild(await ctx.body());

      // A claim NEVER moves points; it is a request. For a first_complete chore the winner
      // goes `claimed` and the losers go `superseded` in the same transaction — Unit C owns
      // that race, and the losers arrive here as `already_claimed`, which is expected rather
      // than an error condition.
      const result = claimChore(ctx.db, { assignmentId, childId });
      if (!result.ok) throw fromChore(result.reason ?? 'not_claimable');

      if (result.changed) ctx.stream.invalidate('chores');
      return { state: result.state };
    },
  },

  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/chores/:assignmentId/unclaim',
    handler: async (ctx, params) => {
      const assignmentId = requireRowId(params['assignmentId']);
      const childId = requireActingChild(await ctx.body());

      // The child's own undo, past the tap gate's two-second window. Ownership is REQUIRED
      // here exactly as on claim: a tap a centimetre off must not un-submit a sibling's card.
      const result = unclaimChore(ctx.db, { assignmentId, childId });
      if (!result.ok) throw fromChore(result.reason ?? 'not_claimable');

      if (result.changed) ctx.stream.invalidate('chores');
      return { state: result.state };
    },
  },

  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/routines/steps/:runStepId/complete',
    handler: async (ctx, params) => {
      const runStepId = requireRowId(params['runStepId']);
      const childId = requireActingChild(await ctx.body());

      const result = completeStep(ctx.db, { runStepId, childId });
      if (!result.ok) throw fromStep(result.reason);

      if (!result.unchanged) ctx.stream.invalidate('routines');
      // The ORIGINAL timestamp on a repeat tap: a double tap must not rewrite when the
      // child did it.
      return { completedAtUtc: result.completedAtUtc };
    },
  },

  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/routines/steps/:runStepId/revoke',
    handler: async (ctx, params) => {
      const runStepId = requireRowId(params['runStepId']);
      const childId = requireActingChild(await ctx.body());

      const result = revokeStep(ctx.db, { runStepId, childId });
      if (!result.ok) throw fromStep(result.reason);

      if (!result.unchanged) ctx.stream.invalidate('routines');
      return { revokedAtUtc: result.revokedAtUtc };
    },
  },

  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/redemptions',
    handler: async (ctx) => {
      const body = await ctx.body();
      const childId = requireActingChild(body);
      const pointsRequested = body['pointsRequested'];
      if (typeof pointsRequested !== 'number' || !Number.isInteger(pointsRequested) || pointsRequested <= 0) {
        // In-table and fail-safe. Unit D would throw a bare Error here, which would become
        // the 503 catch-all; a wall that asks for half a point should see the same nothing
        // as a card that cannot move.
        throw refuse('not_claimable');
      }

      try {
        // Unit D re-checks the balance here as well as at approval, so an impossible ask
        // never occupies the one-pending slot (H1 finding #9).
        const request = requestRedemption(ctx.db, { childId, pointsRequested });
        ctx.stream.invalidate('ledger');
        return request;
      } catch (err) {
        rethrowLedger(err);
      }
    },
  },

  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/scenes/:id/approve',
    handler: (ctx, params) => {
      /*
       * CHOOSING THE PICTURE IS NOT AN ADULT ACTION, and as of 2026-09-16 it no longer asks
       * for the PIN.
       *
       * It was behind it, and the household's answer was to give the children the PIN — which
       * bought them the approval queue, the points ledger and the worth of every chore as
       * well. A door that makes people hand out the master key is a worse guardrail than no
       * door, so this one is gone and the key can go back to being the adults'.
       *
       * What makes that safe is that there is nothing here to guard. Approving is also
       * SELECTING — re-approving an already-approved scene rewrites `decided_at_utc` and is
       * how "put that one back up" works — so the whole of this route is "show that picture
       * instead of this one", every outcome is another picture on the wall, and every one of
       * them is undone by tapping a different picture. Nothing is deleted, nothing is paid,
       * nothing leaves the house.
       *
       * RETIRE STAYED BEHIND THE PIN (routes.admin.ts). It is the one control here that
       * REMOVES rather than chooses, and "the children can put any picture up" is a different
       * sentence from "the children can take a picture out of the library".
       *
       * Deliberately not guarded on the current state: a no-op for an already-approved scene
       * would break the only mechanism for choosing.
       */
      if (!approveScene(ctx.db, params['id'] ?? '', ctx.now.toISOString() as Utc)) {
        throw new ApiError('not_found', 'no such scene');
      }
      // 'all' rather than a new scope: the wall re-reads the whole snapshot, and adding a
      // `scene` scope would be a change to the frozen WallEvent union to save one field on a
      // refetch that happens a handful of times a year.
      ctx.stream.invalidate('all');
      return NO_CONTENT;
    },
  },

  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/redemptions/:id/cancel',
    handler: async (ctx, params) => {
      const id = requireRowId(params['id']);
      const childId = requireActingChild(await ctx.body());
      try {
        const result = cancelRedemption(ctx.db, id, childId);
        ctx.stream.invalidate('ledger');
        return result;
      } catch (err) {
        rethrowLedger(err);
      }
    },
  },
  /**
   * Count one door opening.  Telemetry, and the only route here that changes nothing a child
   * can see.
   *
   * **Why it is on the wall surface.** It is not a mutation in any sense the guardrails care
   * about: it cannot delete, cannot pay, cannot approve, and the CHECK on `target` means it
   * cannot write anything but a counter on one of two named doors. PIN-gating it would mean
   * asking an adult for a PIN to record that an adult opened the calendar, which would both
   * destroy the measurement and annoy the person being measured.
   *
   * **The date and time are stamped HERE, not sent.** The wall's own clock is the thing this
   * whole codebase refuses to trust — a Pi coming up after a power cut may not have synced
   * yet, and those are precisely the days you would most want to read correctly. The server's
   * clock is the one that is NTP-disciplined, so the server stamps. It also means the client
   * cannot write an arbitrary date, which keeps a fragment-driven kiosk from being able to
   * scribble on evidence.
   *
   * Never 500s on a bad body. This is a diagnostic on the render path of a wall that must not
   * go dark, and no telemetry is worth an error card.
   */
  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/telemetry/door',
    handler: async (ctx) => {
      const body = await ctx.body();
      const target = body['target'];
      if (!isDoorTarget(target)) throw new ApiError('bad_request', 'unknown door');
      // Anything that is not literally `true` is `false`: a missing field must not be graded
      // as "the picture was up", because that is the half of the split being argued for.
      const scene = body['scene'] === true;
      recordDoorTap(ctx.db, {
        target,
        scene,
        localDate: localDate(ctx.now),
        localTime: localTime(ctx.now),
      });
      // No `stream.invalidate`: nothing renders this, and waking every SSE client to tell it
      // a counter moved would make the instrument more expensive than the thing it measures.
      return NO_CONTENT;
    },
  },
  /**
   * Tick, or untick, one of the dog's deeds this week.  The Easter egg (2026-09-15).
   *
   * **No `childId`, no PIN.** Nothing here can pay, approve or delete: a deed is a row whose
   * presence means "done", the list it belongs to is drawn from code by the week, and the
   * undo is the same tap.  It is the one write on this wall a guest may make without the
   * guardrails caring, which is precisely why it may sit behind a tap on the dog with no
   * door in front of it.
   *
   * The body names the WEEK the sheet was drawn for, and a week that is not today's is
   * refused: a sheet left open over Sunday midnight would otherwise write a tick nobody can
   * see.  Same shape as the wall's other stale-view refusals — the client refetches and the
   * sheet redraws with Monday's list.
   */
  {
    method: 'POST',
    surface: 'wall',
    pattern: '/api/wall/v1/dog/deeds/:deedId',
    handler: async (ctx, params) => {
      // A household with no pet has no deeds to tick. Refused before the body is read, in the
      // same child-safe words as a card that cannot change (2026-10-12).
      if (!petEnabled(ctx.db)) throw refuse('not_claimable');
      const deedId = params['deedId'] ?? '';
      // A deed id is a slug from the pool, not a row number; anything else is refused before
      // the domain sees it, with the same child-safe wording as any card that cannot change.
      if (!/^[a-z0-9-]{1,40}$/.test(deedId)) throw refuse('not_claimable');
      const body = await ctx.body();
      const week = body['week'];
      if (typeof week !== 'string') throw new ApiError('bad_request', 'week is required');
      const done = body['done'] === true;
      const result = setDogDeed(ctx.db, { week, deedId, done }, localDate(ctx.now), nowUtc(ctx.now));
      if (!result.ok) throw refuse('not_claimable');
      if (result.changed) ctx.stream.invalidate('dog');
      return { ok: true, changed: result.changed };
    },
  },
];
