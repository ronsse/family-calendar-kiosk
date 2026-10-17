/**
 * Unit B - the Home Assistant adapter's only public surface.
 *
 * A composition root imports THIS module and nothing else under
 * `src/calendar/homeassistant/`. Choosing an implementation is the one thing a caller is
 * allowed to know; after that it holds a `CalendarSource` and an opaque `externalRef`
 * (ADR-0004).
 *
 * Deliberately NOT re-exported: the wire types, the entity-id shape, the base URL, the
 * client, and every HA-specific error class. If a future unit needs one of those, the
 * boundary is wrong, not this file.
 *
 *   const calendar = createHomeAssistantCalendar();   // reads HA_BASE_URL / HA_TOKEN
 *   await syncAllSources(db, calendar, { window });
 */

import type { CalendarSource } from '../CalendarSource.ts';
import { homeAssistantConfigFromEnv, type ConfigOverrides } from './config.ts';
import { HomeAssistantCalendar } from './HomeAssistantCalendar.ts';

export type { ConfigOverrides };

/**
 * Builds the adapter from the environment (`HA_BASE_URL`, `HA_TOKEN`).
 *
 * Throws at construction when either is missing. A calendar source that silently fetches
 * nothing would promote an empty generation over good data - the failure is far cheaper
 * at startup than at 06:00.
 */
export function createHomeAssistantCalendar(
  env: Record<string, string | undefined> = process.env,
  overrides: ConfigOverrides = {},
): CalendarSource {
  return new HomeAssistantCalendar(homeAssistantConfigFromEnv(env, overrides));
}
