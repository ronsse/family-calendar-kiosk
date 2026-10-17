/**
 * Unit C — the chores domain. Public surface.
 *
 * Backs api.md's chore routes:
 *   POST /api/wall/v1/chores/:assignmentId/claim      -> claimChore   (childId REQUIRED)
 *   POST /api/wall/v1/chores/:assignmentId/unclaim    -> unclaimChore (childId REQUIRED)
 *   POST /api/admin/v1/chores/:assignmentId/approve   -> approveChore
 *   POST /api/admin/v1/chores/:assignmentId/reject    -> rejectChore
 *   GET  /api/wall/v1/snapshot                        -> choresForDate
 *
 * Nothing in here reads the clock to decide what "today" is: every entry point takes an
 * explicit LocalDate, because the client asserts its own view of today and the server
 * answering from its own clock is how the wall ends up a day behind through 6:00 AM
 * (H1 lens 3). `materializeChoreDay` defaults to the server's today purely as a
 * convenience for scripts and tests.
 */

export {
  materializeChoreDay,
  materializeChoresForDate,
  rotationMembers,
  type ChoreMaterializationResult,
  type MaterializedChoreDay,
} from './materialize.ts';

export {
  choresForDate,
  getChoreAssignment,
  listChoreAssignments,
  type ChoresForDate,
} from './read.ts';

export {
  approveChore,
  claimChore,
  rejectChore,
  unclaimChore,
  type ChoreTransitionError,
  type ChoreTransitionResult,
} from './transitions.ts';

export { evaluateRrule, occursOn, type RruleEvaluation } from './recurrence.ts';
export { rotationAssignee, type RotationMember } from './rotation.ts';
export { EPOCH, dayIndex } from './localdays.ts';

export {
  ASSIGNMENT_MODELS,
  moveChoreMember,
  readChoreCatalog,
  reconcileDay,
  setChoreMember,
  setChoreModel,
  type ChoreCatalog,
  type ChoreCatalogEntry,
  type ChoreIconEntry,
  type ChoreEditFailure,
  type ChoreEditResult,
  type ChoreRosterEntry,
} from './assign.ts';
export {
  applyChores,
  choreAuthoringWarnings,
  choreIdFor,
  createChore,
  editChore,
  historyFingerprint,
  parseChoreFile,
  restoreChore,
  retireChore,
  shortLabelFor,
  validateChoreAuthoring,
  type ChoreAction,
  type ChoreAuthoring,
  type ChoreChange,
  type ChoreParseResult,
  type ChoreSpec,
  type ChoreEditOutcome,
  type ChoreRetireOutcome,
  type CreateChoreResult,
} from './authoring.ts';
