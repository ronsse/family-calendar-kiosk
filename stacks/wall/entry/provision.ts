/**
 * Unit I — provisioning, out of band.
 *
 * The first device token cannot be minted by `POST /api/admin/v1/devices`, because that route
 * needs a device token to call. The same is true of the parent PIN: `requireParentPin` fails
 * closed when none is set, so an unconfigured household cannot approve anything — including
 * the act of configuring itself. Unit F exports `issueDeviceToken` and `setParentPin` as
 * functions precisely so a script can break that circle. This is that script.
 *
 * Provisioning may run BEFORE the wall's first start. Every run seeds the bundled art into the
 * asset root and registers it (the same `registerBundledArt` steps `main.ts` runs at boot), so
 * `--household` on a bare database finds `av-a`/`av-b`/`av-c`, and the committed scenes are
 * registered after the flags have run, so a picture that fits the new roster goes up. The
 * asset root is `WALL_ASSET_ROOT`, else `assets/` beside the database — the same default as
 * `main.ts`.
 *
 *   npm run provision -- --household db/household.example.sql   # on a fresh DB: then npm start
 *   npm run provision -- --device "living room wall"
 *   npm run provision -- --pin 1111
 *   npm run provision -- --household db/household.sql
 *   npm run provision -- --settings db/household.json   # zone, locale, features, pets ('-' = stdin)
 *   npm run provision -- --calendars db/calendars.sql
 *   npm run provision -- --chores ~/wall-chores.json
 *   npm run provision -- --add-scene w37-cozy-painted   # register a generated scene as a candidate
 *   npm run provision -- --add-backdrop ~/porch.jpg --id porch   # a still picture, straight up
 *   npm run provision -- --scenes                       # the catalog, which one is up, how long each was
 *   npm run provision -- --scene-events -               # backfill past decisions (JSON from a backup)
 *   npm run provision -- --reset-activity               # wipe the wall's USE, keep its setup
 *   npm run provision -- --band child-a=fluent --ledger child-c=on   # one child's screen, in place
 *   npm run provision -- --list
 *
 * The token is printed ONCE and stored hashed. It goes into the Pi's `~/.config/kiosk.env` as
 * `WALL_DEVICE_TOKEN`; nothing recovers it afterwards, and re-running `--device` mints a new
 * one rather than reprinting the old.
 *
 * The chore-authoring half is exported rather than buried in the CLI body, and `main()` runs
 * only when this file is the process entry point — the same shape `src/db/migrate.ts` uses,
 * and for the same reason: a path that writes to the household's live database has to be
 * testable without spawning it.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { Database as Db } from 'better-sqlite3';
import { openDatabase, inTransaction } from '../../../src/db/connection.ts';
import { migrate } from '../../../src/db/migrate.ts';
import { parseHousehold, writeHousehold, HOUSEHOLD_ROW_KEYS } from '../../../src/config/household.ts';
import {
  applyChores,
  choreAuthoringWarnings,
  historyFingerprint,
  parseChoreFile,
  validateChoreAuthoring,
  type ChoreChange,
} from '../../../src/domain/chores/authoring.ts';
import { addDays, localDate } from '../../../src/time.ts';
import { DOOR_TARGETS, readDoorTaps, type DoorTarget } from '../../../src/domain/telemetry/doorTaps.ts';
import type { ReadingBand, Utc } from '../../../src/types.ts';
import {
  activeScene,
  approveScene,
  listScenes,
  logSceneDecision,
  readSceneManifest,
  registerScene,
  sceneHistory,
} from '../../../src/domain/scenes/library.ts';
import { REPO_ROOT, registerBaselineAssets, registerCommittedScenes } from './baseline.ts';
import { seedAssets } from './seed-assets.ts';
import { issueDeviceToken, listDevices, parentPinIsSet, revokeDevice, setParentPin } from '../../../src/http/index.ts';

const args = process.argv.slice(2);

function flag(name: string): string | null {
  const i = args.indexOf(`--${name}`);
  if (i === -1) return null;
  return args[i + 1] ?? '';
}

/**
 * Every flag this script understands.
 *
 * It exists because an unknown flag used to be SILENTLY IGNORED. `flag()` answers null for
 * anything absent and nothing ever asked whether a `--something` on the command line had been
 * read by anybody, so a typo, or a flag added to the repo but not yet in the running container,
 * fell through to the default branch and printed the device list. Exit code 0.
 *
 * That is exactly how it presented on 2026-09-08: the weekly scene runner called
 * `--add-scene <id>` against a container built before that flag existed, got a device inventory
 * and a success, and reported the scene as registered. Nothing was registered. Correct-looking
 * output hiding a dead path, for the fourth time in this project — and this time the path was a
 * CLI contract, which is the easiest of all of them to check.
 */
const KNOWN_FLAGS: readonly string[] = [
  'db', 'device', 'pin', 'revoke', 'household', 'calendars', 'chores', 'taps',
  'add-scene', 'style', 'scenes', 'list', 'force', 'reset-activity', 'band', 'ledger',
  'settings', 'add-backdrop', 'id', 'scene-events',
];

/** A backdrop is a picture for a wall, not a camera original. */
const BACKDROP_MAX_BYTES = 4 * 1024 * 1024;
const BACKDROP_ID_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** The repo's committed scenes — ids a household backdrop may not reuse. */
const REPO_SCENES = fileURLToPath(new URL('../../../assets/scenes', import.meta.url));

/** `~/Pictures/Porch View.JPG` -> `porch-view`. */
function backdropSlug(path: string): string {
  return basename(path, extname(path))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 63);
}

