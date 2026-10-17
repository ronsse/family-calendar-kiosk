/**
 * Unit J — release hygiene: what the tracked tree must never carry.
 *
 * The public repo is built from this repo's tracked tree, so these are properties of
 * `git ls-files`, not of the working directory. Three checks:
 *
 *   (a) the household dog's real name appears in no tracked file. It is the one private
 *       literal safe to name here, because the code replaced it with a constant word
 *       (`dog`) and the displayed name comes from `household.pets[0].name`. It is spelled
 *       in pieces below so this file does not match itself.
 *   (b) the household's own data files and secret env files are untracked.
 *   (c) every tracked picture is one the release has vetted, by sha256.
 *
 * Every scanner is checked against something it MUST find first, because a scan that has
 * quietly stopped reading anything reports green forever.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const ASSET_LIST = 'tools/release/public-assets.sha256';

function git(args: string[]): { status: number | null; stdout: string } {
  const r = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return { status: r.status, stdout: r.stdout ?? '' };
}

const HAVE_GIT = git(['rev-parse', '--is-inside-work-tree']).stdout.trim() === 'true';
const NO_GIT = HAVE_GIT ? false : 'not a git checkout (e.g. a container build)';

function tracked(): string[] {
  const r = git(['ls-files', '-z']);
  assert.equal(r.status, 0, 'git ls-files failed');
  return r.stdout.split('\0').filter((f) => f.length > 0);
}

/** Tracked text files whose contents match `word` as a whole word, case-insensitively. */
function trackedFilesWithWord(word: string): string[] {
  const r = git(['grep', '-I', '-l', '-i', '-w', '-e', word, '--', '.', ':(exclude)docs/local/**']);
  // git grep: 0 = matches, 1 = no match, anything else = it could not run.
  assert.ok(r.status === 0 || r.status === 1, `git grep failed (exit ${String(r.status)})`);
  return r.stdout.split('\n').filter((f) => f.length > 0);
}

// ---------------------------------------------------------------------------
// (a) the dog's real name
// ---------------------------------------------------------------------------

test('the word scanner reads tracked files (synthetic positive)', { skip: NO_GIT }, () => {
  assert.ok(
    trackedFilesWithWord('DOG_SHEET_WIDTH_PX').includes('web/src/views/domain/DogSheet.tsx'),
    'a scanner that cannot find a known identifier proves nothing by finding nothing else',
  );
});

// Enforced only at the END of the release pass: until every lane (docs, tools) has landed,
// other paths still carry the word. Run with RELEASE_HYGIENE=1 to enforce it.
test(
  "no tracked file names the household's dog",
  { skip: NO_GIT || (process.env.RELEASE_HYGIENE !== '1' && 'set RELEASE_HYGIENE=1 to enforce') },
  () => {
    const name = 'ja' + 'x';
    const re = new RegExp(`\\b${name}\\b`, 'i');
    assert.ok(re.test(`a ${name.toUpperCase()} b`) && !re.test(`${name}on`), 'the pattern is a whole word');
    assert.deepEqual(trackedFilesWithWord(name), []);
  },
);

// ---------------------------------------------------------------------------
// (b) household data and secrets are never tracked
// ---------------------------------------------------------------------------

const FORBIDDEN_FILES = [
  'db/household.sql',
  'db/household.json',
  'db/cast.json',
  'db/calendars.sql',
  'db/chores.json',
  'db/scene-place.json',
  'stacks/wall/op.env',
  'tools/op.env',
  'CLAUDE.local.md',
];
const FORBIDDEN_DIRS = ['db/scene-activities/', 'local/'];

test('the forbidden-path check matches what it should (synthetic positive)', () => {
  assert.deepEqual(forbidden(['db/cast.json', 'local/x.txt', 'db/scene-activities/a.json', 'db/cast.example.json']), [
    'db/cast.json',
    'local/x.txt',
    'db/scene-activities/a.json',
  ]);
});

function forbidden(files: readonly string[]): string[] {
  return files.filter((f) => FORBIDDEN_FILES.includes(f) || FORBIDDEN_DIRS.some((d) => f.startsWith(d)));
}

test("the household's own data and secret env files are untracked", { skip: NO_GIT }, () => {
  const files = tracked();
  assert.ok(files.includes('package.json'), 'git ls-files returned the tree');
  assert.deepEqual(forbidden(files), []);
});

// ---------------------------------------------------------------------------
// (c) every tracked picture is vetted
// ---------------------------------------------------------------------------

test('every tracked jpg/png is listed in the public asset manifest', { skip: NO_GIT }, (t) => {
  const listPath = path.join(ROOT, ASSET_LIST);
  if (!existsSync(listPath)) {
    t.skip(`${ASSET_LIST} does not exist yet; the release pass writes it`);
    return;
  }
  const listed = new Set(
    readFileSync(listPath, 'utf8')
      .split('\n')
      .map((l) => l.trim().split(/\s+/)[0]?.toLowerCase() ?? '')
      .filter((h) => /^[0-9a-f]{64}$/.test(h)),
  );
  // The private repo keeps the household's own art tracked and lists it in private-only.txt;
  // build-public drops those paths and removes the list, so in the public tree nothing is exempt.
  const privateList = path.join(ROOT, 'tools/release/private-only.txt');
  const privateOnly = new Set(
    existsSync(privateList)
      ? readFileSync(privateList, 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'))
      : [],
  );
  const pictures = tracked().filter((f) => /\.(jpe?g|png)$/i.test(f) && !privateOnly.has(f));
  const unlisted = pictures.filter(
    (f) => !listed.has(createHash('sha256').update(readFileSync(path.join(ROOT, f))).digest('hex')),
  );
  assert.deepEqual(unlisted, [], `tracked pictures whose sha256 is not in ${ASSET_LIST}`);
});
