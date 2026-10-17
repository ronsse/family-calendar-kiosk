/**
 * Unit H — the leave-by alert, judged on the client from local state.
 *
 * Denver in September is UTC-6, so 16:25 local is 22:25Z. Every expectation below is in
 * minutes since local midnight, which is the only unit the module reasons in.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEventView, DepartureRules, LocalDate, LocalTime, Utc } from '../src/types.ts';
import { DEFAULT_DEPARTURE_RULES, MAX_LEAD_MINUTES, MIN_LEAD_MINUTES } from '../src/domain/departures/index.ts';
import {
  GO_LINGER_MINUTES,
  LEAD_MAX_MINUTES,
  LEAD_MIN_MINUTES,
  SCHOOL_EMOJI,
  departureNow,
  departureWords,
  departuresForDay,
  leaveAtText,
  leadStep,
  leavingSourcesLine,
  localTimeText,
  stepLocalTime,
} from '../web/src/views/logic/departures.ts';

const ICON = { assetId: 'a', url: '/x.png', isFallback: false } as const;
// A Tuesday.
const TUE = '2026-09-15' as LocalDate;
const SAT = '2026-09-19' as LocalDate;

function timed(
  id: number,
  title: string,
  startsAtUtc: string,
  extra: Partial<CalendarEventView> = {},
): CalendarEventView {
  return {
    id,
    title,
    when: { kind: 'timed', startsAtUtc: startsAtUtc as Utc, endsAtUtc: startsAtUtc as Utc },
    sourceId: 's',
    colourToken: '--c-src-slate',
    childId: null,
    icon: ICON,
    emoji: null,
    category: null,
    ...extra,
  };
}

function allDay(id: number, title: string, date: LocalDate, emoji: string | null): CalendarEventView {
  const next = `${date.slice(0, 8)}${String(Number(date.slice(8)) + 1).padStart(2, '0')}` as LocalDate;
  return {
    id,
    title,
    when: { kind: 'allDay', startDate: date, endDate: next },
    sourceId: 's',
    colourToken: '--c-src-slate',
    childId: null,
    icon: ICON,
    emoji,
    category: null,
  };
}

const RULES: DepartureRules = DEFAULT_DEPARTURE_RULES;
const t = (s: string) => s as LocalTime;

test('a school day departs at the rule’s time, and a day-off event or a weekend cancels it', () => {
  const school = departuresForDay([], RULES, TUE);
  assert.equal(school.length, 1);
  assert.equal(school[0]?.key, 'school');
  assert.equal(school[0]?.emoji, SCHOOL_EMOJI);
  assert.equal(school[0]?.leaveAtMinutes, 7 * 60 + 35);
  assert.equal(school[0]?.readyFromMinutes, 7 * 60 + 15);
  assert.equal(leaveAtText(school[0]!), '7:35 AM');

  assert.deepEqual(departuresForDay([], RULES, SAT), []);
  // The classifier's 🏠 is the whole day-off family; the title is not read here.
  assert.deepEqual(departuresForDay([allDay(9, 'Teacher work day', TUE, '🏠')], RULES, TUE), []);
  // An all-day event that is NOT a day off changes nothing.
  assert.equal(departuresForDay([allDay(9, 'Picture day', TUE, '📷')], RULES, TUE).length, 1);
});

test('a timed event in a named category departs travelMinutes before it; the rest are ignored', () => {
  const events = [
    timed(1, 'Gymnastics', '2026-09-15T22:30:00Z', { category: 'sport', childId: 'child-a', emoji: '🤸' }),
    timed(2, 'Dentist', '2026-09-15T20:00:00Z', { category: 'medical' }),
    timed(3, 'Untagged', '2026-09-15T21:00:00Z'),
    // Tomorrow's, even though today's snapshot may carry it.
    timed(4, 'Dance', '2026-09-16T22:25:00Z', { category: 'dance' }),
    // Unparseable: dropped, never thrown.
    timed(5, 'Broken', 'not-a-date', { category: 'dance' }),
  ];
  const out = departuresForDay(events, RULES, TUE);
  assert.deepEqual(
    out.map((d) => [d.key, d.leaveAtMinutes, d.readyFromMinutes, d.childId, d.emoji]),
    [
      ['school', 455, 435, null, SCHOOL_EMOJI],
      ['event:1', 16 * 60 + 20, 16 * 60, 'child-a', '🤸'],
    ],
  );
});

test('off means off', () => {
  const events = [timed(1, 'Gymnastics', '2026-09-15T22:30:00Z', { category: 'sport' })];
  assert.deepEqual(departuresForDay(events, { ...RULES, enabled: false }, TUE), []);
});

test('the phases: quiet, ready, go, quiet — and the soonest active departure wins', () => {
  const events = [
    timed(1, 'Dance', '2026-09-15T22:25:00Z', { category: 'dance' }),
    timed(2, 'Dance', '2026-09-15T22:40:00Z', { category: 'dance' }),
  ];
  const day = departuresForDay(events, RULES, TUE);
  assert.deepEqual(day.map((d) => d.key), ['school', 'event:1', 'event:2']);

  assert.equal(departureNow(day, t('07:14')), null);
  assert.deepEqual(departureNow(day, t('07:15'))?.phase, 'ready');
  assert.equal(departureNow(day, t('07:15'))?.minutesLeft, 20);
  assert.equal(departureNow(day, t('07:34'))?.minutesLeft, 1);
  assert.equal(departureNow(day, t('07:35'))?.phase, 'go');
  assert.equal(departureNow(day, t(`07:${String(35 + GO_LINGER_MINUTES - 1)}`))?.phase, 'go');
  assert.equal(departureNow(day, t(`07:${String(35 + GO_LINGER_MINUTES)}`)), null);
  assert.equal(departureNow(day, t('12:00')), null);

  // Dance at 4:25 leaves 4:15, ready from 3:55; the 4:40 one leaves 4:30, ready from 4:10.
  assert.equal(departureNow(day, t('15:55'))?.departure.key, 'event:1');
  assert.equal(departureNow(day, t('16:12'))?.departure.key, 'event:1');
  assert.equal(departureNow(day, t('16:20'))?.phase, 'go');
  assert.equal(departureNow(day, t('16:20'))?.departure.key, 'event:1');
  // The first has gone quiet at 4:25; the second is in its ready window.
  assert.equal(departureNow(day, t('16:25'))?.departure.key, 'event:2');
  assert.equal(departureNow(day, t('16:25'))?.phase, 'ready');
  assert.equal(departureNow(day, t('16:31'))?.phase, 'go');
  assert.equal(departureNow(day, t('16:40')), null);
});

test('the words', () => {
  const day = departuresForDay([], RULES, TUE);
  assert.deepEqual(departureWords(departureNow(day, t('07:20'))!), {
    head: 'Get ready for School',
    detail: 'Leave at 7:35 AM · 15 min',
  });
  assert.deepEqual(departureWords(departureNow(day, t('07:34'))!), {
    head: 'Get ready for School',
    detail: 'Leave at 7:35 AM · 1 min',
  });
  assert.deepEqual(departureWords(departureNow(day, t('07:36'))!), {
    head: 'Time to go!',
    detail: 'School · leave 7:35 AM',
  });
});

test('the header’s compact words drop the time from the first line and never repeat it', () => {
  const day = departuresForDay([], RULES, TUE);
  assert.deepEqual(departureWords(departureNow(day, t('07:20'))!, true), {
    head: 'Get ready',
    detail: 'School · 15 min',
  });
  assert.deepEqual(departureWords(departureNow(day, t('07:34'))!, true), {
    head: 'Get ready',
    detail: 'School · 1 min',
  });
  assert.deepEqual(departureWords(departureNow(day, t('07:36'))!, true), {
    head: 'Time to go!',
    detail: 'School',
  });
});

test('a ready window of zero has no ready phase, only go', () => {
  const day = departuresForDay([], { ...RULES, readyMinutes: 0 }, TUE);
  assert.equal(departureNow(day, t('07:30')), null);
  assert.equal(departureNow(day, t('07:35'))?.phase, 'go');
});

test('the Leaving tab’s arithmetic and its line', () => {
  assert.equal(stepLocalTime(t('07:35'), 5), '07:40');
  assert.equal(stepLocalTime(t('00:00'), -5), '23:55');
  assert.equal(stepLocalTime(t('23:55'), 5), '00:00');
  assert.equal(localTimeText(t('07:35')), '7:35 AM');
  assert.equal(localTimeText(t('16:05')), '4:05 PM');
  assert.equal(localTimeText(t('00:10')), '12:10 AM');
  assert.equal(
    leavingSourcesLine(RULES),
    'School Mon–Fri, except a day off · dance and sport from the calendar',
  );
});

test('a lead-time stepper walks rail to rail and goes inert at each one', () => {
  // The rails are the server's: a step past either is a 400 the household reads as a dead key.
  assert.equal(LEAD_MIN_MINUTES, MIN_LEAD_MINUTES);
  assert.equal(LEAD_MAX_MINUTES, MAX_LEAD_MINUTES);
  let m = 10;
  const seen: number[] = [m];
  for (let next = leadStep(m).down; next !== null; next = leadStep(m).down) {
    m = next;
    seen.push(m);
  }
  assert.deepEqual(seen, [10, 5, 0]);
  assert.equal(leadStep(0).down, null);
  let steps = 0;
  for (let next = leadStep(m).up; next !== null; next = leadStep(m).up) {
    m = next;
    steps += 1;
  }
  assert.equal(m, 120);
  assert.equal(steps, 24);
  assert.equal(leadStep(120).up, null);
  // A value off the grid (written by a file, not the wall) lands ON the rail, not past it.
  assert.deepEqual(leadStep(3), { down: 0, up: 8 });
  assert.deepEqual(leadStep(118), { down: 113, up: 120 });
});
