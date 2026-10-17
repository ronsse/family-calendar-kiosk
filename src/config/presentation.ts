/**
 * The household's locale and currency, held for the BUNDLE's formatters (2026-10-12).
 *
 * The zone lives in `src/time.ts` (`configureTime`), because both sides compute local dates.
 * Locale and currency are only ever WORDS on the glass, so they live here, beside it, and the
 * web formatters in `web/src/views/logic/{clock,week,balances}.ts` read them ambiently rather
 * than taking them as arguments — the alternative was a new parameter on every caller of
 * `localDateText` and `cashText`, in nineteen files.
 *
 * Pure and dependency-free (no database, no DOM), so it is safe in the bundle. Nothing on the
 * server needs it today.
 */

import { configureTime, householdTimeZone } from '../time.ts';
import { DEFAULT_CURRENCY, DEFAULT_LOCALE } from '../types.ts';

let locale: string = DEFAULT_LOCALE;
let currency: string = DEFAULT_CURRENCY;

/** Throws (RangeError) on a tag or code this runtime rejects, and changes nothing then. */
export function configureLocale(o: { locale: string; currency: string }): void {
  new Intl.NumberFormat(o.locale, { style: 'currency', currency: o.currency });
  locale = o.locale;
  currency = o.currency;
}

export function householdLocale(): string {
  return locale;
}

export function householdCurrency(): string {
  return currency;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Applies a snapshot's `household` to this bundle. Never throws: the field may be missing (a
 * snapshot cached before the server knew it), and a zone or locale the browser does not know
 * leaves the previous one in place — the wall keeps rendering in the old zone rather than not
 * at all. Returns true when anything changed, so a caller can re-render.
 */
export function applyHouseholdView(h: unknown): boolean {
  if (!isRecord(h)) return false;
  let changed = false;
  const tz = h['timezone'];
  if (typeof tz === 'string' && tz !== householdTimeZone()) {
    try {
      configureTime({ timeZone: tz });
      changed = true;
    } catch {
      // Unknown zone in this browser: keep the old one.
    }
  }
  const loc = typeof h['locale'] === 'string' ? h['locale'] : locale;
  const cur = typeof h['currency'] === 'string' ? h['currency'] : currency;
  if (loc !== locale || cur !== currency) {
    try {
      configureLocale({ locale: loc, currency: cur });
      changed = true;
    } catch {
      // Unknown locale or currency in this browser: keep the old pair.
    }
  }
  return changed;
}
