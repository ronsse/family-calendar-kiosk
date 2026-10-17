/**
 * Unit B — the per-source event filter.
 *
 * Built for a SUBSCRIBED calendar nobody in the house curates. The household imported a school
 * district feed on 2026-09-09 and got 132 series: every club, class, PTA meeting and curriculum
 * night the school runs, alongside the handful of days that actually change a child's morning.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyEventFilter, matchesKeepTerms } from '../src/calendar/sync.ts';
import type { FetchedEvent } from '../src/calendar/CalendarSource.ts';
import type { LocalDate, Utc } from '../src/types.ts';

const allDay = (title: string): FetchedEvent => ({
  externalUid: title,
  title,
  when: { kind: 'allDay', startDate: '2026-11-23' as LocalDate, endDate: '2026-11-28' as LocalDate },
});
const timed = (title: string): FetchedEvent => ({
  externalUid: title,
  title,
  when: {
    kind: 'timed',
    startsAtUtc: '2026-11-23T21:00:00Z' as Utc,
    endsAtUtc: '2026-11-23T22:00:00Z' as Utc,
  },
});

test("'all' is the default and keeps everything", () => {
  // The family calendar's timed events are the whole point of it.
  const events = [allDay('Fall Break'), timed('Child A dance')];
  assert.equal(applyEventFilter(events, 'all').length, 2);
});

test("'all_day_only' keeps the days that change shape and drops the school day's furniture", () => {
  // Real titles from the district feed. The split fell out 21 all-day / 44 timed with no
  // exceptions, which is why this is a structural test and not a keyword list.
  const keep = [
    'No School',
    'Fall Break',
    'Thanksgiving Break',
    'Assessment Day by Appointment-No School',
    'Individual Picture Day',
    'Picture Retakes',
    'Parent/Teacher Conferences',
    'Teacher Work Day',
    'LAST DAY OF SCHOOL',
  ].map(allDay);
  const drop = [
    'Chess Club',
    'Band & Orchestra Talons',
    'Spanish Class',
    'PTA Meeting',
    'Curriculum Night Grade 5',
    'Crest Robotics',
    'Sticky Fingers',
  ].map(timed);

  const got = applyEventFilter([...keep, ...drop], 'all_day_only');
  assert.equal(got.length, keep.length);
  assert.deepEqual(
    got.map((e) => e.title).sort(),
    keep.map((e) => e.title).sort(),
  );
});

test('an unknown filter keeps everything rather than emptying the calendar', () => {
  // A typo in a config column must not silently empty a source. An empty calendar looks
  // exactly like a calendar with nothing on it — this project's worst failure shape, and the
  // reason the fallback is "show too much" rather than "show nothing".
  const events = [allDay('Fall Break'), timed('Chess Club')];
  assert.equal(applyEventFilter(events, 'typo').length, 2);
  assert.equal(applyEventFilter(events, '').length, 2);
});

test('filtering does not mutate what it is handed', () => {
  const events = [allDay('Fall Break'), timed('Chess Club')];
  applyEventFilter(events, 'all_day_only');
  assert.equal(events.length, 2);
});

// ---------------------------------------------------------------------------
// keep_terms — the exception that readmits one child's own grade
// ---------------------------------------------------------------------------

test("a child's own grade survives all_day_only", () => {
  // `all_day_only` correctly drops all 100 timed school events. Eight of them are the first
  // grade's outings, and those are precisely what the seven-year-old counts down to — timed,
  // because they happen during the school day like the clubs the filter exists to remove.
  const events = [
    allDay('Fall Break'),
    timed('Grade 1 Denver Zoo'),
    timed('Grade 1 Planetarium'),
    timed('Wax Museum Grade 1'),
    timed('Chess Club'),
    timed('Grade 3 State Capitol'),
  ];
  const got = applyEventFilter(events, 'all_day_only', 'grade 1').map((e) => e.title);
  assert.deepEqual(got, ['Fall Break', 'Grade 1 Denver Zoo', 'Grade 1 Planetarium', 'Wax Museum Grade 1']);
});

test('"grade 1" matches whole words only — not grade 10, not "Grades K&1"', () => {
  // Both are real shapes from the district feed. A substring match would take the second and,
  // in a bigger district, the first.
  assert.equal(matchesKeepTerms('Grade 10 Orientation', 'grade 1'), false);
  assert.equal(matchesKeepTerms('PTA Grades K&1 Meet Up', 'grade 1'), false);
  assert.equal(matchesKeepTerms('Grade 1 Denver Zoo', 'grade 1'), true);
  // Typed by people into a web form: double spaces and trailing spaces both arrive.
  assert.equal(matchesKeepTerms('  Grade   1   Denver Zoo ', 'grade 1'), true);
  assert.equal(matchesKeepTerms('grade 1 denver zoo', 'GRADE 1'), true);
});

test('several terms, for the year a second child starts school', () => {
  assert.equal(matchesKeepTerms('Grade 3 State Capitol', 'grade 1, grade 3'), true);
  assert.equal(matchesKeepTerms('Grade 2 Meet Up', 'grade 1, grade 3'), false);
});

test('no terms, empty terms and a regex-shaped term are all survivable', () => {
  // These come from a config column. A stray bracket must not throw inside the sync and turn a
  // typo into a failed generation — which is a source that silently stops updating.
  assert.equal(matchesKeepTerms('Grade 1 Zoo', null), false);
  assert.equal(matchesKeepTerms('Grade 1 Zoo', ''), false);
  assert.equal(matchesKeepTerms('Grade 1 Zoo', ' , , '), false);
  assert.doesNotThrow(() => matchesKeepTerms('Grade 1 (Zoo)', 'grade 1 (zoo'));
  assert.equal(matchesKeepTerms('Grade 1 (Zoo)', 'grade 1 (zoo)'), true);
});

test('keep_terms does nothing when the filter is not filtering', () => {
  const events = [timed('Chess Club')];
  assert.equal(applyEventFilter(events, 'all', 'grade 1').length, 1);
});
