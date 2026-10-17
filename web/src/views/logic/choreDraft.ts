/**
 * The New-chore sheet, minus its pixels.
 *
 * A parent standing at the wall makes a chore in three steps — NAME, PICTURE, DETAILS — on a
 * panel with no keyboard, so the sheet draws its own. Everything the sheet holds and every way
 * it may change is here, as a reducer over a plain draft, and the component only dispatches:
 *
 *   - The name is typed one key at a time. The first letter capitalises itself (sentence
 *     case, like every chore the file ever authored), a space is a key like any other, and
 *     the name is capped so it cannot outgrow a card.
 *   - A step may only be LEFT when it has what the next one needs: no name, no icon step;
 *     no icon, no details. `canProceed` is that rule, and the Next key is drawn inert from
 *     it rather than tapped into nothing.
 *   - The details are pills over closed lists — kind, model, days — and a points stepper
 *     with a floor and a ceiling, so the draft cannot hold a value the server would refuse for
 *     shape. What it CAN still be refused for (an icon that vanished, a child who is gone) the
 *     server says in words, and the sheet shows those words.
 *
 * `draftToRequest` is the only way out: the body of `POST /api/admin/v1/chores`, with the
 * child whose screen the sheet was opened from as the whole roster. A parent widens it
 * afterwards on the same screen — that is what the roster toggles are for.
 *
 * No React, no `.tsx` import: the test runner cannot load a component, and this file is the
 * half of the sheet that has tests.
 */

import type {
  ChoreCatalogEntry,
  ChoreEditRequest,
  NewChoreRequest,
} from '../../app/adminActions.ts';
import type { AssignmentModel, ChoreKind } from '../../../../src/types.ts';
import {
  DAY_ORDER,
  SPANS,
  canonicalDays,
  daysToRrule,
  rruleToDays,
  toggleDay,
  type DayCode,
} from './choreDays.ts';

export type DraftStep = 'name' | 'icon' | 'details';

export const STEP_ORDER: readonly DraftStep[] = ['name', 'icon', 'details'];

/** Longest name the sheet accepts — `labelFull` on a card is one line at arm's length. */
export const NAME_MAX_CHARS = 28;
export const POINTS_MIN = 0;
export const POINTS_MAX = 20;

export const KIND_WORDS: Readonly<Record<ChoreKind, string>> = {
  duty: 'Duty',
  extra: 'Extra',
};

/**
 * The keyboard, row by row. Letters are themselves; the two keys that are not letters are
 * named so the component cannot mistake a glyph for a character to type.
 */
export type KeyToken = string | { readonly key: 'backspace' } | { readonly key: 'space' };

export const KEY_ROWS: readonly (readonly KeyToken[])[] = [
  [...'qwertyuiop'],
  [...'asdfghjkl', { key: 'backspace' }],
  [...'zxcvbnm', { key: 'space' }],
];

/**
 * How wide the keyboard stands: its widest row of keys at `keyPx`, with `gapPx` between them.
 * The space bar flexes, so its row is never the widest. The sheet draws the rows as ONE block
 * this wide and centres it, so every row ends where the others do. At the tap floor it is 784,
 * and beside the grown-up column the sheet's content is 780: centred, the block reaches 2px into
 * each side's padding, where left-aligned it ran 4px into one (measured 2026-10-11).
 */
export function keyboardWidthPx(keyPx: number, gapPx: number): number {
  const widest = Math.max(...KEY_ROWS.map((row) => row.length));
  return widest * keyPx + (widest - 1) * gapPx;
}

export interface ChoreDraft {
  readonly step: DraftStep;
  readonly name: string;
  readonly iconAssetId: string | null;
  readonly kind: ChoreKind;
  readonly basePoints: number;
  readonly assignmentModel: AssignmentModel;
  /**
   * The weekdays it comes, never empty — or `null` for a chore being EDITED whose rule says more
   * than a set of weekdays can (an interval, an end). Null is "Custom": left exactly as it is
   * unless a day is tapped. A new chore always starts with a set.
   */
  readonly days: readonly DayCode[] | null;
  /** The chore being changed, or null for a new one. Decides which way out the sheet takes. */
  readonly editing: string | null;
}

export type DraftAction =
  | { readonly type: 'type'; readonly char: string }
  | { readonly type: 'backspace' }
  | { readonly type: 'space' }
  | { readonly type: 'setIcon'; readonly assetId: string }
  | { readonly type: 'setKind'; readonly kind: ChoreKind }
  | { readonly type: 'points'; readonly delta: 1 | -1 }
  | { readonly type: 'setModel'; readonly model: AssignmentModel }
  | { readonly type: 'toggleDay'; readonly day: DayCode }
  | { readonly type: 'setSpan'; readonly spanId: string }
  | { readonly type: 'next' }
  | { readonly type: 'back' }
  /** Back to `emptyDraft()`: the sheet opens clean every time. */
  | { readonly type: 'reset' }
  /** Open on an existing chore instead: `draftForEdit`, so the list's Edit key and the tests share one door. */
  | { readonly type: 'edit'; readonly chore: ChoreCatalogEntry };

