/**
 * The household's SETTINGS — one validated config, one loader per language (2026-10-12).
 *
 * The roster (children, routines, chores, countdowns, calendars) stays where it is: SQL and
 * JSON files applied by `provision.ts`, because those are rows with history. What lives here
 * is the household's SHAPE: its zone, locale and currency, which surfaces it uses, when the
 * board replaces the picture, its pets, and what the scene tools may draw.
 *
 * The authored file is `db/household.json` (gitignored; `db/household.example.json` is the
 * committed twin). `provision.ts --settings` validates it with `parseHousehold` and writes one
 * `household_config` row per top-level key through `writeHousehold`. The app NEVER reads the
 * file; it reads the rows, through `readHousehold`. Every missing row reads as its default, and
 * the defaults are the wall as it was before this module existed — so a database with no
 * settings rows behaves exactly as it always did.
 *
 * `tools/household_config.py` is the Python twin, read by the host-side scene tools.
 * `test/unit-g.config.test.ts` runs both over the example and compares the normalized output:
 * the schema is the contract and that test is what keeps the two loaders one.
 *
 * THIS IS THE ONLY MODULE THAT KNOWS THESE ROW KEYS. Sibling keys in the same table, owned
 * elsewhere and not read here: `cents_per_point` (src/domain/settings), `departures`
 * (src/domain/departures), `wall_theme` (src/domain/theme), `parent_pin_scrypt` (src/http/auth).
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../db/connection.ts';
import { isLocalTime } from '../time.ts';
import {
  DEFAULT_CURRENCY,
  DEFAULT_LOCALE,
  DEFAULT_TZ,
  type BoardWindow,
  type HouseholdFeatures,
  type HouseholdView,
} from '../types.ts';

export const HOUSEHOLD_CONFIG_VERSION = 1;

export const SCENE_MODES = ['off', 'static', 'generated'] as const;
export type SceneMode = (typeof SCENE_MODES)[number];
export const SCENE_PROVIDERS = ['fal', 'nvidia', 'nous'] as const;
export type SceneProvider = (typeof SCENE_PROVIDERS)[number];
/** Where the children's activities come from: an AI writer held to code guardrails, or the table. */
export const SCENE_ACTIVITY_SOURCES = ['written', 'table'] as const;
export type SceneActivitySource = (typeof SCENE_ACTIVITY_SOURCES)[number];
/** Who chooses each run's picture: the AI director (rotation as its fallback), or rotation only. */
export const SCENE_DIRECTORS = ['ai', 'rotation'] as const;
export type SceneDirector = (typeof SCENE_DIRECTORS)[number];

/** v0.1 knows one kind of pet. */
export const PET_KINDS = ['dog'] as const;
export type PetKind = (typeof PET_KINDS)[number];
export const MAX_PETS = 1;
export const PET_NAME_MAX = 24;
const PET_ID_RE = /^[a-z][a-z0-9-]{0,23}$/;
const PETS_LIMIT_MESSAGE = 'v0.1 supports at most one pet, of kind dog';

export interface PetConfig {
  readonly id: string;
  readonly kind: PetKind;
  readonly name: string;
}

/** Read by the host-side tools only; never on the snapshot. */
export interface SceneSettings {
  readonly mode: SceneMode;
  readonly provider: SceneProvider;
  /** `null` = every id in the taste table; otherwise an allowlist (validated by the tools). */
  readonly styles: readonly string[] | null;
  readonly settings: readonly string[] | null;
  /** What the timer may draw unattended. */
  readonly premises: readonly string[];
  /** `null` = no cap. */
  readonly weeklyBudgetUsd: number | null;
  /**
   * `written` (default): tools/scene_activity_writer.py writes them, frozen per scene, with the
   * table as its fallback. `table`: tools/scene-activities.json only, as before 2026-10-12.
   */
  readonly activities: SceneActivitySource;
  /** `ai` (default): tools/scene_director.py chooses each run's picture. `rotation`: the week number. */
  readonly director: SceneDirector;
  /** Opt-in: event titles and visitor descriptions may reach the director. Off = counts only. */
  readonly shareTitles: boolean;
}

