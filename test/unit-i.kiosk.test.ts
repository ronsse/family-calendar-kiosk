/**
 * Unit I acceptance, part 2: the Pi.
 *
 * The kiosk is shell and Python, so these are assertions ABOUT FILES rather than about
 * behaviour — but they are the assertions that matter, because the failure they guard is
 * silent. Repointing the wall is four edits across three files, and getting three of them
 * right leaves a kiosk that boots, runs, reports healthy, and shows Home Assistant's setup
 * wizard at 6:00 AM. Nothing in the running system would complain.
 *
 * The other half is the boot chain. autologin -> labwc -> kiosk.service -> kiosk-gate.py ->
 * Chromium is verified working on the real box; every link in it is load-bearing and several
 * are non-obvious enough to be "cleaned up" by someone who has not read CLAUDE.md. These
 * tests make removing one a red test rather than a dark wall.
 */

import { test } from 'node:test';
import { execFileSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel: string): string => readFileSync(resolve(REPO, rel), 'utf8');

const KIOSK_ENV = read('pi/config/kiosk.env');
const PROBE = read('pi/config/bin/kiosk-probe.sh');
const GATE = read('pi/config/bin/kiosk-gate.py');
const SETUP = read('pi/scripts/setup.sh');
const RUN = read('pi/config/bin/kiosk-run.sh');
const UNIT = read('pi/config/systemd/kiosk.service');
const AUTOSTART = read('pi/config/labwc/autostart');
const SNAPSHOT = read('pi/config/bin/kiosk-snapshot.sh');

/** Config lines only — a `#` comment may name the old port as history, and one does. */
function settings(file: string): string[] {
  return file
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith('#'));
}

// ---------------------------------------------------------------------------
// The wall points at the wall app
// ---------------------------------------------------------------------------

test('kiosk.env no longer points the wall at Home Assistant', () => {
  const config = settings(KIOSK_ENV);
  for (const line of config) {
    assert.ok(!line.includes('8123'), `still references HA's port: ${line}`);
  }
  const dashboard = config.find((l) => l.startsWith('DASHBOARD_URL='));
  assert.ok(dashboard !== undefined, 'DASHBOARD_URL must exist — the gate reads it');
  assert.match(dashboard, /^DASHBOARD_URL=http:\/\/homeserver:8124\/?$/);
});

test('the dashboard URL is a HOSTNAME — a LAN address can drift', () => {
  const dashboard = settings(KIOSK_ENV).find((l) => l.startsWith('DASHBOARD_URL=')) ?? '';
  assert.ok(!/\d{1,3}(\.\d{1,3}){3}/.test(dashboard), `pinned an IP: ${dashboard}`);
});

test('the probe asks /api/health, not / and not /api/', () => {
  for (const line of settings(PROBE)) {
    assert.ok(!line.includes('8123'), `probe still references HA's port: ${line}`);
  }
  assert.match(PROBE, /\/api\/health/, 'must probe the documented liveness endpoint');
  assert.ok(
    !/\$\{origin\}\/api\/"/.test(PROBE),
    'the old HA probe path must be gone, or 401 would still read as up',
  );
});

