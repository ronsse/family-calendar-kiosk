/**
 * Unit H — the scene library. Which pictures exist, and which one is on the wall.
 *
 * The picture behind every screen used to be chosen by taking the first element of a
 * committed array in the frontend bundle. That made the answer to "put a new picture up" a
 * code edit and a redeploy, which is the whole reason the weekly cadence never happened —
 * the generator could produce a scene at 2am and had no way to make it visible.
 *
 * ## The split, and why the manifest keeps the geometry
 *
 * A scene is three things and they are owned in three places:
 *
 *   - the **picture**, `scenes/<id>.jpg` in the asset volume;
 *   - the **tap regions**, `scenes/<id>.json`, written by `tools/scene-regions.py`, which
 *     refuses to emit one at all unless every child clears the tap floor, the height floor,
 *     the gutter and the facing rule;
 *   - the **library state** — candidate, approved, retired — which is this table.
 *
 * Regions are NOT copied into SQLite. The region finder's refusals are the safety property
 * that keeps a dead-end screen off the wall, and a second copy of the rectangles would be
 * free to disagree with the copy those refusals were computed against. One source of truth
 * for geometry, and it is the file the tool wrote.
 *
 * ## Approval is also selection, deliberately
 *
 * `activeScene` is the approved scene with the newest `decided_at_utc`. There is no separate
 * "pinned" flag, because approving an old scene again already means exactly "put that one
 * up": one mechanism, and "go back to the one from three weeks ago" needs no new concept.
 * The cost is that approval carries two meanings at once — admit to the pool, and promote —
 * and that is the trade taken, because the alternative is two buttons that a parent has to
 * hold apart at a wall-mounted panel.
 *
 * ## Nothing here decides that a picture is SAFE to show
 *
 * A row in this table says a human said yes. It does not say the file is on disk or that the
 * manifest parses — `readSceneManifest` answers that, and the caller drops a scene that fails
 * it. Keeping those apart is what lets an approved-but-broken scene fall through to the next
 * approved one instead of putting a picture with no doors on the wall. On the scene screen the
 * navigation rail is hidden because the picture IS the navigation, so a scene with no usable
 * region is not a degraded screen, it is a dead end that looks like a working one.
 */

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Database as Db } from 'better-sqlite3';
import { readHousehold } from '../../config/household.ts';
import { listActiveChildren } from '../../db/repo.ts';
import type { SceneBox, SceneRegion, SceneState, Utc, WallScene } from '../../types.ts';

export interface SceneRow {
  readonly id: string;
  readonly relPath: string;
  readonly state: SceneState;
  readonly source: 'baseline' | 'generated';
  readonly styleId: string | null;
  readonly createdAtUtc: Utc;
  readonly decidedAtUtc: Utc | null;
}

interface RawRow {
  id: string;
  rel_path: string;
  state: SceneState;
  source: 'baseline' | 'generated';
  style_id: string | null;
  created_at_utc: string;
  decided_at_utc: string | null;
}

const toRow = (r: RawRow): SceneRow => ({
  id: r.id,
  relPath: r.rel_path,
  state: r.state,
  source: r.source,
  styleId: r.style_id,
  createdAtUtc: r.created_at_utc as Utc,
  decidedAtUtc: r.decided_at_utc as Utc | null,
});

/**
 * The whole catalog, newest first.
 *
 * Ordered by arrival rather than by state so the grown-up surface reads as a history — what
 * was generated, in the order it was generated, with what happened to it — rather than as
 * three separate lists that have to be mentally reassembled into one.
 */
export function listScenes(db: Db): SceneRow[] {
  const rows = db
    .prepare(
      `SELECT id, rel_path, state, source, style_id, created_at_utc, decided_at_utc
         FROM scene ORDER BY created_at_utc DESC, id DESC`,
    )
    .all() as RawRow[];
  return rows.map(toRow);
}

