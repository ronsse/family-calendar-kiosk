/**
 * Unit H — the action port.
 *
 * The wall's five writes, as an interface the view layer depends on instead of on
 * `fetch`.  Two reasons, both about 6:00 AM rather than about testing:
 *
 * - the ambient view and any preview surface get `NULL_WALL_ACTIONS`, so a tap that
 *   should do nothing does nothing rather than reaching a server;
 * - the transport is replaceable without touching a renderer, and the HTTP unit
 *   owns `src/http/**` — this file only speaks the documented wall contract
 *   (docs/api.md §Routes, device-token surface, which can never approve anything).
 *
 * Everything here rejects on failure and the tap gate reverts the optimistic value.
 * No error text is ever rendered to a child: a failed write shows the last good
 * state plus, at most, a staleness marker.  `wrong_child` and `already_claimed` are
 * expected outcomes, not incidents (docs/api.md §Errors).
 */

import type { ChoreState } from '../../../src/types.ts';
import type { DoorTarget } from '../../../src/domain/telemetry/doorTaps.ts';
import { fetchSceneCatalog, type SceneCatalog } from './adminActions.ts';

export interface WallActions {
  claimChore(assignmentId: number, childId: string): Promise<void>;
  /** The child's own undo of a claim: `claimed -> pending`, never anything decided. */
  unclaimChore(assignmentId: number, childId: string): Promise<void>;
  completeStep(runStepId: number, childId: string): Promise<void>;
  revokeStep(runStepId: number, childId: string): Promise<void>;
  requestRedemption(childId: string, pointsRequested: number): Promise<void>;
  cancelRedemption(requestId: number, childId: string): Promise<void>;
  /**
   * Count one door opening.
   *
   * **Returns `void`, not a `Promise`, and that is the point.** Every other action here
   * rejects so the tap gate can revert an optimistic value; this one has nothing to revert
   * and nothing to say. A signature that cannot be awaited cannot accidentally delay opening
   * the calendar, and cannot grow an error path that puts a diagnostic in front of a child.
   * If it fails, the measurement is one tap short — which is the correct price.
   */
  recordDoorTap(target: DoorTarget, scene: boolean): void;
  /**
   * The picture library, for the grown-up screen.
   *
   * The only READ on this port, and it is here rather than on `AdminActions` for the reason
   * the route is on the wall surface at all: the PIN gates the ACTION, not the door. A child
   * may open the picture screen and look; changing which picture is up needs the PIN and lives
   * on the admin port. It is here rather than a bare fetch in the component because that is
   * where the device token is — a component that called `fetch` itself would send no
   * `Authorization` header and silently get an empty catalog, which is exactly what it did on
   * the first run against the panel.
   *
   * Never rejects: an empty catalog is the failure value. This screen shares a door with the
   * approval queue, and a throw here would take out the grown-up destination behind a door a
   * child has already opened.
   */
  fetchScenes(): Promise<SceneCatalog>;
  /**
   * Tick or untick one of the dog's deeds this week.  The Easter egg.  No child, no PIN — the
   * server refuses a stale `week` and the snapshot redraws the sheet, so a rejection here is a
   * refetch, never a message.
   */
  setDogDeed(week: string, deedId: string, done: boolean): Promise<void>;
  /**
   * Put a picture up.  No PIN, since 2026-09-16: approving IS selecting, every outcome is
   * another picture on the wall, and each one is undone by choosing a different one.  The
   * door used to ask for the PIN and the household's answer was to give the children the
   * PIN — which handed them the approval queue and the ledger too.  RETIRING a picture is
   * still an adult action and still lives on `AdminActions`.
   */
  approveScene(sceneId: string): Promise<void>;
}

/** Does nothing, successfully.  For the ambient view and for tests. */
export const NULL_WALL_ACTIONS: WallActions = {
  claimChore: async () => {},
  unclaimChore: async () => {},
  approveScene: async () => {},
  completeStep: async () => {},
  revokeStep: async () => {},
  requestRedemption: async () => {},
  cancelRedemption: async () => {},
  recordDoorTap: () => {},
  fetchScenes: async () => ({ activeSceneId: null, scenes: [] }),
  setDogDeed: async () => {},
};

export interface WallActionError extends Error {
  code: string;
  status: number;
}

function actionError(code: string, status: number): WallActionError {
  const err = new Error(`wall action failed: ${code}`) as WallActionError;
  err.code = code;
  err.status = status;
  return err;
}

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export interface WallActionsOptions {
  /** Same-origin by default: the kiosk loads the bundle from the same server. */
  baseUrl?: string | undefined;
  /** `Authorization: Device <token>`, provisioned once onto the Pi. */
  deviceToken?: string | undefined;
  fetchImpl?: FetchLike | undefined;
  /**
   * Count door taps? Default true. False for a PROBE session — an agent driving the panel to
   * verify a change, whose navigation clicks are indistinguishable from a child's at the DOM
   * and must not reach the §5.1 instrument.
   */
  countTaps?: boolean | undefined;
}

