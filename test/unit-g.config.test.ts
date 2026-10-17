/**
 * The household's settings (2026-10-12): `src/config/household.ts` and its Python twin.
 *
 * What is pinned here: the defaults ARE the wall as it was (so a database with no settings rows
 * behaves exactly as before), every validation refuses its own bad case, the rows round-trip, a
 * bad row costs only its own key, `provision.ts --settings` is all-or-nothing, and — the
 * contract — the TypeScript and Python loaders turn the example into the same thing.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../src/db/connection.ts';
import { migrate } from '../src/db/migrate.ts';
import {
  DEFAULT_HOUSEHOLD,
  HOUSEHOLD_ROW_KEYS,
  parseHousehold,
  readHousehold,
  toView,
  writeHousehold,
  type HouseholdConfig,
} from '../src/config/household.ts';
import { IDLE_BOARD_WINDOWS } from '../web/src/views/logic/timeTrust.ts';

const EXAMPLE = 'db/household.example.json';

function freshDb() {
  const db = openDatabase({ path: ':memory:' });
  migrate(db);
  return db;
}

function errorsOf(json: unknown): string[] {
  const r = parseHousehold(json);
  assert.equal(r.ok, false, `expected a refusal for ${JSON.stringify(json)}`);
  return r.ok ? [] : r.errors;
}

/** Sorted keys, recursively, so two loaders' dict orders cannot make equal things unequal. */
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v !== null && typeof v === 'object') {
    return Object.fromEntries(
      Object.keys(v)
        .sort()
        .map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]),
    );
  }
  return v;
}

test('(a) an empty document is refused on version', () => {
  const errors = errorsOf({});
  assert.ok(errors.some((e) => e.startsWith('version:')), errors.join('\n'));
});

test('(b) the defaults parse, and they are the wall as it was', () => {
  const r = parseHousehold(DEFAULT_HOUSEHOLD);
  assert.ok(r.ok, r.ok ? '' : r.errors.join('\n'));
  assert.deepEqual(r.config, DEFAULT_HOUSEHOLD);
  assert.equal(DEFAULT_HOUSEHOLD.timezone, 'America/Denver');
  // The board windows were a constant in the bundle; the default must not move them.
  assert.deepEqual(DEFAULT_HOUSEHOLD.boardWindows, IDLE_BOARD_WINDOWS);
  assert.deepEqual(DEFAULT_HOUSEHOLD.pets, []);
  // Only version is required: everything else defaults.
  const minimal = parseHousehold({ version: 1 });
  assert.ok(minimal.ok);
  assert.deepEqual(minimal.config, DEFAULT_HOUSEHOLD);
});

