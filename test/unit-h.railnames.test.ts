/**
 * Unit H — the rail's names: every child's, whole, at one size (web/src/views/logic/railNames.ts).
 *
 * Driven with synthetic names of a realistic length — seven and eight letters — because the
 * example household's "Child A" / "Child B" / "Child C" are the names that HID the defect: the
 * first word of "Child B" is a real word, so a rail that drew "Child" looked merely odd, and the
 * pre-reader's tile with no name at all looked like a choice.
 *
 * The arithmetic here is written out again by hand rather than calling the module's own helpers,
 * so a wrong constant in the module cannot agree with itself.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fontSizePx, iconPx, layoutPx, MIN } from '../web/src/design/tokens.ts';
import { nameWidthPx, planRailNames, type RailNamePlan } from '../web/src/views/logic/railNames.ts';
import { shellGeometry, WALL_LAYOUTS } from '../web/src/views/logic/theme.ts';

const SYNTHETIC = ['Augusta', 'Benedict', 'Cordelia'];

/** Felt's bottom row runs the shell's whole body, which is what ChildBar charges it. */
const ROW_PX = shellGeometry(WALL_LAYOUTS.felt, false).body.width;
const SIDE_PX = layoutPx.sideWidth;

/** The longest line of a name on `lines` lines, broken at its best space — in characters. */
function longestChars(name: string, lines: 1 | 2): number {
  const n = name.trim();
  if (lines === 1) return n.length;
  let best = n.length;
  for (let i = 0; i < n.length; i++) {
    if (n[i] === ' ') best = Math.min(best, Math.max(i, n.length - i - 1));
  }
  return best;
}

/** A one-word name of exactly `n` letters, starting from a real one so the cases stay readable. */
function word(start: string, n: number): string {
  const s = (start + 'abcdefghijklmnopqrstuvwxyz').slice(0, n);
  assert.equal(s.length, n);
  return s;
}

/** Felt's row, by hand: house key 64, a 16 gutter before each tile, and each tile's parts. */
function rowNeedsPx(names: readonly string[], plan: RailNamePlan): number {
  const tile = (name: string) =>
    4 + plan.facePx + 8 + 3 + 12 + Math.ceil(longestChars(name, plan.lines) * 0.65 * plan.sizePx) + 12 + 3 + 4;
  return 64 + 16 * names.length + names.reduce((sum, name) => sum + tile(name), 0);
}

/** The room a name has on a side rail, by hand: 104 less the inset, the plinth's frame and the key's padding. */
function sideRoomPx(form: 'plinth' | 'spine'): number {
  return 104 - 2 * 4 - (form === 'plinth' ? 2 * 4 : 0) - 2 * 4;
}

test('the geometry these tests assume is the geometry the wall has', () => {
  assert.equal(ROW_PX, 912, 'felt bottom row: 960 less the 24 each side');
  assert.equal(SIDE_PX, 104);
  assert.equal(layoutPx.railBottomHeight, 64);
  assert.equal(layoutPx.railHomeHeight, 64);
});

test('felt names all three children whole at 20px, one line, beside a 56px face', () => {
  const plan = planRailNames('row', SYNTHETIC, ROW_PX, true);
  assert.deepEqual(plan, { place: 'beside', sizePx: fontSizePx.body, lines: 1, facePx: 56, fits: true });
  assert.ok(plan !== null && rowNeedsPx(SYNTHETIC, plan) <= ROW_PX, 'and the row really holds them');
});

test('one size for every name on a rail, however different their lengths', () => {
  // A short name does not get a bigger size than a long one beside it: three captions at three
  // sizes read as three kinds of thing.
  const plan = planRailNames('row', ['Jo', 'Benedict', 'Maximilienne'], ROW_PX, true);
  assert.ok(plan !== null);
  assert.equal(typeof plan.sizePx, 'number');
  assert.equal(plan.fits, true);
});

