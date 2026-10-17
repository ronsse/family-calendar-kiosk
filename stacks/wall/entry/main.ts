/**
 * Unit I — the composition root. One process: API, SSE, calendar sync and the SPA.
 *
 * This file exists because `createWallServer` takes an injected `Database` and decides nothing
 * about where the household's data lives — deliberately, so the whole route surface is
 * testable against `:memory:`. Somebody has to make those decisions; it is this file, and it
 * is outside `src/**` so that Unit F's boundary stays intact.
 *
 * ## One process, one origin
 *
 * The bundle is served by the same server that answers `/api/wall/v1/*`, through the
 * `fallback` seam. That is not a deployment convenience: same-origin means no CORS preflight
 * in front of a three-year-old's tap, no second container to be up at 06:00, and no way for
 * the static half and the API half to be at different versions.
 *
 * ## What it refuses to do
 *
 * It does not create the database schema silently and move on if something is wrong; `migrate`
 * is idempotent and `assertIntegrity` runs inside it, so a corrupt volume is a loud failure at
 * boot rather than a wall that renders half a day. It does not start calendar sync without an
 * adapter — `startSyncScheduler` reports why it declined, and that reason is logged, because a
 * scheduler that silently did nothing presents as "the calendar is just quiet today".
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';
import { openDatabase } from '../../../src/db/connection.ts';
import { migrate } from '../../../src/db/migrate.ts';
import { configureTime } from '../../../src/time.ts';
import { readHousehold } from '../../../src/config/household.ts';
import { chooseCalendarSource } from '../../../src/calendar/registry.ts';
import {
  createWallServer,
  createCalendarRefresher,
  startSyncScheduler,
  parentPinIsSet,
  listDevices,
} from '../../../src/http/index.ts';
import { createStaticHandler } from './static.ts';
import { registerBundledArt } from './baseline.ts';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '../../..');

function env(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.length === 0 ? fallback : raw;
}

const DB_PATH = resolve(env('WALL_DB', resolve(REPO, 'dev.db')));
const WEB_ROOT = resolve(env('WALL_WEB_ROOT', resolve(REPO, 'web/dist')));
// Assets sit beside the database on purpose: they are household content, they must survive a
// container rebuild, and putting them in the same volume means there is exactly one thing to
// back up rather than two things that can get out of step.
const ASSET_ROOT = resolve(env('WALL_ASSET_ROOT', resolve(dirname(DB_PATH), 'assets')));
const PORT = Number(env('WALL_PORT', '8124'));
// 0.0.0.0 with ufw governing the subnets, matching stacks/homeassistant. A published Docker
// port would bypass ufw's chains; a host-bound socket does not (CLAUDE.md).
const HOST = env('WALL_BIND', '0.0.0.0');

function log(message: string): void {
  process.stdout.write(`[wall] ${message}\n`);
}

mkdirSync(dirname(DB_PATH), { recursive: true });
mkdirSync(ASSET_ROOT, { recursive: true });

const db = openDatabase({ path: DB_PATH });
const migration = migrate(db);
// Every local date and time this process computes is in the household's zone from here on.
// A bad `timezone` row reads as the default (readHousehold never throws), so this cannot stop
// the wall booting.
const household = readHousehold(db);
configureTime({ timeZone: household.timezone });
log(`household timezone ${household.timezone}`);
// The bundled art: seed the committed files into the volume, register their `asset` rows,
// then the committed scenes, which are the library's floor (see registerBaselineScenes).
// provision.ts runs the same function, so either may come first on a fresh database.
registerBundledArt(db, REPO, ASSET_ROOT, log);
log(
  migration.applied
    ? `migrated ${DB_PATH} to schema version ${String(migration.version)}`
    : `${DB_PATH} already at schema version ${String(migration.version)}`,
);

// Loud, once, at boot. Both of these are provisioning steps a human performs, and both fail
// in ways that look like something else from the living room: no device token renders the
// offline card, and no PIN means nothing can ever be approved.
const devices = listDevices(db).filter((d) => !d.revoked);
if (devices.length === 0) {
  log('WARNING: no device token has been issued — the wall will render the offline card.');
  log('         run:  docker compose exec wall node --experimental-strip-types \\');
  log('                 stacks/wall/entry/provision.ts --device "living room wall"');
}
if (!parentPinIsSet(db)) {
  log('WARNING: no parent PIN is set — nothing can be approved until one is.');
  log('         run:  docker compose exec wall node --experimental-strip-types \\');
  log('                 stacks/wall/entry/provision.ts --pin 1111');
}

// Built before the server, attached after the scheduler: the server needs the refresher and
// the scheduler needs the server's stream, so something has to be late-bound and this is the
// end that can be. Unattached it answers "not configured", which is also the right answer for
// a household with no calendar upstream.
const calendarRefresh = createCalendarRefresher();

const server = createWallServer({
  db,
  snapshot: { assetRoot: ASSET_ROOT },
  calendarRefresh,
  fallback: createStaticHandler({ webRoot: WEB_ROOT, assetRoot: ASSET_ROOT, db, logger: log }),
  logger: (event) => {
    if (event.kind !== 'unexpected') return;
    const cause = event.error instanceof Error ? event.error.stack : String(event.error);
    process.stderr.write(`[wall] ${event.method} ${event.path} -> ${event.code}\n${cause}\n`);
  },
});

// The adapter is named by MODULE PATH, never imported here — see src/calendar/registry.ts,
// which owns the table of built-in sources and the WALL_CALENDAR_* overrides (ADR-0004).
const calendarSource = chooseCalendarSource(process.env);
const sourceName = calendarSource.name;
const adapterModule = calendarSource.module;
const adapterExport = calendarSource.export;
const calendarConfigured = calendarSource.configured;

const sync = startSyncScheduler({
  dbPath: DB_PATH,
  // No credentials means no adapter: leaving it unset is a supported configuration (a
  // household with no upstream calendar still has chores and routines), and it is reported
  // rather than assumed.
  adapterModule: calendarConfigured ? adapterModule : undefined,
  adapterExport,
  stream: server.stream,
  onMessage: (message) => {
    // Clears the in-flight guard, and records what the sweep found so a forced refresh can
    // report it back rather than returning a bare acknowledgement.
    calendarRefresh.observe(message);
    if (message.type === 'synced') {
      log(`calendar sync: ${String(message.ok)} ok, ${String(message.failed)} failed, ${String(message.events)} events`);
    } else {
      log(`calendar sync error: ${message.message}`);
    }
  },
});
calendarRefresh.attach(sync);
log(
  sync.started
    ? `calendar sync scheduled (${sourceName})`
    : `calendar sync NOT running: ${calendarConfigured ? (sync.reason ?? 'unknown') : `${sourceName}: ${calendarSource.needs}`}`,
);

const address = await server.listen(PORT, HOST);
log(`listening on http://${HOST}:${String(address.port)}  (web: ${WEB_ROOT}, assets: ${ASSET_ROOT})`);

/**
 * Shut down in the order that keeps the wall from noticing.
 *
 * Streams first — an open SSE response keeps `server.close` pending forever — then the
 * scheduler, then the database. A container restart is the normal case for all of this, and
 * the kiosk gate covers the gap with last-known-good.
 */
let closing = false;
async function shutdown(signal: string): Promise<void> {
  if (closing) return;
  closing = true;
  log(`${signal} — shutting down`);
  try {
    await server.close();
    await sync.stop();
    db.close();
  } catch (err) {
    process.stderr.write(`[wall] shutdown: ${String(err)}\n`);
  }
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

/**
 * An unhandled rejection must not kill the wall.
 *
 * Node's default is to exit, and the default is wrong here: a stray rejection from a socket
 * that went away is not a reason to take the household's display down and wait for systemd.
 * It is logged, loudly, because the alternative failure — swallowing a real bug — is caught by
 * reading the log, and the alternative to logging is a blank wall at 6:00 AM.
 */
process.on('unhandledRejection', (reason) => {
  process.stderr.write(`[wall] unhandled rejection: ${String(reason)}\n`);
});
