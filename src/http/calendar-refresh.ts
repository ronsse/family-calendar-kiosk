/**
 * Unit F — asking the calendar sweep to run now, from a route.
 *
 * `syncNow()` has existed on the scheduler since it was written and nothing ever called it
 * (backlog item 3 (private notes)), so the only way to force a refresh was to restart the container. That is a bad
 * shape for the one operation an adult actually wants when the wall looks wrong: it drops every
 * SSE client, re-runs migrations, and takes the wall dark for a few seconds — to do something
 * the worker thread is already sitting there ready to do.
 *
 * ## Why this is an object and not a call straight through to the scheduler
 *
 * Three things the route needs that `SyncScheduler` does not offer:
 *
 *   - **It must not start two sweeps.** `syncNow()` is a `postMessage`: fire and forget, no
 *     return value, no notion of "already running". Two taps a second apart would queue two
 *     full sweeps against the same upstream.
 *   - **It must be able to say what happened.** A refresh that reports nothing is one an adult
 *     will press again, which is how you get the double-call in the first place.
 *   - **It must be testable without a worker thread.** The scheduler spawns one; a route test
 *     that had to spawn one would be an integration test wearing a unit test's clothes.
 *
 * ## The in-flight guard has a deadline, deliberately
 *
 * "In flight" is set on request and cleared when the worker reports back. If a message is ever
 * lost — a crashed worker, a `terminate` mid-sweep — a purely message-driven flag would latch
 * ON and refuse every future refresh for the life of the process. That failure is silent and
 * permanent, which is worse than the double sweep it protects against. So the flag also expires
 * on its own, and the deadline is generous enough that a normal sweep always beats it.
 */

/** The half of `SyncScheduler` this needs.  Narrow on purpose — see the header. */
export interface SyncTrigger {
  readonly started: boolean;
  readonly reason: string | null;
  syncNow(): void;
}

/** What the worker tells us about a sweep, narrowed to the fields that matter here. */
export interface SyncReport {
  readonly type: string;
  readonly ok?: number | undefined;
  readonly failed?: number | undefined;
  readonly events?: number | undefined;
  readonly message?: string | undefined;
}

export type RefreshDisposition =
  /** A sweep was asked for just now. */
  | 'started'
  /** One was already running; this call did nothing, which is the correct outcome. */
  | 'already-running'
  /** No adapter is configured, so there is nothing to refresh and never will be. */
  | 'not-configured';

export interface RefreshOutcome {
  readonly disposition: RefreshDisposition;
  /** Populated for `not-configured`: the scheduler's own words, for an adult to read. */
  readonly reason: string | null;
  /** When a sweep last finished, or null if none has since this process started. */
  readonly lastCompletedAtUtc: string | null;
  /** What the last completed sweep found. Null before the first one. */
  readonly lastEvents: number | null;
  readonly lastFailed: number | null;
}

/**
 * How long an unacknowledged refresh stays "in flight".
 *
 * Two minutes. A sweep of this household's six calendars takes ~50ms; the number is not a
 * prediction of how long the work takes, it is how long we are willing to be wrong in the
 * direction that refuses a legitimate refresh.
 */
export const REFRESH_IN_FLIGHT_MS = 2 * 60_000;

export interface CalendarRefresher {
  /** Ask for a sweep. Idempotent while one is in flight. */
  refresh(): RefreshOutcome;
  /** Feed the scheduler's messages in, so the in-flight flag can clear. */
  observe(message: SyncReport): void;
  /**
   * Late-bind the scheduler.
   *
   * The composition root builds the server before it starts the scheduler — the scheduler
   * needs `server.stream` — so the refresher has to exist before the thing it triggers. An
   * unattached refresher answers `not-configured`, which is also the honest answer for a
   * household with no calendar upstream at all.
   */
  attach(trigger: SyncTrigger): void;
}

export function createCalendarRefresher(
  now: () => number = () => Date.now(),
): CalendarRefresher {
  let trigger: SyncTrigger | null = null;
  let inFlightUntil = 0;
  let lastCompletedAtUtc: string | null = null;
  let lastEvents: number | null = null;
  let lastFailed: number | null = null;

  const snapshot = (disposition: RefreshDisposition, reason: string | null): RefreshOutcome => ({
    disposition,
    reason,
    lastCompletedAtUtc,
    lastEvents,
    lastFailed,
  });

  const busy = (): boolean => now() < inFlightUntil;

  return {
    attach(next) {
      trigger = next;
    },

    observe(message) {
      // ANY terminal message clears the flag, not just success. An errored sweep is a finished
      // sweep, and refusing the retry that an adult obviously wants next is exactly backwards.
      if (message.type !== 'synced' && message.type !== 'error') return;
      inFlightUntil = 0;
      if (message.type === 'synced') {
        lastCompletedAtUtc = new Date(now()).toISOString();
        lastEvents = typeof message.events === 'number' ? message.events : null;
        lastFailed = typeof message.failed === 'number' ? message.failed : null;
      }
    },

    refresh() {
      if (trigger === null || !trigger.started) {
        return snapshot('not-configured', trigger?.reason ?? 'no calendar sync is running');
      }
      if (busy()) return snapshot('already-running', null);
      inFlightUntil = now() + REFRESH_IN_FLIGHT_MS;
      trigger.syncNow();
      return snapshot('started', null);
    },
  };
}
