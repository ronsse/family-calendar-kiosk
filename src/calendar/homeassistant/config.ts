/**
 * Unit B — Home Assistant adapter. Configuration, from the environment only.
 *
 * INTERNAL TO THIS DIRECTORY. The base URL and the long-lived token are secrets-adjacent
 * deployment facts; they are never hardcoded, never committed, and never logged. On
 * the server they come from 1Password via `op run --env-file` (see the global environment
 * notes), so this module only ever reads names, never values, from the repo.
 *
 * Nothing here is exported past `src/calendar/homeassistant/`. A caller selects the
 * implementation; it never learns the port, the host, or the shape of an entity id.
 */

export const ENV_BASE_URL = 'HA_BASE_URL';
export const ENV_TOKEN = 'HA_TOKEN';
export const ENV_TIMEOUT_MS = 'HA_TIMEOUT_MS';
export const ENV_RETRIES = 'HA_RETRIES';
export const ENV_BACKOFF_MS = 'HA_BACKOFF_MS';
export const ENV_UTC_MIDNIGHT_ALLDAY = 'HA_UTC_MIDNIGHT_ALLDAY';

export interface HomeAssistantConfig {
  /** Origin only, no trailing slash, e.g. "http://homeserver:8123". */
  readonly baseUrl: string;
  /** Long-lived access token. Never log this object; log `redact(config)` instead. */
  readonly token: string;
  readonly timeoutMs: number;
  readonly retries: number;
  readonly backoffMs: number;
  /**
   * Normalise "midnight UTC → midnight UTC" wire values into floating all-day dates.
   *
   * Defaults ON because one upstream calendar is misconfigured to UTC and is already
   * putting all-day events on two local days (H3 finding #5). Set `HA_UTC_MIDNIGHT_ALLDAY=0`
   * to disable it once every upstream calendar is on America/Denver.
   */
  readonly utcMidnightIsAllDay: boolean;
  readonly fetchImpl: typeof globalThis.fetch;
}

/** Safe to log: everything except the token. */
export function redact(config: HomeAssistantConfig): Record<string, unknown> {
  return {
    baseUrl: config.baseUrl,
    timeoutMs: config.timeoutMs,
    retries: config.retries,
    backoffMs: config.backoffMs,
    utcMidnightIsAllDay: config.utcMidnightIsAllDay,
    token: config.token ? '[redacted]' : '[missing]',
  };
}

export const DEFAULTS = {
  timeoutMs: 10_000,
  retries: 2,
  backoffMs: 250,
  utcMidnightIsAllDay: true,
} as const;

export interface ConfigOverrides {
  timeoutMs?: number;
  retries?: number;
  backoffMs?: number;
  utcMidnightIsAllDay?: boolean;
  fetchImpl?: typeof globalThis.fetch;
}

function positiveInt(raw: string | undefined, fallback: number, name: string): number {
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) throw new Error(`${name} must be a non-negative integer`);
  return n;
}

function boolFlag(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined || raw === '') return fallback;
  return !['0', 'false', 'no', 'off'].includes(raw.trim().toLowerCase());
}

/** Origin, validated and trailing-slash-free. Throws on anything that is not http(s). */
export function normaliseBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${ENV_BASE_URL} is not a valid URL`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${ENV_BASE_URL} must be http or https`);
  }
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/**
 * Builds the adapter's configuration from the process environment.
 *
 * Throws — loudly, at startup, naming the variable — when a required value is absent.
 * A missing token must not degrade into an adapter that quietly fetches nothing: that
 * would promote an empty generation over good data, which is a blank calendar on the wall
 * with no error anywhere (H3 finding #7).
 *
 * Error messages name variables, never values.
 */
export function homeAssistantConfigFromEnv(
  env: Record<string, string | undefined> = process.env,
  overrides: ConfigOverrides = {},
): HomeAssistantConfig {
  const rawBase = env[ENV_BASE_URL];
  if (!rawBase) throw new Error(`${ENV_BASE_URL} is not set`);
  const token = env[ENV_TOKEN];
  if (!token) throw new Error(`${ENV_TOKEN} is not set`);

  return {
    baseUrl: normaliseBaseUrl(rawBase),
    token,
    timeoutMs:
      overrides.timeoutMs ?? positiveInt(env[ENV_TIMEOUT_MS], DEFAULTS.timeoutMs, ENV_TIMEOUT_MS),
    retries: overrides.retries ?? positiveInt(env[ENV_RETRIES], DEFAULTS.retries, ENV_RETRIES),
    backoffMs:
      overrides.backoffMs ?? positiveInt(env[ENV_BACKOFF_MS], DEFAULTS.backoffMs, ENV_BACKOFF_MS),
    utcMidnightIsAllDay:
      overrides.utcMidnightIsAllDay ??
      boolFlag(env[ENV_UTC_MIDNIGHT_ALLDAY], DEFAULTS.utcMidnightIsAllDay),
    fetchImpl: overrides.fetchImpl ?? globalThis.fetch,
  };
}
