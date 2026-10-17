/**
 * Unit H — counts and their nouns (web/src/views/logic/plural.ts), and the sites that print them.
 *
 * The defect was "1 points": every site wrote its own `${n} points`. The helper is tested here,
 * and the second half of this file fails if a site goes back to writing its own.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { counted, NOUN, nounFor } from '../web/src/views/logic/plural.ts';
import { choreListSummary } from '../web/src/views/logic/grownup.ts';

test('one takes the singular, and so does minus one', () => {
  assert.equal(counted(1, NOUN.point), '1 point');
  assert.equal(counted(-1, NOUN.point), '-1 point');
  assert.equal(nounFor(1, NOUN.sleep), 'sleep');
});

test('zero, many, negatives and fractions take the plural', () => {
  assert.equal(counted(0, NOUN.point), '0 points');
  assert.equal(counted(2, NOUN.point), '2 points');
  assert.equal(counted(12, NOUN.chore), '12 chores');
  assert.equal(counted(-3, NOUN.point), '-3 points');
  assert.equal(counted(1.5, NOUN.point), '1.5 points');
  assert.equal(nounFor(Number.NaN, NOUN.step), 'steps');
});

test('the abbreviation is the same either way', () => {
  assert.equal(counted(1, NOUN.min), '1 min');
  assert.equal(counted(16, NOUN.min), '16 min');
});

test('the grown-up summary lines count through it', () => {
  const rows = (duties: number, extras: number) =>
    [
      ...Array.from({ length: duties }, () => ({ kind: 'duty' })),
      ...Array.from({ length: extras }, () => ({ kind: 'extra' })),
    ] as never;
  assert.deepEqual(choreListSummary(rows(1, 0)), { head: '1 chore', detail: '1 duty · 0 extras' });
  assert.deepEqual(choreListSummary(rows(2, 1)), { head: '3 chores', detail: '2 duties · 1 extra' });
});

// ---------------------------------------------------------------------------
// No site writes its own plural
// ---------------------------------------------------------------------------

const ROOT = path.resolve(import.meta.dirname, '..');

function sources(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...sources(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** A number interpolated straight before a counted noun: `${String(n)} points`, `${n} points`. */
const HAND_PLURAL = /\$\{[^}]*\}\s+(points?|stars?|sleeps?|chores?|steps?|things?)\b/;
/** A word constant for one of those nouns, which is how a site spells its own. */
const WORD_CONST = /\bconst\s+[A-Z_]*(POINTS?|STARS?|SLEEPS?)_WORD\s*=/;

test('the scan for hand-written plurals catches one (control)', () => {
  assert.ok(HAND_PLURAL.test('{`${String(points)} points`}'));
  assert.ok(WORD_CONST.test("const POINTS_WORD = 'points';"));
  assert.ok(!HAND_PLURAL.test('{`${String(n)} of ${String(m)} so far.`}'));
});

test('no web source writes its own count of points, stars, sleeps, chores, steps or things', () => {
  const hits: string[] = [];
  for (const file of sources(path.join(ROOT, 'web/src'))) {
    const rel = path.relative(ROOT, file);
    if (rel === 'web/src/views/logic/plural.ts') continue;
    readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      if (/^\s*\*/.test(code)) return;
      if (HAND_PLURAL.test(code) || WORD_CONST.test(code)) hits.push(`${rel}:${String(i + 1)}: ${line.trim()}`);
    });
  }
  assert.deepEqual(hits, []);
});
