/**
 * Unit I — bringing the volume's baseline assets up to date with the image, on every boot.
 *
 * This is in its own module rather than in the composition root for one mechanical reason:
 * `main.ts` starts a server as a side effect of being imported, so nothing in it can be unit
 * tested. That is not a nitpick here — this function's whole job is a three-way decision about
 * whose copy of a file wins, it went undetected in the wrong state for two weeks, and the
 * symptom was invisible. It needs a test that runs it, not a test that greps it.
 *
 * The arguments are injected for the same reason: a test can point it at two temp directories.
 */

import { dirname, join, relative } from 'node:path';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

/**
 * Brings the volume's baseline assets up to date with the image, on every boot.
 *
 * `asset.rel_path` is rooted at ASSET_ROOT, which lives in a volume — so on a fresh deploy
 * it is empty and every icon on the wall 404s. Unit J found this end to end: the schema
 * guarantees a non-empty url, the renderer guarantees it renders what it is given, and
 * nobody owned whether the string resolved to a file that exists. For the pre-reader the
 * icon IS the interface, so a wall of grey placeholders is not a degraded experience, it is
 * an unusable one.
 *
 * ## Why this is no longer copy-if-absent
 *
 * It was, from the first deploy until 2026-09-08, on the stated grounds that "the generated
 * set from ADR-0002 lands in this same volume and must not be clobbered by the shipped
 * baseline". **That premise was never true.** `tools/gen-icon.py` and `tools/gen-scene.py`
 * run on the server and write into the repo's `assets/`, where the output is committed; nothing
 * in this process writes into ASSET_ROOT, and there is no upload route. The rule protected a
 * case that could not occur, and charged the real one.
 *
 * What it charged: a committed asset that CHANGED could never reach the wall again, because
 * a file was already sitting at its path. Measured 2026-09-08 — six committed files were
 * stale in the volume, including `scenes/autumn-forest.{jpg,json}`, `scenes/trailer-camp.{jpg,json}`
 * and two of the three avatars. Five commits of scene work (the dog's breed corrected, heads facing
 * the way bodies do, clothes following the weather, relative height, the eldest's braids) were in
 * git, were in the image, and were not on the wall. The household said "the image generation
 * hasn't updated".
 *
 * That is this project's most expensive failure shape wearing a third coat: **correct-looking
 * output hiding a dead path.** The wall showed a picture, the deploy said nothing, and the
 * only symptom was that the art never changed. Compare the calendar sync running against an
 * unconfigured adapter behind a wall honestly labelling itself stale.
 *
 * ## What still may not be clobbered, and how that is now decided exactly
 *
 * "Never overwrite" was a proxy for a real rule: **a file a human put there by hand wins over
 * the baseline.** `.seeded.json` makes that answerable instead of guessed. It records the
 * digest of every file this function wrote, so on the next boot each path is one of three
 * things:
 *
 *   - **absent** — copy it.
 *   - **present, and its digest is the one we recorded** — untouched baseline. Refresh it when
 *     the image's copy differs. This is the case that was broken.
 *   - **present, and its digest is something else** — somebody replaced it (`docker cp`, a
 *     hand-authored scene). Leave it alone and say so in the log, every boot, so a local
 *     override is never silently permanent.
 *
 * The ledger is bootstrapped by writing it, so the first boot after this change has no record
 * for anything and would take the third branch for all 38 files — which would preserve exactly
 * the staleness this exists to end. So a missing ledger means "we have never tracked this
 * volume", and the volume is taken to be baseline: refresh, then record. That is safe here and
 * was checked rather than assumed — every file in the volume has a committed counterpart, and
 * the only differences are the six where the repo is newer.
 */
export interface SeedResult {
  readonly copied: number;
  readonly refreshed: number;
  /** Paths a human replaced by hand.  Reported on every boot, not only the first. */
  readonly kept: readonly string[];
}

export function seedAssets(
  baseline: string,
  assetRoot: string,
  log: (message: string) => void,
): SeedResult {
  if (!existsSync(baseline)) return { copied: 0, refreshed: 0, kept: [] };

  const ledgerPath = join(assetRoot, LEDGER);
  const previous = readLedger(ledgerPath, log);
  // A first run against an untracked volume trusts the image; see the header.
  const bootstrapping = previous === null;
  const ledger: Record<string, string> = {};

  let copied = 0;
  let refreshed = 0;
  const kept: string[] = [];

  for (const entry of readdirSync(baseline, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) continue;
    // The manifest describes the set; it is not part of it, and the asset root is served.
    if (entry.name === 'manifest.json') continue;
    const from = join(entry.parentPath ?? entry.path, entry.name);
    const rel = relative(baseline, from);
    const to = join(assetRoot, rel);
    const shipped = digest(readFileSync(from));

    if (!existsSync(to)) {
      mkdirSync(dirname(to), { recursive: true });
      copyFileSync(from, to);
      copied += 1;
      ledger[rel] = shipped;
      continue;
    }

    const onDisk = digest(readFileSync(to));
    if (onDisk === shipped) {
      ledger[rel] = shipped;
      continue;
    }
    // Differs from the image. Whose copy is it?
    const recorded = previous?.[rel];
    const isLocalOverride = !bootstrapping && recorded !== onDisk;
    if (isLocalOverride) {
      kept.push(rel);
      // Keep the RECORDED digest, not the local one: re-recording it here would make the
      // override indistinguishable from baseline on the next boot, and the first time the
      // image changed underneath it the file would be silently overwritten after all.
      if (recorded !== undefined) ledger[rel] = recorded;
      continue;
    }
    copyFileSync(from, to);
    refreshed += 1;
    ledger[rel] = shipped;
  }

  writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2));
  if (copied > 0) log(`seeded ${String(copied)} baseline asset(s) into ${assetRoot}`);
  if (refreshed > 0) log(`refreshed ${String(refreshed)} changed baseline asset(s)`);
  // Logged on EVERY boot, not only the one where it started. An override that is invisible
  // after the deploy that made it is how the wall ends up serving art nobody remembers placing.
  if (kept.length > 0) {
    log(`kept ${String(kept.length)} locally-modified asset(s), not overwritten: ${kept.join(', ')}`);
  }
  return { copied, refreshed, kept };
}

/** Where the volume records what the baseline put there. Dotfile: the asset root is served. */
export const LEDGER = '.seeded.json';

function digest(bytes: Buffer): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** `null` means "no ledger", which is a different answer from "an empty one" — see the header. */
function readLedger(
  path: string,
  log: (message: string) => void,
): Record<string, string> | null {
  if (!existsSync(path)) return null;
  // A ledger that exists but cannot be read is NOT the same as no ledger. Reading it as
  // absent would bootstrap — overwriting the very local overrides it can no longer see. An
  // empty ledger is the safe reading: every difference then looks like an override, so the
  // failure mode is a stale asset an operator can spot in the log, not a lost one.
  const bad = (why: string): Record<string, string> => {
    log(`WARNING: ${path} ${why}; treating every differing asset as a local override`);
    return {};
  };
  let parsed: unknown;
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return bad('is unreadable');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    return bad('is not an object');
  }
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(parsed)) if (typeof v === 'string') out[k] = v;
  return out;
}