function refuseUnknownFlags(): void {
  const unknown = args.filter((a) => a.startsWith('--') && !KNOWN_FLAGS.includes(a.slice(2)));
  if (unknown.length === 0) return;
  process.stderr.write(`REFUSING: unknown flag(s) ${unknown.join(', ')}. Nothing was done.\n`);
  process.stderr.write(`  known: ${KNOWN_FLAGS.map((f) => `--${f}`).join(' ')}\n`);
  // A caller that asked for something this build cannot do must not be told it worked. If this
  // build is older than the caller, that IS the message.
  process.exit(2);
}

// ---------------------------------------------------------------------------
// Chore authoring — additive, and the only path that may touch a live chore list
// ---------------------------------------------------------------------------

/**
 * Why a JSON FILE, and not repeated CLI flags or a `.sql` file like `--household`.
 *
 * **Not flags.** A chore is ten fields. `--chore id:short:full:icon:cat:model:pts:kind:rrule`
 * is colon soup nobody can read back, there is no flag shape that expresses "retire this one",
 * and — the deciding one — a flag invocation is a transcript of an edit, not a thing you keep.
 * The paid list is explicitly meant to CHANGE over time (backlog item 2.4 (private notes)), so the input wants to
 * be a file an adult edits, diffs and re-runs, which is also what makes re-running it a no-op.
 *
 * **Not SQL.** `--household` and `--calendars` `exec` their file verbatim, which is fine for
 * files whose whole job is to define a shape from scratch. It is exactly wrong here: SQL cannot
 * be validated before it runs and it can `DELETE`, and a deleted chore orphans the `chore_day`,
 * `chore_assignment` and `ledger_entry` rows that record work a child actually did and was paid
 * for. This path therefore never deletes anything — retiring is `active = 0` — and every field
 * is checked before a transaction is opened. That matters more than style consistency because a
 * MIGRATED database has no CHECK constraint on `kind` or `due_by_local` at all (SQLite cannot
 * `ALTER TABLE ADD COLUMN` with a CHECK, see `migrate.ts`), so on the household's real database
 * the writer *is* the constraint.
 *
 * **JSON, not TOML**, only because `JSON.parse` ships with Node and TOML is a dependency.
 *
 *   {
 *     "chores": [
 *       {
 *         "id": "ch-dishes",
 *         "labelShort": "Dishes",              // 1..14 chars, schema-enforced
 *         "labelFull": "Empty the dishwasher",
 *         "iconAssetId": "ico-table",          // must already exist in `asset`
 *         "category": "kitchen",
 *         "assignmentModel": "individual",     // individual|shared|first_complete|rotation
 *         "basePoints": 5,
 *         "kind": "extra",                     // duty|extra
 *         "rrule": "FREQ=DAILY",
 *         "dueByLocal": "18:00",               // optional, "HH:MM" local, or null
 *         "rotation": ["child-a", "child-b"]   // optional; see below
 *       }
 *     ],
 *     "retire":  ["ch-old"],
 *     "restore": ["ch-back"]
 *   }
 *
 * Three verbs, deliberately separate. `chores` upserts a definition and never touches `active`;
 * `retire` sets `active = 0`; `restore` sets it back. Folding "active" into the record instead
 * would mean a re-run of a file that still lists a retired chore silently un-retires it, and
 * that a fat-fingered retirement is only undoable by hand-editing SQL — which is the gap this
 * whole path exists to close.
 *
 * It is ADDITIVE: only the ids the file names are touched. A chore absent from the file is left
 * exactly as it is, so a truncated file cannot empty the board.
 *
 * `rotation` is the rotation ORDER for a `rotation` chore, and doubles as a ROSTER for the other
 * models — `roster()` in `materialize.ts` prefers rotation members over "every active child", so
 * listing two children on a `shared` chore scopes it to those two. Omit it entirely to leave the
 * existing membership alone.
 *
 * The parser, validator and writer live in `src/domain/chores/authoring.ts` since 2026-09-14,
 * because the wall's "New chore" sheet is a second door onto the same rules. Re-exported here
 * so the tests and anyone who learned this path keep their imports.
 */
export {
  applyChores,
  choreAuthoringWarnings,
  historyFingerprint,
  parseChoreFile,
  validateChoreAuthoring,
  type ChoreAction,
  type ChoreAuthoring,
  type ChoreChange,
  type ChoreParseResult,
  type ChoreSpec,
} from '../../../src/domain/chores/authoring.ts';


function choreLine(db: Db, change: ChoreChange): string {
  const row = db
    .prepare('SELECT label_full, kind, base_points, due_by_local, rrule, active FROM chore WHERE id = ?')
    .get(change.id) as
    | {
        label_full: string;
        kind: string;
        base_points: number;
        due_by_local: string | null;
        rrule: string;
        active: number;
      }
    | undefined;
  if (row === undefined) return `  ${change.action.padEnd(15)} ${change.id}`;
  const points = `${String(row.base_points)}pt${row.base_points === 1 ? '' : 's'}`;
  return (
    `  ${change.action.padEnd(15)} ${change.id.padEnd(16)} ${row.kind.padEnd(5)} ` +
    `${points.padEnd(5)} ${row.active === 1 ? 'active ' : 'RETIRED'} ` +
    `${(row.due_by_local ?? '--:--').padEnd(5)} ${row.rrule.padEnd(22)} ${row.label_full}`
  );
}

/**
 * The door-tap report — evidence for backlog item 5.1 (private notes), printed so it reads as an argument.
 *
 * The raw table is not the useful artifact; the COMPARISON is. "The calendar was opened nine
 * times" says nothing on its own. Nine times while the picture is up against once while the
 * board is up is the case for a readout, and one against nine is the case against it. So the
 * summary comes first and the per-day table underneath it, which is the order somebody
 * deciding actually reads in.
 *
 * `reaches` leads and `taps` is parenthetical, because reaches is the number that survives a
 * three-year-old. See the module header on `doorTaps.ts`.
 */
