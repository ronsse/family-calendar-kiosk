/**
 * Unit E — routines. Public surface.
 *
 * The routine runner is the flagship: ordered, picture-led step sequences a child works
 * through alone at 06:00. Unit F composes the wall snapshot from `todaysRoutinesWithStatus`
 * and the two step transitions; nothing outside this directory reaches into the routine
 * tables directly.
 *
 * Lazy daily materialization itself belongs to Unit A (`materializeRoutineRun`) and is
 * composed, never duplicated.
 */

export {
  todaysRoutines,
  todaysRoutinesWithStatus,
  viewsForRun,
  ROUTINE_ICON_CATEGORY,
  STEP_ICON_CATEGORY,
  type TodaysRoutinesResult,
  type RoutineFailure,
} from './read.ts';

export {
  completeStep,
  revokeStep,
  type StepMutation,
  type StepCompleted,
  type StepRevoked,
  type StepRefused,
  type StepRefusalReason,
  type CompleteStepResult,
  type RevokeStepResult,
} from './steps.ts';

export { progressOf, progressForRun, type RoutineProgress } from './progress.ts';

export {
  readRoutineCatalog,
  assignStep,
  moveStep,
  reconcileRun,
  type RoutineCatalog,
  type RoutineCatalogEntry,
  type RoutineStepCatalogEntry,
  type RoutineStepAssignmentEntry,
  type AssignStepInput,
  type MoveStepInput,
  type AssignFailure,
  type AssignOutcome,
  type AssignRefused,
} from './assign.ts';
