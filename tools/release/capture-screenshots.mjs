/**
 * Regenerate docs/images/ from the EXAMPLE household, on a throwaway wall built from the PUBLIC
 * tree.
 *
 *   npm run build && npm run screenshots
 *   node tools/release/capture-screenshots.mjs [--keep] [--only wall-picture,week,...]
 *
 * ## Why it assembles a public tree first
 *
 * `main.ts` and `provision.ts` seed and register art from the repository they run from. Run from
 * the household checkout, the wall would serve the household's own avatars and its own committed
 * scene, and every screenshot would carry them into a public README. So this script does what
 * `build-public.sh` steps 2-3 do — `git archive HEAD`, delete every path in
 * `tools/release/private-only.txt`, overlay `tools/release/public-assets/` — into a temporary
 * directory, and runs the server and provisioning from THAT tree. Only `node_modules` and the
 * built bundle (`web/dist`) come from this checkout; neither carries art.
 *
 * It then proves it: every image the page loaded is fetched again and hashed, and the run fails
 * if an avatar is not one of `public-assets/assets/avatars/*.jpg` or if any served file matches a
 * private-only image.
 *
 * ## The instance
 *
 * Port 8131 on 127.0.0.1, its own database and asset root under the temp directory, no Home
 * Assistant, no calendar adapter, no paid call of any kind. The calendar is eight synthetic events
 * written straight into SQLite as one promoted generation. One chore is claimed for child-b
 * through the wall API so the grown-ups' Waiting screen has a row.
 *
 * ## The browser
 *
 * Raw CDP over Node's global WebSocket; no Playwright or Puppeteer dependency. 960x540 logical at
 * deviceScaleFactor 1.5 (1440x810 PNG). NEVER 2.0: the headless shell hangs capturing the idle
 * picture at 2x (CLAUDE.md). Every CDP call is raced against a timeout, each UI action is its own
 * Runtime.evaluate (React has to re-render between taps), localStorage is cleared before every
 * load, and the URL carries `probe=1` so these taps never reach the door-tap telemetry.
 *
 * No file may exceed 600 KB. A capture over that is retaken at deviceScaleFactor 1; one still
 * over (the full-bleed painted scene and the hero that frames it) is written as a 256-colour
 * palette PNG instead, by a small encoder at the bottom of this file. The summary table says
 * which images took which path.
 *
 * ## The hashes change on every run
 *
 * The clock and the date are in every picture, so a regeneration changes every PNG's sha256.
 * Refresh `tools/release/public-assets.sha256` in the same commit: this script rewrites the
 * `docs/images/` lines in it (sorted by path) after a successful run.
 */

import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { crc32, deflateSync, inflateSync } from 'node:zlib';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(REPO, 'docs/images');
const PORT = 8131;
const ORIGIN = `http://127.0.0.1:${PORT}`;
const ZONE = 'America/Denver';
const PIN = '1111';
const VIEW = { width: 960, height: 540 };
const DSF = 1.5;
const MAX_BYTES = 600 * 1024;

const args = process.argv.slice(2);
const KEEP = args.includes('--keep');
const onlyAt = args.indexOf('--only');
const ONLY = onlyAt === -1 ? null : new Set((args[onlyAt + 1] ?? '').split(',').filter(Boolean));
const wanted = (name) => ONLY === null || ONLY.has(name);