/** Approved scenes, most recently decided first — the order `activeScene` falls through. */
export function approvedScenes(db: Db): SceneRow[] {
  const rows = db
    .prepare(
      `SELECT id, rel_path, state, source, style_id, created_at_utc, decided_at_utc
         FROM scene WHERE state = 'approved'
        ORDER BY decided_at_utc DESC, id DESC`,
    )
    .all() as RawRow[];
  return rows.map(toRow);
}

/**
 * Register a scene, or update the file a known id points at.
 *
 * Insert-if-absent on the STATE: re-registering never resurrects something a parent retired,
 * and never silently re-approves. `registerBaselineScenes` runs on every boot, so without that
 * rule a scene taken off the wall would come back on the next restart — a decision undone by a
 * deploy, which is the kind of thing nobody connects to the deploy.
 */
export function registerScene(
  db: Db,
  scene: {
    id: string;
    relPath: string;
    state: SceneState;
    source: 'baseline' | 'generated';
    styleId?: string | null;
    nowUtc: Utc;
  },
): 'inserted' | 'unchanged' | 'relocated' {
  const inserted = db
    .prepare(
      `INSERT INTO scene (id, rel_path, state, source, style_id, created_at_utc, decided_at_utc)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO NOTHING`,
    )
    .run(
      scene.id,
      scene.relPath,
      scene.state,
      scene.source,
      scene.styleId ?? null,
      scene.nowUtc,
      scene.state === 'candidate' ? null : scene.nowUtc,
    ).changes;
  if (inserted > 0) return 'inserted';
  // A committed scene whose FILE moved is followed, the same way registerBaselineAssets
  // follows a relocated asset. Nothing else about an existing row is touched.
  const moved = db
    .prepare(`UPDATE scene SET rel_path = ? WHERE id = ? AND rel_path <> ?`)
    .run(scene.relPath, scene.id, scene.relPath).changes;
  return moved > 0 ? 'relocated' : 'unchanged';
}

/**
 * Approve a scene, which also puts it on the wall.
 *
 * `decided_at_utc` is rewritten on every approval, including one that is already approved —
 * that is not a no-op, it is the mechanism by which "show that one again" works.
 */
export function approveScene(db: Db, id: string, nowUtc: Utc): boolean {
  return (
    db
      .prepare(`UPDATE scene SET state = 'approved', decided_at_utc = ? WHERE id = ?`)
      .run(nowUtc, id).changes > 0
  );
}

/** Take a scene out of service. The row stays: the catalog is a history, not a live set. */
export function retireScene(db: Db, id: string, nowUtc: Utc): boolean {
  return (
    db
      .prepare(`UPDATE scene SET state = 'retired', decided_at_utc = ? WHERE id = ?`)
      .run(nowUtc, id).changes > 0
  );
}

// ---------------------------------------------------------------------------
// Manifests, and choosing what actually goes up
// ---------------------------------------------------------------------------

/** Shape of `scenes/<id>.json` as `tools/scene-regions.py` writes it. */
interface RawManifest {
  id?: unknown;
  /** Asset-root-relative path of the picture. Read only when a baseline is registered. */
  image?: unknown;
  regions?: unknown;
  /**
   * `true` marks a BACKDROP: a picture with no tap targets on purpose. Only this
   * flag lets `regions: []` through — see `readSceneManifest`.
   */
  static?: unknown;
  /** Where the dog is hiding. Absent on a manifest written before the field existed. */
  dog?: unknown;
}

/** The parsed file, or `null` for anything unreadable, unparseable or not an object. */
function loadManifest(assetRoot: string, id: string): RawManifest | null {
  return loadManifestFile(join(assetRoot, 'scenes', `${id}.json`));
}

function loadManifestFile(path: string): RawManifest | null {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
  if (typeof raw !== 'object' || raw === null) return null;
  return raw as RawManifest;
}

const isFraction = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 1;

