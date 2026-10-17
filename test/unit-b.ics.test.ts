/**
 * The iCal adapter: Google's secret iCal addresses, read directly, expanded over a window.
 *
 * No network: `fetchImpl` is a stub. The feeds below are synthetic and written in the
 * shape Google exports (TZID'd DTSTARTs, VALUE=DATE all-days, RECURRENCE-ID overrides).
 *
 * The load-bearing cases are the ones that produce a WRONG wall rather than a broken one:
 * a moved practice shown at both times, a cancelled one still showing, a weekly club an
 * hour off after the clocks change, a revoked address read as an empty calendar, and —
 * specific to this adapter — the secret address leaking into `sync_run.error`.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createIcsCalendar } from '../src/calendar/ics/index.ts';
import type { CalendarSource, FetchedEvent, FetchWindow } from '../src/calendar/CalendarSource.ts';
import type { LocalDate } from '../src/types.ts';

const SECRET = 'private-0123456789abcdef';
const URL_SCHOOL = `https://calendar.example.test/calendar/ical/school%40group/${SECRET}/basic.ics`;
const URL_FAMILY = `https://calendar.example.test/calendar/ical/family%40group/${SECRET}/basic.ics`;

const win = (from: string, to: string): FetchWindow => ({ fromDate: from as LocalDate, toDate: to as LocalDate });

function ics(...events: string[]): string {
  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Google Inc//Google Calendar 70.9054//EN',
    'X-WR-CALNAME:School',
    'X-WR-TIMEZONE:America/Denver',
    ...events,
    'END:VCALENDAR',
    '',
  ].join('\r\n');
}

const vevent = (...lines: string[]): string => ['BEGIN:VEVENT', ...lines, 'END:VEVENT'].join('\r\n');

type Responder = (url: string) => Response | Promise<Response>;

function adapter(
  bodies: Record<string, Responder | string>,
  extraEnv: Record<string, string> = {},
): { cal: CalendarSource; calls: string[] } {
  const calls: string[] = [];
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    calls.push(url);
    const hit = bodies[url];
    if (hit === undefined) return new Response('not found', { status: 404 });
    return typeof hit === 'string' ? new Response(hit, { status: 200 }) : hit(url);
  }) as typeof globalThis.fetch;
  const cal = createIcsCalendar(
    { ICS_URL_CALENDAR_SCHOOL: URL_SCHOOL, ...extraEnv },
    { fetchImpl, retries: 2, backoffMs: 0 },
  );
  return { cal, calls };
}

const byStart = (a: FetchedEvent, b: FetchedEvent): number =>
  startKey(a) < startKey(b) ? -1 : startKey(a) > startKey(b) ? 1 : 0;
const startKey = (e: FetchedEvent): string => (e.when.kind === 'timed' ? e.when.startsAtUtc : e.when.startDate);

// A Wednesday club at 15:00 Denver, Oct 7 - Nov 18. Oct 28 is EXDATEd, Nov 11 moved to
// 16:00, Nov 18 cancelled. DST ends Sunday Nov 1, so 15:00 is 21:00Z before and 22:00Z after.
const CLUB = [
  vevent(
    'UID:club-1@google.com',
    'DTSTART;TZID=America/Denver:20261007T150000',
    'DTEND;TZID=America/Denver:20261007T160000',
    'RRULE:FREQ=WEEKLY;BYDAY=WE;UNTIL=20261119T055959Z',
    'EXDATE;TZID=America/Denver:20261028T150000',
    'SUMMARY:Piano club',
  ),
  vevent(
    'UID:club-1@google.com',
    'RECURRENCE-ID;TZID=America/Denver:20261111T150000',
    'DTSTART;TZID=America/Denver:20261111T160000',
    'DTEND;TZID=America/Denver:20261111T170000',
    'SUMMARY:Piano club (moved)',
  ),
  vevent(
    'UID:club-1@google.com',
    'RECURRENCE-ID;TZID=America/Denver:20261118T150000',
    'DTSTART;TZID=America/Denver:20261118T150000',
    'DTEND;TZID=America/Denver:20261118T160000',
    'STATUS:CANCELLED',
    'SUMMARY:Piano club',
  ),
];

test('a weekly club expands every week, honours EXDATE, a moved and a cancelled occurrence, across DST', async () => {
  const { cal } = adapter({ [URL_SCHOOL]: ics(...CLUB) });
  const events = (await cal.fetchEvents('calendar.school', win('2026-10-01', '2026-12-01'))).sort(byStart);

  assert.deepEqual(
    events.map((e) => [e.title, e.when.kind === 'timed' ? e.when.startsAtUtc : '']),
    [
      ['Piano club', '2026-10-07T21:00:00.000Z'],
      ['Piano club', '2026-10-14T21:00:00.000Z'],
      ['Piano club', '2026-10-21T21:00:00.000Z'],
      // 10-28 EXDATEd. After the clocks change, 15:00 is 22:00Z:
      ['Piano club', '2026-11-04T22:00:00.000Z'],
      ['Piano club (moved)', '2026-11-11T23:00:00.000Z'],
      // 11-18 cancelled.
    ],
  );
  const first = events[0]!;
  assert.equal(first.when.kind === 'timed' && first.when.endsAtUtc, '2026-10-07T22:00:00.000Z');
  const ids = events.map((e) => e.externalUid);
  assert.equal(new Set(ids).size, ids.length, 'identifiers are unique');
  assert.equal(events[4]!.externalUid, 'club-1@google.com::20261111T150000', 'a moved occurrence keeps its slot id');
});

test('identifiers are stable across fetches and independent of feed order', async () => {
  const a = await adapter({ [URL_SCHOOL]: ics(...CLUB) }).cal.fetchEvents('calendar.school', win('2026-10-01', '2026-12-01'));
  const b = await adapter({ [URL_SCHOOL]: ics(...[...CLUB].reverse()) }).cal.fetchEvents(
    'calendar.school',
    win('2026-10-01', '2026-12-01'),
  );
  assert.deepEqual(a.map((e) => e.externalUid).sort(), b.map((e) => e.externalUid).sort());
});

test('an occurrence moved INTO the window from past its end is found; one moved OUT is not shown', async () => {
  const feed = ics(
    vevent(
      'UID:swim@google.com',
      'DTSTART;TZID=America/Denver:20261005T170000',
      'DTEND;TZID=America/Denver:20261005T180000',
      'RRULE:FREQ=WEEKLY;COUNT=10',
      'SUMMARY:Swim',
    ),
    // Dec 7's lesson pulled forward to Oct 10.
    vevent(
      'UID:swim@google.com',
      'RECURRENCE-ID;TZID=America/Denver:20261207T170000',
      'DTSTART;TZID=America/Denver:20261010T090000',
      'DTEND;TZID=America/Denver:20261010T100000',
      'SUMMARY:Swim (make-up)',
    ),
    // Oct 12's lesson pushed out to January.
    vevent(
      'UID:swim@google.com',
      'RECURRENCE-ID;TZID=America/Denver:20261012T170000',
      'DTSTART;TZID=America/Denver:20270111T170000',
      'DTEND;TZID=America/Denver:20270111T180000',
      'SUMMARY:Swim',
    ),
  );
  const { cal } = adapter({ [URL_SCHOOL]: feed });
  const events = (await cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-15'))).sort(byStart);
  assert.deepEqual(
    events.map((e) => [e.title, startKey(e)]),
    [
      ['Swim', '2026-10-05T23:00:00.000Z'],
      ['Swim (make-up)', '2026-10-10T15:00:00.000Z'],
    ],
  );
});

test('all-day events are floating dates with an exclusive end; a yearly birthday recurs', async () => {
  const feed = ics(
    vevent('UID:nosch@google.com', 'DTSTART;VALUE=DATE:20261012', 'DTEND;VALUE=DATE:20261013', 'SUMMARY:No School'),
    vevent('UID:break@google.com', 'DTSTART;VALUE=DATE:20261123', 'DTEND;VALUE=DATE:20261128', 'SUMMARY:Fall Break'),
    vevent('UID:noend@google.com', 'DTSTART;VALUE=DATE:20261020', 'SUMMARY:Picture Day'),
    vevent(
      'UID:bday@google.com',
      'DTSTART;VALUE=DATE:19900305',
      'DTEND;VALUE=DATE:19900306',
      'RRULE:FREQ=YEARLY',
      'SUMMARY:Grandma',
    ),
  );
  const { cal } = adapter({ [URL_SCHOOL]: feed });
  const autumn = (await cal.fetchEvents('calendar.school', win('2026-10-01', '2026-11-25'))).sort(byStart);
  assert.deepEqual(
    autumn.map((e) => [e.title, e.when]),
    [
      ['No School', { kind: 'allDay', startDate: '2026-10-12', endDate: '2026-10-13' }],
      ['Picture Day', { kind: 'allDay', startDate: '2026-10-20', endDate: '2026-10-21' }],
      // Starts inside the window and runs past its end: included, dates untouched.
      ['Fall Break', { kind: 'allDay', startDate: '2026-11-23', endDate: '2026-11-28' }],
    ],
  );
  const spring = await cal.fetchEvents('calendar.school', win('2027-03-01', '2027-03-10'));
  assert.deepEqual(spring.map((e) => [e.title, e.when, e.externalUid]), [
    ['Grandma', { kind: 'allDay', startDate: '2027-03-05', endDate: '2027-03-06' }, 'bday@google.com::20270305'],
  ]);
});

test('UTC and floating times land on the right instants; window edges are household midnights', async () => {
  const feed = ics(
    vevent('UID:z@google.com', 'DTSTART:20261009T013000Z', 'DTEND:20261009T023000Z', 'SUMMARY:Late call'),
    vevent('UID:f@google.com', 'DTSTART:20261009T080000', 'DTEND:20261009T083000', 'SUMMARY:Floating'),
    // 23:30 Denver on Oct 14 is inside a window ending Oct 15; 00:30 Oct 15 is not.
    vevent('UID:in@google.com', 'DTSTART;TZID=America/Denver:20261014T233000', 'DTEND;TZID=America/Denver:20261014T234500', 'SUMMARY:In'),
    vevent('UID:out@google.com', 'DTSTART;TZID=America/Denver:20261015T003000', 'DTEND;TZID=America/Denver:20261015T010000', 'SUMMARY:Out'),
    // A New York event: 9:00 Eastern is 7:00 Denver.
    vevent('UID:ny@google.com', 'DTSTART;TZID=America/New_York:20261013T090000', 'DTEND;TZID=America/New_York:20261013T100000', 'SUMMARY:East'),
  );
  const { cal } = adapter({ [URL_SCHOOL]: feed });
  const got = Object.fromEntries(
    (await cal.fetchEvents('calendar.school', win('2026-10-08', '2026-10-15'))).map((e) => [e.title, startKey(e)]),
  );
  assert.deepEqual(got, {
    'Late call': '2026-10-09T01:30:00.000Z', // 19:30 Denver on the 8th: inside
    Floating: '2026-10-09T14:00:00.000Z',
    In: '2026-10-15T05:30:00.000Z',
    East: '2026-10-13T13:00:00.000Z',
  });
});

test('a cancelled one-off and a cancelled series are not shown; an event with no UID is', async () => {
  const feed = ics(
    vevent('UID:gone@google.com', 'DTSTART;VALUE=DATE:20261012', 'STATUS:CANCELLED', 'SUMMARY:Gone'),
    vevent('UID:series@google.com', 'DTSTART;VALUE=DATE:20261001', 'RRULE:FREQ=DAILY', 'STATUS:CANCELLED', 'SUMMARY:Series'),
    vevent('DTSTART;VALUE=DATE:20261013', 'SUMMARY:Anonymous'),
    vevent('UID:untitled@google.com', 'DTSTART;VALUE=DATE:20261014'),
  );
  const { cal } = adapter({ [URL_SCHOOL]: feed });
  const events = await cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-20'));
  assert.deepEqual(events.map((e) => e.title).sort(), ['(no title)', 'Anonymous']);
  assert.match(events.find((e) => e.title === 'Anonymous')!.externalUid, /^syn:[0-9a-f]{32}$/);
});

test('a daily series started a decade ago expands; a pathological rule throws instead of stalling', async () => {
  const daily = ics(
    vevent('UID:old@google.com', 'DTSTART;TZID=America/Denver:20160101T070000', 'DTEND;TZID=America/Denver:20160101T071500', 'RRULE:FREQ=DAILY', 'SUMMARY:Vitamins'),
  );
  const ok = await adapter({ [URL_SCHOOL]: daily }).cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-08'));
  assert.equal(ok.length, 7);

  const secondly = ics(
    vevent('UID:mad@google.com', 'DTSTART:20200101T000000Z', 'DTEND:20200101T000001Z', 'RRULE:FREQ=SECONDLY', 'SUMMARY:x'),
  );
  await assert.rejects(
    adapter({ [URL_SCHOOL]: secondly }).cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-08')),
    /expands past/,
  );
});

test('a body that is not a complete calendar throws — never an empty week', async () => {
  for (const body of [
    '<!DOCTYPE html><html><body>Sign in</body></html>',
    '',
    ics(...CLUB).replace(/END:VCALENDAR\s*$/, ''),
  ]) {
    await assert.rejects(adapter({ [URL_SCHOOL]: body }).cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-08')));
  }
  // An honestly empty calendar is fine.
  assert.deepEqual(await adapter({ [URL_SCHOOL]: ics() }).cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-08')), []);
});

test('failures name the variable and NEVER the secret address', async () => {
  const messages: string[] = [];
  const grab = async (p: Promise<unknown>): Promise<void> => {
    try {
      await p;
      assert.fail('expected a throw');
    } catch (e) {
      messages.push((e as Error).message);
    }
  };

  // A reset address: Google answers 404. Not retried.
  const notFound = adapter({});
  await grab(notFound.cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-08')));
  assert.equal(notFound.calls.length, 1, '404 is not retried');

  // Unreachable: the transport error's own text (which may carry the URL) is not copied in.
  const down = adapter({ [URL_SCHOOL]: () => { throw new TypeError(`fetch failed for ${URL_SCHOOL}`); } });
  await grab(down.cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-08')));
  assert.equal(down.calls.length, 3, 'transport failures are retried');

  // A calendar the database includes but the environment does not configure.
  await grab(adapter({}).cal.fetchEvents('calendar.family', win('2026-10-01', '2026-10-08')));

  // Config errors.
  for (const env of [
    {},
    { ICS_URL_CALENDAR_SCHOOL: `not a url ${SECRET}` },
    { ICS_URL_CALENDAR_SCHOOL: `op://Agent Secrets/google-calendar-ics/${SECRET}` },
    { ICS_URL_CALENDAR_SCHOOL: `ftp://x/${SECRET}` },
  ]) {
    try {
      createIcsCalendar(env);
      assert.fail('expected a throw');
    } catch (e) {
      messages.push((e as Error).message);
    }
  }

  assert.equal(messages.length, 7);
  for (const m of messages) {
    assert.ok(!m.includes(SECRET), `message leaks the address: ${m}`);
    assert.ok(!m.includes('calendar.example.test'), `message leaks the host: ${m}`);
  }
  assert.match(messages[0]!, /HTTP 404 on ICS_URL_CALENDAR_SCHOOL/);
  assert.match(messages[1]!, /unreachable after 3 attempt\(s\) on ICS_URL_CALENDAR_SCHOOL/);
  assert.match(messages[2]!, /ICS_URL_CALENDAR_FAMILY is not set/);
  assert.match(messages[5]!, /unresolved 1Password reference/);
});

test('a transient 503 is retried and then succeeds', async () => {
  let n = 0;
  const { cal, calls } = adapter({
    [URL_SCHOOL]: () => (++n === 1 ? new Response('busy', { status: 503 }) : new Response(ics(...CLUB), { status: 200 })),
  });
  const events = await cal.fetchEvents('calendar.school', win('2026-10-01', '2026-10-15'));
  assert.equal(calls.length, 2);
  assert.equal(events.length, 2);
});

test('listSources maps each variable back to its ref; probe never throws', async () => {
  const { cal } = adapter(
    { [URL_SCHOOL]: ics(), [URL_FAMILY]: ics().replace('X-WR-CALNAME:School', 'X-WR-CALNAME:Family') },
    { ICS_URL_CALENDAR_FAMILY: URL_FAMILY, ICS_URL_CALENDAR_HOLIDAYS_IN_UNITED_STATES: '' },
  );
  assert.deepEqual(
    (await cal.listSources()).sort((a, b) => a.externalRef.localeCompare(b.externalRef)),
    [
      { externalRef: 'calendar.family', label: 'Family' },
      { externalRef: 'calendar.school', label: 'School' },
    ],
  );
  assert.equal(await cal.probe(), true);
  assert.equal(await adapter({}).cal.probe(), false);
  assert.equal(JSON.stringify(cal).includes(SECRET), false, 'the adapter does not serialise its addresses');
});
