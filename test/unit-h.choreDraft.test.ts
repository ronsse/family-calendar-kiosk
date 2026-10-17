/**
 * Unit H — the New-chore sheet's draft, one key at a time.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  KEY_ROWS,
  NAME_MAX_CHARS,
  POINTS_MAX,
  canProceed,
  draftForEdit,
  draftToEdit,
  draftToRequest,
  emptyDraft,
  keyboardWidthPx,
  reduceDraft,
  type ChoreDraft,
  type DraftAction,
} from '../web/src/views/logic/choreDraft.ts';
import {
  DAY_ORDER,
  SPANS,
  daysToRrule,
  rruleToDays,
  spanOf,
  toggleDay,
  type DayCode,
} from '../web/src/views/logic/choreDays.ts';
import type { ChoreCatalogEntry } from '../web/src/app/adminActions.ts';
import { evaluateRrule } from '../src/domain/chores/recurrence.ts';
import type { LocalDate } from '../src/types.ts';

function run(actions: readonly DraftAction[], from: ChoreDraft = emptyDraft()): ChoreDraft {
  return actions.reduce(reduceDraft, from);
}

function typed(word: string): DraftAction[] {
  return [...word].map((c) => (c === ' ' ? { type: 'space' } : { type: 'type', char: c }));
}

test('typing capitalises the first letter of each word, and a space cannot lead or double', () => {
  const d = run(typed('feed the pet'));
  assert.equal(d.name, 'Feed the pet');
  assert.equal(run([{ type: 'space' }, ...typed('x')]).name, 'X');
  assert.equal(run([...typed('a'), { type: 'space' }, { type: 'space' }]).name, 'A ');
  assert.equal(run([...typed('ab'), { type: 'backspace' }]).name, 'A');
  assert.equal(run([{ type: 'backspace' }]).name, '');
  // A tab, a newline or a multi-character "char" is not a key on this keyboard.
  assert.equal(run([{ type: 'type', char: '\t' }]).name, '');
  assert.equal(run([{ type: 'type', char: 'ab' }]).name, 'A');
});

test('the name has a ceiling, and the keyboard covers the alphabet once', () => {
  const long = run(typed('abcdefghijklmnopqrstuvwxyzabcdefghij'));
  assert.equal([...long.name].length, NAME_MAX_CHARS);
  const letters = KEY_ROWS.flat().filter((k): k is string => typeof k === 'string');
  assert.equal(new Set(letters).size, 26);
  assert.equal(letters.length, 26);
  assert.ok(KEY_ROWS.flat().some((k) => typeof k !== 'string' && k.key === 'backspace'));
  assert.ok(KEY_ROWS.flat().some((k) => typeof k !== 'string' && k.key === 'space'));
  assert.ok(KEY_ROWS.every((row) => row.length <= 10), 'ten keys is the widest row the sheet is drawn for');
});

test('a step is left only with what the next one needs, and back always works', () => {
  const empty = emptyDraft();
  assert.equal(canProceed(empty), false);
  assert.equal(reduceDraft(empty, { type: 'next' }).step, 'name');

  const named = run(typed('Sweep'));
  assert.equal(canProceed(named), true);
  const picture = reduceDraft(named, { type: 'next' });
  assert.equal(picture.step, 'icon');
  assert.equal(canProceed(picture), false);
  assert.equal(reduceDraft(picture, { type: 'next' }).step, 'icon');
  // Keys do nothing off the name step.
  assert.equal(reduceDraft(picture, { type: 'type', char: 'x' }).name, 'Sweep');

  const withIcon = reduceDraft(picture, { type: 'setIcon', assetId: 'ico-table' });
  const details = reduceDraft(withIcon, { type: 'next' });
  assert.equal(details.step, 'details');
  assert.equal(canProceed(details), true);
  assert.equal(reduceDraft(details, { type: 'next' }).step, 'details');
  assert.equal(reduceDraft(reduceDraft(details, { type: 'back' }), { type: 'back' }).step, 'name');
  assert.equal(reduceDraft(empty, { type: 'back' }).step, 'name');
  assert.deepEqual(reduceDraft(details, { type: 'reset' }), empty);
});

test('the details are bounded: points clamp, and only a known span sticks', () => {
  const d = run([{ type: 'points', delta: -1 }, { type: 'points', delta: -1 }]);
  assert.equal(d.basePoints, 0);
  const up = run(Array.from({ length: POINTS_MAX + 5 }, () => ({ type: 'points', delta: 1 }) as const));
  assert.equal(up.basePoints, POINTS_MAX);
  assert.deepEqual(run([{ type: 'setSpan', spanId: 'weekends' }]).days, ['SA', 'SU']);
  assert.deepEqual(run([{ type: 'setSpan', spanId: 'fortnightly' }]).days, DAY_ORDER);
  assert.equal(run([{ type: 'setKind', kind: 'extra' }]).kind, 'extra');
  assert.equal(run([{ type: 'setModel', model: 'rotation' }]).assignmentModel, 'rotation');
});

test('several days at once: toggles build a set, spans set it, and the last day will not go out', () => {
  const school = run([{ type: 'setSpan', spanId: 'weekdays' }]);
  const monThu = run(
    [{ type: 'toggleDay', day: 'TU' }, { type: 'toggleDay', day: 'WE' }, { type: 'toggleDay', day: 'FR' }],
    school,
  );
  assert.deepEqual(monThu.days, ['MO', 'TH']);
  assert.equal(draftToRequest({ ...monThu, name: 'X', iconAssetId: 'ico-pet' }, 'child-a')?.rrule, 'FREQ=WEEKLY;BYDAY=MO,TH');
  // Toggling back to all seven is "Every day", spelled the way the file spells it.
  const all = run([{ type: 'setSpan', spanId: 'weekends' }, { type: 'setSpan', spanId: 'weekdays' }, { type: 'toggleDay', day: 'SA' }, { type: 'toggleDay', day: 'SU' }]);
  assert.equal(daysToRrule(all.days ?? []), 'FREQ=DAILY');
  assert.equal(spanOf(all.days ?? [])?.id, 'daily');
  // The last lit day stays lit: a chore that comes on no day is not a chore.
  assert.deepEqual(toggleDay(['SA'], 'SA'), ['SA']);
  assert.deepEqual(toggleDay(['SA', 'MO'], 'SA'), ['MO']);
});

test('every set of days the sheet can make is an rrule the expander reads, on exactly those days', () => {
  const monday = new Date(Date.UTC(2026, 8, 14));
  for (let mask = 1; mask < 128; mask += 1) {
    const days = DAY_ORDER.filter((_, i) => (mask & (1 << i)) !== 0);
    const rrule = daysToRrule(days);
    assert.ok(rrule !== null);
    assert.deepEqual(rruleToDays(rrule), days, rrule);
    DAY_ORDER.forEach((day, i) => {
      const date = new Date(monday.getTime() + i * 86_400_000).toISOString().slice(0, 10) as LocalDate;
      const e = evaluateRrule(rrule, date);
      assert.equal(e.supported, true, rrule);
      assert.equal(e.occurs, days.includes(day), `${rrule} on ${day}`);
    });
  }
  assert.deepEqual(SPANS.map((x) => x.id), ['daily', 'weekdays', 'weekends']);
});

test('a rule that says more than a set of weekdays reads back as Custom, never as a near miss', () => {
  for (const rrule of [
    'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO',
    'FREQ=WEEKLY;BYDAY=MO;UNTIL=20261231',
    'FREQ=DAILY;INTERVAL=3',
    'FREQ=MONTHLY',
    'FREQ=WEEKLY',
    'nonsense',
  ]) {
    assert.equal(rruleToDays(rrule), null, rrule);
  }
  assert.deepEqual(rruleToDays('FREQ=WEEKLY;BYDAY=TH,MO'), ['MO', 'TH']);
  assert.deepEqual(rruleToDays('FREQ=WEEKLY;INTERVAL=1;BYDAY=SA'), ['SA']);
});

const PET: ChoreCatalogEntry = {
  id: 'ch-pet',
  labelShort: 'Feed pet',
  labelFull: 'Feed the pet',
  icon: { assetId: 'ico-pet', url: '/x', isFallback: false },
  category: 'pet',
  assignmentModel: 'first_complete',
  basePoints: 3,
  kind: 'duty',
  rrule: 'FREQ=DAILY',
  dueByLocal: null,
  active: true,
  roster: [],
  rosterExplicit: false,
};

test('the edit sheet opens holding the chore, and sends only what was changed', () => {
  const d = draftForEdit(PET);
  assert.equal(d.editing, 'ch-pet');
  assert.equal(d.step, 'name');
  assert.equal(d.name, 'Feed the pet');
  assert.deepEqual(d.days, DAY_ORDER);
  assert.deepEqual(draftToEdit(d, PET), {}, 'opened and saved untouched is nothing to send');

  const renamed = run([{ type: 'backspace' }, { type: 'backspace' }, { type: 'backspace' }, ...typed('dog')], d);
  assert.deepEqual(draftToEdit(renamed, PET), { labelFull: 'Feed the dog' });

  const days = run([{ type: 'setSpan', spanId: 'weekends' }, { type: 'setIcon', assetId: 'ico-table' }], d);
  assert.deepEqual(draftToEdit(days, PET), { iconAssetId: 'ico-table', rrule: 'FREQ=WEEKLY;BYDAY=SA,SU' });
});

test('the edit action opens the reducer on a chore, and reset takes it back to a new one', () => {
  const d = run([{ type: 'edit', chore: PET }]);
  assert.deepEqual(d, draftForEdit(PET));
  assert.deepEqual(run([{ type: 'reset' }], d), emptyDraft());
});

test('an edited chore with a Custom rule keeps it unless a day is tapped', () => {
  const custom = { ...PET, rrule: 'FREQ=WEEKLY;INTERVAL=2;BYDAY=MO' };
  const d = draftForEdit(custom);
  assert.equal(d.days, null);
  assert.deepEqual(draftToEdit(run(typed('x'), d), custom), { labelFull: 'Feed the petx' });
  const tapped = run([{ type: 'toggleDay', day: 'WE' }], d);
  assert.deepEqual(tapped.days, ['WE'] satisfies DayCode[]);
  assert.deepEqual(draftToEdit(tapped, custom), { rrule: 'FREQ=WEEKLY;BYDAY=WE' });
  // An equal set written differently is not a change.
  assert.deepEqual(draftToEdit(draftForEdit({ ...PET, rrule: 'FREQ=WEEKLY;BYDAY=SU,SA' }), { ...PET, rrule: 'FREQ=WEEKLY;BYDAY=SU,SA' }), {});
});

test('the request carries the child the sheet was opened from as the whole roster', () => {
  assert.equal(draftToRequest(emptyDraft(), 'child-a'), null);
  const d = run([
    ...typed('feed the pet'),
    { type: 'next' },
    { type: 'setIcon', assetId: 'ico-pet' },
    { type: 'next' },
    { type: 'setKind', kind: 'extra' },
    { type: 'points', delta: 1 },
    { type: 'setModel', model: 'first_complete' },
    { type: 'setSpan', spanId: 'weekends' },
    { type: 'toggleDay', day: 'SU' },
  ]);
  assert.deepEqual(draftToRequest(d, 'child-b'), {
    labelFull: 'Feed the pet',
    iconAssetId: 'ico-pet',
    kind: 'extra',
    basePoints: 2,
    assignmentModel: 'first_complete',
    rrule: 'FREQ=WEEKLY;BYDAY=SA',
    roster: ['child-b'],
  });
});

test('the keyboard stands as one block the width of its widest row, so every row ends together', () => {
  // Ten keys at the 64px tap floor and nine 16px gutters. The space row is 7 keys and a space
  // bar that takes the rest, so at one key wide it is the narrowest row, never the widest.
  assert.equal(keyboardWidthPx(64, 16), 784);
  const spaceRow = KEY_ROWS.find((row) => row.some((k) => typeof k !== 'string' && k.key === 'space'));
  assert.ok(spaceRow !== undefined);
  assert.ok(spaceRow.length * 64 + (spaceRow.length - 1) * 16 < keyboardWidthPx(64, 16));
  // It scales with the floor rather than holding a number: a bigger key is a wider block.
  assert.equal(keyboardWidthPx(72, 16), 10 * 72 + 9 * 16);
});

test('every day and span pill drawn as a button CHANGES the set when pressed, and nothing else is a button', async () => {
  const { dayPillFlags, spanPillFlags } = await import('../web/src/views/logic/choreDays.ts');
  const { pillState } = await import('../web/src/views/logic/pill.ts');
  const sets: (readonly DayCode[] | null)[] = [DAY_ORDER, ['MO', 'TH'], ['SA'], ['MO', 'TU', 'WE', 'TH', 'FR'], null];
  for (const days of sets) {
    const from = { ...emptyDraft(), step: 'details' as const, days };
    for (const day of DAY_ORDER) {
      const face = pillState(dayPillFlags(days, day, false));
      const after = reduceDraft(from, { type: 'toggleDay', day }).days;
      assert.equal(face.enabled, JSON.stringify(after) !== JSON.stringify(days), `${String(days)} ${day}`);
      assert.equal(face.filled, days !== null && days.includes(day), 'a lit day is drawn filled');
      assert.equal(pillState(dayPillFlags(days, day, true)).enabled, false, 'busy is inert');
    }
    for (const span of SPANS) {
      const face = pillState(spanPillFlags(days, span, false));
      const after = reduceDraft(from, { type: 'setSpan', spanId: span.id }).days;
      assert.equal(face.enabled, JSON.stringify(after) !== JSON.stringify(days), `${String(days)} ${span.id}`);
    }
  }
});
