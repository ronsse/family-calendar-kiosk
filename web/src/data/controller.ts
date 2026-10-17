/**
 * Unit I — the data layer. The thing that keeps the wall right when nobody is looking at it.
 *
 * ## One clock, one timer, deadlines for everything else
 *
 * There is a single repeating tick, and every scheduled thing — the poll, the retry, the
 * stream reconnect — is a DEADLINE compared against `now()` on that tick, never its own
 * `setTimeout`. That is not tidiness. A pile of pending timers is exactly what a Pi with no
 * RTC breaks: NTP steps the clock by hours after boot, a background tab gets its timers
 * throttled, a suspended one gets them coalesced, and a schedule expressed as "fire in 900
 * seconds" quietly becomes "fire whenever". A schedule expressed as "it is due at T" is
 * self-correcting — the next tick that happens, whenever it happens, notices.
 *
 * ## Nothing here is allowed to leave the wall without a refresh path
 *
 * The stream is the fast path and it is the one that fails. So the poll is unconditional:
 * `pollIntervalMs` returns a finite number for every input, including "the stream has been
 * dead for a week". A healthy stream makes the poll cheap, not unnecessary — a socket can be
 * open, silent and useless (a proxy holding bytes, a half-open connection TCP has not noticed
 * yet), and in that state the wall looks alive while being a day behind.
 *
 * ## The four outcomes, and the one that is never available
 *
 * `snapshot.ts` decides between accept / refetch / reload / degrade. What is NOT in that list
 * is "render the error". No 5xx, no stack, no login form and no empty screen ever reaches a
 * child: every failure keeps the last good snapshot on screen with a staleness mark, which
 * Unit H already renders from `freshness`. Stale-but-labelled satisfies the prime invariant.
 *
 * The single exception, and it is deliberate: `location.reload()` when the running bundle is
 * older than `minClientBuild`. That is the one failure a stale bundle cannot render its way
 * out of, because the next thing it would do is parse a shape it does not understand. It is
 * guarded by a cooldown so it can never become a reload loop — see `protocol.ts`.
 */

import type { LocalDate, WallSnapshot } from '../../../src/types.ts';
import {
  FETCH_RETRY_BASE_MS,
  MISMATCH_MAX_RETRIES,
  fetchRetryMs,
  mismatchRetryMs,
  pollIntervalMs,
  sseDelayMs,
} from './backoff.ts';
import { wallHeaders, type KeyValueStore } from './device.ts';
import { initialDateWatch, observeDate, wallLocalDate, type DateWatch } from './localDate.ts';
import {
  CLIENT_BUILD,
  CLIENT_BUILD_HEADER,
  MIN_CLIENT_BUILD_HEADER,
  RELOAD_STAMP_KEY,
  SNAPSHOT_PATH,
  STREAM_PATH,
  minBuildFromHeader,
  shouldHardReload,
} from './protocol.ts';
import { createSseDecoder, parseWallEvent } from './sse.ts';
import { classifyResponse, type DegradeReason } from './snapshot.ts';

/** How often the tick runs. Well under a minute, so a date boundary is noticed promptly. */
export const DEFAULT_TICK_MS = 15_000;

export type RefreshReason =
  | 'boot'
  | 'stream-open'
  | 'invalidate'
  | 'date-boundary'
  | 'poll'
  | 'retry';

export interface WallDataState {
  /** The last snapshot good enough to render. Null only before the first one arrives. */
  readonly snapshot: WallSnapshot | null;
  /** Non-null while the newest attempt failed. The snapshot above stays on screen regardless. */
  readonly degraded: DegradeReason | null;
  readonly streamConnected: boolean;
  readonly lastGoodAtMs: number | null;
}