/**
 * The usable regions of `scenes/<id>.json`, or `null` if there are none.
 *
 * One exception, and it is opt-in per file: a manifest that says `"static": true` is a
 * BACKDROP — a picture with no tap targets on purpose (a household's own photo, or the
 * committed figure-free floor) — and its regions are returned even when there are none, so
 * `[]` means "usable, no doors". Without the flag the old rule stands untouched: an empty or
 * all-malformed region list is a generated scene the finder failed on, and that is a dead end.
 * On a backdrop the rail does the navigating, so it is not one.
 *
 * Total by construction: anything unreadable, unparseable or malformed is `null`, and one bad
 * rectangle drops that rectangle rather than the scene — the other two children can still find
 * themselves. This mirrors `web/src/views/logic/scenes.ts` deliberately; the client keeps its
 * own copy because it must still degrade correctly for whatever it is handed, and a client that
 * trusted the server here would render a dead end the moment a file changed underneath it.
 */
export function readSceneManifest(assetRoot: string, id: string): SceneRegion[] | null {
  return manifestRegions(loadManifest(assetRoot, id));
}

function manifestRegions(raw: RawManifest | null): SceneRegion[] | null {
  if (raw === null || !Array.isArray(raw.regions)) return null;
  const regions: SceneRegion[] = [];
  for (const r of raw.regions) {
    if (typeof r !== 'object' || r === null) continue;
    const q = r as Record<string, unknown>;
    if (typeof q['slot'] !== 'number' || !Number.isInteger(q['slot'])) continue;
    if (!isFraction(q['x']) || !isFraction(q['y']) || !isFraction(q['w']) || !isFraction(q['h'])) {
      continue;
    }
    // The head crop is optional everywhere and drops on its own: a malformed one costs the
    // rail its picture-face and nothing else, because the tap box above is what makes the
    // scene usable.
    regions.push({ slot: q['slot'], x: q['x'], y: q['y'], w: q['w'], h: q['h'], head: box(q['head']) });
  }
  if (raw.static === true) return regions;
  return regions.length > 0 ? regions : null;
}

/**
 * The dog's box in `scenes/<id>.json`, or `null` when the manifest has none or it is
 * malformed.  Never decides whether a scene is usable — that is the children's regions'
 * job — so a manifest written before the dog existed, or a picture where the finder could
 * not see him, is simply a scene with no Easter egg.
 */
export function readSceneDog(assetRoot: string, id: string): SceneBox | null {
  const raw = loadManifest(assetRoot, id);
  return raw === null ? null : box(raw.dog);
}

/** One rectangle in fractions, or `null` for anything that is not four sane fractions. */
function box(value: unknown): SceneBox | null {
  if (typeof value !== 'object' || value === null) return null;
  const q = value as Record<string, unknown>;
  if (!isFraction(q['x']) || !isFraction(q['y']) || !isFraction(q['w']) || !isFraction(q['h'])) {
    return null;
  }
  return { x: q['x'], y: q['y'], w: q['w'], h: q['h'] };
}

/**
 * The picture to put on the wall, or `null` when there is not a usable one.
 *
 * Falls THROUGH: the newest approved scene whose picture is on disk and whose manifest yields
 * at least one region. An approved scene that lost its file costs itself and not the feature,
 * which is the property that lets the volume be restored, migrated, or half-populated without
 * the wall going picture-less.
 *
 * `null` is a real answer and the caller must handle it. The honest response to "every picture
 * we have is broken" is the information board — the screen the 6:00 AM invariant is actually
 * about — not a scene we know is a dead end.
 */
