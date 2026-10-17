/**
 * Unit H acceptance, part 2: the clock.
 *
 * Two failures this file exists to prevent, both of which put a wrong wall in
 * front of the household at 6:00 AM:
 *
 *   - a local date derived from UTC, which rolls the wall over to "tomorrow"
 *     during dinner (H3 finding #6);
 *   - a routine time box evaluated anywhere but on the client's own clock, which
 *     is the flaw H2 Q1 found: a snapshot built at 00:00 carrying `locked` never
 *     opens at 06:00, because nothing refetches in between.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { EventWhen, LocalDate, Utc } from '../src/types.ts';
import {
  clientLocalDate,
  clientLocalTime,
  clockHands,
  eventStartLocalTime,
  eventTimeText,
  instantTimeText,
  localDateText,
  minutesOfDay,
} from '../web/src/views/logic/clock.ts';
import { timeBoxState } from '../web/src/views/logic/timebox.ts';

const at = (iso: string): number => Date.parse(iso);

// ---------------------------------------------------------------------------
// Local date, from the household zone and never from UTC
// ---------------------------------------------------------------------------

test('the local date at dinner is still TODAY, not tomorrow', () => {
  // 19:30 America/Denver on the 24th is 01:30Z on the 25th.  toISOString() would
  // say "2026-08-25" and the whole wall would roll over mid-dinner.
  const dinner = at('2026-08-25T01:30:00Z');
  assert.equal(clientLocalDate(dinner), '2026-08-24');
  assert.equal(clientLocalTime(dinner), '19:30');
});

test('the local date rolls at LOCAL midnight, not at 00:00Z', () => {
  assert.equal(clientLocalDate(at('2026-08-25T05:59:00Z')), '2026-08-24'); // 23:59 MDT
  assert.equal(clientLocalDate(at('2026-08-25T06:01:00Z')), '2026-08-25'); // 00:01 MDT
});

test('6:00 AM on a school day reads as 06:00 local', () => {
  assert.equal(clientLocalTime(at('2026-08-25T12:00:00Z')), '06:00');
});

// ---------------------------------------------------------------------------
// Parsing and the pre-reader's dial
// ---------------------------------------------------------------------------

test('minutesOfDay accepts only "HH:MM"', () => {
  assert.equal(minutesOfDay('06:00'), 360);
  assert.equal(minutesOfDay('19:30'), 1170);
  assert.equal(minutesOfDay('00:00'), 0);
  assert.equal(minutesOfDay('7:30'), null, 'a single-digit hour is not a LocalTime');
  assert.equal(minutesOfDay('24:00'), null);
  assert.equal(minutesOfDay('06:60'), null);
  assert.equal(minutesOfDay(''), null);
});

test('the dial puts the hands where a clock would', () => {
  assert.deepEqual(clockHands('12:00'), { hourDeg: 0, minuteDeg: 0 });
  assert.deepEqual(clockHands('03:00'), { hourDeg: 90, minuteDeg: 0 });
  assert.deepEqual(clockHands('07:30'), { hourDeg: 225, minuteDeg: 180 });
  assert.deepEqual(clockHands('19:30'), { hourDeg: 225, minuteDeg: 180 }, 'a dial is 12-hour');
  assert.equal(clockHands('nope'), null);
});

// ---------------------------------------------------------------------------
// Event text — formatted once, in the household zone
// ---------------------------------------------------------------------------

const timed = (startZ: string, endZ: string): EventWhen => ({
  kind: 'timed',
  startsAtUtc: startZ as Utc,
  endsAtUtc: endZ as Utc,
});

test('a timed event shows household-local wall-clock time', () => {
  const when = timed('2026-08-25T13:30:00Z', '2026-08-25T14:30:00Z');
  assert.equal(eventTimeText(when), '7:30 AM');
  assert.equal(eventStartLocalTime(when), '07:30');
});

test('an all-day event carries no instant and no dial', () => {
  const when: EventWhen = {
    kind: 'allDay',
    startDate: '2026-08-25' as LocalDate,
    endDate: '2026-08-26' as LocalDate,
  };
  assert.equal(eventStartLocalTime(when), null);
  assert.equal(eventTimeText(when), 'All day');
});

test('a malformed instant drops one line of text, never the wall', () => {
  const when = timed('not-a-date' as unknown as string, 'also-not') as EventWhen;
  assert.equal(eventTimeText(when), '');
  assert.equal(eventStartLocalTime(when), null);
  assert.equal(instantTimeText('garbage'), '');
  assert.equal(instantTimeText(null), '');
});

test('a LocalDate renders as words without shifting a day', () => {
  assert.equal(localDateText('2026-12-25' as LocalDate, 'short'), 'Fri, Dec 25');
  assert.equal(localDateText('2026-01-01' as LocalDate, 'full'), 'Thursday, January 1');
  assert.equal(localDateText('nonsense' as LocalDate), '');
});

// ---------------------------------------------------------------------------
// The time box, computed client-side
// ---------------------------------------------------------------------------

test('a morning box opens and closes on the client clock', () => {
  const box = (now: string) => timeBoxState('06:00', '09:00', now);
  assert.equal(box('05:59').phase, 'before');
  assert.equal(box('05:59').minutesUntilOpen, 1);
  assert.equal(box('06:00').phase, 'open', 'it must open AT the boundary, not after it');
  assert.equal(box('06:00').minutesUntilClose, 180);
  assert.equal(box('08:59').phase, 'open');
  assert.equal(box('09:00').phase, 'after', 'closed is exclusive of the closing minute');
  assert.equal(box('23:59').phase, 'after');
});

test('a bedtime box that spans midnight is open on both sides of it', () => {
  const box = (now: string) => timeBoxState('19:30', '06:00', now);
  assert.equal(box('19:29').phase, 'before');
  assert.equal(box('19:30').phase, 'open');
  assert.equal(box('23:59').phase, 'open');
  assert.equal(box('00:01').phase, 'open', 'still bedtime after midnight');
  assert.equal(box('05:59').phase, 'open');
  assert.equal(box('06:00').phase, 'before', 'tonight is ahead, not behind');
  assert.ok(box('19:30').wrapsMidnight);
});

test('a wrapping box counts down to its close across midnight', () => {
  assert.equal(timeBoxState('19:30', '06:00', '20:00').minutesUntilClose, 600);
  assert.equal(timeBoxState('19:30', '06:00', '05:00').minutesUntilClose, 60);
  assert.equal(timeBoxState('19:30', '06:00', '12:00').minutesUntilOpen, 450);
});

test('a zero-length window reads as always open, never as never open', () => {
  const box = timeBoxState('06:00', '06:00', '13:00');
  assert.equal(box.phase, 'open');
});

test('an unparseable box fails OPEN — the wall is never blank because of a bad time', () => {
  const box = timeBoxState('not-a-time', '09:00', '06:30');
  assert.equal(box.phase, 'open');
  assert.equal(box.degraded, true);
});

test('the clock never blocks a tap, in any phase', () => {
  for (const now of ['05:00', '06:30', '09:30', '23:00']) {
    const box = timeBoxState('06:00', '09:00', now);
    assert.equal(box.blocksInteraction, false);
  }
});
