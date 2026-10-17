/**
 * Unit H — strips that choose words that fit instead of clipping (logic/textFit.ts).
 *
 * The ruler here is fake on purpose: width proportional to characters and size. The real one is
 * a canvas in the strip's own font; what these tests pin is the DECISION, walked through every
 * room from generous to none, and the one promise the decision makes — whatever it picks is
 * never wider than the room it was given.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { LocalDate } from '../src/types.ts';
import { fontSizePx } from '../web/src/design/tokens.ts';
import { FIT_SLACK_PX, firstThatFits, fitsIn, headerDateFit, type MeasureText } from '../web/src/views/logic/textFit.ts';
import {
  departureFit,
  departureMinutes,
  departureWords,
  headerKeeps,
  type Departure,
  type DepartureAlert,
  type DepartureFit,
  type DepartureRoom,
} from '../web/src/views/logic/departures.ts';
import { localDateText } from '../web/src/views/logic/clock.ts';

/**
 * Calibrated to the measurement that started this: "Sun, Oct 11" at 17px came to 96px in
 * gallery's typeface, and the header gave it 89.
 */
const EM_PER_CHAR = 96 / (11 * 17);
const ruler: MeasureText = (words, sizePx) => [...words].length * sizePx * EM_PER_CHAR;

const SUN = '2026-10-11' as LocalDate;

test('fitsIn keeps the slack: a run that measures within it of the room does not fit', () => {
  assert.equal(fitsIn(90, 90), false);
  assert.equal(fitsIn(90 - FIT_SLACK_PX, 90), true);
  assert.equal(fitsIn(90 - FIT_SLACK_PX + 0.5, 90), false);
});

test('firstThatFits takes the first in order that fits, and null when none does', () => {
  const widths = [120, 80, 40];
  assert.equal(firstThatFits(widths, 200, (w) => w), 120);
  assert.equal(firstThatFits(widths, 100, (w) => w), 80);
  assert.equal(firstThatFits(widths, 50, (w) => w), 40);
  assert.equal(firstThatFits(widths, 30, (w) => w), null);
});

test('the date that was cut on 2026-10-11 is drawn whole: 89px gets "Sun, Oct 11" at the floor', () => {
  assert.equal(Math.round(ruler('Sun, Oct 11', fontSizePx.small)), 96);
  const fit = headerDateFit(SUN, 89, ruler);
  assert.deepEqual(fit, { words: 'Sun, Oct 11', sizePx: fontSizePx.meta });
});

test('the header date gives way smaller, then shorter, then not at all', () => {
  const seen: string[] = [];
  for (let room = 200; room >= 0; room -= 1) {
    const fit = headerDateFit(SUN, room, ruler);
    const key = fit === null ? 'none' : `${fit.words}@${String(fit.sizePx)}`;
    if (seen[seen.length - 1] !== key) seen.push(key);
    if (fit !== null) assert.ok(fitsIn(ruler(fit.words, fit.sizePx), room), `room ${String(room)}: ${key} is wider than its room`);
  }
  assert.deepEqual(seen, [
    `Sun, Oct 11@${String(fontSizePx.small)}`,
    `Sun, Oct 11@${String(fontSizePx.meta)}`,
    `Oct 11@${String(fontSizePx.meta)}`,
    'none',
  ]);
});

test('the short form is the month and day, and a malformed date draws nothing', () => {
  assert.equal(localDateText(SUN, 'monthDay'), 'Oct 11');
  assert.equal(headerDateFit('not-a-date' as LocalDate, 500, ruler), null);
});

// ---------------------------------------------------------------------------
// The leave-by banner beside a side rail.

const SCHOOL: Departure = {
  key: 'school',
  label: 'School',
  emoji: '🎒',
  leaveAtMinutes: 7 * 60 + 35,
  readyFromMinutes: 7 * 60 + 15,
  childId: null,
};
const DANCE: Departure = { ...SCHOOL, key: 'event:7', label: 'Dance', emoji: '💃', childId: 'child-a' };

const ready = (departure: Departure, minutesLeft: number): DepartureAlert => ({ departure, phase: 'ready', minutesLeft });
const go = (departure: Departure): DepartureAlert => ({ departure, phase: 'go', minutesLeft: 0 });

const room = (roomPx: number, facePx: number | null): DepartureRoom => ({ roomPx, emojiPx: 24, facePx, gapPx: 4 });

/** What the banner would occupy if drawn as `fit` says — summed independently of the module. */
function drawnWidth(fit: DepartureFit, r: DepartureRoom): number {
  let w = r.emojiPx;
  if (fit.face && r.facePx !== null) w += r.gapPx + r.facePx;
  if (fit.form === 'words') w += r.gapPx + Math.max(ruler(fit.head.words, fit.head.sizePx), ruler(fit.detail.words, fit.detail.sizePx));
  if (fit.form === 'minutes') w += r.gapPx + ruler(fit.line.words, fit.line.sizePx);
  return w;
}