export interface HouseholdConfig {
  readonly version: 1;
  readonly timezone: string;
  readonly locale: string;
  readonly currency: string;
  readonly features: HouseholdFeatures;
  readonly boardWindows: readonly BoardWindow[];
  readonly pets: readonly PetConfig[];
  readonly scenes: SceneSettings;
}

/**
 * Today's wall, exactly. The board windows are `IDLE_BOARD_WINDOWS` in
 * `web/src/views/logic/timeTrust.ts`; `test/unit-g.config.test.ts` pins that they agree.
 * `pets` is the one default that is NOT the live wall's: a household has no pet until it says so.
 */
export const DEFAULT_HOUSEHOLD: HouseholdConfig = {
  version: 1,
  timezone: DEFAULT_TZ,
  locale: DEFAULT_LOCALE,
  currency: DEFAULT_CURRENCY,
  features: { chores: true, money: true, routines: true, countdowns: true },
  boardWindows: [
    { opensAtLocal: '05:45', closesAtLocal: '08:30' },
    { opensAtLocal: '18:45', closesAtLocal: '20:45' },
  ],
  pets: [],
  scenes: {
    mode: 'generated',
    provider: 'fal',
    styles: null,
    settings: null,
    premises: ['plain'],
    weeklyBudgetUsd: null,
    activities: 'written',
    director: 'ai',
    shareTitles: false,
  },
};

// ---------------------------------------------------------------------------
// Validation — one function per top-level key, shared by the file and the rows
// ---------------------------------------------------------------------------

type Field<T> = { ok: true; value: T } | { ok: false; errors: string[] };

function ok<T>(value: T): Field<T> {
  return { ok: true, value };
}