const log = (m) => process.stdout.write(`[screenshots] ${m}\n`);
const die = (m) => {
  process.stderr.write(`[screenshots] ${m}\n`);
  process.exit(1);
};
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function withTimeout(promise, ms, label) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timeout after ${ms} ms: ${label}`)), ms);
    }),
  ]);
}

// ---------------------------------------------------------------------------
// 1. The public tree
// ---------------------------------------------------------------------------

if (!existsSync(join(REPO, 'web/dist/index.html'))) die('web/dist is missing: run npm run build first');
if (!existsSync(join(REPO, 'node_modules/better-sqlite3'))) die('node_modules is missing: run npm ci first');

const TMP = mkdtempSync(join(tmpdir(), 'wall-screenshots-'));
const TREE = join(TMP, 'tree');
mkdirSync(TREE);
log(`work directory ${TMP}`);

function sh(cmd, opts = {}) {
  const r = spawnSync('bash', ['-o', 'pipefail', '-c', cmd], { encoding: 'utf8', ...opts });
  if (r.status !== 0) die(`command failed (${r.status}): ${cmd}\n${r.stderr}`);
  return r.stdout;
}

sh(`git -C "${REPO}" archive --format=tar HEAD | tar -x -C "${TREE}"`);
const privateOnlyPath = join(TREE, 'tools/release/private-only.txt');
const overlay = join(TREE, 'tools/release/public-assets');
if (!existsSync(privateOnlyPath)) die('tools/release/private-only.txt is not committed at HEAD');
if (!existsSync(overlay)) die('tools/release/public-assets/ is not committed at HEAD');
const privateOnly = readFileSync(privateOnlyPath, 'utf8')
  .split('\n')
  .map((l) => l.replace(/\r$/, '').trim())
  .filter((l) => l !== '' && !l.startsWith('#'));
// The private images' hashes, read from this checkout BEFORE they are deleted from the tree, so
// the proof below can say "none of these was served" rather than only "the right ones were".
const privateHashes = new Map();
for (const rel of privateOnly) {
  if (rel.includes('..')) die(`private-only.txt: refusing path ${rel}`);
  const inTree = join(TREE, rel);
  if (existsSync(inTree) && statSync(inTree).isFile() && /\.(jpe?g|png)$/i.test(rel)) {
    privateHashes.set(sha256(readFileSync(inTree)), rel);
  }
  rmSync(inTree, { recursive: true, force: true });
}
sh(`cp -a "${overlay}/." "${TREE}/"`);
rmSync(overlay, { recursive: true, force: true });
rmSync(privateOnlyPath, { force: true });
if (!existsSync(join(TREE, 'assets/scenes/spring-meadow-house.json'))) {
  die('the public tree has no assets/scenes/spring-meadow-house.json after the overlay');
}
const publicOverlay = join(REPO, 'tools/release/public-assets');
for (const rel of privateOnly) {
  if (existsSync(join(TREE, rel)) && !existsSync(join(publicOverlay, rel))) {
    die(`private-only path survived the swap: ${rel}`);
  }
}
const publicAvatarHashes = new Map();
for (const f of readdirSync(join(publicOverlay, 'assets/avatars'))) {
  publicAvatarHashes.set(sha256(readFileSync(join(publicOverlay, 'assets/avatars', f))), `assets/avatars/${f}`);
}
for (const [h, rel] of publicAvatarHashes) {
  if (sha256(readFileSync(join(TREE, rel))) !== h) die(`tree ${rel} is not the public avatar`);
}
symlinkSync(join(REPO, 'node_modules'), join(TREE, 'node_modules'));
symlinkSync(join(REPO, 'web/dist'), join(TREE, 'web/dist'));
log(`public tree assembled: ${privateOnly.length} private-only paths removed, overlay applied`);

const require = createRequire(join(REPO, 'package.json'));
const Database = require('better-sqlite3');

// ---------------------------------------------------------------------------
// 2. The instance
// ---------------------------------------------------------------------------

const exampleSettings = JSON.parse(readFileSync(join(TREE, 'db/household.example.json'), 'utf8'));
const settingsWith = (boardWindows) => JSON.stringify({ ...exampleSettings, boardWindows });

function instanceEnv(data) {
  const env = { ...process.env };
  for (const k of Object.keys(env)) if (k.startsWith('HA_') || k.startsWith('ICS_URL_')) delete env[k];
  delete env.WALL_CALENDAR_SOURCE;
  return {
    ...env,
    WALL_DB: join(data, 'wall.db'),
    WALL_ASSET_ROOT: join(data, 'assets'),
    WALL_PORT: String(PORT),
    WALL_BIND: '127.0.0.1',
    WALL_WEB_ROOT: join(REPO, 'web/dist'),
    TZ: ZONE,
  };
}

function provision(data, flags, input) {
  const r = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'stacks/wall/entry/provision.ts', '--db', join(data, 'wall.db'), ...flags],
    { cwd: TREE, env: instanceEnv(data), encoding: 'utf8', input },
  );
  if (r.status !== 0) die(`provision ${flags.join(' ')} failed (${r.status}):\n${r.stdout}\n${r.stderr}`);
  return r.stdout;
}

function provisionInstance(data, householdSql, boardWindows, chores) {
  mkdirSync(data, { recursive: true });
  provision(data, ['--household', householdSql]);
  provision(data, ['--settings', '-'], settingsWith(boardWindows));
  if (chores) provision(data, ['--chores', chores]);
  provision(data, ['--pin', PIN]);
  const out = provision(data, ['--device', 'screenshots']);
  const m = /^token\s*:\s*(\S+)/m.exec(out);
  if (!m) die('could not read the device token from provision --device');
  return m[1];
}

let server = null;
async function startServer(data) {
  const child = spawn(process.execPath, ['--experimental-strip-types', 'stacks/wall/entry/main.ts'], {
    cwd: TREE,
    env: instanceEnv(data),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (d) => (output += d));
  child.stderr.on('data', (d) => (output += d));
  server = { child, output: () => output };
  for (let i = 0; i < 100; i++) {
    if (child.exitCode !== null) die(`server exited (${child.exitCode}):\n${output}`);
    try {
      const res = await fetch(`${ORIGIN}/api/health`);
      if (res.ok) {
        log(`server up (pid ${child.pid})`);
        return;
      }
    } catch {
      /* not yet */
    }
    await sleep(200);
  }
  die(`server did not answer /api/health:\n${output}`);
}

async function stop(proc, name) {
  if (proc === null || proc.exitCode !== null) return;
  proc.kill('SIGTERM');
  for (let i = 0; i < 50 && proc.exitCode === null; i++) await sleep(100);
  if (proc.exitCode === null) proc.kill('SIGKILL');
  log(`${name} stopped (pid ${proc.pid})`);
}
async function stopServer() {
  if (server !== null) await stop(server.child, 'server');
  server = null;
}

// ---------------------------------------------------------------------------
// 3. The synthetic calendar
// ---------------------------------------------------------------------------

const ymd = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: ZONE }).format(d);
function addDays(date, n) {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}
/** The UTC instant of a wall-clock time in the household's zone. */
function zonedUtc(date, hhmm) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = hhmm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsetAt = (t) => {
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', {
        timeZone: ZONE,
        hourCycle: 'h23',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
        .formatToParts(new Date(t))
        .map((p) => [p.type, p.value]),
    );
    return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute) - t;
  };
  let t = guess - offsetAt(guess);
  t = guess - offsetAt(t);
  return new Date(t).toISOString();
}

function seedCalendar(data) {
  const db = new Database(join(data, 'wall.db'));
  try {
    const today = ymd(new Date());
    const dow = new Date(`${today}T12:00:00Z`).getUTCDay();
    const toSaturday = ((6 - dow + 7) % 7) || 7;
    const timed = (uid, title, offset, start, end, icon, category, emoji) => ({
      uid, title, icon, category, emoji,
      startsAtUtc: zonedUtc(addDays(today, offset), start),
      endsAtUtc: zonedUtc(addDays(today, offset), end),
    });
    const allDay = (uid, title, offset, icon, category, emoji) => ({
      uid, title, icon, category, emoji,
      allDayStart: addDays(today, offset),
      allDayEnd: addDays(today, offset + 1), // end is EXCLUSIVE (db/schema.sql)
    });
    const events = [
      // Two on TODAY, so the board's first column is never empty whatever hour this runs.
      allDay('ex-pajama', 'Pajama day at school', 0, 'ico-outing', 'outing', null),
      timed('ex-soccer', 'Soccer practice', 0, '17:30', '18:30', 'ico-sport', 'sport', '⚽'),
      timed('ex-swim', 'Swimming lesson', 1, '16:00', '17:00', 'ico-sport', 'sport', '🏊'),
      timed('ex-dentist', 'Dentist', 2, '09:30', '10:30', 'ico-medical', 'medical', '🦷'),
      allDay('ex-library', 'Library day', 3, 'ico-outing', 'outing', '📚'),
      timed('ex-piano', 'Piano', 4, '15:30', '16:15', 'ico-music', 'music', '🎹'),
      allDay('ex-grandparents', 'Grandparents visit', toSaturday, 'ico-travel', 'travel', null),
      timed('ex-party', 'Child B birthday party', 6, '14:00', '16:00', 'ico-cake', 'birthday', '🎂'),
    ];
    const now = new Date().toISOString();
    db.transaction(() => {
      db.prepare(
        `INSERT INTO calendar_source (id, label, external_ref, child_id, colour_token, included)
         VALUES ('cs-family', 'Family', 'example-family', NULL, 'blue', 1)`,
      ).run();
      const run = Number(
        db
          .prepare(`INSERT INTO sync_run (source_id, state, started_at_utc) VALUES ('cs-family', 'running', ?)`)
          .run(now).lastInsertRowid,
      );
      const insert = db.prepare(
        `INSERT INTO calendar_event
           (sync_run_id, source_id, external_uid, title, starts_at_utc, ends_at_utc,
            all_day_start_date, all_day_end_date, icon_asset_id, emoji, category)
         VALUES (?, 'cs-family', ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const e of events) {
        insert.run(run, e.uid, e.title, e.startsAtUtc ?? null, e.endsAtUtc ?? null,
          e.allDayStart ?? null, e.allDayEnd ?? null, e.icon, e.emoji, e.category);
      }
      db.prepare(`UPDATE sync_run SET state = 'complete', completed_at_utc = ?, event_count = ? WHERE id = ?`)
        .run(now, events.length, run);
      db.prepare(`UPDATE sync_run SET state = 'promoted', promoted_at_utc = ? WHERE id = ?`).run(now, run);
      db.prepare(`UPDATE calendar_source SET current_sync_run_id = ? WHERE id = 'cs-family'`).run(run);
    })();
    log(`calendar: ${events.length} synthetic events from ${today}`);
  } finally {
    db.close();
  }
}

