/**
 * Which of the household's surfaces are on (2026-10-12).
 *
 * `household.features` arrives on the snapshot (`db/household.json` → `household_config`). A
 * surface that is off is not drawn: no grown-up tab for it, no section on a child's screen, no
 * panel on the ambient board. The server also ships its lists empty, so this is the second of
 * two locks, not the only one.
 *
 * `undefined` — a snapshot from a server older than the household config — means ON, which is
 * what every wall did before the setting existed. A feature is only ever turned off by a
 * household that said so.
 *
 * Pure `.ts`, imports only the contract: a logic module may never import from a `.tsx`.
 */

import type { HouseholdView } from '../../../../src/types.ts';

export type Feature = keyof HouseholdView['features'];

export function featureOn(h: Pick<HouseholdView, 'features'> | undefined | null, f: Feature): boolean {
  const v = h?.features?.[f];
  return typeof v === 'boolean' ? v : true;
}
