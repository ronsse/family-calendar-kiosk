/**
 * The built-in calendar adapters, by name (2026-10-12; moved out of `stacks/wall/entry/main.ts`).
 *
 * Each adapter is named by MODULE URL, never imported here: nothing outside
 * `src/calendar/<impl>/` may know which upstream this is, which is what keeps a Google-direct
 * swap a config change rather than a migration (ADR-0004). The sync worker imports the module.
 *
 * `WALL_CALENDAR_SOURCE` picks one; each has its own "is it configured" test, so a source with
 * no credentials is reported as not running rather than scheduled to fail every five minutes.
 * `WALL_CALENDAR_ADAPTER` / `WALL_CALENDAR_EXPORT` still override the module outright (tests
 * use that). A new adapter is one entry here and one directory beside it.
 */

type Env = Readonly<Record<string, string | undefined>>;

interface SourceSpec {
  /** Relative to this file. */
  readonly module: string;
  readonly export: string;
  readonly configured: (env: Env) => boolean;
  /** Why it is not running, when `configured` says no. Logged verbatim. */
  readonly needs: string;
}

export const CALENDAR_SOURCES: Readonly<Record<string, SourceSpec>> = {
  homeassistant: {
    module: './homeassistant/index.ts',
    export: 'createHomeAssistantCalendar',
    configured: (env) => !!env['HA_BASE_URL'],
    needs: 'HA_BASE_URL is not set',
  },
  ics: {
    module: './ics/index.ts',
    export: 'createIcsCalendar',
    configured: (env) => Object.entries(env).some(([k, v]) => k.startsWith('ICS_URL_') && !!v),
    needs: 'no ICS_URL_* variables are set',
  },
};

export const DEFAULT_CALENDAR_SOURCE = 'homeassistant';

export interface ChosenCalendarSource {
  readonly name: string;
  /** A module specifier the worker can `import()`: the override, or this adapter's file URL. */
  readonly module: string;
  readonly export: string;
  readonly configured: boolean;
  readonly needs: string;
}

/** Unset and empty are the same thing, as everywhere else in the wall's environment. */
function envOr(env: Env, name: string, fallback: string): string {
  const raw = env[name];
  return raw === undefined || raw.length === 0 ? fallback : raw;
}

/** Throws on an unknown `WALL_CALENDAR_SOURCE`, naming the ones that exist. */
export function chooseCalendarSource(env: Env): ChosenCalendarSource {
  const name = envOr(env, 'WALL_CALENDAR_SOURCE', DEFAULT_CALENDAR_SOURCE);
  const spec = Object.hasOwn(CALENDAR_SOURCES, name) ? CALENDAR_SOURCES[name] : undefined;
  if (spec === undefined) {
    throw new Error(`WALL_CALENDAR_SOURCE must be one of ${Object.keys(CALENDAR_SOURCES).join(', ')}`);
  }
  return {
    name,
    module: envOr(env, 'WALL_CALENDAR_ADAPTER', new URL(spec.module, import.meta.url).href),
    export: envOr(env, 'WALL_CALENDAR_EXPORT', spec.export),
    configured: spec.configured(env),
    needs: spec.needs,
  };
}