export function activeScene(db: Db, assetRoot: string): WallScene | null {
  // `scenes.mode = off` is a household that wants the information board and no picture at all.
  // It is checked here, not at approval time, so turning it back on restores the library as it
  // was — nothing is retired by a setting.
  if (readHousehold(db).scenes.mode === 'off') return null;
  for (const row of approvedScenes(db)) {
    if (!existsSync(join(assetRoot, row.relPath))) continue;
    const regions = readSceneManifest(assetRoot, row.id);
    if (regions === null) continue;
    return {
      id: row.id,
      // Encoded because this ends up inside a CSS `url("…")`. A quote in a hand-edited
      // manifest would close the declaration early, and the damage does not look like damage:
      // the rule is dropped, the picture is a blank rectangle, and the taps over it still work.
      image: encodeURI(`/${row.relPath.replace(/^\/+/, '')}`),
      regions,
      dog: readSceneDog(assetRoot, row.id),
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The committed set, which is the floor
// ---------------------------------------------------------------------------
//
// Something committed under `assets/scenes/` must always be approvable, or a fresh database
// has no picture at all and the "never blank at 6:00 AM" floor goes with it: the generated
// library lives only in the volume and is exactly as durable as its backup. `backdrop` is the
// floor that fits every household, because it is static and draws no one. Any other committed
// scene drew a fixed number of children and goes up only where that many children live.

/**
 * The instant the baseline scenes are treated as having been approved.
 *
 * Deliberately in the past and deliberately fixed, so that ANY approval a household makes is
 * newer and therefore wins. A baseline registered at boot with `now` would jump ahead of a
 * scene a parent approved last week every time the container restarted — a decision quietly
 * undone by a deploy, which is the class of bug nobody ever traces back to the deploy.
 */
const BASELINE_EPOCH_MS = Date.parse('2026-09-08T00:00:00Z');

/** How `registerBaselineScenes` reports a baseline it registered but would not approve. */
const defaultBaselineLog = (message: string): void => {
  process.stdout.write(`[wall] ${message}\n`);
};

/**
 * Puts every committed scene in the library, on every boot — `approved` when it fits this
 * household, `candidate` when it does not.
 *
 * "Fits": a picture with tap targets drew a fixed number of children, and it is
 * approved only when the household has exactly that many active children. A three-child
 * picture on a two-child wall would hand one child a door that is somebody else's face, and on
 * a no-child wall it is three strangers. Such a scene is still registered, as a `candidate`,
 * and the boot log says why. A STATIC manifest (`"static": true` — a backdrop, no children in
 * it) fits every household and is approved regardless.
 *
 * The child count is read when the row is first inserted, and once more on every later run for
 * exactly one kind of row: a drawn baseline that is still an UNDECIDED candidate (`source =
 * 'baseline'`, `state = 'candidate'`, `decided_at_utc IS NULL`). If its tap targets now match
 * the active children, it is approved — stamped with the same baseline stamp it would have had
 * at first insert, so it still ranks below anything an adult has ever approved. That is what
 * makes the order of the first two commands free: the wall started on an empty roster, then
 * provisioned with three children, puts the three-child picture up on its next run, exactly as
 * provisioning first would have. Nothing else is ever changed: a row an adult decided (its
 * `decided_at_utc` is set), one that is approved or retired, and every `generated` row are left
 * byte-identical, so on a live wall whose baseline is already approved this does nothing.
 *
 * This is what makes the table safe to depend on. `sceneCatalog.ts` argued against a runtime
 * index on the grounds that losing it loses every picture at once, silently, because the wall's
 * honest answer to an empty pool is a screen that looks completely fine. The answer is not to
 * refuse a library — it is to keep the shipped set as the floor. Drop the table, restore a
 * three-month-old volume, start from an empty database: the committed pictures come back.
 *
 * Insert-if-absent on state, so this never resurrects a scene a parent retired and never
 * re-approves one they took down. `scenesDir` is the REPO's `assets/scenes`, not the volume's:
 * the question being answered is "what shipped in this image", and the volume also holds
 * generated scenes, which are not baseline and must not be auto-approved.
 */
export function registerBaselineScenes(
  db: Db,
  scenesDir: string,
  listDir: (dir: string) => string[],
  log: (message: string) => void = defaultBaselineLog,
): number {
  const ids = listDir(scenesDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.slice(0, -'.json'.length));

  // Ranking, oldest first: every STATIC manifest (a backdrop: no children drawn, no tap
  // targets) ranks below every committed scene that has tap targets, and ties go by id so the
  // result is stable rather than dependent on the order the filesystem returned. A backdrop
  // fits every household, so it is the floor under the floor: it shows only when nothing
  // drawn for the children is usable. The rule reads the manifests, not a list of ids, so the
  // code names no scene and dropping a picture and its manifest into the repo is enough.
  const manifests = new Map(ids.map((id) => [id, loadManifestFile(join(scenesDir, `${id}.json`))]));
  const isStatic = (id: string): number => (manifests.get(id)?.static === true ? 0 : 1);
  const ordered = [...ids].sort((a, b) => isStatic(a) - isStatic(b) || (a < b ? -1 : a > b ? 1 : 0));

  const children = listActiveChildren(db).length;
  let inserted = 0;
  const present = db.prepare(`SELECT 1 FROM scene WHERE id = ?`);
  const insert = db.prepare(
    `INSERT INTO scene (id, rel_path, state, source, style_id, created_at_utc, decided_at_utc)
     VALUES (?, ?, ?, 'baseline', NULL, ?, ?)
     ON CONFLICT(id) DO NOTHING`,
  );
  ordered.forEach((id, i) => {
    // One second apart, so the ordering survives a sort on the column rather than depending on
    // the tiebreak. All in the past — see BASELINE_EPOCH_MS. Counted back FROM the epoch, so
    // the newest-ranked baseline sits exactly on it and everything ranked below it is strictly
    // older: a floor added under an existing one can never tie with, let alone outrank, it.
    // Rows are insert-if-absent, so a database that already has its baselines keeps the stamps
    // it was given; this ordering only decides anything on a database seeing a scene first.
    const at = new Date(BASELINE_EPOCH_MS + (i - (ordered.length - 1)) * 1000).toISOString();
    if (present.get(id) !== undefined) return;

    const raw = manifests.get(id) ?? null;
    const regions = manifestRegions(raw);
    const fits = regions !== null && (raw?.static === true || regions.length === children);
    if (!fits) {
      log(
        regions === null
          ? `baseline scene ${id} has no usable manifest: registered, not approved`
          : `baseline scene ${id} needs ${regions.length} children, household has ${children}: registered, not approved`,
      );
    }
    inserted += insert.run(id, baselineRelPath(raw, id), fits ? 'approved' : 'candidate', at, fits ? at : null).changes;
  });

  // The one promotion: an undecided baseline candidate whose roster now fits (see above).
  // Static manifests are approved at insert, so only drawn scenes can be waiting here. The
  // WHERE clause repeats every condition, so a row that changed since it was read is skipped.
  const promote = db.prepare(
    `UPDATE scene SET state = 'approved', decided_at_utc = ?
      WHERE id = ? AND source = 'baseline' AND state = 'candidate' AND decided_at_utc IS NULL`,
  );
  ordered.forEach((id, i) => {
    const raw = manifests.get(id) ?? null;
    const regions = manifestRegions(raw);
    if (regions === null || raw?.static === true || regions.length === 0) return;
    if (regions.length !== children) return;
    const at = new Date(BASELINE_EPOCH_MS + (i - (ordered.length - 1)) * 1000).toISOString();
    if (promote.run(at, id).changes > 0) {
      log(`scene ${id}: baseline fits ${String(children)} children now, approved`);
    }
  });
  return inserted;
}

/**
 * Where a baseline's picture lives, relative to the asset root. The manifest's own `image`
 * when it is a plain relative path — `backdrop` reuses `backgrounds/household.jpg` rather than
 * committing a second copy of it — and `scenes/<id>.jpg` otherwise, which is every scene that
 * predates the field being read.
 */
function baselineRelPath(raw: RawManifest | null, id: string): string {
  const image = raw?.image;
  if (
    typeof image === 'string' &&
    image.length > 0 &&
    !image.startsWith('/') &&
    !image.split('/').includes('..')
  ) {
    return image;
  }
  return `scenes/${id}.jpg`;
}