async function claimOneChore(token, childId) {
  const today = ymd(new Date());
  const headers = { authorization: `Device ${token}` };
  const snap = await (await fetch(`${ORIGIN}/api/wall/v1/snapshot?localDate=${today}`, { headers })).json();
  const row = (snap.chores ?? []).find((c) => c.childId === childId && c.state === 'pending');
  if (!row) die(`no pending chore for ${childId} to claim`);
  const res = await fetch(`${ORIGIN}/api/wall/v1/chores/${row.assignmentId}/claim`, {
    method: 'POST',
    headers: { ...headers, 'content-type': 'application/json' },
    body: JSON.stringify({ childId }),
  });
  if (!res.ok) die(`claim ${row.assignmentId} failed: ${res.status} ${await res.text()}`);
  log(`claimed "${row.labelShort}" for ${childId}`);
}

// ---------------------------------------------------------------------------
// 4. The browser
// ---------------------------------------------------------------------------

function findChrome() {
  if (process.env.CHROME_BIN) return process.env.CHROME_BIN;
  const roots = [
    [join(homedir(), '.cache/ms-playwright'), /^chromium-\d+$/, /^chrome-linux/, 'chrome'],
    [join(homedir(), '.cache/ms-playwright'), /^chromium_headless_shell-\d+$/, /^chrome-linux/, 'headless_shell'],
    [join(homedir(), '.cache/puppeteer/chrome'), /./, /^chrome-linux64$/, 'chrome'],
  ];
  for (const [root, outer, inner, bin] of roots) {
    if (!existsSync(root)) continue;
    for (const a of readdirSync(root).filter((n) => outer.test(n)).sort().reverse()) {
      for (const b of readdirSync(join(root, a)).filter((n) => inner.test(n))) {
        const p = join(root, a, b, bin);
        if (existsSync(p)) return p;
      }
    }
  }
  die('no Chromium found: set CHROME_BIN');
}