test('(c) every validation refuses its own bad case, as "<path>: <why>"', () => {
  const cases: [Record<string, unknown>, string][] = [
    [{ timezone: 'Mars/Olympus_Mons' }, 'timezone:'],
    [{ locale: 'not a locale!!' }, 'locale:'],
    [{ currency: 'DOLLARS' }, 'currency:'],
    [{ features: { chores: 'yes' } }, 'features.chores:'],
    [{ features: { bogus: true } }, 'features.bogus:'],
    [{ boardWindows: [{ opensAtLocal: '5:45', closesAtLocal: '08:30' }] }, 'boardWindows[0].opensAtLocal:'],
    [{ boardWindows: [{ opensAtLocal: '05:45', closesAtLocal: '24:00' }] }, 'boardWindows[0].closesAtLocal:'],
    [{ boardWindows: [{ opensAtLocal: '09:00', closesAtLocal: '08:00' }] }, 'boardWindows[0]:'],
    [{ pets: [{ id: 'a', kind: 'dog', name: 'A' }, { id: 'b', kind: 'dog', name: 'B' }] }, 'pets:'],
    [{ pets: [{ id: 'cat', kind: 'cat', name: 'Tom' }] }, 'pets[0].kind:'],
    [{ pets: [{ id: 'dog', kind: 'dog', name: '' }] }, 'pets[0].name:'],
    [{ pets: [{ id: 'dog', kind: 'dog', name: 'x'.repeat(25) }] }, 'pets[0].name:'],
    [{ pets: [{ id: 'Dog!', kind: 'dog', name: 'Rex' }] }, 'pets[0].id:'],
    [{ scenes: { mode: 'sometimes' } }, 'scenes.mode:'],
    [{ scenes: { provider: 'openai' } }, 'scenes.provider:'],
    [{ scenes: { styles: 'all' } }, 'scenes.styles:'],
    [{ scenes: { settings: [1] } }, 'scenes.settings:'],
    [{ scenes: { premises: null } }, 'scenes.premises:'],
    [{ scenes: { weeklyBudgetUsd: -1 } }, 'scenes.weeklyBudgetUsd:'],
    [{ scenes: { activities: 'sometimes' } }, 'scenes.activities:'],
    [{ timezne: 'Europe/Berlin' }, 'timezne: unknown key'],
  ];
  for (const [patch, prefix] of cases) {
    const errors = errorsOf({ version: 1, ...patch });
    assert.ok(
      errors.some((e) => e.startsWith(prefix)),
      `${JSON.stringify(patch)} → ${JSON.stringify(errors)}; expected one starting "${prefix}"`,
    );
  }
  // The pet rule names the limit in words an adult can act on.
  assert.ok(
    errorsOf({ version: 1, pets: [{ id: 'cat', kind: 'cat', name: 'Tom' }] }).some((e) =>
      e.includes('v0.1 supports at most one pet, of kind dog'),
    ),
  );
  // `_` keys are comments.
  assert.ok(parseHousehold({ version: 1, _comment: 'hello', features: { _why: 'x' } }).ok);
});

test('(d) writeHousehold then readHousehold round-trips', () => {
  const db = freshDb();
  try {
    const config: HouseholdConfig = {
      ...DEFAULT_HOUSEHOLD,
      timezone: 'Europe/Berlin',
      locale: 'de-DE',
      currency: 'EUR',
      features: { chores: true, money: false, routines: true, countdowns: false },
      boardWindows: [{ opensAtLocal: '06:00', closesAtLocal: '07:30' }],
      pets: [{ id: 'dog', kind: 'dog', name: 'Biscuit' }],
      scenes: { ...DEFAULT_HOUSEHOLD.scenes, mode: 'static', weeklyBudgetUsd: 2.5 },
    };
    writeHousehold(db, config);
    assert.deepEqual(readHousehold(db), config);
    // Writing again updates in place rather than conflicting.
    writeHousehold(db, DEFAULT_HOUSEHOLD);
    assert.deepEqual(readHousehold(db), DEFAULT_HOUSEHOLD);
    const n = db
      .prepare(`SELECT COUNT(*) AS n FROM household_config WHERE key IN (${HOUSEHOLD_ROW_KEYS.map(() => '?').join(',')})`)
      .get(...HOUSEHOLD_ROW_KEYS) as { n: number };
    assert.equal(n.n, HOUSEHOLD_ROW_KEYS.length);
    // An empty table reads as the defaults.
    assert.deepEqual(readHousehold(freshDb()), DEFAULT_HOUSEHOLD);
  } finally {
    db.close();
  }
});

test('(e) a malformed row costs only its own key, and warns once', () => {
  const db = freshDb();
  try {
    writeHousehold(db, { ...DEFAULT_HOUSEHOLD, timezone: 'Europe/Berlin' });
    db.prepare(`UPDATE household_config SET value_text = ? WHERE key = 'board_windows'`).run(
      '[{"opensAtLocal":"25:00","closesAtLocal":"08:30"}]',
    );
    const seen: string[] = [];
    const warn = (m: string): void => {
      seen.push(m);
    };
    const first = readHousehold(db, warn);
    assert.deepEqual(first.boardWindows, DEFAULT_HOUSEHOLD.boardWindows);
    assert.equal(first.timezone, 'Europe/Berlin', 'the good rows still apply');
    readHousehold(db, warn);
    assert.equal(seen.length, 1, `warned ${String(seen.length)} times: ${seen.join(' | ')}`);
    assert.match(seen[0] ?? '', /board_windows/);

    // Not JSON at all is the same answer.
    db.prepare(`UPDATE household_config SET value_text = '{' WHERE key = 'pets'`).run();
    assert.deepEqual(readHousehold(db, () => {}).pets, []);
  } finally {
    db.close();
  }
});

