/**
 * Which look the wall wears: stored, read back with a default, and set from the wall.
 *
 * Three looks were drawn in October 2026 (`the theme mockups, private notes/`) and the
 * household's answer was *the felt board, and let us switch*. So this is one row in
 * `household_config` — the same key/value table the rate and the leave-by rules live in, which
 * is why no migration exists for it — and one route behind the PIN.
 *
 * ## Read defensively, written strictly
 *
 * A missing row is the default look, and so is a row somebody hand-edited into a word this
 * build does not know: a wall that refused to render over a typo in a setting about COLOURS
 * would be failing the 6:00 AM invariant for the least important reason there is. Writing is
 * the opposite: the route accepts exactly the three ids and refuses anything else with nothing
 * written, so the only way to store a bad value is by hand.
 *
 * ## Nothing here is a judgement about children
 *
 * A look is presentation, like a reading band and unlike one: it is the same for all three
 * children, it never changes what is asked of anyone, and switching it mid-day changes no row
 * but this one. The snapshot carries it so every screen switches on the same refetch.
 */

import type { Database as Db } from 'better-sqlite3';
import { DEFAULT_WALL_THEME, isWallThemeId, type WallThemeId } from '../../types.ts';

export const WALL_THEME_KEY = 'wall_theme';

/** A stored value, or nothing, as a look this build can draw. Never throws. */
export function parseWallTheme(text: string | null | undefined): WallThemeId {
  return isWallThemeId(text) ? text : DEFAULT_WALL_THEME;
}

export function readWallTheme(db: Db): WallThemeId {
  const row = db
    .prepare(`SELECT value_text FROM household_config WHERE key = ?`)
    .get(WALL_THEME_KEY) as { value_text: string } | undefined;
  return parseWallTheme(row?.value_text);
}

export type WallThemeFailure = 'unknown_theme';

/**
 * Store a look. `changed` is false when the wall already wore it, so the route can skip telling
 * every screen that something changed when nothing did.
 */
export function setWallTheme(
  db: Db,
  theme: unknown,
): { ok: true; theme: WallThemeId; changed: boolean } | { ok: false; reason: WallThemeFailure } {
  if (!isWallThemeId(theme)) return { ok: false, reason: 'unknown_theme' };
  const before = readWallTheme(db);
  db.prepare(
    `INSERT INTO household_config (key, value_text) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value_text = excluded.value_text`,
  ).run(WALL_THEME_KEY, theme);
  return { ok: true, theme, changed: before !== theme };
}