function reportDoorTaps(db: Db, days: number): void {
  const since = addDays(localDate(), -days + 1);
  const rows = readDoorTaps(db, since);

  process.stdout.write(`\ndoor taps, last ${String(days)} days (since ${since})\n`);
  process.stdout.write('  Does the picture need an at-a-glance readout?  backlog item 5.1 (private notes)\n\n');

  if (rows.length === 0) {
    process.stdout.write('  nothing recorded yet.\n');
    // An empty table two weeks in is not a broken instrument, it is the answer gpt-5.5
    // predicted — but on the FIRST day it is indistinguishable from nothing being wired up,
    // and quietly reporting "no demand" would be the worst possible failure here.
    process.stdout.write('  On a wall that has been up for a while this IS the finding\n');
    process.stdout.write('  (option A: nobody reaches for it). On a fresh deploy it only means\n');
    process.stdout.write('  nobody has touched a door yet — check again after a normal day.\n');
    return;
  }

  const total = (target: DoorTarget, scene: boolean) =>
    rows
      .filter((r) => r.target === target && r.scene === scene)
      .reduce((acc, r) => ({ reaches: acc.reaches + r.minutes, taps: acc.taps + r.taps }), {
        reaches: 0,
        taps: 0,
      });

  // Pluralised because this is prose somebody reads while deciding, not a log line — and
  // padded as a whole segment, since "reach" and "reaches" are different widths.
  const said = (r: number, t: number) =>
    `${String(r).padStart(4)} reach${r === 1 ? '' : 'es'} (${String(t)} tap${t === 1 ? '' : 's'})`;
  for (const target of DOOR_TARGETS) {
    const up = total(target, true);
    const down = total(target, false);
    process.stdout.write(
      `  ${target.padEnd(10)} picture up: ${said(up.reaches, up.taps).padEnd(24)}` +
        `picture down: ${said(down.reaches, down.taps)}\n`,
    );
  }
  process.stdout.write(
    '\n  grown-ups is the CONTROL: if both doors are reached for equally often while the\n' +
      '  picture is up, that is people poking the wall, not people hunting for the calendar.\n',
  );

  process.stdout.write('\n  date        door       picture  reaches  taps\n');
  for (const r of rows) {
    process.stdout.write(
      `  ${r.localDate}  ${r.target.padEnd(10)} ${(r.scene ? 'up' : 'down').padEnd(7)} ` +
        `${String(r.minutes).padStart(7)} ${String(r.taps).padStart(5)}\n`,
    );
  }
  process.stdout.write(
    '\n  A reach is a distinct minute with at least one tap. A day where taps hugely\n' +
      '  exceeds reaches is a child drumming on the button, not demand — read reaches.\n',
  );
}

// ---------------------------------------------------------------------------
// Per-child settings — two columns, updated in place, never a household re-apply
// ---------------------------------------------------------------------------

/**
 * `--band child-c=fluent,child-b=fluent` and `--ledger child-c=on`.
 *
 * Changing how one child's screen reads used to mean re-applying `--household`, which refuses
 * once the ledger holds anything (it can delete children, and that cascades to their money), so
 * the only way through was `--force` — the flag whose whole purpose is "I mean to erase earned
 * money". A two-column change must never need that. This path UPDATEs `reading_band` and
 * `ledger_enabled` and nothing else, refuses an unknown child or value before it opens a
 * transaction, and writes every pair or none.
 *
 * Turning a ledger OFF hides the panel and pays 0 from then on; it deletes no entry, so a
 * balance already earned is still there when it is turned back on.
 */
export interface ChildSettings {
  bands: ReadonlyArray<readonly [string, ReadingBand]>;
  ledger: ReadonlyArray<readonly [string, boolean]>;
}

const BANDS: readonly ReadingBand[] = ['picture', 'emergent', 'fluent'];

function pairs(raw: string, what: string): Array<[string, string]> {
  return raw.split(',').filter((s) => s.length > 0).map((s) => {
    const i = s.indexOf('=');
    if (i <= 0 || i === s.length - 1) throw new Error(`--${what}: expected <child-id>=<value>, got "${s}"`);
    return [s.slice(0, i), s.slice(i + 1)];
  });
}

export function parseChildSettings(band: string | null, ledger: string | null): ChildSettings {
  const bands = band === null ? [] : pairs(band, 'band').map(([id, v]) => {
    if (!(BANDS as readonly string[]).includes(v)) {
      throw new Error(`--band: "${v}" is not a band (one of ${BANDS.join(', ')})`);
    }
    return [id, v as ReadingBand] as const;
  });
  const ledgerPairs = ledger === null ? [] : pairs(ledger, 'ledger').map(([id, v]) => {
    if (v !== 'on' && v !== 'off') throw new Error(`--ledger: "${v}" must be on or off`);
    return [id, v === 'on'] as const;
  });
  if (bands.length === 0 && ledgerPairs.length === 0) throw new Error('--band/--ledger: nothing to change');
  return { bands, ledger: ledgerPairs };
}

/** Returns one line per child whose settings actually changed. Throws before writing anything. */
export function applyChildSettings(db: Db, s: ChildSettings): string[] {
  const known = new Set((db.prepare('SELECT id FROM child').all() as Array<{ id: string }>).map((r) => r.id));
  for (const [id] of [...s.bands, ...s.ledger]) {
    if (!known.has(id)) throw new Error(`no child with id "${id}" (known: ${[...known].join(', ')})`);
  }
  const changed: string[] = [];
  inTransaction(db, () => {
    for (const [id, band] of s.bands) {
      const r = db.prepare('UPDATE child SET reading_band = ? WHERE id = ? AND reading_band <> ?').run(band, id, band);
      if (r.changes > 0) changed.push(`${id}: reading band -> ${band}`);
    }
    for (const [id, on] of s.ledger) {
      const v = on ? 1 : 0;
      const r = db.prepare('UPDATE child SET ledger_enabled = ? WHERE id = ? AND ledger_enabled <> ?').run(v, id, v);
      if (r.changes > 0) changed.push(`${id}: ledger ${on ? 'on' : 'off'}`);
    }
  });
  return changed;
}

