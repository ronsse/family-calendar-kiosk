/**
 * Unit H — is the clock good enough to be PLAYFUL with?
 *
 * The wall is gaining a second idle appearance (H8 §4): a full-bleed illustration most of
 * the day, and the information board inside the routine windows.  That makes what the
 * household sees at 6:00 AM a function of `now()`.
 *
 * The Pi 5 has NO hardware RTC.  It boots with whatever the filesystem last remembered —
 * or with 1970 — and NTP steps it later, sometimes by hours, sometimes backwards.  So the
 * obvious shape,
 *
 *     if (hour >= 6 && hour < 8) board(); else scene();
 *
 * puts a picture on the wall at 6:00 AM on a school day every time the network is slow to
 * come back after an overnight power cut.  That is the prime invariant failing, and it
 * fails SILENTLY: the wall is bright, pretty, and confident.
 *
 * So the default is inverted.  **Trusted time is a precondition for the playful screen and
 * never for the useful one.**  Every uncertainty — an unsynchronised clock, no sync this
 * boot, a stale sync, a clock standing behind an instant we have already durably recorded,
 * evidence that did not arrive in a usable shape — resolves to the BOARD.  A freshly-booted
 * Pi with no sync is by definition not confident, so it fails the gate and shows the board.
 * Read that way the time box STRENGTHENS the invariant instead of weakening it: the only
 * thing a wrong clock can cost is delight.
 *
 * The second rule is that a failed gate must say WHICH condition failed.  A bare boolean is
 * how this becomes undebuggable at 06:05 with a parent standing in front of it, so every
 * negative answer carries a `reason`, the full list of failures, and one diagnostic line.
 *
 * Nothing here does I/O and nothing here throws.  Collecting the evidence is a separate job:
 * on this Pi (verified 2026-08-26) that is systemd-timesyncd — `timedatectl`, the tmpfs
 * marker `/run/systemd/timesync/synchronized`, and the persistent `/var/lib/systemd/
 * timesync/clock`.  There is no chrony and no fake-hwclock on the box.
 *
 * WHICH FILE CARRIES `lastSyncAtMs` IS NOT SETTLED, and the collector must not assume.
 * Measured on the box 2026-08-26, 25 hours after boot: the tmpfs marker's mtime was 23:58:55
 * and the persistent clock file's was 00:09:06 — ten minutes APART, both long after boot, and
 * the persistent one more recent.  So both are touched at runtime on different schedules and
 * neither is a documented API for "when did we last sync": `timedatectl timesync-status`
 * reports leap, stratum and root distance and NO last-sync timestamp at all.
 *
 * The collector should therefore take the OLDER of the two.  A staleness ceiling that guesses
 * young fails open, and this whole module exists to fail closed.  With a 34-minute poll
 * interval the 3-hour ceiling is about five missed polls either way, so the conservative
 * reading costs nothing.  This module only
 * decides what the evidence means, so swapping the collector changes nothing here.
 */

import { timeBoxState } from './timebox.ts';

// ---------------------------------------------------------------------------
// The evidence, and the four conditions it has to satisfy
// ---------------------------------------------------------------------------

/** Condition 3's limit.  A sync older than this stops earning the scene. */
export const MAX_SYNC_AGE_MS = 3 * 60 * 60 * 1000;

/**
 * Condition 4's absolute floor.  Nothing this wall renders happened before 2024, so a clock
 * reporting 2019 — or 1970, which is what an RTC-less box says when nothing has ever written
 * a marker for it — is wrong no matter what else it claims about itself.
 */
export const MIN_PLAUSIBLE_EPOCH_MS = Date.UTC(2024, 0, 1);

/**
 * What the wall must be told about its own clock before it may be playful.
 *
 * Deliberately five plain fields and no methods: this is a value collected somewhere else,
 * on a schedule, and handed in.  Nothing in here is derived from another field, so a
 * collector that can only answer three of them cannot fake the other two.
 */