let chrome = null;
async function launchChrome() {
  const bin = findChrome();
  const proc = spawn(
    bin,
    [
      '--headless=new',
      '--remote-debugging-port=0',
      `--user-data-dir=${join(TMP, 'profile')}`,
      // Ubuntu 23.10+ forbids unprivileged user namespaces, so Chrome's sandbox cannot start
      // there; the page is our own throwaway instance on loopback.
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      '--hide-scrollbars',
      '--lang=en-US',
      `--window-size=${VIEW.width},${VIEW.height}`,
      `--force-device-scale-factor=${DSF}`,
      'about:blank',
    ],
    // Chrome makes its singleton socket under TMPDIR, and a unix socket path is capped at 108
    // bytes: a deep TMPDIR (a session scratch directory) kills it at start with no message.
    { stdio: ['ignore', 'ignore', 'pipe'], env: { ...process.env, TMPDIR: '/tmp' } },
  );
  chrome = proc;
  const wsUrl = await withTimeout(
    new Promise((resolveUrl, reject) => {
      let err = '';
      proc.stderr.on('data', (d) => {
        err += d;
        const m = /DevTools listening on (ws:\/\/\S+)/.exec(err);
        if (m) resolveUrl(m[1]);
      });
      proc.on('exit', (code, signal) => reject(new Error(`chrome exited ${code ?? signal}: ${err}`)));
    }),
    20000,
    'chrome start',
  );
  const port = new URL(wsUrl).port;
  // The page target can be listed a beat after DevTools starts listening. Poll briefly, and
  // throw rather than die() so the finally below still stops the server and Chrome.
  let page;
  for (let i = 0; i < 50 && !page; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    page = list.find((t) => t.type === 'page');
    if (!page) await sleep(100);
  }
  if (!page) throw new Error('chrome has no page target');
  log(`chrome ${bin.split('/').slice(-3).join('/')} (pid ${proc.pid})`);
  return connect(page.webSocketDebuggerUrl);
}

async function connect(url) {
  const ws = new WebSocket(url);
  const pending = new Map();
  const listeners = [];
  let id = 0;
  ws.addEventListener('message', (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id !== undefined) {
      const p = pending.get(msg.id);
      if (p) {
        pending.delete(msg.id);
        if (msg.error) p.reject(new Error(`${msg.error.message}`));
        else p.resolve(msg.result);
      }
    } else {
      for (const l of listeners) l(msg);
    }
  });
  await withTimeout(new Promise((r) => ws.addEventListener('open', r)), 10000, 'cdp open');
  const send = (method, params = {}, ms = 15000) =>
    withTimeout(
      new Promise((res, reject) => {
        const i = ++id;
        pending.set(i, { resolve: res, reject });
        ws.send(JSON.stringify({ id: i, method, params }));
      }),
      ms,
      method,
    );
  const evaluate = async (expression) => {
    const r = await send('Runtime.evaluate', {
      expression: `(() => { try { return ${expression} } catch (e) { return { __error: String(e) }; } })()`,
      awaitPromise: true,
      returnByValue: true,
    });
    const v = r?.result?.value;
    if (v && v.__error) throw new Error(`in-page: ${v.__error}`);
    return v;
  };
  return { send, evaluate, on: (fn) => listeners.push(fn), close: () => ws.close() };
}

// ---------------------------------------------------------------------------
// 5. The captures
// ---------------------------------------------------------------------------

const servedImages = new Set();
let cdp = null;
let token = null;
const captured = [];
const failed = [];

const viewport = { width: VIEW.width, height: VIEW.height, dsf: DSF };
async function setViewport(width, height, dsf) {
  Object.assign(viewport, { width, height, dsf });
  await cdp.send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: dsf, mobile: false });
}

async function navigate(url) {
  await cdp.send('Page.navigate', { url });
  for (let i = 0; i < 60; i++) {
    const state = await cdp.evaluate('document.readyState').catch(() => null);
    if (state === 'complete') return;
    await sleep(100);
  }
}

const settle = (ms) => cdp.evaluate(`new Promise((r) => setTimeout(() => r(true), ${ms}))`);

