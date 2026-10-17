/**
 * The scene tools for a cast of any size, with the household's preferences and budget
 * (2026-10-12). Python under test, driven from node like the settings contract test.
 *
 * What is pinned here, and why it is money: for THREE children the generator's prompt and draw
 * digest are frozen by a fixture. `scene-week` passes `--reuse-if-same`, which reuses a cached
 * picture only when the digest matches, so a byte change in the three-child prompt is a paid
 * redraw of a picture the household already has, every Sunday. Then: a cast of one draws one
 * child and no dog, a cast of none is refused, and the household's `scenes` block (mode,
 * allowlists, budget) is enforced BEFORE anything is spent.
 *
 * NOTHING HERE SPENDS. `gen-scene.py` is only ever run with `--print-prompt` / `--print-digest`,
 * and every `scene-week.py` call goes through `sceneWeek()`, which always adds `--dry-run` and
 * `--no-context` (no forecast fetch) and points the wall reads at a container that does not
 * exist. No API key is in the environment of any child process.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const FIXTURE = 'test/fixtures/prompt-v2.example.txt';
// sha256 draw digest for the fixture's arguments (prompt, provider fal, gpt-image-2, seed 1,
// the three committed avatars). The avatars are hashed by content, so the digest is a property
// of WHICH avatars are committed: it lives in a file, and the public build overlays its own
// (tools/release/public-assets/) alongside the public avatars.
const FIXTURE_DIGEST = readFileSync('test/fixtures/prompt-v2.example.digest', 'utf8').trim();
const EXAMPLE_CAST = 'db/cast.example.json';
const EXAMPLE_HOUSEHOLD = 'db/household.example.json';

interface Setting { id: string; setting: string; crowd: string; season: number[] }
const SETTINGS: Setting[] = JSON.parse(readFileSync('tools/scene-settings.json', 'utf8')).settings;
const FIRST = SETTINGS[0] as Setting; // the fixture was recorded on the first setting

// No secret ever reaches a child process: the keys are stripped even if the shell has them.
function cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
  // FAL_LEDGER: an empty ledger, so the household's real spend never trips the weekly budget.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    WALL_CONTAINER: 'ge-no-such-container',
    FAL_LEDGER: join(tmpdir(), `unit-g-no-ledger-${process.pid}.jsonl`),
    ...extra,
  };
  for (const k of ['FAL_KEY', 'NOUS_API_KEY', 'NVIDIA_API_KEY', 'OP_SERVICE_ACCOUNT_TOKEN']) delete env[k];
  return env;
}

// TABLE MODE, explicitly. The fixture is the activity TABLE's pick: gen-scene draws from the table
// whenever no `--activities-file` is passed, which is what `scenes.activities: "table"` (and a
// written set that fell back) produces. A written set is a different prompt by design, so it
// never touches the fixture; `extra` exists for the tests that pass one.
function genScene(mode: '--print-prompt' | '--print-digest', cast: string, extra: string[] = []) {
  return spawnSync('python3', [
    'tools/gen-scene.py', mode, '--style', 'house', '--composition', 'eye-level',
    '--season', 'summer', '--tags', 'forest', '--seed', '1', '--prompt-version', '2', ...extra,
    FIRST.setting, FIRST.crowd, '/nonexistent/x.jpg',
  ], { encoding: 'utf8', env: cleanEnv({ SCENE_CAST: cast }) });
}

// Written activity sets are read from SCENE_ACTIVITIES_DIR; by default a directory that does not
// exist, so no test ever sees the household's own frozen sets in db/scene-activities/.
const NO_ACTIVITIES = join(tmpdir(), `unit-g-no-activities-${process.pid}`);

function sceneWeek(opts: { cast?: string; household: string; args?: string[]; activitiesDir?: string }) {
  const args = ['tools/scene-week.py', '--dry-run', '--no-context', ...(opts.args ?? [])];
  assert.ok(args.includes('--dry-run'));
  const r = spawnSync('python3', args, {
    encoding: 'utf8',
    env: cleanEnv({
      SCENE_CAST: opts.cast ?? EXAMPLE_CAST,
      HOUSEHOLD_CONFIG: opts.household,
      SCENE_ACTIVITIES_DIR: opts.activitiesDir ?? NO_ACTIVITIES,
    }),
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

function withTmp(fn: (dir: string) => void) {
  const dir = mkdtempSync(join(tmpdir(), 'unit-g-tools-'));
  try {
    fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function household(dir: string, scenes: Record<string, unknown>): string {
  const h = JSON.parse(readFileSync(EXAMPLE_HOUSEHOLD, 'utf8'));
  h.scenes = { ...h.scenes, ...scenes };
  const path = join(dir, 'household.json');
  writeFileSync(path, JSON.stringify(h));
  return path;
}

function castOf(dir: string, children: number, dog: boolean): string {
  const c = JSON.parse(readFileSync(EXAMPLE_CAST, 'utf8'));
  c.children = c.children.slice(0, children);
  if (!dog) delete c.dog;
  const path = join(dir, `cast${children}.json`);
  writeFileSync(path, JSON.stringify(c));
  return path;
}

test('(a) the three-child prompt is byte-identical to the frozen fixture (table mode)', () => {
  const r = genScene('--print-prompt', EXAMPLE_CAST);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout, readFileSync(FIXTURE, 'utf8'));
});

test('(b) the three-child draw digest is the recorded one, so cached pictures are reused', () => {
  const r = genScene('--print-digest', EXAMPLE_CAST);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.trim(), FIXTURE_DIGEST);
});

test('(c) a cast of one draws one child and no dog, and the week dry-runs', () => {
  withTmp((dir) => {
    const one = castOf(dir, 1, false);
    const r = genScene('--print-prompt', one);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /One particular child is the subject of this picture/);
    assert.match(r.stdout, /The child \(portrait 1\)/);
    // "three-quarter" is a face angle, not a headcount.
    assert.doesNotMatch(r.stdout, /\bthree\b(?!-quarter)/i);
    assert.doesNotMatch(r.stdout, /portrait 2/);
    const dog = JSON.parse(readFileSync(EXAMPLE_CAST, 'utf8')).dog.breed as string;
    assert.ok(!r.stdout.includes(dog.slice(0, 40)), 'a cast with no dog must draw no dog');
    const w = sceneWeek({ cast: one, household: household(dir, { weeklyBudgetUsd: null }) });
    assert.equal(w.status, 0, w.out);
    assert.match(w.out, /dry run: nothing generated/);
  });
});

test('(d) a cast of none is refused with exit 2, before anything else', () => {
  withTmp((dir) => {
    const w = sceneWeek({ cast: castOf(dir, 0, true), household: household(dir, {}) });
    assert.equal(w.status, 2, w.out);
    assert.match(w.out, /at least one child/);
  });
});

test('(e) scenes.mode off is a timer with nothing to do, not a failing one', () => {
  withTmp((dir) => {
    const w = sceneWeek({ household: household(dir, { mode: 'off' }) });
    assert.equal(w.status, 0, w.out);
    assert.match(w.out, /scenes\.mode is off: nothing to draw/);
  });
});

test('(e) allowlists are validated before spend: an unknown id, and a subset that leaves a gap', () => {
  withTmp((dir) => {
    const unknown = sceneWeek({ household: household(dir, { settings: ['no-such-setting'] }) });
    assert.equal(unknown.status, 2, unknown.out);
    assert.match(unknown.out, /'no-such-setting', which is not an id in tools\/scene-settings\.json/);

    const summer = SETTINGS.find((s) => s.season.length > 0 && s.season.every((m) => m >= 6 && m <= 8));
    assert.ok(summer, 'a summer-only setting exists');
    const gap = sceneWeek({
      household: household(dir, { styles: ['house'], settings: [summer.id] }),
      args: ['--week', '2027-W03'],
    });
    assert.equal(gap.status, 2, gap.out);
    assert.match(gap.out, /nothing to draw/);
    assert.match(gap.out, /household's allowlists/);
  });
});

test('(e) over the weekly budget is exit 3, which the timer does not retry', () => {
  withTmp((dir) => {
    const w = sceneWeek({ household: household(dir, { weeklyBudgetUsd: 0.01 }) });
    assert.equal(w.status, 3, w.out);
    assert.match(w.out, /budget {2}: spent \$[\d.]+ of \$0\.01 this week, this run \$[\d.]+ \(pictures \$[\d.]+, finder \$[\d.]+, writer \$[\d.]+\) {2}— OVER BUDGET/);
    const unit = readFileSync('stacks/wall/systemd/scene-week.service', 'utf8');
    assert.match(unit, /^RestartPreventExitStatus=1 3$/m);
  });
});

test('an uncapped household says so on the dry run', () => {
  withTmp((dir) => {
    const w = sceneWeek({ household: household(dir, { weeklyBudgetUsd: null }) });
    assert.equal(w.status, 0, w.out);
    assert.match(w.out, /^budget {2}: uncapped$/m);
  });
});

test('the timer wrapper reports a missing env file as 2 (retry), never as 1 (a refusal)', () => {
  withTmp((dir) => {
    const r = spawnSync('bash', ['tools/scene-week-timer.sh', '--dry-run', '--no-context'], {
      encoding: 'utf8',
      env: cleanEnv({ OP_SERVICE_ACCOUNT_TOKEN: 'not-a-token', SCENE_OP_ENV_FILE: join(dir, 'missing.env') }),
    });
    assert.equal(r.status, 2, `${r.stdout}${r.stderr}`);
    assert.match(r.stderr, /missing\.env is missing/);
  });
});

test('no scene tool names a 1Password vault: the references live in the gitignored tools/op.env', () => {
  for (const f of ['tools/scene-week.py', 'tools/fal_api.py', 'tools/gen-scene.py', 'tools/scene-regions.py',
    'tools/edit-avatar.py', 'tools/scene-week-timer.sh', 'tools/op.env.example']) {
    assert.doesNotMatch(readFileSync(f, 'utf8'), /op:\/\/[A-Z]/, `${f} carries a real op:// reference`);
  }
});

// --- Written activities (scenes.activities, 2026-10-12) ------------------------------------------
// No test here calls the writer: there is no key in any child's environment, every scene-week
// run is a dry run, and the writer's own guardrails, freeze, reuse and fallback are covered with a
// fake writer by `python3 tools/scene_activity_writer.py --selftest` (npm run verify:activities).

const WRITTEN_SET = {
  scene_id: 'test',
  source: 'written',
  shared: false,
  lines: [
    { do: 'teaching a hedgehog to juggle acorns', kind: 'animal' },
    { do: 'building a tiny bridge of twigs for marching beetles', kind: 'building' },
    { do: 'conducting a choir of frogs with a reed', kind: 'music' },
  ],
};

test('written mode: the dry run says the set is written at draw time, and writes nothing', () => {
  withTmp((dir) => {
    const acts = join(dir, 'acts');
    const w = sceneWeek({ household: household(dir, { activities: 'written' }), activitiesDir: acts });
    assert.equal(w.status, 0, w.out);
    assert.match(w.out, /^activities: written at draw time$/m);
    assert.match(w.out, /dry run: nothing generated, nothing registered, nothing spent/);
    assert.equal(existsSync(acts), false, 'a dry run must not write (or pay for) a set');
  });
});

test('written mode: a frozen set is shown on the dry run, phrased as the prompt will say it', () => {
  withTmp((dir) => {
    const acts = join(dir, 'acts');
    const hh = household(dir, { activities: 'written' });
    const first = sceneWeek({ household: hh, activitiesDir: acts, args: ['--week', '2026-W43'] });
    const id = /^id {6}: (\S+)$/m.exec(first.out)?.[1];
    assert.ok(id, first.out);
    mkdirSync(acts);
    writeFileSync(join(acts, `${id}.json`), JSON.stringify({ ...WRITTEN_SET, scene_id: id }));
    const w = sceneWeek({ household: hh, activitiesDir: acts, args: ['--week', '2026-W43'] });
    assert.equal(w.status, 0, w.out);
    assert.match(w.out, /^activities: written, frozen in .*\.json$/m);
    assert.match(w.out, /The child from portrait 1 is teaching a hedgehog to juggle acorns\./);
  });
});

// The projection's "this run" figure, as printed. Three decimals: the writer is a fifth of a cent.
function thisRun(out: string): { total: number; writer: number } {
  const m = /this run \$([\d.]+) \(pictures \$[\d.]+, finder \$[\d.]+, writer \$([\d.]+)\)/.exec(out);
  assert.ok(m, out);
  return { total: Number(m[1]), writer: Number(m[2]) };
}

test('the budget projection pays for the activity writer only when it will run', () => {
  withTmp((dir) => {
    const acts = join(dir, 'acts');
    const args = ['--week', '2026-W43'];
    const table = sceneWeek({ household: household(dir, { activities: 'table', weeklyBudgetUsd: 100 }), args });
    assert.equal(table.status, 0, table.out);
    const hh = household(dir, { activities: 'written', weeklyBudgetUsd: 100 });
    const unwritten = sceneWeek({ household: hh, activitiesDir: acts, args });
    assert.equal(unwritten.status, 0, unwritten.out);
    const t = thisRun(table.out);
    const u = thisRun(unwritten.out);
    assert.equal(t.writer, 0);
    assert.equal(u.writer, 0.002);
    assert.ok(u.total > t.total, `${u.total} > ${t.total}`);
    assert.equal(Math.round((u.total - t.total) * 1000), 2);

    const id = /^id {6}: (\S+)$/m.exec(unwritten.out)?.[1];
    assert.ok(id, unwritten.out);
    mkdirSync(acts);
    writeFileSync(join(acts, `${id}.json`), JSON.stringify({ ...WRITTEN_SET, scene_id: id }));
    const frozen = sceneWeek({ household: hh, activitiesDir: acts, args });
    assert.equal(frozen.status, 0, frozen.out);
    assert.match(frozen.out, /^activities: written, frozen in /m);
    assert.equal(thisRun(frozen.out).total, t.total);
  });
});

test('table mode: the dry run says the table deals the activities', () => {
  withTmp((dir) => {
    const w = sceneWeek({ household: household(dir, { activities: 'table' }) });
    assert.equal(w.status, 0, w.out);
    assert.match(w.out, /^activities: table \(picked at draw time/m);
  });
});

test('gen-scene --activities-file replaces the table pick, phrased like it; a bad set is refused', () => {
  withTmp((dir) => {
    const file = join(dir, 'set.json');
    writeFileSync(file, JSON.stringify(WRITTEN_SET));
    const r = genScene('--print-prompt', EXAMPLE_CAST, ['--activities-file', file]);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /Each of them is doing something different:\n {2}- The child from portrait 1 is teaching a hedgehog to juggle acorns\.\n/);
    assert.notEqual(r.stdout, readFileSync(FIXTURE, 'utf8'));

    const shared = join(dir, 'shared.json');
    writeFileSync(shared, JSON.stringify({
      ...WRITTEN_SET,
      shared: true,
      lines: [{ do: '{all_of_them} pulling a giant turnip out of the ground', kind: 'garden' }],
    }));
    const s = genScene('--print-prompt', EXAMPLE_CAST, ['--activities-file', shared]);
    assert.equal(s.status, 0, s.stderr);
    assert.match(s.stdout, /The three of them together: all three pulling a giant turnip out of the ground\./);

    // Re-validated at draw time: a hand-edited file cannot carry an upside-down child.
    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({
      ...WRITTEN_SET,
      lines: [{ do: 'doing a handstand on a stump', kind: 'gym' }, ...WRITTEN_SET.lines.slice(1)],
    }));
    const b = genScene('--print-prompt', EXAMPLE_CAST, ['--activities-file', bad]);
    assert.notEqual(b.status, 0);
    assert.match(b.stderr, /upside down/);
  });
});

test('five children: the thin table is a warning in written mode and still a refusal in table mode', () => {
  withTmp((dir) => {
    const c = JSON.parse(readFileSync(EXAMPLE_CAST, 'utf8'));
    c.children = [...c.children,
      { ...c.children[1], slot: 4, height_cm: 110 }, { ...c.children[2], slot: 5, height_cm: 95 }];
    const five = join(dir, 'cast5.json');
    writeFileSync(five, JSON.stringify(c));
    const written = sceneWeek({ cast: five, household: household(dir, { activities: 'written' }) });
    assert.equal(written.status, 0, written.out);
    assert.match(written.out, /warning: .*it needs 5, one per child/);
    const table = sceneWeek({ cast: five, household: household(dir, { activities: 'table' }) });
    assert.equal(table.status, 2, table.out);
    assert.match(table.out, /it needs 5, one per child/);
  });
});