test('felt gives up type first, then a line, and the face only last', () => {
  // Each case is the shortest set that forces the next step; the assertions check, by hand,
  // that the step before it would NOT have held the row and this one does.
  const cases: { names: string[]; want: Omit<RailNamePlan, 'place' | 'fits'> }[] = [
    // 13 letters each: 20px would need 928 of the 912.
    { names: [word('Seraphina', 13), word('Bartholomew', 13), word('Wilhelmina', 13)], want: { sizePx: 17, lines: 1, facePx: 56 } },
    // 16 each: 17px would need 949.
    { names: [word('Anastasia', 16), word('Bartholomew', 16), word('Cordelia', 16)], want: { sizePx: 14, lines: 1, facePx: 56 } },
    // Two words, 19 characters each: one line at 14 would need 937, so they break at their
    // space (692) before the face shrinks.
    { names: ['Anastasia Bellamyss', 'Bartholomew Sonness', 'Cordelia Mariettass'], want: { sizePx: 14, lines: 2, facePx: 56 } },
    // One word each, 18 + 18 + 19 letters, too long for 14px beside a 56px face (919) and with
    // no space to break at: the face gives 8px a tile, and they hold (895).
    { names: [word('Anastasia', 18), word('Bartholomew', 18), word('Cordelia', 19)], want: { sizePx: 14, lines: 1, facePx: 48 } },
  ];
  for (const { names, want } of cases) {
    const plan = planRailNames('row', names, ROW_PX, true);
    assert.ok(plan !== null);
    assert.deepEqual(
      { sizePx: plan.sizePx, lines: plan.lines, facePx: plan.facePx, fits: plan.fits },
      { ...want, fits: true },
      names.join(' / '),
    );
    assert.ok(rowNeedsPx(names, plan) <= ROW_PX, `${names.join(' / ')}: the plan holds the row`);
  }
  // And the step before each really did not hold.
  const at = (names: string[], sizePx: number, lines: 1 | 2, facePx: number) =>
    rowNeedsPx(names, { place: 'beside', sizePx, lines, facePx, fits: true });
  const c = cases.map((x) => x.names);
  assert.ok(at(c[0]!, 20, 1, 56) > ROW_PX);
  assert.ok(at(c[1]!, 17, 1, 56) > ROW_PX);
  assert.ok(at(c[2]!, 14, 1, 56) > ROW_PX);
  assert.ok(at(c[3]!, 14, 1, 56) > ROW_PX);
  assert.ok(at(c[3]!, 14, 2, 56) > ROW_PX, 'a second line does not help a name with no space');
});

test('past every step the name is still drawn whole — the plan says it does not fit, and never cuts it', () => {
  const huge = ['A'.repeat(40), 'B'.repeat(40), 'C'.repeat(40)];
  const plan = planRailNames('row', huge, ROW_PX, true);
  assert.ok(plan !== null);
  assert.equal(plan.fits, false);
  // At its floors, not under them: the face never below the 48 a rail face may be, the type never
  // under 14. What it asks of the drawing is wrapping, which ChildBar's nameplate allows.
  assert.equal(plan.sizePx, MIN.fontSizePx);
  assert.equal(plan.facePx, iconPx.md);
});

test('no plan ever goes under the type floor, a 48px face, or a pill taller than the bar', () => {
  const pool = ['Al', 'Augusta', 'Benedict', 'Cordelia', 'Mary Jane', 'Wilhelmina', 'Anastasia Bellamy', 'X'.repeat(25)];
  for (const a of pool) {
    for (const b of pool) {
      for (const c of pool) {
        for (const form of ['row', 'plinth', 'spine'] as const) {
          const plan = planRailNames(form, [a, b, c], form === 'row' ? ROW_PX : SIDE_PX, true);
          assert.ok(plan !== null);
          assert.ok(plan.sizePx >= MIN.fontSizePx, `${form}: ${String(plan.sizePx)}px`);
          assert.ok(plan.facePx >= iconPx.md, `${form}: face ${String(plan.facePx)}`);
          if (form === 'row') {
            const pill = plan.lines * Math.ceil(plan.sizePx * 1.25) + 2 * 4 + 2 * 3;
            assert.ok(pill <= 64 - 2 * 4, `row pill ${String(pill)}px in a 56px bar`);
          }
        }
      }
    }
  }
});

