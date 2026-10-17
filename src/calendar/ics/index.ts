/**
 * The iCal adapter's only public surface.
 *
 * A composition root imports THIS module and nothing else under `src/calendar/ics/`.
 *
 *   const calendar = createIcsCalendar();   // reads ICS_URL_* from the environment
 *   await syncAllSources(db, calendar, { window });
 */

import type { CalendarSource } from '../CalendarSource.ts';
import { icsConfigFromEnv, type ConfigOverrides } from './config.ts';
import { IcsCalendar } from './IcsCalendar.ts';

export type { ConfigOverrides };

/** Throws at construction when no feed is configured or one is not a usable URL. */
export function createIcsCalendar(
  env: Record<string, string | undefined> = process.env,
  overrides: ConfigOverrides = {},
): CalendarSource {
  return new IcsCalendar(icsConfigFromEnv(env, overrides));
}
