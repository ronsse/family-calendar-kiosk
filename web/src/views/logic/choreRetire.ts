/**
 * Retiring a chore from the wall, and bringing one back (pass 2, #6).
 *
 * Retire is SOFT: the chore leaves every board from today and its history stays. The server
 * refuses while a claim on it is still waiting (`not_claimable`), because retiring would strand
 * a child's finished work outside the queue. Restore reverses retire, so this is an undoable
 * act. It still asks twice, because a single tap on a row of keys is easy to land by accident.
 * Retire is the only control on the open row that takes something OFF the board.
 *
 * The confirm is a two-tap key. The first tap ARMS it and changes its words. A second tap
 * within `RETIRE_ARM_MS` fires. After that window, the next tap arms it again. Nothing here
 * holds a timer: the arm records when it happened, and the component re-renders on its own
 * tick, so the key is still a pure function of the time.
 */

import type { AssetRef } from '../../../../src/types.ts';
import type { ChoreCatalog } from '../../app/adminActions.ts';

export const RETIRE_ARM_MS = 4_000;

export const RETIRE_WORDS = {
  edit: 'Edit',
  retire: 'Retire',
  confirm: 'Tap again to retire',
  /** Said only when the server refused with `not_claimable` — it is the one reason it can. */
  waiting: 'A claim on this chore is still waiting — approve it or send it back first.',
  retired: 'Retired',
  restore: 'Bring back',
  rule: 'Retired chores leave every list from today. Their history stays.',
} as const;

/** Which chore's retire key is armed, and when. One at a time, like the open row. */
export interface RetireArm {
  readonly choreId: string;
  readonly atMs: number;
}

export function isArmed(arm: RetireArm | null, choreId: string, nowMs: number): boolean {
  return arm !== null && arm.choreId === choreId && nowMs - arm.atMs < RETIRE_ARM_MS;
}

/**
 * One tap on a chore's retire key. Returns the next arm and whether this tap SENDS. The send
 * clears the arm, so a third tap starts the confirm again rather than sending twice.
 */
export function pressRetire(
  arm: RetireArm | null,
  choreId: string,
  nowMs: number,
): { readonly arm: RetireArm | null; readonly fire: boolean } {
  if (isArmed(arm, choreId, nowMs)) return { arm: null, fire: true };
  return { arm: { choreId, atMs: nowMs }, fire: false };
}

/** When the armed key should go back to "Retire" on its own, or null when nothing is armed. */
export function armExpiresAtMs(arm: RetireArm | null): number | null {
  return arm === null ? null : arm.atMs + RETIRE_ARM_MS;
}

export interface RetiredChoreRow {
  readonly choreId: string;
  readonly labelFull: string;
  readonly icon: AssetRef;
}

/** The retired chores, alphabetical. They are rare and found by name, not by household order. */
export function retiredChoreRows(catalog: ChoreCatalog): readonly RetiredChoreRow[] {
  return catalog.chores
    .filter((c) => !c.active)
    .map((c) => ({ choreId: c.id, labelFull: c.labelFull, icon: c.icon }))
    .sort((a, b) => a.labelFull.localeCompare(b.labelFull));
}