export type WallDataLog =
  | { kind: 'refresh'; reason: RefreshReason; localDate: LocalDate }
  | { kind: 'accepted'; localDate: LocalDate }
  | { kind: 'date-mismatch'; requested: LocalDate; attempt: number }
  | { kind: 'degraded'; reason: DegradeReason }
  | { kind: 'stream'; event: 'open' | 'closed' | 'failed'; failures: number }
  | { kind: 'reload'; minClientBuild: number }
  | { kind: 'reload-suppressed'; minClientBuild: number };

type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
type TimerHandle = unknown;

export interface WallDataDeps {
  fetchImpl?: FetchLike | undefined;
  now?: (() => number) | undefined;
  /** One-shot. The controller re-arms it after every tick, so ticks can never overlap. */
  setTimer?: ((fn: () => void, ms: number) => TimerHandle) | undefined;
  clearTimer?: ((handle: TimerHandle) => void) | undefined;
  /** The ONLY caller of `location.reload()`. Guarded by `shouldHardReload`. */
  hardReload?: (() => void) | undefined;
  /** Where the reload stamp lives so it survives the reload. */
  store?: KeyValueStore | null | undefined;
  deviceToken?: string | null | undefined;
  /** Same-origin by default: the kiosk loads this bundle from the wall server itself. */
  baseUrl?: string | undefined;
  random?: (() => number) | undefined;
  tickMs?: number | undefined;
  onState?: ((state: WallDataState) => void) | undefined;
  onLog?: ((event: WallDataLog) => void) | undefined;
}

export interface WallDataController {
  getState(): WallDataState;
  start(): void;
  stop(): void;
  /** Coalesced: a call while a fetch is in flight queues exactly one follow-up. */
  refresh(reason: RefreshReason): Promise<void>;
  /**
   * The SHELL's view of the local date, reported from its own clock.
   *
   * Idempotent by date, which is the point: it refetches when the day CHANGES and does
   * nothing at all when it has not, however often it is called. See the note on the
   * implementation for the 2404-requests-in-eight-seconds this exists to make impossible.
   */
  reportShellDate(date: LocalDate): void;
  /** One step of the clock. `start()` arms this on a timer; tests drive it directly. */
  tick(): Promise<void>;
  /** Present so a test can join the stream loop; not part of the rendering path. */
  streamSettled(): Promise<void>;
}

const INITIAL_STATE: WallDataState = {
  snapshot: null,
  degraded: null,
  streamConnected: false,
  lastGoodAtMs: null,
};

