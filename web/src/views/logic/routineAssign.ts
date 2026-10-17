/**
 * The Routines screen, minus its pixels.
 *
 * One routine, one child, one list: the steps she does in order, then the steps she does
 * not.  The list is what the grown-up screen renders; each row already knows which controls
 * it may show, so the component decides nothing.
 *
 *   - An assigned row carries `canMoveUp` / `canMoveDown` — false at the ends, so the arrow
 *     is drawn disabled rather than tapped into a no-op.  Every other tap on this screen
 *     changes something, and a control that goes quiet is this project's signature bug.
 *   - An unassigned row is below the line, in catalog order, so "add teeth to his bedtime"
 *     is a row the adult can see and one tap.
 *   - A RETIRED step (`active: false`) that a child still has stays visible — she is doing
 *     it tonight — but never appears in the unassigned pool, because nothing new may be
 *     built on it.
 *
 * Wire shape in, view rows out.  No React, no `.tsx` import: the test runner cannot load a
 * component, and this file is the half of the screen that has tests.
 */

import type { RoutineCatalog, RoutineCatalogEntry, RoutineStepCatalogEntry } from '../../app/adminActions.ts';

export interface RoutineStepRow {
  readonly stepId: string;
  readonly labelFull: string;
  readonly icon: RoutineStepCatalogEntry['icon'];
  readonly assigned: boolean;
  /** 1-based, only when assigned; the number a child sees on her own screen. */
  readonly position: number | null;
  readonly canMoveUp: boolean;
  readonly canMoveDown: boolean;
}

export interface ChildRoutineRows {
  readonly assigned: readonly RoutineStepRow[];
  readonly available: readonly RoutineStepRow[];
}

const NONE: ChildRoutineRows = { assigned: [], available: [] };

export function routineById(catalog: RoutineCatalog, routineId: string): RoutineCatalogEntry | null {
  return catalog.routines.find((r) => r.id === routineId) ?? null;
}

/**
 * The FIRST routine is the default selection, in the order the household wrote them (the
 * server orders by `sort_order`), so the screen opens on Morning.  Null when the household
 * has none — the screen then says so instead of rendering an empty list under no heading.
 */
export function defaultRoutineId(catalog: RoutineCatalog): string | null {
  return catalog.routines.find((r) => r.active)?.id ?? catalog.routines[0]?.id ?? null;
}

export function childRoutineRows(
  routine: RoutineCatalogEntry | null,
  childId: string,
): ChildRoutineRows {
  if (routine === null) return NONE;
  const byId = new Map(routine.steps.map((s) => [s.id, s]));
  const mine = routine.assignments
    .filter((a) => a.childId === childId)
    .sort((a, b) => a.position - b.position);

  const assigned: RoutineStepRow[] = [];
  for (const [index, a] of mine.entries()) {
    const step = byId.get(a.stepId);
    // An assignment to a step the catalog does not carry cannot happen (composite FK) —
    // but a row that silently vanished would be the wrong way to find out if it did.
    if (step === undefined) continue;
    assigned.push({
      stepId: step.id,
      labelFull: step.labelFull,
      icon: step.icon,
      assigned: true,
      position: index + 1,
      canMoveUp: index > 0,
      canMoveDown: index < mine.length - 1,
    });
  }

  const taken = new Set(mine.map((a) => a.stepId));
  const available: RoutineStepRow[] = routine.steps
    .filter((s) => s.active && !taken.has(s.id))
    .map((s) => ({
      stepId: s.id,
      labelFull: s.labelFull,
      icon: s.icon,
      assigned: false,
      position: null,
      canMoveUp: false,
      canMoveDown: false,
    }));

  return { assigned, available };
}

/**
 * Who has a step in this routine. The Routines screen draws these children small beside each
 * row — the ones the screen is NOT open on — so an adult adding teeth to one bedtime can see
 * at a glance whether the other two already brush.
 */
export function stepHolders(routine: RoutineCatalogEntry | null, stepId: string): ReadonlySet<string> {
  if (routine === null) return new Set();
  return new Set(routine.assignments.filter((a) => a.stepId === stepId).map((a) => a.childId));
}
