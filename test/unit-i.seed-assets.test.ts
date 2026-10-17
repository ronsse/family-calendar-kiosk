/**
 * Unit I — the baseline asset seeder.
 *
 * Every case here is a state the live volume was actually in on 2026-09-08, or one the old
 * copy-if-absent rule claimed to protect. The first test is the regression: six committed
 * files — two scenes, their manifests, and two of the three avatars — sat stale in the volume
 * for two weeks because a file already existed at their path. Five commits of scene work were
 * in git, were in the image, and were not on the wall, and nothing anywhere said so.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { seedAssets, LEDGER } from '../stacks/wall/entry/seed-assets.ts';

function fixture(): { baseline: string; volume: string; logs: string[]; log: (m: string) => void } {
  const root = mkdtempSync(join(tmpdir(), 'seed-'));
  const baseline = join(root, 'image-assets');
  const volume = join(root, 'volume-assets');
  mkdirSync(join(baseline, 'scenes'), { recursive: true });
  mkdirSync(join(volume, 'scenes'), { recursive: true });
  const logs: string[] = [];
  return { baseline, volume, logs, log: (m) => logs.push(m) };
}

const put = (dir: string, rel: string, body: string): void => {
  writeFileSync(join(dir, rel), body);
};
const readIt = (dir: string, rel: string): string => readFileSync(join(dir, rel), 'utf8');

test('a committed asset that CHANGED reaches the volume — the 2026-09-08 regression', () => {
  const { baseline, volume, log } = fixture();
  put(baseline, 'scenes/autumn-forest.jpg', 'v1');
  seedAssets(baseline, volume, log);
  assert.equal(readIt(volume, 'scenes/autumn-forest.jpg'), 'v1', 'fresh volume gets the file');

  // The scene is regenerated and committed. Under copy-if-absent this was a no-op forever.
  put(baseline, 'scenes/autumn-forest.jpg', 'v2-dog-redrawn');
  const result = seedAssets(baseline, volume, log);
  assert.equal(readIt(volume, 'scenes/autumn-forest.jpg'), 'v2-dog-redrawn');
  assert.equal(result.refreshed, 1);
  assert.deepEqual(result.kept, []);
});

test('a file a human replaced by hand is never overwritten, and is reported EVERY boot', () => {
  const { baseline, volume, logs, log } = fixture();
  put(baseline, 'scenes/campsite.jpg', 'shipped');
  seedAssets(baseline, volume, log);

  // `docker cp` of a scene being trialled on the panel.
  put(volume, 'scenes/campsite.jpg', 'hand-placed');
  const first = seedAssets(baseline, volume, log);
  assert.equal(readIt(volume, 'scenes/campsite.jpg'), 'hand-placed');
  assert.deepEqual(first.kept, ['scenes/campsite.jpg']);

  // The image then changes underneath the override. It must STILL lose — and the ledger must
  // not have quietly adopted the local digest, which would make the override look like
  // baseline and get it clobbered by the next release.
  put(baseline, 'scenes/campsite.jpg', 'shipped-v2');
  const second = seedAssets(baseline, volume, log);
  assert.equal(readIt(volume, 'scenes/campsite.jpg'), 'hand-placed');
  assert.deepEqual(second.kept, ['scenes/campsite.jpg']);

  // Reported on every boot, not only the one that created it: an override nobody can see is
  // how the wall ends up serving art nobody remembers placing.
  assert.equal(logs.filter((l) => l.includes('locally-modified')).length, 2);
});

test('an untracked volume is taken to be baseline — otherwise the fix cannot land', () => {
  const { baseline, volume, log } = fixture();
  // Exactly the live state: the volume predates the ledger and holds an older committed file.
  put(baseline, 'scenes/trailer-camp.jpg', 'new');
  put(volume, 'scenes/trailer-camp.jpg', 'old');
  assert.equal(existsSync(join(volume, LEDGER)), false);

  const result = seedAssets(baseline, volume, log);
  assert.equal(readIt(volume, 'scenes/trailer-camp.jpg'), 'new');
  assert.equal(result.refreshed, 1);
  assert.deepEqual(result.kept, [], 'bootstrapping must not mistake staleness for an override');
});

test('a corrupt ledger keeps files rather than losing them', () => {
  const { baseline, volume, logs, log } = fixture();
  put(baseline, 'scenes/x.jpg', 'shipped');
  seedAssets(baseline, volume, log);
  put(volume, 'scenes/x.jpg', 'hand-placed');
  writeFileSync(join(volume, LEDGER), '{not json');

  const result = seedAssets(baseline, volume, log);
  assert.equal(readIt(volume, 'scenes/x.jpg'), 'hand-placed', 'unreadable != untracked');
  assert.deepEqual(result.kept, ['scenes/x.jpg']);
  assert.ok(logs.some((l) => l.includes('WARNING')));
});

test('the manifest describes the set and is not part of it', () => {
  const { baseline, volume, log } = fixture();
  put(baseline, 'manifest.json', '{"assets":[]}');
  put(baseline, 'scenes/y.jpg', 'pic');
  seedAssets(baseline, volume, log);
  assert.equal(existsSync(join(volume, 'manifest.json')), false);
  assert.equal(existsSync(join(volume, 'scenes/y.jpg')), true);
});

test('re-running changes nothing — the boot path runs on every restart', () => {
  const { baseline, volume, log } = fixture();
  put(baseline, 'scenes/z.jpg', 'pic');
  seedAssets(baseline, volume, log);
  const again = seedAssets(baseline, volume, log);
  assert.deepEqual(
    { copied: again.copied, refreshed: again.refreshed, kept: again.kept },
    { copied: 0, refreshed: 0, kept: [] },
  );
});

test('a missing baseline directory is survived, not thrown on', () => {
  const { volume, log } = fixture();
  const result = seedAssets(join(volume, 'nope'), volume, log);
  assert.deepEqual({ ...result, kept: [...result.kept] }, { copied: 0, refreshed: 0, kept: [] });
});

test.after(() => {
  rmSync(join(tmpdir(), 'seed-'), { force: true, recursive: true });
});