export const WALL_API_PREFIX = '/api/wall/v1';

export function wallActionPaths(prefix: string = WALL_API_PREFIX) {
  return {
    claimChore: (assignmentId: number) => `${prefix}/chores/${String(assignmentId)}/claim`,
    unclaimChore: (assignmentId: number) => `${prefix}/chores/${String(assignmentId)}/unclaim`,
    completeStep: (runStepId: number) => `${prefix}/routines/steps/${String(runStepId)}/complete`,
    revokeStep: (runStepId: number) => `${prefix}/routines/steps/${String(runStepId)}/revoke`,
    requestRedemption: () => `${prefix}/redemptions`,
    cancelRedemption: (requestId: number) => `${prefix}/redemptions/${String(requestId)}/cancel`,
    recordDoorTap: () => `${prefix}/telemetry/door`,
    scenes: () => `${prefix}/scenes`,
    setDogDeed: (deedId: string) => `${prefix}/dog/deeds/${encodeURIComponent(deedId)}`,
    approveScene: (sceneId: string) => `${prefix}/scenes/${encodeURIComponent(sceneId)}/approve`,
  };
}

export function createWallActions(options: WallActionsOptions = {}): WallActions {
  const base = options.baseUrl ?? '';
  const paths = wallActionPaths();
  const doFetch: FetchLike =
    options.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));

  async function post(path: string, body: Record<string, unknown>): Promise<void> {
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (options.deviceToken !== undefined && options.deviceToken.length > 0) {
      headers['authorization'] = `Device ${options.deviceToken}`;
    }
    const res = await doFetch(`${base}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      let code = 'unknown';
      try {
        const parsed: unknown = await res.json();
        if (parsed !== null && typeof parsed === 'object' && 'error' in parsed) {
          code = String((parsed as { error: unknown }).error);
        }
      } catch {
        // A non-JSON body from a proxy or a dead server is still just "it failed".
      }
      throw actionError(code, res.status);
    }
  }

  return {
    claimChore: (assignmentId, childId) => post(paths.claimChore(assignmentId), { childId }),
    unclaimChore: (assignmentId, childId) => post(paths.unclaimChore(assignmentId), { childId }),
    completeStep: (runStepId, childId) => post(paths.completeStep(runStepId), { childId }),
    revokeStep: (runStepId, childId) => post(paths.revokeStep(runStepId), { childId }),
    requestRedemption: (childId, pointsRequested) =>
      post(paths.requestRedemption(), { childId, pointsRequested }),
    cancelRedemption: (requestId, childId) => post(paths.cancelRedemption(requestId), { childId }),
    approveScene: (sceneId) => post(paths.approveScene(sceneId), {}),
    recordDoorTap: (target, scene) => {
      // A probe session is an agent driving the panel to verify a change. Its taps are not
      // household behaviour and must not reach the instrument that backlog item 5.1 (private notes) is waiting
      // on — see `isProbeSession`, and the two rows that prompted this.
      if (options.countTaps === false) return;
      // Swallowed deliberately, at the only place that could observe it. An unhandled
      // rejection from a counter would surface in the console of a wall that runs for months,
      // and on a bad day in an error boundary — for a number nobody is watching in real time.
      void post(paths.recordDoorTap(), { target, scene }).catch(() => {});
    },
    setDogDeed: (week, deedId, done) => post(paths.setDogDeed(deedId), { week, done }),
    fetchScenes: () =>
      fetchSceneCatalog({
        baseUrl: options.baseUrl ?? '',
        deviceToken: options.deviceToken ?? '',
        ...(options.fetchImpl === undefined ? {} : { fetchImpl: options.fetchImpl }),
      }),
  };
}

/**
 * Chore states a child can still act on.  Everything else is a grown-up's turn.
 *
 * `claimed` is interactive: the tap that put the card in "Waiting" can take it back out.
 * Until 2026-09-13 this returned true for `pending` alone, which made the DOCUMENTED undo —
 * "a second tap inside the window cancels it" — dead code: the card turned to "Waiting"
 * under the finger, `interactive` went false in the same render, and the second tap landed
 * on a plain div. No throw, no log; the gate simply never heard it. The project's signature
 * bug, in the one control whose whole purpose is being tappable twice. The board itself now
 * derives interactivity from `shownChoreTap` so the drawn state and the tap direction come
 * from one place; this predicate states the same rule for anything else that asks.
 */
export function isChoreInteractive(state: ChoreState): boolean {
  return state === 'pending' || state === 'claimed';
}
