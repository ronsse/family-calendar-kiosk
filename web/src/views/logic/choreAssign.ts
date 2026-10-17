/**
 * The ways a chore is shared, in words — for the pills on an open chore row
 * (`ChoresPanel`) and on the new-chore sheet.
 *
 * The rows themselves are `logic/grownup.ts` §7 now: the Chores screen became one list of every
 * chore in October 2026, and the per-child rows this module used to build (hers above a line,
 * everyone else's below it) went with the screen that drew them.
 *
 * No React, no `.tsx` import: the test runner cannot load a component.
 */

import type { AssignmentModel } from '../../../../src/types.ts';

/** The three ways this wall asks, in the order the pills are drawn. */
export const WALL_MODELS: readonly AssignmentModel[] = ['individual', 'rotation', 'first_complete'];

/**
 * One word each, for a pill a parent reads at arm's length.  `shared` is the file format's
 * fourth model — every claimant earns the full amount — and is not offered from the wall; it
 * only needs a word so a chore that already has it does not render a blank.
 */
export const MODEL_WORDS: Readonly<Record<AssignmentModel, string>> = {
  individual: 'Each',
  rotation: 'Turns',
  first_complete: 'First',
  shared: 'Together',
};

/** The model pills for one chore: the wall's three, plus the current one if it is not among them. */
export function modelChoices(current: AssignmentModel): readonly AssignmentModel[] {
  return WALL_MODELS.includes(current) ? WALL_MODELS : [...WALL_MODELS, current];
}