test('the side rails set eight-letter names whole under a 64px face, and the room is real', () => {
  for (const form of ['plinth', 'spine'] as const) {
    const plan = planRailNames(form, SYNTHETIC, SIDE_PX, true);
    assert.ok(plan !== null);
    assert.equal(plan.place, 'below');
    assert.equal(plan.facePx, 64);
    assert.equal(plan.lines, 1);
    assert.equal(plan.fits, true);
    for (const name of SYNTHETIC) {
      assert.ok(
        Math.ceil(name.length * 0.65 * plan.sizePx) <= sideRoomPx(form),
        `${form}: ${name} at ${String(plan.sizePx)}px in ${String(sideRoomPx(form))}`,
      );
    }
  }
  // An eight-letter name at 17px is 89px by the estimate: one more than the spine's 88 and nine
  // more than the plinth's 80 (its frame). So both set eight letters at 14 — and seven at 17.
  assert.equal(planRailNames('plinth', SYNTHETIC, SIDE_PX, true)?.sizePx, fontSizePx.meta);
  assert.equal(planRailNames('spine', SYNTHETIC, SIDE_PX, true)?.sizePx, fontSizePx.meta);
  for (const form of ['plinth', 'spine'] as const) {
    assert.equal(planRailNames(form, ['Augusta', 'Beatrix', 'Corinna'], SIDE_PX, true)?.sizePx, fontSizePx.small, form);
  }
});

test('a two-word name on a side rail takes a second line rather than an ellipsis', () => {
  // "Mary Beatrice" is 119px on one line at 14 and the plinth has 80; "Beatrice" alone is 73.
  const plan = planRailNames('plinth', ['Mary Beatrice', 'Augusta', 'Benedict'], SIDE_PX, true);
  assert.ok(plan !== null);
  assert.deepEqual({ sizePx: plan.sizePx, lines: plan.lines, fits: plan.fits }, { sizePx: 14, lines: 2, fits: true });
  // A longer second word does not fit by the estimate even so — and the plan says so rather than
  // cutting it; the nameplate wraps it whole.
  const long = planRailNames('plinth', ['Mary Josephine', 'Augusta', 'Benedict'], SIDE_PX, true);
  assert.deepEqual({ sizePx: long?.sizePx, lines: long?.lines, fits: long?.fits }, { sizePx: 14, lines: 2, fits: false });
  // Three tiles of two lines still stand in the rail's height, under the house key.
  const tile = 2 * 4 + 2 * 4 + 64 + 4 + 2 * Math.ceil(14 * 1.25);
  assert.ok(64 + 16 + 3 * tile + 2 * 16 <= 540 - 2 * 24, `three ${String(tile)}px tiles fit`);
});

test('the grown-up screens’ plain column names nobody', () => {
  assert.equal(planRailNames('column', SYNTHETIC, SIDE_PX, true), null);
});

test('a name’s width is its characters at the safe estimate, and two lines break at the best space', () => {
  assert.equal(nameWidthPx('Benedict', 20), Math.ceil(8 * 0.65 * 20));
  assert.equal(nameWidthPx('  Benedict  ', 20), nameWidthPx('Benedict', 20), 'stray spaces are not letters');
  assert.equal(nameWidthPx('Mary Josephine', 14, 2), Math.ceil(9 * 0.65 * 14), 'Mary / Josephine: the longer half');
  assert.equal(nameWidthPx('Benedict', 14, 2), nameWidthPx('Benedict', 14, 1), 'no space, no second line');
});