export interface ClockEvidence {
  /**
   * Condition 1.  The OS reports the clock as GENUINELY SYNCHRONISED to a time source —
   * not merely that it holds a plausible-looking date.  Holding a date is what an RTC-less
   * Pi has one second after power-on, and it means nothing at all.
   */
  readonly osSynchronised: boolean;
  /**
   * Condition 2.  At least one sync has SUCCEEDED since this boot.  A sync that succeeded
   * last week and was restored from disk is not evidence about this morning.
   */
  readonly syncedSinceBoot: boolean;
  /**
   * Condition 3's operand: epoch ms of the most recent successful sync, `null` when there
   * has never been one.  Must be read off the same clock as `nowMs` or the subtraction below
   * means nothing.
   */
  readonly lastSyncAtMs: number | null;
  /** The instant being judged — the same `Date.now()` the wall is about to render from. */
  readonly nowMs: number;
  /**
   * Condition 4's floor: epoch ms of the newest instant this device has DURABLY recorded —
   * written at shutdown and periodically while running.  Time only moves forwards, so a
   * `nowMs` behind this is proof the clock is lying, whatever else it claims.
   *
   * `null` when no marker has ever been written.  That degrades the floor to
   * `MIN_PLAUSIBLE_EPOCH_MS` rather than failing outright: an absent marker is a fresh box,
   * not a lying clock, and conditions 1-3 have already demanded real NTP evidence by the
   * time we get here.  The 2019 case is still caught, which is the half that matters.
   */
  readonly lastShutdownAtMs: number | null;
}

/**
 * Why the clock was not trusted.  Six strings for four conditions: condition 2 and
 * condition 3 each have two distinguishable ways to fail, and telling them apart is worth
 * more at 06:05 than a tidy one-to-one mapping.
 */
export type ClockDistrustReason =
  /** The evidence itself did not arrive in a usable shape.  The collector is broken. */
  | 'malformed-evidence'
  /** Condition 1. */
  | 'not-synchronised'
  /** Condition 2 — never synced this boot, or claimed to with no timestamp behind it. */
  | 'no-sync-this-boot'
  /** Condition 3 — the last sync is AHEAD of now, so the clock stepped back since. */
  | 'sync-in-future'
  /** Condition 3 — the last sync is older than `MAX_SYNC_AGE_MS`. */
  | 'sync-too-old'
  /** Condition 4 — now is behind an instant we already know happened. */
  | 'clock-behind-floor';

interface TimeTrustShared {
  /** Every condition that failed, in the order they are checked.  Diagnostics only. */
  readonly failures: readonly ClockDistrustReason[];
  /**
   * One line for a log or an adult diagnostics strip.  Never child-facing, and it carries
   * no household data — only durations and the name of the condition.
   */
  readonly detail: string;
}