test('the probe gates on `ok`, and deliberately NOT on `dbWritable`', () => {
  // A read-only or full database still renders an already-materialized day, stale and
  // labelled. Parking the family on a screenshot for it would be strictly worse.
  assert.match(PROBE, /"ok":true/);
  assert.ok(
    !/"dbWritable":true/.test(PROBE.replace(/^#.*$/gm, '')),
    'dbWritable must not be part of the up/down decision',
  );
});

test('the gate defaults to the app, and the snapshot script agrees with it', () => {
  assert.match(GATE, /DASHBOARD_URL",\s*"http:\/\/homeserver:8124\//);
  assert.match(SNAPSHOT, /DASHBOARD_URL:-http:\/\/homeserver:8124\//);
});

// ---------------------------------------------------------------------------
// The device token comes from the Pi, by fragment
// ---------------------------------------------------------------------------

test('kiosk.env carries an EMPTY device token key rather than inventing one', () => {
  const line = settings(KIOSK_ENV).find((l) => l.startsWith('WALL_DEVICE_TOKEN='));
  assert.ok(line !== undefined, 'the key must exist so the gate and setup can see it');
  assert.equal(line, 'WALL_DEVICE_TOKEN=', 'a committed token would be a committed secret');
});

test('no committed file carries anything token-shaped', () => {
  // 32 random bytes, base64url. If one ever lands in the repo, this is where it is caught.
  const suspicious = /(?:TOKEN|token)\s*[=:]\s*['"]?[A-Za-z0-9_-]{32,}/;
  for (const [name, body] of [
    ['kiosk.env', KIOSK_ENV],
    ['kiosk-gate.py', GATE],
    ['setup.sh', SETUP],
    ['kiosk-run.sh', RUN],
    ['op.env.example', read('stacks/wall/op.env.example')],
    ['docker-compose.yml', read('stacks/wall/docker-compose.yml')],
  ] as const) {
    assert.ok(!suspicious.test(body), `${name} looks like it contains a real token`);
  }
});

test('the gate appends the token as a FRAGMENT, which never reaches a server log', () => {
  assert.match(GATE, /def redirect_target/);
  assert.match(GATE, /"dt=" \+ quote\(DEVICE_TOKEN/);
  assert.match(GATE, /"Location": redirect_target\(\)/);
  // A query parameter would land in the app's access log and in Chromium's history.
  assert.ok(!/\?dt=/.test(GATE), 'the token must never be a query parameter');
});

/**
 * Run the gate's own `redirect_target()` and read what it actually produces.
 *
 * This replaced a `assert.match(GATE, /if not DEVICE_TOKEN:.../)` — a grep for a code SHAPE,
 * which broke the moment the function grew a second fragment parameter even though the
 * behaviour it was protecting was untouched. Executing it tests the property instead of the
 * spelling, and is strictly stronger: a refactor cannot break it and a behaviour change cannot
 * slip past it.
 */
function redirectTarget(env: Record<string, string>): string {
  const script = [
    'import importlib.util, os, sys',
    'spec = importlib.util.spec_from_file_location("gate", "pi/config/bin/kiosk-gate.py")',
    'm = importlib.util.module_from_spec(spec)',
    'spec.loader.exec_module(m)',
    'print(m.redirect_target())',
  ].join('\n');
  return execFileSync('python3', ['-c', script], {
    encoding: 'utf8',
    env: { ...process.env, ...env },
  }).trim();
}

test('an empty token yields no dt= — the offline card, never a login form', () => {
  const url = redirectTarget({ DASHBOARD_URL: 'http://homeserver:8124/', WALL_DEVICE_TOKEN: '' });
  assert.ok(!url.includes('dt='), `no token must mean no dt=, got ${url}`);
});

test('a token rides the fragment, never the query string', () => {
  // A query parameter would land in the app's access log and in Chromium's history.
  const url = redirectTarget({ DASHBOARD_URL: 'http://homeserver:8124/', WALL_DEVICE_TOKEN: 'sekrit' });
  assert.ok(url.includes('#'), 'there must be a fragment');
  assert.ok(url.split('#')[1]?.includes('dt=sekrit'), `token must be in the fragment, got ${url}`);
  assert.ok(!url.split('#')[0]?.includes('dt='), 'the token must never be before the #');
});

test('the gate always tells the page where to ask for clock evidence', () => {
  // The page is served by homeserver and cannot know this Pi's loopback port. Baking the default
  // into the bundle would work until somebody changed KIOSK_GATE_PORT and then fail in silence.
  for (const token of ['', 'sekrit']) {
    const url = redirectTarget({
      DASHBOARD_URL: 'http://homeserver:8124/',
      WALL_DEVICE_TOKEN: token,
      KIOSK_GATE_PORT: '19999',
    });
    assert.ok(
      url.includes(`gate=${encodeURIComponent('http://127.0.0.1:19999')}`),
      `gate origin must follow KIOSK_GATE_PORT, got ${url}`,
    );
  }
});

test('re-deriving the target does not accumulate duplicate fragment parameters', () => {
  // DASHBOARD_URL may already carry a fragment — including one this function put there.
  const url = redirectTarget({
    DASHBOARD_URL: 'http://homeserver:8124/#gate=stale&dt=old&keep=me',
    WALL_DEVICE_TOKEN: 'fresh',
  });
  assert.equal(url.match(/dt=/g)?.length, 1, `exactly one dt=, got ${url}`);
  assert.equal(url.match(/gate=/g)?.length, 1, `exactly one gate=, got ${url}`);
  assert.ok(url.includes('dt=fresh') && !url.includes('dt=old'), 'the fresh token must win');
  assert.ok(url.includes('keep=me'), 'unrelated fragment parameters must survive');
});

test('the gate can read the token: kiosk-gate.service loads kiosk.env', () => {
  const service = read('pi/config/systemd/kiosk-gate.service');
  assert.match(service, /EnvironmentFile=-%h\/\.config\/kiosk\.env/);
});

// ---------------------------------------------------------------------------
// setup.sh: additive, and loud about what it will not do
// ---------------------------------------------------------------------------

test('setup.sh appends new keys to an existing kiosk.env but never rewrites a value', () => {
  assert.match(SETUP, /grep -q '\^WALL_DEVICE_TOKEN='/);
  assert.match(SETUP, /appended an empty WALL_DEVICE_TOKEN/);
  // deploy.sh never overwrites kiosk.env, so the box in the living room keeps its own copy.
  assert.match(SETUP, /leaving existing keys alone/);
});

test('setup.sh refuses to silently leave the wall pointed at 8123', () => {
  assert.match(SETUP, /grep -q '\^DASHBOARD_URL=\.\*:8123'/);
  assert.match(SETUP, /STALE_DASHBOARD/);
  assert.match(SETUP, /sed -i 's\|\^DASHBOARD_URL=\.\*\|DASHBOARD_URL=http:\/\/homeserver:8124\/\|'/);
});

test('setup.sh still installs every script the boot chain needs', () => {
  for (const script of [
    'kiosk-preflight.sh',
    'kiosk-run.sh',
    'kiosk-watchdog.sh',
    'kiosk-liveness.sh',
    'kiosk-probe.sh',
    'kiosk-snapshot.sh',
    'kiosk-gate.py',
  ]) {
    assert.ok(SETUP.includes(script), `setup.sh stopped installing ${script}`);
  }
});

// ---------------------------------------------------------------------------
// The boot chain, which is verified working and must stay that way
// ---------------------------------------------------------------------------

test('autologin -> labwc -> kiosk.service is still one unbroken chain', () => {
  assert.match(SETUP, /--autologin \$\{KIOSK_USER\}/, 'tty1 must reach a shell with no human');
  assert.match(SETUP, /exec labwc/, 'that login shell is what starts the compositor');
  assert.match(AUTOSTART, /systemctl --user start kiosk\.service/, 'labwc starts the browser');
  assert.match(
    AUTOSTART,
    /import-environment WAYLAND_DISPLAY/,
    'without the session env Chromium cannot find a compositor',
  );
});

test('StartLimitIntervalSec=0 survives — the default would dark the wall permanently', () => {
  // systemd's default is 5 starts in 10s then `failed` forever. A panel powered off at the
  // wrong moment would latch the unit dead until a human SSHed in.
  assert.match(UNIT, /^StartLimitIntervalSec=0$/m);
  assert.match(UNIT, /^Restart=always$/m);
  assert.match(read('pi/config/systemd/kiosk-gate.service'), /^StartLimitIntervalSec=0$/m);
  assert.match(SETUP, /StartLimitIntervalSec=0/, 'and getty@tty1 needs it for the same reason');
});

test('Chromium is resolved at runtime, never hardcoded — trixie renamed the package', () => {
  assert.match(RUN, /command -v chromium \|\| command -v chromium-browser/);
  assert.ok(!/^exec \/usr\/bin\/chromium/m.test(RUN), 'a literal path would break on one distro');
});

test('Chromium still loads the GATE, so it can never paint a network error', () => {
  assert.match(RUN, /START_URL="http:\/\/127\.0\.0\.1:\$\{GATE_PORT\}\/"/);
  assert.match(RUN, /"\$START_URL"/);
});

test('the scale factor the whole design system assumes is still 2.0', () => {
  // web/src/design/README.md: "you design against 960x540 logical px". Changing this number
  // invalidates every tap-target floor and type size in that document.
  const scale = settings(KIOSK_ENV).find((l) => l.startsWith('KIOSK_SCALE='));
  assert.equal(scale, 'KIOSK_SCALE=2.0');
  assert.match(RUN, /--force-device-scale-factor="\$\{KIOSK_SCALE:-2\.0\}"/);
});

test('the DevTools port stays on loopback — it can drive the wall session', () => {
  assert.match(RUN, /--remote-debugging-address=127\.0\.0\.1/);
  assert.match(GATE, /HTTPServer\(\("127\.0\.0\.1", PORT\)/);
});

// ---------------------------------------------------------------------------
// The bundle is served where the API is not
// ---------------------------------------------------------------------------

test('the build output does NOT land in /assets — that path is the avatar route', () => {
  // web/src/views/logic/summary.ts hardcodes ASSET_ROOT = '/assets/', and docs/api.md
  // documents GET /assets/:assetId. A hashed bundle in the same namespace is a collision
  // between a child's face and a script tag.
  const vite = read('web/vite.config.ts');
  assert.match(vite, /assetsDir: 'bundle'/);
  assert.equal(read('web/src/views/logic/summary.ts').includes("ASSET_ROOT = '/assets/'"), true);
});

test('the SPA is wired through Unit F’s fallback seam, with src/http untouched', () => {
  const main = read('stacks/wall/entry/main.ts');
  assert.match(main, /fallback: createStaticHandler/);
  assert.ok(!main.includes('src/http/server.ts'), 'nothing here reaches into Unit F’s internals');
});

test('index.html is uncacheable, which is what makes the hard reload mean anything', () => {
  const staticHandler = read('stacks/wall/entry/static.ts');
  assert.match(staticHandler, /export const NO_STORE = 'no-store, must-revalidate'/);
  assert.match(staticHandler, /return send\(req, res, indexHtml, NO_STORE\)/);
  assert.match(staticHandler, /export const IMMUTABLE =/);
});

test('an unrouted /api path never receives the SPA', () => {
  const staticHandler = read('stacks/wall/entry/static.ts');
  assert.match(staticHandler, /pathname\.startsWith\('\/api\/'\)\) return false/);
});

// ---------------------------------------------------------------------------
// The stack
// ---------------------------------------------------------------------------

test('the compose stack holds no secret, only 1Password references', () => {
  const compose = read('stacks/wall/docker-compose.yml');
  assert.match(compose, /HA_TOKEN: \$\{HA_TOKEN:-\}/, 'interpolated from op run, never literal');
  assert.match(read('stacks/wall/op.env.example'), /HA_TOKEN=op:\/\//);
  // `op://` may appear in the comments — the deploy line is one — but never in a value:
  // compose interpolates values that `op run` has already resolved, it does not resolve refs.
  for (const line of settings(compose)) {
    assert.ok(!line.includes('op://'), `an op:// reference reached a compose value: ${line}`);
  }
});

test('the database is a volume — it is the only state that matters', () => {
  const compose = read('stacks/wall/docker-compose.yml');
  assert.match(compose, /wall-data:\/data/);
  assert.match(compose, /^volumes:\n {2}wall-data:/m);
});

test('the container and the kiosk agree on what "up" means', () => {
  const compose = read('stacks/wall/docker-compose.yml');
  assert.match(compose, /\/api\/health/);
  assert.match(compose, /j\.ok\?0:1/, 'ok, not dbWritable — same rule as kiosk-probe.sh');
});

test('the baseline assets are IN the image — without them the wall is blank on day one', () => {
  // Found live on 2026-08-25, on the first real deploy. The Dockerfile copied src, web, db and
  // stacks/wall/entry, and never `assets/`. Both halves of the bootstrap then no-op silently:
  // seedAssets() returns early on a missing directory, registerBaselineAssets() returns early
  // on a missing manifest, the `asset` table stays empty, and with no `_default` row
  // resolveAsset THROWS on the very first icon. Unit J fixed this chain in the repo; the image
  // layer reintroduced it one level down, where no unit test was looking.
  const dockerfile = read('stacks/wall/Dockerfile');
  const runtime = dockerfile.slice(dockerfile.indexOf('AS runtime'));
  assert.ok(runtime.length > 0, 'expected a runtime stage');
  assert.match(
    runtime,
    /^COPY .*assets .*\/assets$/m,
    'the runtime stage must copy assets/ — seedAssets() reads it from the image at boot',
  );

  // The manifest is what registerBaselineAssets() reads to create the mandatory `_default`
  // fallback row. An assets/ directory without it registers nothing.
  const manifest = JSON.parse(read('assets/manifest.json')) as {
    assets: { id: string; rel_path: string; fallbackFor?: string }[];
  };
  assert.ok(manifest.assets.length > 0);
  assert.ok(
    manifest.assets.some((a) => a.fallbackFor === '_default'),
    'the manifest must carry the _default fallback — it is what makes resolveAsset total',
  );

  // And nothing may exclude assets/ from the build context, which would defeat the COPY.
  for (const line of read('stacks/wall/Dockerfile.dockerignore').split('\n')) {
    const rule = line.trim();
    if (rule.length === 0 || rule.startsWith('#')) continue;
    assert.ok(!/^assets\/?$/.test(rule), `dockerignore excludes the baseline assets: ${rule}`);
  }
});
