/**
 * Unit I — what the bundle knows about the wire, and the one thing it must do about it.
 *
 * `CLIENT_BUILD` is `MIN_CLIENT_BUILD` **read at build time**. That is not a shortcut; it is
 * the mechanism. The bundle is compiled once and then held in a Chromium tab for months, so
 * the only honest statement it can make about its own age is the value of that constant on
 * the day it was compiled. When someone raises `MIN_CLIENT_BUILD` alongside a breaking wire
 * change and redeploys, the *running* bundle still carries the old number, reports it in
 * `x-client-build`, sees the new minimum come back, and reloads before it parses a shape it
 * does not understand (H3 finding #9). Rebuild the bundle and the two agree again, with no
 * second constant for anyone to forget.
 */

import { CLIENT_BUILD_HEADER, MIN_CLIENT_BUILD } from '../../../src/http/protocol.ts';

export { CLIENT_BUILD_HEADER };

/** The build this bundle was compiled at. See the note above; do not hand-maintain it. */
export const CLIENT_BUILD = MIN_CLIENT_BUILD;

/** Sent on every response by Unit F, so the reload trigger never depends on the snapshot. */
export const MIN_CLIENT_BUILD_HEADER = 'x-min-client-build';

export const WALL_API_PREFIX = '/api/wall/v1';
export const SNAPSHOT_PATH = `${WALL_API_PREFIX}/snapshot`;
export const STREAM_PATH = `${WALL_API_PREFIX}/stream`;
export const HEALTH_PATH = '/api/health';

/**
 * A reload that does not fix anything must not repeat.
 *
 * If the server raises the minimum and the browser reloads onto a *cached* copy of the same
 * old bundle, the reload loop is a black screen that flickers — strictly worse than a stale
 * render. So a hard reload is allowed at most once per this window, and the wall otherwise
 * keeps showing the last good snapshot with a staleness mark, which is the contract for every
 * other failure too.
 */
export const RELOAD_COOLDOWN_MS = 10 * 60_000;

/** Where the last reload's timestamp is parked so it survives the reload itself. */
export const RELOAD_STAMP_KEY = 'wall.lastHardReloadAtMs';

/**
 * True only when the running bundle is GENUINELY older than the server's minimum.
 *
 * Strictly `<`. A bundle newer than the minimum is the normal state of every deploy, and an
 * `!==` here would reload the wall on every single response forever.
 */
export function isStaleBuild(runningBuild: number, minClientBuild: unknown): boolean {
  if (typeof minClientBuild !== 'number' || !Number.isFinite(minClientBuild)) return false;
  return runningBuild < minClientBuild;
}

export interface ReloadDecision {
  reload: boolean;
  /** Populated when a reload was warranted but suppressed; for a log an adult reads. */
  suppressed: 'cooldown' | null;
}

/** `isStaleBuild`, plus the loop guard. The only thing allowed to call `location.reload()`. */
export function shouldHardReload(
  runningBuild: number,
  minClientBuild: unknown,
  lastReloadAtMs: number | null,
  nowMs: number,
  cooldownMs: number = RELOAD_COOLDOWN_MS,
): ReloadDecision {
  if (!isStaleBuild(runningBuild, minClientBuild)) return { reload: false, suppressed: null };
  if (lastReloadAtMs !== null && Number.isFinite(lastReloadAtMs)) {
    const since = nowMs - lastReloadAtMs;
    // A clock step backwards (the Pi has no RTC, NTP steps it after boot) must not be read
    // as "ages ago"; treat any negative age as inside the window.
    if (since < cooldownMs) return { reload: false, suppressed: 'cooldown' };
  }
  return { reload: true, suppressed: null };
}

/** Reads the minimum out of a response header, tolerating its absence. */
export function minBuildFromHeader(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string' || raw.length === 0) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}
