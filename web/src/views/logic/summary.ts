/**
 * Unit H — the derivations the domain layer shares.
 *
 * Pure functions over the snapshot, so the same number reaches all three bands and
 * the tests can check it without a browser.  `resolve` threads the tap gate's
 * optimistic values through without this module knowing React exists: pass
 * `gate.value` and progress moves the instant a child taps, pass nothing and you
 * get the server's view.
 */

import type {
  AssetRef,
  Balance,
  CalendarEventView,
  Child,
  ChoreAssignmentView,
  LocalDate,
  RedemptionRequest,
  WallSnapshot,
} from '../../../../src/types.ts';
import { localDate } from '../../../../src/time.ts';
import { isStepDone, type Progress } from './progress.ts';
import { choreKey, stepKey } from './tap.ts';

export type Resolve = (key: string, serverValue: boolean) => boolean;

const SERVER_ONLY: Resolve = (_key, serverValue) => serverValue;

function progressOf(done: number, total: number): Progress {
  return {
    total,
    done,
    remaining: Math.max(0, total - done),
    fraction: total === 0 ? 0 : done / total,
    allDone: total > 0 && done === total,
  };
}

/**
 * Everything one child owes the day: routine steps plus live chores.
 *
 * A CLAIMED chore counts as done here.  The child has finished her part and is
 * waiting on an adult; a progress mark that refuses to move until a parent walks
 * past teaches her that tapping does nothing.  The chore card still shows the
 * hourglass, so "waiting" stays visible where it belongs.
 */
export function childDayProgress(
  snapshot: Pick<WallSnapshot, 'routines' | 'chores'>,
  childId: string,
  resolve: Resolve = SERVER_ONLY,
): Progress {
  let total = 0;
  let done = 0;
  for (const run of snapshot.routines ?? []) {
    if (run.childId !== childId) continue;
    for (const step of run.steps ?? []) {
      total += 1;
      if (resolve(stepKey(step.runStepId), isStepDone(step))) done += 1;
    }
  }
  for (const chore of snapshot.chores ?? []) {
    if (chore.childId !== childId) continue;
    if (chore.state === 'superseded') continue;
    total += 1;
    const claimedOnServer = chore.state !== 'pending';
    if (resolve(choreKey(chore.assignmentId), claimedOnServer)) done += 1;
  }
  return progressOf(done, total);
}

export function choresForChild(
  chores: readonly ChoreAssignmentView[],
  childId: string,
): ChoreAssignmentView[] {
  return (chores ?? []).filter((c) => c.childId === childId);
}

/** One open request per child, by contract; `.find()` is still not trusted. */
export function pendingRedemptionFor(
  redemptions: readonly RedemptionRequest[] | undefined,
  childId: string,
): RedemptionRequest | null {
  return (redemptions ?? []).find((r) => r.childId === childId && r.state === 'pending') ?? null;
}

export interface UpcomingOptions {
  /** Household events (childId === null) are always included. */
  childId?: string | null;
  nowMs: number;
  limit: number;
}

/**
 * The local date an event lands on, for RANKING.  `null` only when a timed event's
 * instant will not parse.
 *
 * An all-day event already under way ranks as TODAY rather than as the day it began.
 * "Mountains, Aug 26-31" on the 28th is not a past event and not a future one; it is
 * what is happening, and burying it under Saturday's gymnastics because it started
 * two days ago is the same class of mistake as dropping it.
 */
function rankDate(event: CalendarEventView, todayLocal: LocalDate): LocalDate | null {
  if (event.when.kind === 'allDay') {
    return event.when.startDate < todayLocal ? todayLocal : event.when.startDate;
  }
  const ms = Date.parse(event.when.startsAtUtc);
  return Number.isNaN(ms) ? null : localDate(new Date(ms));
}