/**
 * Where the served assets live: `WALL_ASSET_ROOT`, else `assets/` beside the database. The same
 * default as `main.ts`, so provisioning a dev database writes where the dev server reads. (It
 * used to default to `/data/assets`, the container's path, which on a dev box is EACCES.)
 */
export function assetRootFor(dbPath: string): string {
  const raw = process.env['WALL_ASSET_ROOT'];
  return resolve(raw === undefined || raw.length === 0 ? resolve(dirname(dbPath), 'assets') : raw);
}

async function main(): Promise<void> {
  refuseUnknownFlags();
  const explicitDb = flag('db') ?? process.env['WALL_DB'];
  const dbPath = explicitDb ?? 'dev.db';
  const db = openDatabase({ path: dbPath });
  migrate(db);
  const assetRoot = assetRootFor(dbPath);

  // ALWAYS, on every path, before anything else. Minting a token is silent about which database
  // received the hash, and the failure that causes is invisible: run this on the host instead of
  // inside the container and it succeeds, prints a perfectly good token, and writes to ./dev.db
  // while the wall reads /data/wall.db. The wall then 401s and looks like a revoked token.
  process.stdout.write(`database  : ${dbPath}\n`);
  if (explicitDb === undefined) {
    process.stderr.write(
      'WARNING: WALL_DB is unset and no --db was given, so this is ./dev.db — a local scratch\n' +
      '         database, NOT the wall\'s. If you meant to provision the wall, run it inside the\n' +
      '         container:  docker compose exec wall node --experimental-strip-types \\\n' +
      '                       stacks/wall/entry/provision.ts <args>\n',
    );
  }

  // The bundled art BEFORE any flag: `--household` references av-a/b/c, and on a database the
  // wall has never booted against those rows would not exist yet (a FOREIGN KEY failure).
  // Logged to stderr so stdout stays the flags' own output (a script parses --device's token).
  const artLog = (message: string): void => {
    process.stderr.write(`[provision] ${message}\n`);
  };
  mkdirSync(assetRoot, { recursive: true });
  seedAssets(resolve(REPO_ROOT, 'assets'), assetRoot, artLog);
  registerBaselineAssets(db, assetRoot, REPO_ROOT, artLog);

  const device = flag('device');
  const pin = flag('pin');
  const revoke = flag('revoke');
  const household = flag('household');
  const settings = flag('settings');
  const calendars = flag('calendars');
  const chores = flag('chores');
  const taps = flag('taps');
  const band = flag('band');
  const ledger = flag('ledger');
  const addScene = flag('add-scene');
  const addBackdrop = flag('add-backdrop');
  const sceneEvents = flag('scene-events');
  const wantsScenes = args.includes('--scenes');
  const wantsReset = args.includes('--reset-activity');
  const wantsList =
    args.includes('--list') ||
    (addScene === null &&
      addBackdrop === null &&
      sceneEvents === null &&
      !wantsScenes &&
      !wantsReset &&
      device === null &&
      pin === null &&
      revoke === null &&
      household === null &&
      settings === null &&
      calendars === null &&
      chores === null &&
      taps === null &&
      band === null &&
      ledger === null);

  /**
   * Applies the household's SETTINGS — zone, locale, currency, features, board windows, pets,
   * scenes — from the JSON file `src/config/household.ts` validates (2026-10-12).
   *
   * All or nothing: every error is printed and nothing is written, because a half-applied
   * settings file is a wall in one zone with another's board windows. `-` reads stdin, which is
   * how the gitignored file reaches a container that has no copy of it.
   *
   * Refused beside `--household`: `db/household.sql` and `db/household.json` are two different
   * files with one name between them, and a run that applies both is a run where somebody
   * meant one of them.
   */
  if (settings !== null) {
    if (household !== null) {
      process.stderr.write(
        'REFUSING: --settings and --household in one run. They are different files with the same\n' +
          'name (household.json is settings, household.sql is the roster); apply them one at a time.\n',
      );
      process.exit(2);
    }
    if (settings.length === 0) {
      process.stderr.write('--settings needs a path, e.g. --settings db/household.json (or - for stdin)\n');
      process.exit(2);
    }
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(settings === '-' ? 0 : settings, 'utf8'));
    } catch (err) {
      process.stderr.write(`${settings === '-' ? 'stdin' : settings}: not readable JSON (${err instanceof Error ? err.message : String(err)})\n`);
      process.exit(1);
    }
    const parsed = parseHousehold(raw);
    if (!parsed.ok) {
      for (const e of parsed.errors) process.stderr.write(`${e}\n`);
      process.stderr.write(`settings NOT applied: ${String(parsed.errors.length)} error(s). Nothing was written.\n`);
      process.exit(1);
    }
    writeHousehold(db, parsed.config);
    process.stdout.write(`settings applied: ${HOUSEHOLD_ROW_KEYS.join(', ')}\n`);
  }

  /**
   * Applies a household definition — children, routines, chores, countdowns, calendar sources.
   *
   * M1 shipped no way to create any of this. The admin surface only approves, rejects and
   * adjusts things that already exist, and `seed.dev.sql` is explicitly synthetic fixtures. So
   * on a real deploy the wall came up correct, authenticated, healthy and completely empty.
   * This is the missing seam, in the one script whose whole job is setup no route can perform.
   *
   * One transaction: a half-applied household is a wall showing some children's routines and
   * not others, which is worse than a wall showing none.
   */
  if (household !== null) {
    if (household.length === 0) {
      process.stderr.write('--household needs a path, e.g. --household db/household.sql\n');
      process.exit(2);
    }
    // A household file resets what it owns, and deleting a child cascades to their ledger.
    // That is harmless during setup and catastrophic afterwards: it erases money children have
    // actually earned, silently, with no undo. Guardrails are architectural, never a warning
    // comment somebody reads after the fact (CLAUDE.md) — so refuse, and make --force the
    // deliberate act it should be.
    const earned = db.prepare('SELECT COUNT(*) AS n FROM ledger_entry').get() as { n: number };
    if (earned.n > 0 && !args.includes('--force')) {
      process.stderr.write(
        `REFUSING: the ledger holds ${String(earned.n)} entr${earned.n === 1 ? 'y' : 'ies'}.\n` +
          'Applying a household file deletes children, which cascades to their balances.\n' +
          'If you mean to erase earned money, re-run with --force.\n' +
          'To change only the CHORE list, use --chores: it is additive and never deletes.\n',
      );
      process.exit(3);
    }
    const sql = readFileSync(household, 'utf8');
    inTransaction(db, () => {
      db.exec(sql);
    });
    const counts = ['child', 'routine', 'routine_step', 'chore', 'countdown', 'calendar_source']
      .map((t) => {
        const row = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number };
        return `${t}=${String(row.n)}`;
      })
      .join('  ');
    process.stdout.write(`household applied from ${household}\n`);
    process.stdout.write(`  ${counts}\n`);
  }

  /**
   * Applies the calendar wiring — which upstream calendars sync, and which of those render.
   *
   * Deliberately NOT part of `--household`, and the reason is a lifetime mismatch rather than
   * tidiness. A household file RESETS what it owns: it deletes children, which cascades to their
   * ledger. Calendar sources own sync history (`sync_run` -> `calendar_event`), and that history
   * is the schedule currently on the wall. Fused into one file, changing a chore would either
   * re-sync every calendar or be impossible without erasing balances.
   *
   * So this path is ADDITIVE and takes no `--force`: it upserts by id and deletes nothing, which
   * is why it needs no ledger guard. Flipping a calendar off leaves its promoted generation in
   * place and simply stops reading it — and flipping it back on renders again immediately,
   * before the next sweep, because the events were never thrown away.
   *
   * `external_ref` is passed through untouched. This script does not know what an entity id is
   * (ADR-0004); it moves opaque strings from a file into a column.
   */
  if (calendars !== null) {
    if (calendars.length === 0) {
      process.stderr.write('--calendars needs a path, e.g. --calendars db/calendars.sql\n');
      process.exit(2);
    }
    const sql = readFileSync(calendars, 'utf8');
    inTransaction(db, () => {
      db.exec(sql);
    });
    const rows = db
      .prepare(
        `SELECT id, label, included,
                (SELECT COUNT(*) FROM calendar_event ce
                  WHERE ce.sync_run_id = cs.current_sync_run_id) AS events
           FROM calendar_source cs ORDER BY included DESC, id`,
      )
      .all() as { id: string; label: string; included: number; events: number }[];
    process.stdout.write(`calendars applied from ${calendars}\n`);
    for (const r of rows) {
      // The promoted event count is the honest readout: `included = 1` only means it is
      // scheduled. A source that has never synced shows 0, which is what distinguishes "wired
      // up" from "working" — the distinction that made an empty wall look like a quiet week.
      const mark = r.included === 1 ? 'renders ' : 'excluded';
      process.stdout.write(
        `  ${mark}  ${r.id.padEnd(14)} ${r.label.padEnd(12)} ${String(r.events)} promoted events\n`,
      );
    }
    if (rows.every((r) => r.included !== 1)) {
      process.stderr.write(
        'WARNING: no source is included, so the wall renders no upcoming events at all.\n',
      );
    }
  }

  /**
   * Changes the chore list on a LIVE database, additively.
   *
   * The one path that may run against a household that has already earned money. It never
   * deletes and it never writes the ledger, so unlike `--household` it needs no `--force` and
   * no ledger guard — the guard is structural instead (`historyFingerprint`, checked either
   * side of the write inside the transaction, rolling the run back if anything moved).
   *
   * Nothing is written until the whole file has been validated, so a typo on the last chore
   * leaves the database exactly as it was.
   */
  if (chores !== null) {
    if (chores.length === 0) {
      process.stderr.write('--chores needs a path, e.g. --chores /tmp/chores.json\n');
      process.exit(2);
    }
    const parsed = parseChoreFile(readFileSync(chores, 'utf8'));
    if (!parsed.ok) {
      process.stderr.write(`REFUSING: ${chores} is not a valid chore file. Nothing was written.\n`);
      for (const e of parsed.errors) process.stderr.write(`  ${e}\n`);
      process.exit(2);
    }
    const invalid = validateChoreAuthoring(db, parsed.authoring);
    if (invalid.length > 0) {
      process.stderr.write(`REFUSING: ${chores} references rows that do not exist. Nothing was written.\n`);
      for (const e of invalid) process.stderr.write(`  ${e}\n`);
      process.exit(2);
    }
    const warnings = choreAuthoringWarnings(db, parsed.authoring);
    const changes = applyChores(db, parsed.authoring);
    process.stdout.write(`chores applied from ${chores}\n`);
    for (const change of changes) process.stdout.write(`${choreLine(db, change)}\n`);
    process.stdout.write(`  history untouched: ${historyFingerprint(db)}\n`);
    for (const w of warnings) process.stderr.write(`WARNING: ${w}\n`);
    // Writing straight into the database bypasses the app's SSE invalidation, exactly as
    // `--household` does. Say so rather than leaving an adult wondering why the wall disagrees.
    if (changes.some((c) => c.action !== 'unchanged')) {
      process.stdout.write(
        '  the wall keeps its current snapshot until the next date boundary; restart the kiosk\n' +
          '  to see this now:  ssh wall-pi \'systemctl --user restart kiosk.service\'\n',
      );
    }
  }

  if (device !== null) {
    if (device.length === 0) {
      process.stderr.write('--device needs a label, e.g. --device "living room wall"\n');
      process.exit(2);
    }
    const issued = issueDeviceToken(db, device);
    process.stdout.write(`device id : ${issued.id}\n`);
    process.stdout.write(`label     : ${issued.label}\n`);
    process.stdout.write(`token     : ${issued.token}\n`);
    process.stdout.write('\nPut this on the Pi, once:\n');
    process.stdout.write(`  ssh wall-pi "sed -i 's|^WALL_DEVICE_TOKEN=.*|WALL_DEVICE_TOKEN=${issued.token}|' ~/.config/kiosk.env"\n`);
    process.stdout.write('  ssh wall-pi "systemctl --user restart kiosk-gate.service kiosk.service"\n');
    process.stdout.write('\nIt is not recoverable after this line scrolls away.\n');
  }

  if (revoke !== null && revoke.length > 0) {
    process.stdout.write(revokeDevice(db, revoke) ? `revoked ${revoke}\n` : `no active device ${revoke}\n`);
  }

  if (pin !== null) {
    if (pin.length < 4) {
      process.stderr.write('--pin must be at least 4 characters\n');
      process.exit(2);
    }
    await setParentPin(db, pin);
    process.stdout.write('parent PIN set\n');
  }

  if (taps !== null) {
    // `--taps` with no number is the common case; 14 days is the window both reviewers framed
    // the question in ("near-zero over two weeks").
    const parsed = taps.length === 0 ? 14 : Number(taps);
    if (!Number.isInteger(parsed) || parsed < 1 || parsed > 365) {
      process.stderr.write('--taps takes a whole number of days from 1 to 365, e.g. --taps 14\n');
      process.exit(2);
    }
    reportDoorTaps(db, parsed);
  }

  /**
   * Registers a freshly generated scene as a CANDIDATE.
   *
   * This is how the weekly run (`tools/scene-week.py`) tells the wall a new picture exists.
   * Candidate and not approved, always and without a flag to say otherwise: a picture nobody
   * has looked at must never reach a wall three children navigate BY that picture. The
   * generator's own checks are about geometry and identity, not about whether the household
   * wants to look at it for a week.
   *
   * Insert-if-absent, so re-running the weekly script is safe and cannot un-decide a scene an
   * adult has already approved or retired.
   */
  if (addScene !== null) {
    if (addScene.length === 0) {
      process.stderr.write('--add-scene needs an id, e.g. --add-scene w37-cozy-painted\n');
      process.exit(2);
    }
    // Refuse a row for a picture that is not there. A candidate whose file is missing is
    // invisible until somebody approves it, and then it silently does nothing — `activeScene`
    // skips it — which reads as "approving is broken" rather than "the file never arrived".
    const missing = ['jpg', 'json']
      .map((ext) => `${assetRoot}/scenes/${addScene}.${ext}`)
      .filter((f) => !existsSync(f));
    if (missing.length > 0) {
      process.stderr.write(`REFUSING: no such scene files. Nothing was written.\n`);
      for (const f of missing) process.stderr.write(`  missing ${f}\n`);
      process.exit(2);
    }
    if (readSceneManifest(assetRoot, addScene) === null) {
      process.stderr.write(
        `REFUSING: ${addScene}.json has no usable tap region. Nothing was written.\n` +
          '  On the picture the picture IS the navigation, so a scene with no doors is a dead\n' +
          '  end that looks like a working screen. Re-run tools/scene-regions.py.\n',
      );
      process.exit(2);
    }
    const outcome = registerScene(db, {
      id: addScene,
      relPath: `scenes/${addScene}.jpg`,
      state: 'candidate',
      source: 'generated',
      styleId: flag('style'),
      nowUtc: new Date().toISOString() as Utc,
    });
    process.stdout.write(`scene ${addScene}: ${outcome} (candidate)\n`);
    if (outcome === 'inserted') {
      process.stdout.write('  it is NOT on the wall. Approve it from the grown-up screen.\n');
    }
  }

  /**
   * Puts a household's own still picture up as the wall's picture (2026-10-12).
   *
   * A BACKDROP is a scene with no tap targets: the manifest says `"static": true` and
   * `regions: []`, the rail's avatars do the navigating, and "the children navigate by the
   * picture" does not apply to it — which is why, unlike `--add-scene`, it needs no finder and
   * no review and goes straight to `approved`. Approving is selecting, so it is on the wall at
   * once; choosing any other picture from the grown-up screen takes it down again.
   *
   * The file is COPIED into the volume (`<assetRoot>/scenes/<id>.<ext>`), never referenced
   * where it lies, so the household's photo folder can move without blanking the wall. Refused,
   * with nothing written, for anything over 4 MB or not a JPEG/PNG: the panel draws it at
   * 960x540 logical pixels, and a 20 MB camera original is a slow first paint at 6:00 AM.
   */
  if (addBackdrop !== null) {
    const refuse = (why: string): never => {
      process.stderr.write(`REFUSING: ${why}. Nothing was written.\n`);
      process.exit(2);
    };
    if (addBackdrop.length === 0) refuse('--add-backdrop needs a picture, e.g. --add-backdrop ~/porch.jpg');
    const ext = extname(addBackdrop).toLowerCase();
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) refuse(`${basename(addBackdrop)} is not a .jpg, .jpeg or .png`);
    if (!existsSync(addBackdrop) || !statSync(addBackdrop).isFile()) refuse(`no such file ${addBackdrop}`);
    const size = statSync(addBackdrop).size;
    if (size > BACKDROP_MAX_BYTES) {
      refuse(`${basename(addBackdrop)} is ${(size / 1024 / 1024).toFixed(1)} MB; a backdrop may be at most 4 MB`);
    }
    const id = flag('id') ?? backdropSlug(addBackdrop);
    if (!BACKDROP_ID_RE.test(id)) refuse(`--id ${JSON.stringify(id)} must be lowercase letters, digits and dashes`);
    const existing = listScenes(db).find((row) => row.id === id);
    if (existing !== undefined && existing.source === 'generated') {
      refuse(`${id} is a generated scene; pick another --id`);
    }
    // The committed floor is re-seeded from the repo on every boot, so overwriting its files in
    // the volume would be undone silently. A household backdrop needs an id of its own.
    if (existsSync(join(REPO_SCENES, `${id}.json`))) refuse(`${id} is committed house art; pick another --id`);

    const relPath = `scenes/${id}${ext === '.png' ? '.png' : '.jpg'}`;
    mkdirSync(join(assetRoot, 'scenes'), { recursive: true });
    copyFileSync(addBackdrop, join(assetRoot, relPath));
    writeFileSync(
      join(assetRoot, 'scenes', `${id}.json`),
      `${JSON.stringify({ id, image: relPath, static: true, regions: [] }, null, 2)}\n`,
    );
    const nowUtc = new Date().toISOString() as Utc;
    const outcome = registerScene(db, { id, relPath, state: 'approved', source: 'baseline', nowUtc });
    approveScene(db, id, nowUtc);
    process.stdout.write(`backdrop ${id}: ${outcome} (approved) -> ${relPath}\n`);
    process.stdout.write('  it is on the wall now. Choose another picture from the grown-up screen to take it down.\n');
  }

  /**
   * Past decisions, replayed into `scene_decision` (v11, 2026-10-18).
   *
   * The log starts on the day it was added; before that `approveScene` overwrote every earlier
   * approval in place, so the only record of them is the nightly backups — each one a snapshot
   * of every scene's LATEST decision. The union of those snapshots is most of the history, and
   * this is how it gets in: a JSON array of `{ sceneId, kind, atUtc }`, insert-if-absent, so
   * running it twice adds nothing. A scene id the library does not know is skipped and said,
   * never invented: a decision about a picture that is not in the catalog is not history.
   */
  if (sceneEvents !== null) {
    const refuse = (why: string): never => {
      process.stderr.write(`${why}\n`);
      process.exit(2);
    };
    if (sceneEvents.length === 0) refuse('--scene-events needs a path, e.g. --scene-events events.json (or - for stdin)');
    let raw: unknown;
    try {
      raw = JSON.parse(readFileSync(sceneEvents === '-' ? 0 : sceneEvents, 'utf8'));
    } catch (err) {
      refuse(`--scene-events: not readable JSON (${err instanceof Error ? err.message : String(err)})`);
    }
    if (!Array.isArray(raw)) refuse('--scene-events: expected a JSON array of { sceneId, kind, atUtc }');
    const known = new Set(listScenes(db).map((r) => r.id));
    const bad: string[] = [];
    const events: { sceneId: string; kind: 'approved' | 'retired'; atUtc: string }[] = [];
    (raw as unknown[]).forEach((e, i) => {
      const q = (typeof e === 'object' && e !== null ? e : {}) as Record<string, unknown>;
      const { sceneId, kind, atUtc } = q;
      if (
        typeof sceneId !== 'string' ||
        (kind !== 'approved' && kind !== 'retired') ||
        typeof atUtc !== 'string' ||
        !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(atUtc)
      ) {
        bad.push(`  [${String(i)}] needs sceneId, kind approved|retired, and an ISO atUtc ending in Z`);
        return;
      }
      events.push({ sceneId, kind, atUtc });
    });
    if (bad.length > 0) {
      for (const b of bad) process.stderr.write(`${b}\n`);
      refuse(`--scene-events: ${String(bad.length)} malformed event(s). Nothing was written.`);
    }
    let added = 0;
    let present = 0;
    const unknown = new Set<string>();
    inTransaction(db, () => {
      for (const e of events) {
        if (!known.has(e.sceneId)) unknown.add(e.sceneId);
        else if (logSceneDecision(db, e.sceneId, e.kind, e.atUtc)) added += 1;
        else present += 1;
      }
    });
    process.stdout.write(`scene events: ${String(added)} added, ${String(present)} already known\n`);
    for (const id of unknown) process.stdout.write(`  skipped ${id}: not in the library\n`);
  }

  if (wantsScenes) {
    const active = activeScene(db, assetRoot);
    const history = sceneHistory(db, new Date().toISOString() as Utc);
    process.stdout.write(`on the wall: ${active?.id ?? 'NONE — the information board'}\n`);
    for (const row of listScenes(db)) {
      const regions = readSceneManifest(assetRoot, row.id);
      const mark = row.id === active?.id ? '->' : '  ';
      const health = regions === null ? 'NO USABLE REGIONS' : `${String(regions.length)} regions`;
      process.stdout.write(
        `${mark} ${row.id.padEnd(28)} ${row.state.padEnd(10)} ${row.source.padEnd(10)} ${health}\n`,
      );
    }
    // The favourites: time as the chosen picture, longest first. Not time looked at — the
    // dark screen at night is inside it, for every picture alike.
    const ranked = [...history].filter(([, h]) => h.upMs > 0).sort((a, b) => b[1].upMs - a[1].upMs);
    if (ranked.length > 0) {
      process.stdout.write('longest up (time as the chosen picture):\n');
      for (const [id, h] of ranked) {
        const days = (h.upMs / 86_400_000).toFixed(1);
        process.stdout.write(`   ${id.padEnd(48)} ${days.padStart(6)} days  chosen ${String(h.timesChosen)}x\n`);
      }
    }
  }

  /**
   * Wipes what the wall has DONE, and keeps what it IS.
   *
   * Asked for 2026-09-09: *"wipe all chores, the calendar is not in use yet, I need to test
   * these components and give feedback from actual use by me before kids."* Fifteen days of
   * board history had accumulated from a period nobody was really using it — 130 assignments,
   * 26 routine runs, and a door-tap instrument whose only rows were an agent's own
   * verification clicks. All of that is noise across the signal an operator is about to
   * generate on purpose, and none of it can be told apart from real use afterwards.
   *
   * SETUP SURVIVES, USE DOES NOT. Chores, routines, children, countdowns and calendar sources
   * are untouched — the point is to test them, so deleting them would defeat the exercise.
   * What goes is every record of the wall being used: the materialized days and their claims,
   * the routine runs, any redemption requests, and the door-tap counters.
   *
   * ## Why it refuses when the ledger has rows
   *
   * `ledger_entry.ref_id` is TEXT with NO foreign key — deliberately, because the ledger is
   * append-only and must outlive the thing it refers to. The consequence is that nothing in
   * the database stops this from deleting the assignments the ledger points at, leaving rows
   * that say a child was paid for a chore that no longer exists. The ledger is the only record
   * of real money on this wall, so the guard is here rather than in the schema, and `--force`
   * is the deliberate way past it.
   *
   * Idempotent, and safe to run repeatedly through a testing week: today's board rebuilds on
   * the next snapshot because materialization is a pure function of the definitions and the
   * date.
   */
  if (wantsReset) {
    const count = (table: string): number =>
      (db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

    const earned = count('ledger_entry');
    if (earned > 0 && !args.includes('--force')) {
      process.stderr.write(
        `REFUSING: the ledger has ${String(earned)} entries — real money a child has earned.\n` +
          '  Wiping the board would leave those rows referring to chores that no longer exist.\n' +
          '  If you mean to do it anyway, re-run with --force.\n',
      );
      process.exit(2);
    }

    // Ordered by dependency even though the FKs cascade, so the numbers reported are the
    // numbers actually deleted rather than whatever a cascade happened to take with it.
    const before = {
      choreDays: count('chore_day'),
      claims: count('chore_assignment'),
      routineRuns: count('routine_run'),
      routineSteps: count('routine_run_step'),
      redemptions: count('redemption_request'),
      doorTaps: count('door_tap'),
    };
    inTransaction(db, () => {
      // chore_assignment cascades from chore_day; routine_run_step and its completions
      // cascade from routine_run. Both are declared ON DELETE CASCADE in the schema.
      db.prepare('DELETE FROM chore_day').run();
      db.prepare('DELETE FROM routine_run').run();
      db.prepare('DELETE FROM redemption_request').run();
      db.prepare('DELETE FROM door_tap').run();
      if (earned > 0) db.prepare('DELETE FROM ledger_entry').run();
    });

    process.stdout.write('activity wiped — the wall keeps its setup and forgets its use\n');
    process.stdout.write(`  chore days       ${String(before.choreDays)}\n`);
    process.stdout.write(`  claims           ${String(before.claims)}\n`);
    process.stdout.write(`  routine runs     ${String(before.routineRuns)} (${String(before.routineSteps)} steps)\n`);
    process.stdout.write(`  redemptions      ${String(before.redemptions)}\n`);
    process.stdout.write(`  door taps        ${String(before.doorTaps)}\n`);
    if (earned > 0) process.stdout.write(`  LEDGER ENTRIES   ${String(earned)}  (--force)\n`);
    process.stdout.write(
      `\n  kept: ${String(count('chore'))} chores, ${String(count('routine_step'))} routine steps, ` +
        `${String(count('child'))} children, ${String(count('countdown'))} countdowns\n`,
    );
    process.stdout.write(
      "  today's board rebuilds on the next snapshot; restart the kiosk to see it now:\n" +
        "    ssh wall-pi 'systemctl --user restart kiosk.service'\n",
    );
  }

  if (band !== null || ledger !== null) {
    let changed: string[];
    try {
      changed = applyChildSettings(db, parseChildSettings(band, ledger));
    } catch (e) {
      process.stderr.write(`REFUSING: ${(e as Error).message}. Nothing was changed.\n`);
      process.exit(2);
    }
    process.stdout.write(changed.length === 0 ? 'children: already as asked, nothing changed\n' : `${changed.join('\n')}\n`);
    process.stdout.write("  the wall picks this up on its next snapshot; restart the kiosk to see it now:\n" +
      "    ssh wall-pi 'systemctl --user restart kiosk.service'\n");
  }

  // The committed scenes AFTER every flag, so a household just applied is the roster a drawn
  // baseline is judged against (registerBaselineScenes: an undecided baseline that now fits is
  // approved; nothing an adult decided is touched).
  registerCommittedScenes(db, REPO_ROOT, artLog);

  if (wantsList) {
    const devices = listDevices(db);
    process.stdout.write(`parent PIN: ${parentPinIsSet(db) ? 'set' : 'NOT SET — nothing can be approved'}\n`);
    if (devices.length === 0) {
      process.stdout.write('devices   : none — the wall will render the offline card\n');
    } else {
      for (const d of devices) {
        process.stdout.write(`device    : ${d.id}  ${d.revoked ? '[revoked]' : '[active] '}  ${d.label}\n`);
      }
    }
  }

  db.close();
}

// Run only as the entry point, so the exports above can be imported by a test without the CLI
// opening ./dev.db and printing a device list into the test output.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
