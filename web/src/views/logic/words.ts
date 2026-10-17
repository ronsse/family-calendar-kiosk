/**
 * Unit H — the words for a machine state, in the two lengths the bands need.
 *
 * A state is carried by fill + glyph + edge before it is carried by a word (Unit
 * G rule 4, "never colour alone"); these strings are the redundant channel for the
 * bands that read.  The picture band has no entry because it renders no words —
 * there is deliberately no `picture` key to reach for.
 */

import type { ChoreState, MaterializationStatus } from '../../../../src/types.ts';

export interface StateWords {
  /** <= 2 words, for the emergent band. */
  readonly short: string;
  readonly full: string;
}

export const choreStateWords: Record<ChoreState, StateWords> = {
  pending: { short: 'To do', full: 'Ready to do' },
  claimed: { short: 'Waiting', full: 'Waiting for a grown-up' },
  // "Done", not "Done and paid". Every live duty in this household is `basePoints 0` by the
  // house rule — duties are expected and pay nothing, extras earn — so the old word promised
  // money that was never coming, on the screen of the child it was promised to. Reported
  // 2026-09-09: "the jobs say done and paid. But we're not paying for jobs."
  //
  // It is one word for both kinds rather than a branch on points, because the CARD already
  // carries what it pays: an extra shows "8 points" beside the tick and a duty shows nothing.
  // The state word's job is the state.
  approved: { short: 'Done', full: 'Done' },
  superseded: { short: 'All set', full: 'Someone else got it' },
};

export const freshnessWords: Record<MaterializationStatus, StateWords> = {
  ok: { short: 'Fresh', full: 'Up to date' },
  stale: { short: 'Old', full: 'Showing older information' },
  error: { short: 'Stuck', full: 'Today did not build — tell a grown-up' },
};

/*
 * There is deliberately NO time-box words table here.
 *
 * One existed — "Soon" / "Now" / "Finished for today" — and nothing ever rendered it, because
 * `ChildView.currentRun` shows the OPEN routine or the one opening soonest and no other. The
 * phase is therefore carried by which routine is on screen, and a label restating it would be
 * the wall saying "Now" above the only thing it is showing.
 *
 * The refusal the table encoded still stands and lives in `timebox.ts`: the phase moves
 * EMPHASIS, never permission. "Later" must never become "Locked" — a clock-gated routine
 * bricks the wall at 05:50 (H2 Q1).
 */