/**
 * What is coming next, soonest first, capped at `limit`.
 *
 * A wall holds five or six blocks, not twenty — the DinkyDash lesson Unit G took as
 * well.  Which five is therefore the whole job, and this function got it wrong in a
 * way nothing could see until a real calendar was connected (2026-08-25):
 *
 *   - It ranked EVERY all-day event above EVERY timed one.  With nine all-day events
 *     in a 60-day window and a limit of four, the wall showed a birthday two months
 *     out and never showed this afternoon's gymnastics at all.
 *   - It never expired all-day events, because the "already finished" filter only
 *     examined timed ones.  Yesterday's all-day event stayed on the wall for the life
 *     of the sync window, at the top.
 *   - All-day events tied at `a.id - b.id`, which is per-source insertion order.  With
 *     three calendars staged into three separate generations, that is not date order:
 *     the birthdays calendar synced first, so its event held first place outright.
 *
 * The rule now is the obvious one — SOONEST FIRST.  Rank by local date; within a day,
 * the all-day event frames the day so it leads; then by clock time.  "All-day first"
 * was a real intuition applied at the wrong scope: it belongs within a date, not
 * across the whole window.
 *
 * An event whose instant will not parse is KEPT and sorted to the back, because
 * dropping data we failed to parse is how a wall silently loses the orthodontist.
 */
export function upcomingEvents(
  events: readonly CalendarEventView[] | undefined,
  opts: UpcomingOptions,
): CalendarEventView[] {
  const childId = opts.childId ?? null;
  const todayLocal = localDate(new Date(opts.nowMs));
  const mine = (events ?? []).filter((e) => e.childId === null || childId === null || e.childId === childId);
  const live = mine.filter((e) => {
    if (e.when.kind === 'allDay') {
      // `endDate` is EXCLUSIVE, so an event ending 2026-08-26 is over ON the 26th.
      // The sync window reaches a day BACK, so without this yesterday never leaves.
      return e.when.endDate > todayLocal;
    }
    const ends = Date.parse(e.when.endsAtUtc);
    return Number.isNaN(ends) ? true : ends >= opts.nowMs;
  });
  const sorted = [...live].sort((a, b) => {
    const ad = rankDate(a, todayLocal);
    const bd = rankDate(b, todayLocal);
    if (ad !== bd) {
      if (ad === null) return 1;
      if (bd === null) return -1;
      return ad < bd ? -1 : 1;
    }
    const aAll = a.when.kind === 'allDay';
    const bAll = b.when.kind === 'allDay';
    if (aAll !== bAll) return aAll ? -1 : 1;
    if (a.when.kind === 'timed' && b.when.kind === 'timed') {
      const at = Date.parse(a.when.startsAtUtc);
      const bt = Date.parse(b.when.startsAtUtc);
      if (!Number.isNaN(at) && !Number.isNaN(bt) && at !== bt) return at - bt;
    }
    return a.id - b.id;
  });
  return sorted.slice(0, Math.max(0, opts.limit));
}

/** Children in their fixed left-to-right order.  Never sorted by id or by name. */
export function orderedChildren(children: readonly Child[] | undefined): Child[] {
  return [...(children ?? [])].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id));
}

export function childById(children: readonly Child[] | undefined, childId: string | null): Child | null {
  if (childId === null) return null;
  return (children ?? []).find((c) => c.id === childId) ?? null;
}

/** Balances are contracted one-per-active-child; this still never returns undefined. */
export function balancesByChild(balances: readonly Balance[] | undefined): Map<string, Balance> {
  const map = new Map<string, Balance>();
  for (const b of balances ?? []) map.set(b.childId, b);
  return map;
}

/**
 * The ONE place the client turns an asset id into a URL.
 *
 * Every other image on the wall arrives as a resolved `AssetRef` — the server
 * walks the fallback chain at snapshot time so the render path can never miss
 * (types.ts, H2 gap #1).  `Child.avatarAssetId` is the exception: the frozen
 * contract carries the id and not a ref, and docs/api.md documents no asset route,
 * so the root below is this unit's assumption and is deliberately in exactly one
 * place to change.  `db/schema.sql` calls `asset.rel_path` "relative to the served
 * asset root", which is the root meant here.
 *
 * If it is wrong the avatars fall back to a shape rather than to nothing, and the
 * child is still identifiable by accent, frame shape and fixed column — which is
 * why Unit G insists identity never rides on one channel.
 */
export const ASSET_ROOT = '/assets/';

export function avatarRef(child: Pick<Child, 'avatarAssetId'>): AssetRef {
  const id = child.avatarAssetId ?? '';
  return {
    assetId: id,
    url: id.length === 0 ? '' : `${ASSET_ROOT}${encodeURIComponent(id)}`,
    isFallback: false,
  };
}
