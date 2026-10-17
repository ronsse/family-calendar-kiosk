/**
 * Unit F — HTTP + SSE. Public surface.
 *
 * Implements docs/api.md (FROZEN) on `node:http`. The route surface is fourteen paths and
 * the kiosk is the only client, so there is no framework here to keep current on a box that
 * has to still boot a wall in five years.
 *
 *   createWallServer  — the server factory; the `Database` handle is injected.
 *   buildSnapshot     — the single authoritative read behind GET /snapshot.
 *   WallEventStream   — the SSE fan-out; carries `invalidate` and `heartbeat` and no state.
 *   probeHealth       — GET /api/health, including the allocation-class write probe.
 *   startSyncScheduler— calendar sync in a worker thread, never on the request path.
 *   issueDeviceToken / setParentPin — provisioning, called out of band by the setup script
 *                       because the first device token cannot be minted by a route that
 *                       needs a device token.
 */

export { createWallServer } from './server.ts';
export type { WallServer, WallServerOptions, ServerLogEvent } from './server.ts';

export {
  buildSnapshot,
  countdownsFor,
  listPendingRedemptions,
  requireBuildableDate,
  COUNTDOWN_ICON_CATEGORY,
  DEFAULT_EVENT_HORIZON_DAYS,
} from './snapshot.ts';
export type { SnapshotOptions } from './snapshot.ts';

export { WallEventStream, DEFAULT_HEARTBEAT_MS, DEFAULT_RETRY_MS } from './stream.ts';
export type { InvalidateScope, StreamOptions } from './stream.ts';

export { probeDbWritable, probeHealth, probeReadable, PROBE_ROWS, PROBE_ROW_BYTES } from './health.ts';
export type { HealthReport, ProbeOptions } from './health.ts';

export {
  authenticateDevice,
  hashDeviceToken,
  issueDeviceToken,
  listDevices,
  parentPinIsSet,
  requireParentPin,
  revokeDevice,
  setParentPin,
  verifyParentPin,
  PIN_CONFIG_KEY,
} from './auth.ts';
export type { DeviceIdentity, IssuedDevice } from './auth.ts';

export { startSyncScheduler, DEFAULT_SYNC_INTERVAL_MS } from './sync-scheduler.ts';
export { createCalendarRefresher, REFRESH_IN_FLIGHT_MS } from './calendar-refresh.ts';
export type { CalendarRefresher, RefreshOutcome, SyncTrigger } from './calendar-refresh.ts';
export type { SyncScheduler, SyncSchedulerOptions } from './sync-scheduler.ts';

export {
  ApiError,
  isApiError,
  statusFor,
  API_VERSION,
  MIN_CLIENT_BUILD,
  CLIENT_BUILD_HEADER,
  MAX_DATE_SKEW_DAYS,
} from './protocol.ts';
export type { ApiErrorCode, ContractErrorCode, OperationalErrorCode } from './protocol.ts';
