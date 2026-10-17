/**
 * iCal adapter. Configuration, from the environment only.
 *
 * INTERNAL TO THIS DIRECTORY.
 *
 * One variable per calendar, named from the calendar's `external_ref`:
 *
 *   calendar.school                     -> ICS_URL_CALENDAR_SCHOOL
 *   calendar.family                     -> ICS_URL_CALENDAR_FAMILY
 *
 * Keying on the existing refs is what makes the Home Assistant -> iCal swap (and its
 * rollback) a config change with no database edit: the `calendar_source` rows, their
 * include/exclude flags and their keep-terms all stay exactly as they are.
 *
 * A Google "secret address in iCal format" IS a credential — anyone holding it reads the
 * calendar, with no login. So the URLs come from 1Password via `op run`, and they never
 * appear in a thrown message, a log line, or `sync_run.error`. Errors name the VARIABLE.
 */

export const ENV_URL_PREFIX = 'ICS_URL_';
export const ENV_TIMEOUT_MS = 'ICS_TIMEOUT_MS';
export const ENV_RETRIES = 'ICS_RETRIES';
export const ENV_BACKOFF_MS = 'ICS_BACKOFF_MS';

export interface IcsFeed {
  /** The opaque ref the database already holds, e.g. "calendar.school". */
  readonly externalRef: string;
  /** The env variable it came from — safe to put in a message. */
  readonly envName: string;
  /** The secret address. Never log, never interpolate into a message. */
  readonly url: string;
}

export interface IcsConfig {
  readonly feeds: ReadonlyMap<string, IcsFeed>;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly backoffMs: number;
  readonly fetchImpl: typeof globalThis.fetch;
}

export const DEFAULTS = {
  timeoutMs: 15_000,
  retries: 2,
  backoffMs: 500,
} as const;

export interface ConfigOverrides {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  fetchImpl?: typeof globalThis.fetch;
}

/** `calendar.school` -> `ICS_URL_CALENDAR_SCHOOL`. */
export function envNameFor(externalRef: string): string {
  return ENV_URL_PREFIX + externalRef.toUpperCase().replace(/[^A-Z0-9]/g, '_');
}

/**
 * `ICS_URL_CALENDAR_SCHOOL` -> `calendar.school`.
 *
 * The mapping is lossy in one direction only (`.` and `_` both become `_`), so the ref is
 * recovered by convention: the first `_` is the `.` of an entity-style ref. A ref that does
 * not follow that convention still works for `fetchEvents`, which goes the other way
 * through `envNameFor`; only `listSources` — an admin listing — relies on this guess.
 */
function refFromEnvName(name: string): string {
  const tail = name.slice(ENV_URL_PREFIX.length).toLowerCase();
  const dot = tail.indexOf('_');
  return dot > 0 ? `${tail.slice(0, dot)}.${tail.slice(dot + 1)}` : tail;
}

function nonNegativeInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

/** True when any `ICS_URL_*` variable is set — the composition root's "is this configured". */
export function hasIcsFeeds(env: Record<string, string | undefined>): boolean {
  return Object.entries(env).some(([k, v]) => k.startsWith(ENV_URL_PREFIX) && !!v);
}

/**
 * Builds the adapter's configuration. Throws, naming the variable and never the value,
 * when there are no feeds or a feed is not an http(s) URL — an adapter that quietly
 * fetches nothing would promote an empty week over good data.
 *
 * An `op://` reference that `op run` did not resolve is caught here too: it is the most
 * likely misconfiguration (the deploy run without `op run`), and it parses as a URL.
 */
export function icsConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: ConfigOverrides = {},
): IcsConfig {
  const feeds = new Map<string, IcsFeed>();
  for (const [name, value] of Object.entries(env)) {
    if (!name.startsWith(ENV_URL_PREFIX) || !value) continue;
    // Checked before parsing: a real reference ("op://Agent Secrets/...") has a space in it
    // and would otherwise be reported as a bad URL rather than as the missing `op run`.
    if (/^\s*op:\/\//i.test(value)) {
      throw new Error(`${name} is an unresolved 1Password reference — run under \`op run\``);
    }
    let url: URL;
    try {
      url = new URL(value.trim());
    } catch {
      throw new Error(`${name} is not a valid URL`);
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') throw new Error(`${name} must be http or https`);
    const externalRef = refFromEnvName(name);
    feeds.set(externalRef, { externalRef, envName: name, url: url.href });
  }
  if (feeds.size === 0) throw new Error(`no ${ENV_URL_PREFIX}* variables are set`);

  return {
    feeds,
    timeoutMs: overrides.timeoutMs ?? nonNegativeInt(env[ENV_TIMEOUT_MS], DEFAULTS.timeoutMs, ENV_TIMEOUT_MS),
    retries: overrides.retries ?? nonNegativeInt(env[ENV_RETRIES], DEFAULTS.retries, ENV_RETRIES),
    backoffMs: overrides.backoffMs ?? nonNegativeInt(env[ENV_BACKOFF_MS], DEFAULTS.backoffMs, ENV_BACKOFF_MS),
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
  };
}
