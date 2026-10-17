/**
 * Unit H — progress derived from the snapshot, once, in the domain layer.
 *
 * The three bands render the SAME numbers three ways; none of them recomputes.
 * Anything that could differ between bands is a divergence waiting to happen.
 */

import type { ChoreAssignmentView, RoutineRunStepView, RoutineRunView } from '../../../../src/types.ts';

export interface Progress {
  readonly total: number;
  readonly done: number;
  readonly remaining: number;
  /** 0..1.  Exactly 0 when there is nothing to do — never NaN. */
  readonly fraction: number;
  /** An EMPTY routine is not "done".  Nothing celebrates zero steps. */
  readonly allDone: boolean;
}

/** A stable copy, ordered by position.  Never mutates the snapshot. */
export function sortedSteps(run: RoutineRunView): RoutineRunStepView[] {
  return [...(run.steps ?? [])].sort((a, b) => a.position - b.position);
}

export function isStepDone(step: RoutineRunStepView): boolean {
  return step.completedAtUtc !== null && step.completedAtUtc !== undefined;
}

export function routineProgress(run: RoutineRunView): Progress {
  const steps = run.steps ?? [];
  const total = steps.length;
  const done = steps.filter(isStepDone).length;
  return {
    total,
    done,
    remaining: Math.max(0, total - done),
    fraction: total === 0 ? 0 : done / total,
    allDone: total > 0 && done === total,
  };
}

/** The first not-yet-done step in position order — what the wall points at. */
export function nextStep(run: RoutineRunView): RoutineRunStepView | null {
  return sortedSteps(run).find((s) => !isStepDone(s)) ?? null;
}

/** Chores count as done once an adult has approved them, not when claimed. */
export function choreProgress(chores: readonly ChoreAssignmentView[]): Progress {
  const live = chores.filter((c) => c.state !== 'superseded');
  const total = live.length;
  const done = live.filter((c) => c.state === 'approved').length;
  return {
    total,
    done,
    remaining: Math.max(0, total - done),
    fraction: total === 0 ? 0 : done / total,
    allDone: total > 0 && done === total,
  };
}