function label(fit: DepartureFit): string {
  const face = fit.face ? '+face' : '';
  if (fit.form === 'words') return `words ${String(fit.head.sizePx)}/${String(fit.detail.sizePx)}${face}`;
  if (fit.form === 'minutes') return `minutes "${fit.line.words}" ${String(fit.line.sizePx)}${face}`;
  return `glyph${face}`;
}

/** Walk the room from wide to nothing; every pick fits, and the sequence of forms is the order of giving way. */
function walk(alert: DepartureAlert, facePx: number | null): string[] {
  const seen: string[] = [];
  for (let px = 360; px >= 0; px -= 1) {
    const r = room(px, facePx);
    const fit = departureFit(alert, r, ruler);
    const isLastResort = fit.form === 'glyph' && !fit.face;
    if (!isLastResort) assert.ok(fitsIn(drawnWidth(fit, r), px), `room ${String(px)}: ${label(fit)} overflows`);
    const key = label(fit);
    if (seen[seen.length - 1] !== key) seen.push(key);
  }
  return seen;
}

test('the school run gives way in order and never draws wider than its room', () => {
  assert.deepEqual(walk(ready(SCHOOL, 16), null), [
    `words ${String(fontSizePx.small)}/${String(fontSizePx.meta)}`,
    `minutes "16 min" ${String(fontSizePx.small)}`,
    `minutes "16 min" ${String(fontSizePx.meta)}`,
    'glyph',
  ]);
});

test('a child\'s event keeps the face while the minutes fit beside it, drops it for the minutes, and keeps it over nothing', () => {
  assert.deepEqual(walk(ready(DANCE, 9), 32), [
    `words ${String(fontSizePx.small)}/${String(fontSizePx.meta)}+face`,
    `minutes "9 min" ${String(fontSizePx.small)}+face`,
    `minutes "9 min" ${String(fontSizePx.meta)}+face`,
    `minutes "9 min" ${String(fontSizePx.meta)}`,
    'glyph+face',
    'glyph',
  ]);
});

/**
 * The real widths, measured in gallery's typeface on the panel's browser on 2026-10-11 (a canvas,
 * bold). Anything not listed falls back to the proportional ruler.
 */
const MEASURED: Readonly<Record<string, number>> = { '16 min@17': 55, '16 min@14': 45 };
const measured: MeasureText = (words, sizePx) => MEASURED[`${words}@${String(sizePx)}`] ?? ruler(words, sizePx);

test('the side-rail banner that read "G… / S…" reads "🎒 16 min" once the dial steps aside', () => {
  // 2026-10-11, gallery, stale, at 10:08 AM (the widest time on this face). The banner was 63px,
  // and 41 inside an 8px pad and a 3px edge. The dial and its gap are 48 more. The emoji is 30.
  const real = (roomPx: number): DepartureRoom => ({ roomPx, emojiPx: 30, facePx: null, gapPx: 8 });
  assert.equal(departureFit(ready(SCHOOL, 16), real(41), measured).form, 'glyph');
  const fit = departureFit(ready(SCHOOL, 16), real(41 + 48), measured);
  assert.deepEqual(fit.form === 'minutes' ? [fit.line.words, fit.line.sizePx] : [fit.form], ['16 min', fontSizePx.meta]);
});

test('the header gives way in order while the banner is up: the date, then fresh words, else the dial', () => {
  assert.deepEqual(headerKeeps(false, false, true), { date: true, dial: true, statusWords: true });
  assert.deepEqual(headerKeeps(true, true, true), { date: false, dial: true, statusWords: false });
  // A stale label never shrinks, so the dial goes, beside numerals that already say the time.
  assert.deepEqual(headerKeeps(true, false, true), { date: false, dial: false, statusWords: true });
  // With no numerals on the screen the dial is a pre-reader's only "when", and it stays.
  assert.deepEqual(headerKeeps(true, false, false), { date: false, dial: true, statusWords: true });
});

test('a fresh side-rail header keeps both lines', () => {
  const fit = departureFit(ready(SCHOOL, 16), room(290, null), ruler);
  assert.equal(fit.form, 'words');
  assert.deepEqual(fit.form === 'words' ? [fit.head.words, fit.detail.words] : [], ['Get ready', 'School · 16 min']);
});

test('the go phase falls back to "Go!", and one minute is "1 min"', () => {
  assert.equal(departureMinutes(go(SCHOOL)), 'Go!');
  assert.equal(departureMinutes(ready(SCHOOL, 1)), '1 min');
  assert.equal(departureWords(ready(SCHOOL, 1), true).detail, 'School · 1 min');
  const fit = departureFit(go(SCHOOL), room(70, null), ruler);
  assert.equal(fit.form === 'minutes' ? fit.line.words : fit.form, 'Go!');
});

test('a long event title is never clipped to fit the two lines; the banner steps down instead', () => {
  const long: Departure = { ...DANCE, label: 'Gymnastics at the north rec centre' };
  const fit = departureFit(ready(long, 12), room(200, 32), ruler);
  assert.notEqual(fit.form, 'words');
  assert.ok(fitsIn(drawnWidth(fit, room(200, 32)), 200));
});