export function createWallDataController(deps: WallDataDeps = {}): WallDataController {
  const doFetch: FetchLike = deps.fetchImpl ?? ((input, init) => globalThis.fetch(input, init));
  const now = deps.now ?? (() => Date.now());
  const setTimer = deps.setTimer ?? ((fn, ms) => setTimeout(fn, ms));
  const clearTimer = deps.clearTimer ?? ((h) => { clearTimeout(h as ReturnType<typeof setTimeout>); });
  const random = deps.random ?? Math.random;
  const tickMs = deps.tickMs ?? DEFAULT_TICK_MS;
  const base = deps.baseUrl ?? '';
  const store = deps.store ?? null;
  const token = deps.deviceToken ?? null;

  let state: WallDataState = INITIAL_STATE;
  let running = false;
  let dateWatch: DateWatch = initialDateWatch();
  /** Separate from `dateWatch`: the shell has its own clock and its own tick. */
  let shellWatch: DateWatch = initialDateWatch();

  let inFlight = false;
  let queuedReason: RefreshReason | null = null;
  let mismatchAttempts = 0;
  let fetchFailures = 0;
  let sseFailures = 0;
  let streamOpen = false;
  let streamTask: Promise<void> = Promise.resolve();

  let lastAttemptAtMs = 0;
  let retryDueAtMs: number | null = null;
  let reconnectDueAtMs: number | null = null;

  let tickTimer: TimerHandle | null = null;
  let abort: AbortController | null = null;

  function log(event: WallDataLog): void {
    deps.onLog?.(event);
  }

  function setState(patch: Partial<WallDataState>): void {
    const next: WallDataState = { ...state, ...patch };
    if (
      next.snapshot === state.snapshot &&
      next.degraded === state.degraded &&
      next.streamConnected === state.streamConnected &&
      next.lastGoodAtMs === state.lastGoodAtMs
    ) {
      return;
    }
    state = next;
    deps.onState?.(next);
  }

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...wallHeaders(token, CLIENT_BUILD_HEADER, CLIENT_BUILD), ...extra };
  }

  // -------------------------------------------------------------------------
  // The one sanctioned reload
  // -------------------------------------------------------------------------

  function readReloadStamp(): number | null {
    try {
      const raw = store?.getItem(RELOAD_STAMP_KEY) ?? null;
      if (raw === null) return null;
      const n = Number(raw);
      return Number.isFinite(n) ? n : null;
    } catch {
      return null;
    }
  }

  /**
   * Returns true when a reload was triggered, so the caller stops touching a page that is
   * going away. Called with the minimum from EVERY source that carries one — the header on
   * every response, the heartbeat, and the snapshot body — because a bundle too old to parse
   * the snapshot must not have to reach the snapshot to find that out.
   */
  function maybeReload(minClientBuild: number | null): boolean {
    if (minClientBuild === null) return false;
    const decision = shouldHardReload(CLIENT_BUILD, minClientBuild, readReloadStamp(), now());
    if (!decision.reload) {
      if (decision.suppressed !== null) log({ kind: 'reload-suppressed', minClientBuild });
      return false;
    }
    try {
      store?.setItem(RELOAD_STAMP_KEY, String(now()));
    } catch {
      // Without a stamp the cooldown cannot be enforced, so refuse the reload rather than
      // risk a loop: a stale bundle rendering stale-but-labelled beats a flickering wall.
      log({ kind: 'reload-suppressed', minClientBuild });
      return false;
    }
    log({ kind: 'reload', minClientBuild });
    deps.hardReload?.();
    return true;
  }

  // -------------------------------------------------------------------------
  // The snapshot
  // -------------------------------------------------------------------------

  async function fetchSnapshot(reason: RefreshReason): Promise<void> {
    const requested = wallLocalDate(now());
    lastAttemptAtMs = now();
    log({ kind: 'refresh', reason, localDate: requested });

    let status = 0;
    let body: unknown = null;
    let headerMin: number | null = null;

    try {
      const res = await doFetch(`${base}${SNAPSHOT_PATH}?localDate=${requested}`, {
        method: 'GET',
        headers: headers({ accept: 'application/json' }),
      });
      status = res.status;
      headerMin = minBuildFromHeader(res.headers.get(MIN_CLIENT_BUILD_HEADER));
      try {
        body = await res.json();
      } catch {
        // A body that is not JSON is a proxy, a captive portal or a truncated response. It is
        // "unreachable" as far as the wall is concerned, which is a degrade, not a render.
        body = null;
      }
    } catch {
      status = 0;
      body = null;
    }

    if (maybeReload(headerMin)) return;

    const outcome = classifyResponse(requested, status, body);

    if (outcome.kind === 'reload') {
      maybeReload(Number.POSITIVE_INFINITY);
      return;
    }

    if (outcome.kind === 'accept') {
      // The body's own minimum, for the case where a proxy stripped the header.
      const bodyMin = outcome.snapshot.minClientBuild;
      if (typeof bodyMin === 'number' && maybeReload(bodyMin)) return;

      mismatchAttempts = 0;
      fetchFailures = 0;
      retryDueAtMs = null;
      log({ kind: 'accepted', localDate: requested });
      setState({ snapshot: outcome.snapshot, degraded: null, lastGoodAtMs: now() });
      return;
    }

    if (outcome.kind === 'refetch') {
      // The server built a DIFFERENT day. Do not render it — that is the wall being a day
      // behind through 6:00 AM (H1 lens 3). Ask again, and keep whatever was already up.
      mismatchAttempts += 1;
      log({ kind: 'date-mismatch', requested, attempt: mismatchAttempts });
      if (mismatchAttempts <= MISMATCH_MAX_RETRIES) {
        retryDueAtMs = now() + mismatchRetryMs(mismatchAttempts);
        return;
      }
      // Out of retries. Stop hammering, mark it, and let the ordinary poll keep trying —
      // the usual cause is a clock so far out that the server refuses to build the date, and
      // that heals when NTP lands rather than when we ask harder.
      mismatchAttempts = 0;
      retryDueAtMs = now() + fetchRetryMs(1);
      log({ kind: 'degraded', reason: 'date_mismatch' });
      setState({ degraded: 'date_mismatch' });
      return;
    }

    fetchFailures += 1;
    retryDueAtMs = now() + fetchRetryMs(fetchFailures);
    log({ kind: 'degraded', reason: outcome.reason });
    setState({ degraded: outcome.reason });
  }

  /**
   * Coalesced, and the QUEUED REASON is carried forward rather than flattened.
   *
   * A burst is normal here — the stream opens while the boot fetch is still in flight, three
   * taps land in a second, an invalidation arrives during a poll — and every one of those must
   * collapse into at most one follow-up request. What must not collapse is why: "the stream
   * reopened" and "the day rolled over" are the two events worth seeing in a log at 06:05, and
   * a generic `coalesced` would erase exactly the one that mattered. Latest reason wins, since
   * the fetch that follows uses the current clock anyway.
   */
  async function refresh(reason: RefreshReason): Promise<void> {
    if (!running) return;
    if (inFlight) {
      queuedReason = reason;
      return;
    }
    inFlight = true;
    try {
      await fetchSnapshot(reason);
    } finally {
      inFlight = false;
    }
    if (queuedReason !== null) {
      const next = queuedReason;
      queuedReason = null;
      await refresh(next);
    }
  }

  // -------------------------------------------------------------------------
  // The stream
  // -------------------------------------------------------------------------

  function handlePayload(payload: string): void {
    const event = parseWallEvent(payload);
    if (event === null) return;
    if (event.type === 'heartbeat') {
      maybeReload(event.minClientBuild);
      return;
    }
    // An invalidation is a REASON to refetch and never the fact itself, so the scope is not
    // acted on: the client re-reads the whole snapshot, which is the only place any of this
    // is authoritative.
    void refresh('invalidate');
  }

  async function runStream(): Promise<void> {
    if (!running || streamOpen) return;
    streamOpen = true;
    reconnectDueAtMs = null;
    const controller = new AbortController();
    abort = controller;

    try {
      const res = await doFetch(`${base}${STREAM_PATH}`, {
        method: 'GET',
        headers: headers({ accept: 'text/event-stream' }),
        signal: controller.signal,
      });

      if (maybeReload(minBuildFromHeader(res.headers.get(MIN_CLIENT_BUILD_HEADER)))) return;
      if (res.status !== 200 || res.body === null) throw new Error(`stream status ${res.status}`);

      sseFailures = 0;
      log({ kind: 'stream', event: 'open', failures: 0 });
      setState({ streamConnected: true });
      // SSE carries no state, so an open stream is itself a reason to refetch: whatever
      // changed while it was down was never pushed and never will be.
      void refresh('stream-open');

      const reader = res.body.getReader();
      const decoder = createSseDecoder();
      const utf8 = new TextDecoder();
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done === true) break;
        const bytes = chunk.value as Uint8Array | undefined;
        if (bytes !== undefined) {
          for (const payload of decoder.push(utf8.decode(bytes, { stream: true }))) {
            handlePayload(payload);
          }
        }
        if (!running) break;
      }
      log({ kind: 'stream', event: 'closed', failures: sseFailures });
    } catch {
      log({ kind: 'stream', event: 'failed', failures: sseFailures });
    } finally {
      streamOpen = false;
      abort = null;
      setState({ streamConnected: false });
      if (running) {
        sseFailures += 1;
        reconnectDueAtMs = now() + sseDelayMs(sseFailures, random());
      }
    }
  }

  function openStream(): void {
    streamTask = runStream();
    // A rejected stream must never surface as an unhandled rejection: on this box that is a
    // process-level crash, and the process is the wall.
    void streamTask.catch(() => {});
  }

  // -------------------------------------------------------------------------
  // The tick
  // -------------------------------------------------------------------------

  async function tick(): Promise<void> {
    if (!running) return;
    const at = now();

    const observed = observeDate(dateWatch, wallLocalDate(at));
    dateWatch = observed.watch;

    if (observed.rolledOver) {
      // A new day is a new question. Yesterday's mismatch retries and backoff say nothing
      // about whether the server can build TODAY, and inheriting them would delay the one
      // fetch of the day that matters most.
      mismatchAttempts = 0;
      fetchFailures = 0;
      retryDueAtMs = null;
      await refresh('date-boundary');
    } else if (retryDueAtMs !== null && at >= retryDueAtMs) {
      retryDueAtMs = null;
      await refresh('retry');
    } else if (at - lastAttemptAtMs >= pollIntervalMs(sseFailures)) {
      await refresh('poll');
    }

    if (!streamOpen && (reconnectDueAtMs === null || now() >= reconnectDueAtMs)) {
      openStream();
    }
  }

  function arm(): void {
    if (!running) return;
    tickTimer = setTimer(() => {
      void tick().then(arm, arm);
    }, tickMs);
  }

  return {
    getState: () => state,

    start(): void {
      if (running) return;
      running = true;
      // Seed both watches so the boot fetch is not immediately followed by a "rollover" one.
      dateWatch = observeDate(initialDateWatch(), wallLocalDate(now())).watch;
      shellWatch = observeDate(initialDateWatch(), wallLocalDate(now())).watch;
      mismatchAttempts = 0;
      fetchFailures = 0;
      sseFailures = 0;
      retryDueAtMs = null;
      reconnectDueAtMs = null;
      lastAttemptAtMs = now();
      void refresh('boot');
      openStream();
      arm();
    },

    stop(): void {
      running = false;
      if (tickTimer !== null) clearTimer(tickTimer);
      tickTimer = null;
      try {
        abort?.abort();
      } catch {
        /* already gone */
      }
    },

    refresh,

    /**
     * Deliberately idempotent, and deliberately NOT just "call refresh".
     *
     * `WallApp` reports a rollover from its own clock through a `useEffect` whose dependency
     * array includes the callback identity. A callback rebuilt on every state change therefore
     * turns "tell me when the day rolls over" into "tell me every time anything renders" —
     * refetch, new snapshot, new state, new identity, refetch. MEASURED in a real headless
     * Chromium against a real server before this existed: **2404 snapshot requests in eight
     * seconds**, climbing, with nothing visible from the living room until the server fell
     * over.
     *
     * `useWallData` also memoises the callback, which fixes that instance. This is the
     * structural half: the SECOND clock cannot cause a fetch storm no matter how often it
     * speaks, because a date that has not changed is not news. The shell's clock stays a
     * genuinely independent path to the boundary refetch — which is the whole reason it is
     * wired up at all — without being able to become a load generator.
     */
    reportShellDate(date: LocalDate): void {
      if (!running) return;
      const observed = observeDate(shellWatch, date);
      shellWatch = observed.watch;
      if (observed.rolledOver) void refresh('date-boundary');
    },

    tick,
    streamSettled: () => streamTask,
  };
}

/** Exported for the tests that assert the retry floor is not zero. */
export const MIN_RETRY_MS = FETCH_RETRY_BASE_MS;