function bad<T>(...errors: string[]): Field<T> {
  return { ok: false, errors };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Keys starting with `_` are comments (the repo's JSON convention) and are ignored. */
function unknownKeys(obj: Record<string, unknown>, known: readonly string[], path: string): string[] {
  return Object.keys(obj)
    .filter((k) => !k.startsWith('_') && !known.includes(k))
    .map((k) => `${path}${path === '' ? '' : '.'}${k}: unknown key`);
}

function parseTimezone(v: unknown): Field<string> {
  if (typeof v !== 'string' || v.length === 0) return bad('timezone: must be an IANA zone name');
  try {
    new Intl.DateTimeFormat('en-CA', { timeZone: v });
  } catch {
    return bad(`timezone: "${v}" is not a time zone this runtime knows`);
  }
  return ok(v);
}

function parseLocale(v: unknown): Field<string> {
  if (typeof v !== 'string' || v.length === 0) return bad('locale: must be a BCP-47 tag');
  try {
    if (Intl.DateTimeFormat.supportedLocalesOf([v]).length === 1) return ok(v);
  } catch {
    // A malformed tag throws; it is reported the same way as an unsupported one.
  }
  return bad(`locale: "${v}" is not a locale this runtime supports`);
}

function parseCurrency(v: unknown): Field<string> {
  if (typeof v !== 'string' || v.length === 0) return bad('currency: must be an ISO-4217 code');
  try {
    new Intl.NumberFormat('en-US', { style: 'currency', currency: v });
  } catch {
    return bad(`currency: "${v}" is not an ISO-4217 code`);
  }
  return ok(v);
}

const FEATURE_KEYS = ['chores', 'money', 'routines', 'countdowns'] as const;

function parseFeatures(v: unknown): Field<HouseholdFeatures> {
  if (!isRecord(v)) return bad('features: must be an object');
  const errors = unknownKeys(v, FEATURE_KEYS, 'features');
  const out: Record<string, boolean> = { ...DEFAULT_HOUSEHOLD.features };
  for (const k of FEATURE_KEYS) {
    if (!(k in v)) continue;
    const flag = v[k];
    if (typeof flag !== 'boolean') errors.push(`features.${k}: must be true or false`);
    else out[k] = flag;
  }
  return errors.length > 0 ? bad(...errors) : ok(out as unknown as HouseholdFeatures);
}

function parseBoardWindows(v: unknown): Field<BoardWindow[]> {
  if (!Array.isArray(v)) return bad('boardWindows: must be a list');
  const errors: string[] = [];
  const out: BoardWindow[] = [];
  v.forEach((w: unknown, i) => {
    const path = `boardWindows[${String(i)}]`;
    if (!isRecord(w)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    errors.push(...unknownKeys(w, ['opensAtLocal', 'closesAtLocal'], path));
    const opens = w['opensAtLocal'];
    const closes = w['closesAtLocal'];
    const opensOk = typeof opens === 'string' && isLocalTime(opens);
    const closesOk = typeof closes === 'string' && isLocalTime(closes);
    if (!opensOk) errors.push(`${path}.opensAtLocal: must be HH:MM`);
    if (!closesOk) errors.push(`${path}.closesAtLocal: must be HH:MM`);
    if (opensOk && closesOk) {
      // Zero-padded HH:MM compares correctly as a string.
      if (opens >= closes) errors.push(`${path}: opensAtLocal must be before closesAtLocal`);
      else out.push({ opensAtLocal: opens, closesAtLocal: closes });
    }
  });
  return errors.length > 0 ? bad(...errors) : ok(out);
}

function parsePets(v: unknown): Field<PetConfig[]> {
  if (!Array.isArray(v)) return bad('pets: must be a list');
  if (v.length > MAX_PETS) return bad(`pets: ${PETS_LIMIT_MESSAGE}`);
  const errors: string[] = [];
  const out: PetConfig[] = [];
  v.forEach((p: unknown, i) => {
    const path = `pets[${String(i)}]`;
    if (!isRecord(p)) {
      errors.push(`${path}: must be an object`);
      return;
    }
    errors.push(...unknownKeys(p, ['id', 'kind', 'name'], path));
    const { id, kind, name } = p;
    const before = errors.length;
    if (typeof id !== 'string' || !PET_ID_RE.test(id)) {
      errors.push(`${path}.id: must match ${PET_ID_RE.source}`);
    }
    if (typeof kind !== 'string' || !(PET_KINDS as readonly string[]).includes(kind)) {
      errors.push(`${path}.kind: ${PETS_LIMIT_MESSAGE}`);
    }
    if (typeof name !== 'string' || name.trim().length === 0 || name.length > PET_NAME_MAX) {
      errors.push(`${path}.name: must be 1-${String(PET_NAME_MAX)} characters`);
    }
    if (errors.length === before) out.push({ id: id as string, kind: kind as PetKind, name: name as string });
  });
  return errors.length > 0 ? bad(...errors) : ok(out);
}

const SCENE_KEYS = ['mode', 'provider', 'styles', 'settings', 'premises', 'weeklyBudgetUsd', 'activities', 'director', 'shareTitles'] as const;

function isStringList(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string' && x.length > 0);
}

function parseScenes(v: unknown): Field<SceneSettings> {
  if (!isRecord(v)) return bad('scenes: must be an object');
  const errors = unknownKeys(v, SCENE_KEYS, 'scenes');
  const d = DEFAULT_HOUSEHOLD.scenes;
  const mode = 'mode' in v ? v['mode'] : d.mode;
  const provider = 'provider' in v ? v['provider'] : d.provider;
  const styles = 'styles' in v ? v['styles'] : d.styles;
  const settings = 'settings' in v ? v['settings'] : d.settings;
  const premises = 'premises' in v ? v['premises'] : d.premises;
  const budget = 'weeklyBudgetUsd' in v ? v['weeklyBudgetUsd'] : d.weeklyBudgetUsd;
  const activities = 'activities' in v ? v['activities'] : d.activities;
  const director = 'director' in v ? v['director'] : d.director;
  const shareTitles = 'shareTitles' in v ? v['shareTitles'] : d.shareTitles;
  if (typeof mode !== 'string' || !(SCENE_MODES as readonly string[]).includes(mode)) {
    errors.push(`scenes.mode: must be one of ${SCENE_MODES.join(', ')}`);
  }
  if (typeof provider !== 'string' || !(SCENE_PROVIDERS as readonly string[]).includes(provider)) {
    errors.push(`scenes.provider: must be one of ${SCENE_PROVIDERS.join(', ')}`);
  }
  if (styles !== null && !isStringList(styles)) errors.push('scenes.styles: must be null or a list of ids');
  if (settings !== null && !isStringList(settings)) errors.push('scenes.settings: must be null or a list of ids');
  if (!isStringList(premises)) errors.push('scenes.premises: must be a list of ids');
  if (budget !== null && (typeof budget !== 'number' || !Number.isFinite(budget) || budget < 0)) {
    errors.push('scenes.weeklyBudgetUsd: must be null or a number >= 0');
  }
  if (typeof activities !== 'string' || !(SCENE_ACTIVITY_SOURCES as readonly string[]).includes(activities)) {
    errors.push(`scenes.activities: must be one of ${SCENE_ACTIVITY_SOURCES.join(', ')}`);
  }
  if (typeof director !== 'string' || !(SCENE_DIRECTORS as readonly string[]).includes(director)) {
    errors.push(`scenes.director: must be one of ${SCENE_DIRECTORS.join(', ')}`);
  }
  if (typeof shareTitles !== 'boolean') errors.push('scenes.shareTitles: must be true or false');
  if (errors.length > 0) return bad(...errors);
  return ok({
    mode: mode as SceneMode,
    provider: provider as SceneProvider,
    styles: styles === null ? null : [...(styles as string[])],
    settings: settings === null ? null : [...(settings as string[])],
    premises: [...(premises as string[])],
    weeklyBudgetUsd: budget as number | null,
    activities: activities as SceneActivitySource,
    director: director as SceneDirector,
    shareTitles: shareTitles as boolean,
  });
}

const TOP_KEYS = [
  'version',
  'timezone',
  'locale',
  'currency',
  'features',
  'boardWindows',
  'pets',
  'scenes',
] as const;

/**
 * The authored file, validated and normalized. Pure.
 *
 * `version` is required; every other key is optional and a missing one is its default, as are
 * the missing members of `features` and `scenes`. One error per bad field, as `"<path>: <why>"`.
 * Unknown keys are refused (a typo must not read as "use the default"); keys starting with `_`
 * are comments.
 */
export function parseHousehold(
  json: unknown,
): { ok: true; config: HouseholdConfig } | { ok: false; errors: string[] } {
  if (!isRecord(json)) return { ok: false, errors: ['(root): must be a JSON object'] };
  const errors = unknownKeys(json, TOP_KEYS, '');
  if (json['version'] !== HOUSEHOLD_CONFIG_VERSION) {
    errors.push(`version: must be ${String(HOUSEHOLD_CONFIG_VERSION)}`);
  }
  const d = DEFAULT_HOUSEHOLD;
  const pick = <T>(key: string, parse: (v: unknown) => Field<T>, fallback: T): T => {
    if (!(key in json)) return fallback;
    const r = parse(json[key]);
    if (r.ok) return r.value;
    errors.push(...r.errors);
    return fallback;
  };
  const config: HouseholdConfig = {
    version: 1,
    timezone: pick('timezone', parseTimezone, d.timezone),
    locale: pick('locale', parseLocale, d.locale),
    currency: pick('currency', parseCurrency, d.currency),
    features: pick('features', parseFeatures, d.features),
    boardWindows: pick('boardWindows', parseBoardWindows, d.boardWindows),
    pets: pick('pets', parsePets, d.pets),
    scenes: pick('scenes', parseScenes, d.scenes),
  };
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config };
}

// ---------------------------------------------------------------------------
// Rows
// ---------------------------------------------------------------------------

/**
 * One row per top-level key. The three strings are stored as plain text, the rest as JSON —
 * the same shape `departures` and `wall_theme` already use.
 */
const ROWS = {
  timezone: { key: 'timezone', json: false, parse: parseTimezone },
  locale: { key: 'locale', json: false, parse: parseLocale },
  currency: { key: 'currency', json: false, parse: parseCurrency },
  features: { key: 'features', json: true, parse: parseFeatures },
  boardWindows: { key: 'board_windows', json: true, parse: parseBoardWindows },
  pets: { key: 'pets', json: true, parse: parsePets },
  scenes: { key: 'scenes', json: true, parse: parseScenes },
} as const;

type RowField = keyof typeof ROWS;
const ROW_FIELDS = Object.keys(ROWS) as RowField[];

/** The `household_config` keys this module owns, in a stable order. */
export const HOUSEHOLD_ROW_KEYS: readonly string[] = ROW_FIELDS.map((f) => ROWS[f].key);

export type HouseholdWarn = (message: string) => void;

const defaultWarn: HouseholdWarn = (message) => {
  process.stderr.write(`[wall] ${message}\n`);
};

/**
 * Which bad rows have already been reported, per logger. `readHousehold` runs on every snapshot,
 * so a hand-edited bad row would otherwise log every fifteen seconds for as long as it stood.
 * Keyed by logger so the production logger warns once per process and a test's own logger
 * starts clean.
 */
const warned = new WeakMap<HouseholdWarn, Set<string>>();

function warnOnce(warn: HouseholdWarn, key: string, message: string): void {
  let seen = warned.get(warn);
  if (seen === undefined) {
    seen = new Set();
    warned.set(warn, seen);
  }
  if (seen.has(key)) return;
  seen.add(key);
  warn(message);
}

/**
 * The household's settings, from the rows, over the defaults. Never throws.
 *
 * Read defensively, like `parseWallTheme`: a row that does not parse is logged once and reads
 * as the default for THAT key only — a wall that refused to render over a hand-edited setting
 * would be failing the 6:00 AM invariant for the least important reason there is.
 */
export function readHousehold(db: Db, warn: HouseholdWarn = defaultWarn): HouseholdConfig {
  const placeholders = HOUSEHOLD_ROW_KEYS.map(() => '?').join(', ');
  const rows = db
    .prepare(`SELECT key, value_text FROM household_config WHERE key IN (${placeholders})`)
    .all(...HOUSEHOLD_ROW_KEYS) as { key: string; value_text: string }[];
  const byKey = new Map(rows.map((r) => [r.key, r.value_text]));

  const out: Record<string, unknown> = { ...DEFAULT_HOUSEHOLD };
  for (const field of ROW_FIELDS) {
    const spec = ROWS[field];
    const text = byKey.get(spec.key);
    if (text === undefined) continue;
    let raw: unknown = text;
    if (spec.json) {
      try {
        raw = JSON.parse(text);
      } catch {
        warnOnce(warn, spec.key, `household_config.${spec.key} is not JSON; using the default`);
        continue;
      }
    }
    const r = (spec.parse as (v: unknown) => Field<unknown>)(raw);
    if (r.ok) out[field] = r.value;
    else warnOnce(warn, spec.key, `household_config.${spec.key} is invalid (${r.errors.join('; ')}); using the default`);
  }
  return out as unknown as HouseholdConfig;
}

/** Every key, in one transaction: a half-applied household is worse than either whole one. */
export function writeHousehold(db: Db, config: HouseholdConfig): void {
  const upsert = db.prepare(
    `INSERT INTO household_config (key, value_text) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_text = excluded.value_text`,
  );
  inTransaction(db, () => {
    for (const field of ROW_FIELDS) {
      const spec = ROWS[field];
      const value = config[field];
      upsert.run(spec.key, spec.json ? JSON.stringify(value) : (value as string));
    }
  });
}

/** What the wall needs: everything but `scenes`, and a pet's id and name only. */
export function toView(config: HouseholdConfig): HouseholdView {
  return {
    timezone: config.timezone,
    locale: config.locale,
    currency: config.currency,
    features: { ...config.features },
    boardWindows: config.boardWindows.map((w) => ({ ...w })),
    pets: config.pets.map((p) => ({ id: p.id, name: p.name })),
  };
}