export type TimeTrust =
  | (TimeTrustShared & { readonly trusted: true; readonly reason: null })
  | (TimeTrustShared & { readonly trusted: false; readonly reason: ClockDistrustReason });

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNullOrFiniteNumber(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

/** Durations only, and never `NaN` — a diagnostic line that reads "NaNm" helps nobody. */
function minutesText(ms: number): string {
  return Number.isFinite(ms) ? `${Math.round(ms / 60_000)}m` : 'an unknown time';
}

function detailFor(
  reason: ClockDistrustReason,
  syncAgeMs: number | null,
  nowMs: number,
  floorMs: number,
): string {
  switch (reason) {
    case 'malformed-evidence':
      return 'clock evidence did not arrive in a usable shape';
    case 'not-synchronised':
      return 'the OS does not report the clock as synchronised';
    case 'no-sync-this-boot':
      return 'no successful time sync since boot';
    case 'sync-in-future':
      return `the last sync is ${minutesText(Math.abs(syncAgeMs ?? 0))} ahead of now`;
    case 'sync-too-old':
      return `last sync ${minutesText(syncAgeMs ?? 0)} ago, limit ${minutesText(MAX_SYNC_AGE_MS)}`;
    case 'clock-behind-floor':
      return `now is ${minutesText(floorMs - nowMs)} behind an instant already recorded`;
  }
  // Exhaustive above.  A new reason must add its own line rather than fall through into a
  // blank string, which is the silent gate this module exists to refuse.
  const unreachable: never = reason;
  return String(unreachable);
}

const MALFORMED: TimeTrust = {
  trusted: false,
  reason: 'malformed-evidence',
  failures: ['malformed-evidence'],
  detail: 'clock evidence did not arrive in a usable shape',
};

/**
 * The gate.  Total: every input, including one that is not a `ClockEvidence` at all,
 * returns a verdict, and the verdict for anything we cannot read is "not trusted".
 *
 * The parameter is typed for callers' benefit; the body assumes nothing, because the
 * evidence crosses a process boundary on its way here and the type does not survive it.
 */
export function evaluateClockEvidence(evidence: ClockEvidence): TimeTrust {
  const raw: unknown = evidence;
  if (raw === null || typeof raw !== 'object') return MALFORMED;

  const { osSynchronised, syncedSinceBoot, lastSyncAtMs, nowMs, lastShutdownAtMs } =
    raw as Record<keyof ClockEvidence, unknown>;

  if (
    typeof osSynchronised !== 'boolean' ||
    typeof syncedSinceBoot !== 'boolean' ||
    !isFiniteNumber(nowMs) ||
    !isNullOrFiniteNumber(lastSyncAtMs) ||
    !isNullOrFiniteNumber(lastShutdownAtMs)
  ) {
    return MALFORMED;
  }

  const failures: ClockDistrustReason[] = [];

  if (!osSynchronised) failures.push('not-synchronised');

  // Condition 2 is "a sync SUCCEEDED this boot".  A `true` with no timestamp behind it is
  // that claim with nothing supporting it, and evidence that contradicts itself is not
  // evidence — same answer, so it gets the same reason.
  if (!syncedSinceBoot || lastSyncAtMs === null) failures.push('no-sync-this-boot');

  const syncAgeMs = lastSyncAtMs === null ? null : nowMs - lastSyncAtMs;
  if (syncAgeMs !== null) {
    // A negative age is not "fresh" — it is the clock standing behind its own last sync,
    // i.e. a backward step that happened after we synced.
    if (syncAgeMs < 0) failures.push('sync-in-future');
    else if (syncAgeMs > MAX_SYNC_AGE_MS) failures.push('sync-too-old');
  }

  const floorMs = Math.max(lastShutdownAtMs ?? MIN_PLAUSIBLE_EPOCH_MS, MIN_PLAUSIBLE_EPOCH_MS);
  if (nowMs < floorMs) failures.push('clock-behind-floor');

  const reason = failures[0];
  if (reason === undefined) {
    return {
      trusted: true,
      reason: null,
      failures: [],
      detail: `synchronised, last sync ${minutesText(syncAgeMs ?? 0)} ago`,
    };
  }
  return { trusted: false, reason, failures, detail: detailFor(reason, syncAgeMs, nowMs, floorMs) };
}

// ---------------------------------------------------------------------------
// Which idle screen
// ---------------------------------------------------------------------------

export interface IdleWindow {
  /**
   * "HH:MM".  Deliberately a plain `string` and not a branded `LocalTime`: this module has
   * to be total over garbage, and a brand would promise a parse that has not happened yet.
   * `timeBoxState` takes the same view of the same strings.
   */
  readonly opensAtLocal: string;
  readonly closesAtLocal: string;
}

/**
 * The board's hours, and they are deliberately WIDER than the routines they cover
 * (06:00-08:00 and 19:00-20:30).  A routine that opens at 06:00 wants the board already up
 * when the first person walks into the room, not arriving at the same moment they do; and
 * the evening does not end the instant the last step is ticked.  These are the panel's
 * numbers, not the routines'.
 */
export const IDLE_BOARD_WINDOWS: readonly IdleWindow[] = [
  { opensAtLocal: '05:45', closesAtLocal: '08:30' },
  { opensAtLocal: '18:45', closesAtLocal: '20:45' },
];

export type IdleMode = 'board' | 'scene';

/** Why, in the order the decision is made.  Only `idle-hours` yields the scene. */
export type IdleModeReason = 'time-untrusted' | 'board-window' | 'idle-hours';

export interface IdleModeDecision {
  readonly mode: IdleMode;
  readonly reason: IdleModeReason;
  readonly timeTrusted: boolean;
  /** Always `false` when `timeTrusted` is false — we did not ask a clock we do not trust. */
  readonly insideBoardWindow: boolean;
}

/**
 * Does the board's schedule cover `nowLocal`?
 *
 * Comparison goes through `timeBoxState`, so wall-clock times are compared as minutes of
 * day and never as instants — one implementation of that comparison, not two.  Its
 * half-open `[opens, closes)` edges come with it: 05:45 is inside, 08:30 is not.
 *
 * Everything unreadable answers TRUE.  A window list we cannot parse, a bound that is not a
 * string, a list that is not a list — none of those prove that now is outside the board's
 * hours, and only proof buys the picture.  `timeBoxState` already fails open on a malformed
 * bound for its own reasons; here that same failure lands on the same safe side, which is the
 * whole design.
 *
 * An EMPTY list is not unreadable: it is the household saying "the board never replaces the
 * picture" (`boardWindows: []` in `db/household.json`, validated server-side), and it covers
 * nothing.  Until 2026-10-12 it answered true and kept the board up all day — the opposite of
 * what the schema documents.  A MISSING list (an older server with no `household`) is not
 * this case: the parameter defaults to `IDLE_BOARD_WINDOWS` before it gets here.
 */
export function boardWindowsCover(
  nowLocal: string,
  windows: readonly IdleWindow[] = IDLE_BOARD_WINDOWS,
): boolean {
  if (typeof nowLocal !== 'string') return true;
  if (!Array.isArray(windows)) return true;
  for (const w of windows) {
    if (w === null || typeof w !== 'object') return true;
    const { opensAtLocal, closesAtLocal } = w as Record<keyof IdleWindow, unknown>;
    if (typeof opensAtLocal !== 'string' || typeof closesAtLocal !== 'string') return true;
    if (timeBoxState(opensAtLocal, closesAtLocal, nowLocal).phase === 'open') return true;
  }
  return false;
}

/**
 * The idle screen, given a verdict on the clock and the time of day.
 *
 * Board if EITHER: time is not trusted, or we are inside a board window.  Scene otherwise —
 * which is most of the day, and is the point.
 *
 * There used to be a third reason: "something is overdue".  It is gone (2026-09-13), and it
 * is the second time a version of it has gone.  In August it was the APPROVAL QUEUE holding
 * the board up, and the household reported the home button as broken.  This time it was the
 * real thing — a duty due at 17:00 nobody had touched — and the household reported the wall
 * as stuck on the calendar days.  Both reports were accurate descriptions of the same design:
 * with duties due at 17:00 every day, the picture was gone from five o'clock until the evening
 * window closed at 20:45, on every evening the household was actually in the room, and
 * nothing on the wall could bring it back.  The board's own hours already cover the routines;
 * a late chore is on the board inside them and on the child's own screen always.  It does not
 * also get to take the picture down.
 */
export function idleMode(
  timeTrusted: boolean,
  nowLocal: string,
  windows: readonly IdleWindow[] = IDLE_BOARD_WINDOWS,
): IdleModeDecision {
  if (timeTrusted !== true) {
    return {
      mode: 'board',
      reason: 'time-untrusted',
      timeTrusted: false,
      // Not "we are outside the windows" — we did not ask.  A clock we do not trust cannot
      // testify about where in the day we are, so it is not asked to.
      insideBoardWindow: false,
    };
  }

  const inWindow = boardWindowsCover(nowLocal, windows);
  return {
    mode: inWindow ? 'board' : 'scene',
    reason: inWindow ? 'board-window' : 'idle-hours',
    timeTrusted: true,
    insideBoardWindow: inWindow,
  };
}

export interface IdleDecision {
  readonly decision: IdleModeDecision;
  /** Carried alongside so "why is the board up?" is answerable from one value. */
  readonly trust: TimeTrust;
}

/**
 * The two steps composed, which is how callers should use this: taking a boolean out of
 * `evaluateClockEvidence` and passing something else to `idleMode` is the only way to wire
 * this wrong, so the wiring is done here once.
 */
export function idleModeFromClock(
  evidence: ClockEvidence,
  nowLocal: string,
  windows: readonly IdleWindow[] = IDLE_BOARD_WINDOWS,
): IdleDecision {
  const trust = evaluateClockEvidence(evidence);
  return { decision: idleMode(trust.trusted, nowLocal, windows), trust };
}