/** Readiness as panel-audit.mjs reads it: the button count is non-zero and stable, then still. */
async function ready(settleMs = 1200) {
  let last = -1;
  for (let i = 0; i < 60; i++) {
    const n = await cdp.evaluate(`document.querySelectorAll('button,[role=button]').length`);
    if (typeof n === 'number' && n > 0 && n === last) break;
    last = n;
    await sleep(250);
  }
  await settle(settleMs);
}

/** A clean load: clear this origin's storage, then boot with the device token in the fragment. */
async function freshLoad() {
  await navigate(`${ORIGIN}/api/health`);
  await cdp.evaluate('(localStorage.clear(), sessionStorage.clear(), true)');
  await navigate('about:blank');
  await navigate(`${ORIGIN}/#dt=${token}&probe=1`);
  await ready();
}

const press = (selector) =>
  cdp.evaluate(`(() => {
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el || el.tagName.toLowerCase() !== 'button') return false;
    el.click();
    return true;
  })()`);

/** A scene target listens for pointerdown, so it is pressed like a finger: at its centre. */
async function touch(selector, index = 0) {
  const box = await cdp.evaluate(`(() => {
    const el = document.querySelectorAll(${JSON.stringify(selector)})[${index}];
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);
  if (box === null) return false;
  for (const type of ['mousePressed', 'mouseReleased']) {
    await cdp.send('Input.dispatchMouseEvent', { type, x: box.x, y: box.y, button: 'left', clickCount: 1 });
  }
  return true;
}

async function waitFor(expression, ms) {
  for (let waited = 0; waited < ms; waited += 150) {
    if (await cdp.evaluate(expression)) return true;
    await sleep(150);
  }
  return false;
}

async function enterPin() {
  if (!(await waitFor(`document.querySelector('[data-pin-door]') !== null`, 5000))) throw new Error('no PIN pad');
  for (const digit of PIN) {
    if (!(await press(`[data-pin-door] [data-pin-key="${digit}"]`))) throw new Error(`PIN key ${digit} not live`);
    await settle(150);
  }
  await settle(250);
  if (!(await press('[data-pin-door] [data-pin-key="check"]'))) throw new Error('PIN check not live');
  const inside = await waitFor(
    `document.querySelector('[data-pin-door]') === null && document.querySelector('[data-home-tile]') !== null`,
    6000,
  );
  if (!inside) throw new Error('the door refused the PIN');
  await ready();
}

async function grab() {
  return Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' }, 20000)).data, 'base64');
}

/**
 * One PNG, at most 600 KB. The steps, in order: the capture as it stands; on a hang, or when
 * it is over the cap, the same view at deviceScaleFactor 1; and when even that is over the cap
 * (a full-bleed painted scene is), a 256-colour palette re-encode of the SHARPER capture,
 * done here with node:zlib so the script still has no image dependency.
 */
async function shoot(name) {
  const path = join(OUT, `${name}.png`);
  const at = { ...viewport };
  const notes = [];
  let buf = null;
  try {
    buf = await grab();
  } catch (e) {
    notes.push(`hung at ${at.dsf}x (${e.message})`);
  }
  const first = buf;
  // The unreduced capture, for the hero to frame without re-quantizing a quantized picture.
  if (first !== null) writeFileSync(join(TMP, `raw-${name}.png`), first);
  try {
    if ((buf === null || buf.length > MAX_BYTES) && at.dsf !== 1) {
      if (buf !== null) notes.push(`${Math.round(buf.length / 1024)} KB at ${at.dsf}x`);
      await setViewport(at.width, at.height, 1);
      await settle(600);
      buf = await grab();
    }
  } catch (e) {
    failed.push(`${name} (${e.message})`);
    return;
  } finally {
    if (at.dsf !== 1) await setViewport(at.width, at.height, at.dsf).catch(() => {});
  }
  if (buf !== first && buf.length <= MAX_BYTES) notes.push('kept the 1x capture');
  if (buf.length > MAX_BYTES) {
    notes.push(`${Math.round(buf.length / 1024)} KB at 1x`);
    const source = first ?? buf;
    buf = paletteReencode(source);
    notes.push(`${first !== null ? `${at.dsf}x` : '1x'} capture re-encoded to 256 colours`);
  }
  writeFileSync(path, buf);
  captured.push({ name, bytes: buf.length, notes });
  log(`${name}.png ${Math.round(buf.length / 1024)} KB${notes.length ? `  (${notes.join('; ')})` : ''}`);
}

// --- A minimal PNG decoder (8-bit RGB/RGBA, non-interlaced: what Chrome writes) and a palette
// encoder. Median cut over a 15-bit histogram, Floyd-Steinberg dithering.

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function decodePng(buf) {
  if (!buf.subarray(0, 8).equals(PNG_SIG)) throw new Error('not a PNG');
  let off = 8;
  let width = 0, height = 0, colourType = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('latin1', off + 4, off + 8);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      colourType = body[9];
      if (body[8] !== 8 || body[12] !== 0 || (colourType !== 2 && colourType !== 6)) {
        throw new Error('unsupported PNG layout');
      }
    } else if (type === 'IDAT') idat.push(body);
    off += 12 + len;
  }
  const bpp = colourType === 6 ? 4 : 3;
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const out = Buffer.alloc(width * height * 3);
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = Buffer.from(raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)));
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? line[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = line[i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[i] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 3] = line[x * bpp];
      out[(y * width + x) * 3 + 1] = line[x * bpp + 1];
      out[(y * width + x) * 3 + 2] = line[x * bpp + 2];
    }
    prev = line;
  }
  return { width, height, rgb: out };
}

function medianCut(rgb, colours) {
  const hist = new Uint32Array(32768);
  for (let i = 0; i < rgb.length; i += 3) hist[((rgb[i] >> 3) << 10) | ((rgb[i + 1] >> 3) << 5) | (rgb[i + 2] >> 3)]++;
  const keys = [];
  for (let k = 0; k < hist.length; k++) if (hist[k] > 0) keys.push(k);
  const ch = (k, c) => (c === 0 ? k >> 10 : c === 1 ? (k >> 5) & 31 : k & 31);
  let boxes = [keys];
  while (boxes.length < colours) {
    let best = -1, bestScore = 0, bestCh = 0;
    boxes.forEach((box, bi) => {
      if (box.length < 2) return;
      let pop = 0;
      for (const k of box) pop += hist[k];
      for (let c = 0; c < 3; c++) {
        let lo = 31, hi = 0;
        for (const k of box) { const v = ch(k, c); if (v < lo) lo = v; if (v > hi) hi = v; }
        const score = (hi - lo) * Math.sqrt(pop);
        if (score > bestScore) { bestScore = score; best = bi; bestCh = c; }
      }
    });
    if (best === -1) break;
    const box = boxes[best].sort((p, q) => ch(p, bestCh) - ch(q, bestCh));
    let total = 0;
    for (const k of box) total += hist[k];
    let acc = 0, cut = 1;
    for (let i = 0; i < box.length - 1; i++) { acc += hist[box[i]]; if (acc >= total / 2) { cut = i + 1; break; } }
    boxes.splice(best, 1, box.slice(0, cut), box.slice(cut));
  }
  return boxes.map((box) => {
    let n = 0, r = 0, g = 0, b = 0;
    for (const k of box) { const w = hist[k]; n += w; r += ch(k, 0) * w; g += ch(k, 1) * w; b += ch(k, 2) * w; }
    return [Math.round((r / n) * 8.226), Math.round((g / n) * 8.226), Math.round((b / n) * 8.226)];
  });
}

function paletteReencode(png) {
  const { width, height, rgb } = decodePng(png);
  const palette = medianCut(rgb, 256);
  const cache = new Int16Array(32768).fill(-1);
  const nearest = (r, g, b) => {
    const key = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
    if (cache[key] >= 0) return cache[key];
    let best = 0, bestD = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const [pr, pg, pb] = palette[i];
      const d = (pr - r) ** 2 * 2 + (pg - g) ** 2 * 4 + (pb - b) ** 2 * 3;
      if (d < bestD) { bestD = d; best = i; }
    }
    cache[key] = best;
    return best;
  };
  const err = new Float32Array(rgb.length);
  for (let i = 0; i < rgb.length; i++) err[i] = rgb[i];
  const rows = Buffer.alloc((width + 1) * height);
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);
  for (let y = 0; y < height; y++) {
    rows[y * (width + 1)] = 0;
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 3;
      const r = clamp(err[i]), g = clamp(err[i + 1]), b = clamp(err[i + 2]);
      const idx = nearest(r, g, b);
      rows[y * (width + 1) + 1 + x] = idx;
      const e = [r - palette[idx][0], g - palette[idx][1], b - palette[idx][2]];
      const spread = (dx, dy, f) => {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || xx >= width || yy >= height) return;
        const j = (yy * width + xx) * 3;
        err[j] += e[0] * f; err[j + 1] += e[1] * f; err[j + 2] += e[2] * f;
      };
      spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
    }
  }
  const chunk = (type, body) => {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(body.length, 0);
    head.write(type, 4, 'latin1');
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), body])) >>> 0, 0);
    return Buffer.concat([head, body, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 3; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  const plte = Buffer.from(palette.flat());
  return Buffer.concat([
    PNG_SIG,
    chunk('IHDR', ihdr),
    chunk('PLTE', plte),
    chunk('IDAT', deflateSync(rows, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

async function capture(name, steps) {
  if (!wanted(name)) return;
  try {
    await steps();
    await shoot(name);
  } catch (e) {
    failed.push(`${name} (${e.message})`);
    log(`${name}: FAILED ${e.message}`);
  }
}

function heroHtml(picture) {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: 1600px; height: 900px; overflow: hidden; }
  body {
    background: radial-gradient(ellipse at 50% 30%, #fbf3e4 0%, #f1e3cb 55%, #e4d0b0 100%);
    position: relative;
  }
  .frame {
    position: absolute; left: 50%; top: 70px; transform: translateX(-50%);
    width: 1280px; height: 720px; padding: 16px; background: #1d1d1f; border-radius: 14px;
    box-shadow: 0 24px 60px rgba(70, 45, 15, 0.35), 0 4px 12px rgba(0, 0, 0, 0.25);
  }
  .frame img { display: block; width: 1280px; height: 720px; border-radius: 2px; }
  .shelf {
    position: absolute; left: 50%; transform: translateX(-50%); top: 846px;
    width: 1400px; height: 10px; border-radius: 5px;
    background: linear-gradient(#b07a45, #8a5a2e);
    box-shadow: 0 6px 14px rgba(70, 45, 15, 0.3);
  }
</style></head><body>
  <div class="frame"><img src="${picture}" alt=""></div>
  <div class="shelf"></div>
</body></html>`;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

async function main() {
  mkdirSync(OUT, { recursive: true });

  const data = join(TMP, 'data');
  // The roster's own four chores only: db/chores.example.json re-states a bed chore of its
  // own, and applied on top it would draw "Make your bed" twice on a child's screen.
  // Plus two of the pet's own asks (category "pet", kind "extra"), so the dog's sheet shows
  // what it is for rather than "Nothing today". Screenshot-only: the example household keeps
  // its own list.
  const petChores = join(TMP, 'pet-chores.json');
  writeFileSync(petChores, JSON.stringify({
    chores: [
      { id: 'ch-shot-fetch', labelShort: 'Fetch', labelFull: 'Throw my ball', iconAssetId: 'ico-fetch',
        category: 'pet', assignmentModel: 'shared', basePoints: 2, kind: 'extra',
        rrule: 'FREQ=DAILY', dueByLocal: null, rotation: [] },
      { id: 'ch-shot-walk', labelShort: 'Walk', labelFull: 'Take me for a walk', iconAssetId: 'ico-leash',
        category: 'pet', assignmentModel: 'shared', basePoints: 4, kind: 'extra',
        rrule: 'FREQ=DAILY', dueByLocal: null, rotation: [] },
    ],
    retire: [],
    restore: [],
  }));
  token = provisionInstance(data, 'db/household.example.sql', [], petChores);
  seedCalendar(data);
  await startServer(data);
  await claimOneChore(token, 'child-b');

  cdp = await launchChrome();
  await cdp.send('Page.enable');
  await cdp.send('Network.enable');
  cdp.on((msg) => {
    if (msg.method === 'Network.responseReceived' && msg.params.type === 'Image') {
      servedImages.add(msg.params.response.url);
    }
  });
  await setViewport(VIEW.width, VIEW.height, DSF);

  // --- The picture, with no board windows: the idle wall is the scene all day.
  await capture('wall-picture', async () => {
    await freshLoad();
    if (!(await cdp.evaluate(`document.querySelector('[data-backdrop]') !== null`))) throw new Error('no picture');
    await settle(800);
  });
  await capture('dog-sheet', async () => {
    await freshLoad();
    if (!(await touch('[data-scene-tap][aria-label="the dog"]'))) throw new Error('no dog on the picture');
    await ready();
  });
  await capture('child-picture', async () => {
    await freshLoad();
    // child-c sorts third, so its slot is 3 % 3 = 0 (logic/sceneFace.ts slotForChild). The
    // targets are drawn in manifest order, so find slot 0's index in the public manifest.
    const manifest = JSON.parse(readFileSync(join(TREE, 'assets/scenes/spring-meadow-house.json'), 'utf8'));
    const index = manifest.regions.findIndex((r) => r.slot === 0);
    if (!(await touch('[data-scene-tap]:not([aria-label])', index))) throw new Error('no child target');
    await ready();
  });

  // --- The board all day.
  provision(data, ['--settings', '-'], settingsWith([{ opensAtLocal: '00:00', closesAtLocal: '23:59' }]));
  await capture('wall-board', async () => {
    await freshLoad();
  });
  for (const [name, child] of [['child-emergent', 'child-b'], ['child-fluent', 'child-a']]) {
    await capture(name, async () => {
      await freshLoad();
      if (!(await press(`[data-rail-child="${child}"] button`))) throw new Error(`no rail face for ${child}`);
      await ready();
    });
  }
  await capture('week', async () => {
    await freshLoad();
    if (!(await press('[data-door="calendar"]'))) throw new Error('no calendar door');
    await ready();
  });
  await capture('grownups-home', async () => {
    await freshLoad();
    if (!(await press('[data-door="grownups"]'))) throw new Error('no grown-ups door');
    await ready();
    await enterPin();
  });
  await capture('grownups-waiting', async () => {
    await freshLoad();
    if (!(await press('[data-door="grownups"]'))) throw new Error('no grown-ups door');
    await ready();
    await enterPin();
    if (!(await press('[data-grownup-nav="waiting"]'))) throw new Error('no Waiting section');
    await ready();
  });
  await capture('pictures-catalog', async () => {
    await freshLoad();
    if (!(await press('[data-door="grownups"]'))) throw new Error('no grown-ups door');
    await ready();
    await enterPin();
    if (!(await press('[data-grownup-leave]'))) throw new Error('no Leave');
    await ready();
    if (!(await press('[data-door="pictures"]'))) throw new Error('no pictures door');
    await ready();
  });

  // --- A household with no children, on a fresh database.
  if (wanted('wall-nokids')) {
    await stopServer();
    const data2 = join(TMP, 'data2');
    token = provisionInstance(data2, 'db/household.nokids.example.sql', [], null);
    await startServer(data2);
    await capture('wall-nokids', async () => {
      await freshLoad();
      await settle(800);
    });
  }

  // --- The hero: the picture in a frame on a wall, drawn by CSS. No photo, no model.
  await capture('hero', async () => {
    const raw = join(TMP, 'raw-wall-picture.png');
    const picture = existsSync(raw) ? raw : join(OUT, 'wall-picture.png');
    if (!existsSync(picture)) throw new Error('wall-picture.png is needed first');
    copyFileSync(picture, join(TMP, 'hero-picture.png'));
    writeFileSync(join(TMP, 'hero.html'), heroHtml('hero-picture.png'));
    await setViewport(1600, 900, 1);
    await navigate(pathToFileURL(join(TMP, 'hero.html')).href);
    await settle(500);
  });

  // --- The proof: every image the page loaded, fetched again and hashed.
  const proof = await proveImages();
  return proof;
}

async function proveImages() {
  // The second instance is the one running now; its asset root seeded from the same tree.
  const urls = [...servedImages].filter((u) => u.startsWith(ORIGIN));
  for (const id of ['av-a', 'av-b', 'av-c']) urls.push(`${ORIGIN}/assets/${id}`);
  const rows = [];
  let bad = 0;
  for (const url of [...new Set(urls)]) {
    let res;
    try {
      res = await fetch(url);
    } catch {
      continue;
    }
    if (!res.ok) {
      // The no-children instance has no avatar rows of its own; the first instance's are
      // proven from its asset root below.
      rows.push({ url, sha: `HTTP ${res.status}`, verdict: 'not served by this instance' });
      continue;
    }
    const sha = sha256(Buffer.from(await res.arrayBuffer()));
    let verdict = 'other (icon/scene/backdrop)';
    if (privateHashes.has(sha)) {
      verdict = `PRIVATE ${privateHashes.get(sha)}`;
      bad++;
    } else if (publicAvatarHashes.has(sha)) verdict = `public ${publicAvatarHashes.get(sha)}`;
    rows.push({ url: url.slice(ORIGIN.length), sha, verdict });
  }
  // The avatars as seeded into the first instance's asset root, which is what /assets/av-* served.
  for (const f of ['a.jpg', 'b.jpg', 'c.jpg']) {
    const p = join(TMP, 'data/assets/avatars', f);
    if (!existsSync(p)) continue;
    const sha = sha256(readFileSync(p));
    const ok = publicAvatarHashes.get(sha) === `assets/avatars/${f}`;
    if (!ok) bad++;
    rows.push({ url: `(asset root) avatars/${f}`, sha, verdict: ok ? `public assets/avatars/${f}` : 'NOT the public avatar' });
  }
  for (const r of rows) log(`proof ${r.sha.slice(0, 16)}  ${r.verdict.padEnd(34)} ${r.url}`);
  if (bad > 0) die(`${bad} served image(s) failed the public-art proof`);
  return rows;
}

function refreshAllowlist() {
  const list = join(REPO, 'tools/release/public-assets.sha256');
  const keep = readFileSync(list, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '' && !/\sdocs\/images\//.test(l));
  for (const f of readdirSync(OUT).filter((n) => n.endsWith('.png'))) {
    keep.push(`${sha256(readFileSync(join(OUT, f)))}  docs/images/${f}`);
  }
  keep.sort((a, b) => {
    const pa = a.split(/\s+/)[1];
    const pb = b.split(/\s+/)[1];
    return pa < pb ? -1 : pa > pb ? 1 : 0;
  });
  writeFileSync(list, `${keep.join('\n')}\n`);
  log(`public-assets.sha256 refreshed (${keep.length} lines)`);
}

let exitCode = 0;
try {
  await main();
} catch (e) {
  exitCode = 1;
  process.stderr.write(`[screenshots] ${e.stack ?? e}\n`);
} finally {
  if (cdp !== null) cdp.close();
  await stop(chrome, 'chrome');
  await stopServer();
  if (!KEEP) rmSync(TMP, { recursive: true, force: true });
  else log(`kept ${TMP}`);
}

const big = captured.filter((c) => c.bytes > MAX_BYTES);
process.stdout.write('\n  captured\n');
for (const c of captured) {
  const notes = c.notes.length > 0 ? `  ${c.notes.join('; ')}` : '';
  process.stdout.write(`    ${c.name.padEnd(20)} ${String(Math.round(c.bytes / 1024)).padStart(4)} KB${notes}\n`);
}
if (failed.length > 0) {
  process.stdout.write('  FAILED\n');
  for (const f of failed) process.stdout.write(`    ${f}\n`);
}
for (const c of big) process.stdout.write(`  OVER ${MAX_BYTES / 1024} KB: ${c.name}\n`);
if (exitCode === 0 && failed.length === 0 && big.length === 0) refreshAllowlist();
process.exit(exitCode !== 0 || failed.length > 0 || big.length > 0 ? 1 : 0);