test('(f) CONTRACT: the Python twin reads the example exactly as the TypeScript loader does', () => {
  const py = JSON.parse(execFileSync('python3', ['tools/household_config.py', '--dump', EXAMPLE], { encoding: 'utf8' }));
  const parsed = parseHousehold(JSON.parse(readFileSync(EXAMPLE, 'utf8')));
  assert.ok(parsed.ok, parsed.ok ? '' : parsed.errors.join('\n'));
  assert.deepEqual(sortKeys(py), sortKeys(JSON.parse(JSON.stringify(parsed.config))));
  // The defaults too: both sides must agree on what a missing key means.
  const dir = mkdtempSync(join(tmpdir(), 'household-'));
  try {
    const minimal = join(dir, 'minimal.json');
    writeFileSync(minimal, '{"version": 1}');
    const pyDefaults = JSON.parse(execFileSync('python3', ['tools/household_config.py', '--dump', minimal], { encoding: 'utf8' }));
    assert.deepEqual(sortKeys(pyDefaults), sortKeys(JSON.parse(JSON.stringify(DEFAULT_HOUSEHOLD))));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('toView drops scenes and gives a pet its id and name only', () => {
  const view = toView({ ...DEFAULT_HOUSEHOLD, pets: [{ id: 'dog', kind: 'dog', name: 'Biscuit' }] });
  assert.ok(!('scenes' in view));
  assert.ok(!('version' in view));
  assert.deepEqual(view.pets, [{ id: 'dog', name: 'Biscuit' }]);
  assert.deepEqual(view.boardWindows, DEFAULT_HOUSEHOLD.boardWindows);
});

test('provision --settings is all-or-nothing, reads stdin, and will not ride with --household', () => {
  const dir = mkdtempSync(join(tmpdir(), 'household-prov-'));
  const dbPath = join(dir, 'wall.db');
  const run = (args: string[], input?: string) =>
    spawnSync(process.execPath, ['--experimental-strip-types', 'stacks/wall/entry/provision.ts', '--db', dbPath, ...args], {
      encoding: 'utf8',
      input,
    });
  try {
    const good = run(['--settings', EXAMPLE]);
    assert.equal(good.status, 0, good.stderr);
    assert.match(good.stdout, /settings applied: timezone, locale, currency, features, board_windows, pets, scenes/);

    const bad = join(dir, 'bad.json');
    writeFileSync(bad, JSON.stringify({ version: 1, timezone: 'Europe/Berlin', pets: [{ id: 'c', kind: 'cat', name: 'Tom' }], scenes: { mode: 'x' } }));
    const refused = run(['--settings', bad]);
    assert.equal(refused.status, 1);
    assert.match(refused.stderr, /pets\[0\]\.kind:/);
    assert.match(refused.stderr, /scenes\.mode:/);
    const peek = openDatabase({ path: dbPath });
    try {
      const kept = readHousehold(peek, () => {});
      assert.equal(kept.timezone, 'America/Denver', 'a refused file wrote nothing');
      assert.deepEqual(kept.pets, [{ id: 'dog', kind: 'dog', name: 'Biscuit' }]);
    } finally {
      peek.close();
    }

    const stdin = run(['--settings', '-'], JSON.stringify({ version: 1, timezone: 'Europe/Berlin' }));
    assert.equal(stdin.status, 0, stdin.stderr);

    const both = run(['--settings', EXAMPLE, '--household', 'db/household.example.sql']);
    assert.equal(both.status, 2);
    assert.match(both.stderr, /REFUSING/);

    const db = openDatabase({ path: dbPath });
    try {
      const after = readHousehold(db, () => {});
      // The stdin run applied a whole document: its zone, and the default (no) pet.
      assert.equal(after.timezone, 'Europe/Berlin');
      assert.deepEqual(after.pets, []);
    } finally {
      db.close();
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