/** A duty, every day, on her own, for one star: the most common chore, so the fewest taps. */
export function emptyDraft(): ChoreDraft {
  return {
    step: 'name',
    name: '',
    iconAssetId: null,
    kind: 'duty',
    basePoints: 1,
    assignmentModel: 'individual',
    days: DAY_ORDER,
    editing: null,
  };
}

/**
 * The sheet opened on a chore that exists, at its NAME step, holding what the chore holds now.
 * The Edit sheet changes name, picture and days only — kind, worth, sharing and children each
 * have their own control on the chore's row — so the other fields are carried for shape and
 * never sent.
 */
export function draftForEdit(chore: ChoreCatalogEntry): ChoreDraft {
  return {
    step: 'name',
    name: chore.labelFull,
    iconAssetId: chore.icon.assetId,
    kind: chore.kind,
    basePoints: chore.basePoints,
    assignmentModel: chore.assignmentModel,
    days: rruleToDays(chore.rrule),
    editing: chore.id,
  };
}

/** Whether the current step has what the next one needs. On the last step: whether it can be sent. */
export function canProceed(draft: ChoreDraft): boolean {
  switch (draft.step) {
    case 'name':
      return draft.name.trim().length > 0;
    case 'icon':
      return draft.iconAssetId !== null;
    case 'details':
      return draft.name.trim().length > 0 && draft.iconAssetId !== null;
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function reduceDraft(draft: ChoreDraft, action: DraftAction): ChoreDraft {
  switch (action.type) {
    case 'type': {
      if (draft.step !== 'name') return draft;
      const char = [...action.char][0];
      if (char === undefined || char.trim() === '') return draft;
      if ([...draft.name].length >= NAME_MAX_CHARS) return draft;
      // Sentence case, like every chore the file ever authored: "Feed the pet", not "Feed The Pet".
      return { ...draft, name: draft.name + (draft.name === '' ? char.toUpperCase() : char) };
    }
    case 'space': {
      if (draft.step !== 'name') return draft;
      // A space cannot lead, and two cannot touch: a name is words.
      if (draft.name === '' || draft.name.endsWith(' ')) return draft;
      if ([...draft.name].length >= NAME_MAX_CHARS) return draft;
      return { ...draft, name: draft.name + ' ' };
    }
    case 'backspace': {
      if (draft.step !== 'name') return draft;
      return { ...draft, name: [...draft.name].slice(0, -1).join('') };
    }
    case 'setIcon':
      return { ...draft, iconAssetId: action.assetId };
    case 'setKind':
      return { ...draft, kind: action.kind };
    case 'points':
      return { ...draft, basePoints: clamp(draft.basePoints + action.delta, POINTS_MIN, POINTS_MAX) };
    case 'setModel':
      return { ...draft, assignmentModel: action.model };
    case 'toggleDay':
      // From "Custom", the first tap starts a fresh set of one: there is no set to toggle within.
      return { ...draft, days: draft.days === null ? [action.day] : toggleDay(draft.days, action.day) };
    case 'setSpan': {
      const span = SPANS.find((x) => x.id === action.spanId);
      return span === undefined ? draft : { ...draft, days: canonicalDays(span.days) };
    }
    case 'next': {
      if (!canProceed(draft)) return draft;
      const at = STEP_ORDER.indexOf(draft.step);
      const next = STEP_ORDER[at + 1];
      return next === undefined ? draft : { ...draft, step: next };
    }
    case 'back': {
      const at = STEP_ORDER.indexOf(draft.step);
      const prev = STEP_ORDER[at - 1];
      return prev === undefined ? draft : { ...draft, step: prev };
    }
    case 'reset':
      return emptyDraft();
    case 'edit':
      return draftForEdit(action.chore);
  }
}

/** The request body, or null while the draft is not yet whole. */
export function draftToRequest(draft: ChoreDraft, childId: string): NewChoreRequest | null {
  const name = draft.name.trim();
  const rrule = draft.days === null ? null : daysToRrule(draft.days);
  if (name === '' || draft.iconAssetId === null || rrule === null) return null;
  return {
    labelFull: name,
    iconAssetId: draft.iconAssetId,
    kind: draft.kind,
    basePoints: draft.basePoints,
    assignmentModel: draft.assignmentModel,
    rrule,
    roster: [childId],
  };
}

/**
 * The edit body: ONLY what differs from the chore as it stands, so an untouched field is never
 * re-sent and re-validated. `{}` means nothing changed and the sheet just closes; null means the
 * draft is not whole. Days read as "Custom" are never sent.
 */
export function draftToEdit(draft: ChoreDraft, chore: ChoreCatalogEntry): ChoreEditRequest | null {
  const name = draft.name.trim().replace(/\s+/g, ' ');
  if (name === '' || draft.iconAssetId === null) return null;
  const patch: { labelFull?: string; iconAssetId?: string; rrule?: string } = {};
  if (name !== chore.labelFull) patch.labelFull = name;
  if (draft.iconAssetId !== chore.icon.assetId) patch.iconAssetId = draft.iconAssetId;
  if (draft.days !== null) {
    const rrule = daysToRrule(draft.days);
    if (rrule === null) return null;
    const before = rruleToDays(chore.rrule);
    if (before === null || daysToRrule(before) !== rrule) patch.rrule = rrule;
  }
  return patch;
}
