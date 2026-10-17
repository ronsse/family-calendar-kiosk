/**
 * The bundled art: the committed asset set, its `asset` rows, and the committed scenes.
 *
 * Shared by `main.ts` (every boot) and `provision.ts` (every run). It used to live inside
 * `main.ts` only, so a bare database provisioned BEFORE the first start had no `asset` rows,
 * and `--household` failed on `child.avatar_asset_id REFERENCES asset(id)` — the documented
 * quick start (provision, then start) could not work on a fresh checkout.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Database as Db } from 'better-sqlite3';
import { registerBaselineScenes } from '../../../src/domain/scenes/library.ts';
import { seedAssets } from './seed-assets.ts';

/** The repository root this file ships in. */
export const REPO_ROOT = resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');

const defaultLog = (message: string): void => {
  process.stdout.write(`[wall] ${message}\n`);
};

/**
 * Registers the baseline assets in the `asset` table, and the `_default` fallback that makes
 * `resolveAsset` total.
 *
 * The schema calls `_default` mandatory and has triggers stopping it being deleted or
 * un-validated — but nothing ever CREATED it outside the dev seed. So a fresh production
 * database threw on the very first icon: chain guarded at both ends, unbootstrapped in the
 * middle. That is H1 lens 4's finding in a new form, and it is a blank wall on day one.
 *
 * Insert-if-absent on every boot. A household that authors its own imagery, or the generated
 * set from ADR-0002, keeps its rows: nothing here overwrites an existing id or category.
 *
 * `assetRoot` is where the files are served from (a row is written only for a file that is
 * really there); `repoRoot` is where `assets/manifest.json` is read.
 */
export function registerBaselineAssets(
  database: Db,
  assetRoot: string,
  repoRoot: string = REPO_ROOT,
  log: (message: string) => void = defaultLog,
): void {
  const manifestPath = resolve(repoRoot, 'assets/manifest.json');
  if (!existsSync(manifestPath)) return;
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    assets: { id: string; kind: string; category: string; rel_path: string; fallbackFor?: string }[];
  };
  const insertAsset = database.prepare(
    `INSERT INTO asset (id, kind, category, rel_path, validated_at_utc)
     VALUES (?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
  );
  const insertFallback = database.prepare(
    `INSERT INTO asset_fallback (category, asset_id) VALUES (?, ?) ON CONFLICT DO NOTHING`,
  );
  // A baseline id whose FILE has moved is followed. Insert-if-absent alone meant the
  // placeholder avatars could never be replaced: the rows already existed, so a new manifest
  // was ignored and the wall kept serving three geometric shapes. Scoped to ids the manifest
  // declares — anything a household authored itself is not in here and is never touched.
  const relocate = database.prepare(
    `UPDATE asset SET rel_path = ?, validated_at_utc = ? WHERE id = ? AND rel_path <> ?`,
  );
  let assets = 0;
  let fallbacks = 0;
  let moved = 0;
  for (const a of manifest.assets) {
    // validated_at_utc is set only when the file is genuinely on disk — the whole point of
    // the column is that it means "this renders", not "a row exists".
    if (!existsSync(join(assetRoot, a.rel_path))) continue;
    const now = new Date().toISOString();
    assets += insertAsset.run(a.id, a.kind, a.category, a.rel_path, now).changes;
    moved += relocate.run(a.rel_path, now, a.id, a.rel_path).changes;
    if (a.fallbackFor) fallbacks += insertFallback.run(a.fallbackFor, a.id).changes;
  }
  if (assets > 0 || fallbacks > 0 || moved > 0) {
    log(
      `registered ${assets} baseline asset(s), ${fallbacks} fallback(s), relocated ${moved}`,
    );
  }
}

/**
 * Registers the committed scenes from the REPO's `assets/scenes`, not the volume's: the
 * question is "what shipped in this image", and the volume also holds generated candidates,
 * which have not been looked at and must not be auto-approved. See `registerBaselineScenes`.
 */
export function registerCommittedScenes(
  db: Db,
  repoRoot: string = REPO_ROOT,
  log: (message: string) => void = defaultLog,
): number {
  const scenesDir = resolve(repoRoot, 'assets/scenes');
  const added = existsSync(scenesDir)
    ? registerBaselineScenes(db, scenesDir, (dir) => readdirSync(dir), log)
    : 0;
  if (added > 0) log(`registered ${String(added)} baseline scene(s)`);
  return added;
}

/**
 * All of the bundled art, in boot order: copy the committed files into the asset root, write
 * their `asset` rows, then put the committed scenes in the library.
 */
export function registerBundledArt(
  db: Db,
  repoRoot: string,
  assetRoot: string,
  log: (message: string) => void = defaultLog,
): void {
  seedAssets(resolve(repoRoot, 'assets'), assetRoot, log);
  registerBaselineAssets(db, assetRoot, repoRoot, log);
  registerCommittedScenes(db, repoRoot, log);
}
