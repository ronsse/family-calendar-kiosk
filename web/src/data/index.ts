/**
 * Unit I — the data layer's public surface.
 *
 * Everything below the seam Unit H left: fetching the snapshot the shell renders, subscribing
 * to the invalidation stream, noticing the local date boundary that nothing on the server can
 * notice, and reloading a bundle that has become too old to parse what it is being sent.
 */

export { createWallDataController, DEFAULT_TICK_MS, MIN_RETRY_MS } from './controller.ts';
export type {
  RefreshReason,
  WallDataController,
  WallDataDeps,
  WallDataLog,
  WallDataState,
} from './controller.ts';

export { useWallData } from './useWallData.ts';
export type { WallData } from './useWallData.ts';

export { WallRoot } from './WallRoot.tsx';
export { WaitingScreen } from './WaitingScreen.tsx';

export {
  CLIENT_BUILD,
  CLIENT_BUILD_HEADER,
  HEALTH_PATH,
  MIN_CLIENT_BUILD_HEADER,
  RELOAD_COOLDOWN_MS,
  RELOAD_STAMP_KEY,
  SNAPSHOT_PATH,
  STREAM_PATH,
  WALL_API_PREFIX,
  isStaleBuild,
  minBuildFromHeader,
  shouldHardReload,
} from './protocol.ts';
export type { ReloadDecision } from './protocol.ts';

export { initialDateWatch, observeDate, wallLocalDate } from './localDate.ts';
export type { DateObservation, DateWatch } from './localDate.ts';

export {
  FETCH_RETRY_MAX_MS,
  MISMATCH_MAX_RETRIES,
  POLL_DEGRADED_MS,
  POLL_HEALTHY_MS,
  SSE_BACKOFF_MAX_MS,
  SSE_DEAD_AFTER_FAILURES,
  fetchRetryMs,
  mismatchRetryMs,
  pollIntervalMs,
  sseDelayMs,
} from './backoff.ts';

export { createSseDecoder, parseWallEvent } from './sse.ts';
export type { SseDecoder } from './sse.ts';

export {
  classifyResponse,
  errorCode,
  evaluateSnapshot,
  isRenderableSnapshot,
  snapshotLocalDate,
} from './snapshot.ts';
export type { DegradeReason, SnapshotOutcome } from './snapshot.ts';

export {
  TOKEN_FRAGMENT_KEY,
  TOKEN_STORAGE_KEY,
  hashWithoutToken,
  isProbeSession,
  resolveDeviceToken,
  tokenFromHash,
  wallHeaders,
} from './device.ts';
export type { KeyValueStore } from './device.ts';

export { browserWindow, claimDeviceToken, hardReload, safeStorage } from './browser.ts';
export type { BrowserWindow } from './browser.ts';
