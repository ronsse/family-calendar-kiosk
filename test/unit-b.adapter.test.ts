/**
 * Unit B acceptance, part 1 (build-plan.md §4): the Home Assistant adapter maps recorded
 * fixtures into the frozen `CalendarSource` shape, with no live HA and no network.
 *
 * The load-bearing cases here are the ones that produce a wall that is WRONG rather than a
 * wall that is broken, because only the second kind gets noticed:
 *
 *   - an all-day event from the UTC-misconfigured calendar landing on two local days,
 *     or on one wrong day (H3 finding #5),
 *   - the fetch window drifting by an hour across a DST boundary (H3 finding #6),
 *   - a malformed payload yielding a SHORT LIST instead of a throw, which gets promoted
 *     over good data and renders as "no events today" (H3 finding #7).
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { createHomeAssistantCalendar } from '../src/calendar/homeassistant/index.ts';
import type { CalendarSource, FetchedEvent, FetchWindow } from '../src/calendar/CalendarSource.ts';
import type { LocalDate } from '../src/types.ts';
import {
  fixtureServer,
  json,
  loadFixture,
  TEST_BASE_URL,
  TEST_TOKEN,
  type FixtureHandler,
  type FixtureServer,
} from './fixtures/calendar/fixture-ha.ts';

const ENTITY = 'calendar.household';
const EVENTS_PATH = `/api/calendars/${ENTITY}`;

function adapterFor(
  handlers: Record<string, FixtureHandler>,
  overrides: { retries?: number; utcMidnightIsAllDay?: boolean } = {},
): { calendar: CalendarSource; server: FixtureServer } {
  const server = fixtureServer(handlers);
  const calendar = createHomeAssistantCalendar(
    { HA_BASE_URL: TEST_BASE_URL, HA_TOKEN: TEST_TOKEN },
    { fetchImpl: server.fetchImpl, backoffMs: 0, retries: overrides.retries ?? 0, ...overrides },
  );
  return { calendar, server };
}

function servingEvents(fixture: string, entity = ENTITY) {
  const body = loadFixture(fixture);
  return adapterFor({ [`/api/calendars/${entity}`]: () => json(body) });
}

const win = (from: string, to: string): FetchWindow => ({
  fromDate: from as LocalDate,
  toDate: to as LocalDate,
});

function byTitle(events: FetchedEvent[], title: string): FetchedEvent {
  const hit = events.find((e) => e.title === title);
  assert.ok(hit, `no event titled ${title}`);
  return hit;
}

// ---------------------------------------------------------------------------
// Enumeration and the window
// ---------------------------------------------------------------------------

test('listSources maps the recorded calendar list into opaque descriptors', async () => {
  const { calendar } = adapterFor({ '/api/calendars': () => json(loadFixture('calendars.json')) });

  const sources = await calendar.listSources();
  assert.equal(calendar.kind, 'homeassistant');
  assert.equal(sources.length, 7, 'the household runs seven calendars');
  assert.deepEqual(Object.keys(sources[0] ?? {}).sort(), ['externalRef', 'label']);
  assert.deepEqual(
    sources.map((s) => s.label),
    ['Household', 'Child A', 'Child B', 'Child C', 'Adult One', 'Holidays', 'Hobby'],
  );
});

test('the fetch window is anchored at LOCAL midnight, and follows DST', async () => {
  const { calendar, server } = servingEvents('events.household.json');

  // Denver is UTC-07:00 in February and UTC-06:00 in July. Stepping the window by 24h of
  // UTC instead would silently drop the first or last local day, twice a year.
  const eventCalls = () => server.calls.filter((c) => c.path === EVENTS_PATH);
  await calendar.fetchEvents(ENTITY, win('2026-02-09', '2026-02-16'));
  assert.equal(eventCalls()[0]?.start, '2026-02-09T07:00:00.000Z');
  assert.equal(eventCalls()[0]?.end, '2026-02-16T07:00:00.000Z');

  await calendar.fetchEvents(ENTITY, win('2026-07-13', '2026-07-20'));
  assert.equal(eventCalls()[1]?.start, '2026-07-13T06:00:00.000Z');
  assert.equal(eventCalls()[1]?.end, '2026-07-20T06:00:00.000Z');
});

test('the bearer token is sent on every request', async () => {
  const { calendar, server } = servingEvents('events.household.json');
  await calendar.fetchEvents(ENTITY, win('2026-02-09', '2026-02-16'));
  assert.ok(server.calls.length >= 2, 'the events and the entity state');
  for (const call of server.calls) assert.equal(call.authorization, `Bearer ${TEST_TOKEN}`);
});

test('a window whose end is not after its start is rejected before any request', async () => {
  const { calendar, server } = servingEvents('events.household.json');
  await assert.rejects(() => calendar.fetchEvents(ENTITY, win('2026-02-16', '2026-02-16')));
  assert.equal(server.calls.length, 0);
});

test('an externalRef that is not a calendar entity id is refused, not interpolated', async () => {
  const { calendar, server } = servingEvents('events.household.json');
  for (const bad of ['../states', 'calendar.a/b', 'calendar.a?x=1', 'sensor.temp', '']) {
    await assert.rejects(() => calendar.fetchEvents(bad, win('2026-02-09', '2026-02-16')));
  }
  assert.equal(server.calls.length, 0, 'a bad ref must never reach the wire');
});

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

test('a timed event round-trips its instants', async () => {
  const { calendar } = servingEvents('events.household.json');
  const events = await calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-08-01'));

  const practice = byTitle(events, 'Practice');
  assert.deepEqual(practice.when, {
    kind: 'timed',
    startsAtUtc: '2026-02-10T21:00:00.000Z',
    endsAtUtc: '2026-02-10T22:00:00.000Z',
  });

  // Same wall-clock discipline on the other side of the DST boundary.
  const swim = byTitle(events, 'Swim lesson');
  assert.deepEqual(swim.when, {
    kind: 'timed',
    startsAtUtc: '2026-07-14T15:30:00.000Z',
    endsAtUtc: '2026-07-14T16:15:00.000Z',
  });
});

test('an all-day event stays floating, with an exclusive end', async () => {
  const { calendar } = servingEvents('events.household.json');
  const events = await calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-08-01'));

  assert.deepEqual(byTitle(events, 'Class photo').when, {
    kind: 'allDay',
    startDate: '2026-02-12',
    endDate: '2026-02-13',
  });
  // Four days, 16th through 19th inclusive: the end is EXCLUSIVE, so it is the 20th.
  assert.deepEqual(byTitle(events, 'Trip').when, {
    kind: 'allDay',
    startDate: '2026-03-16',
    endDate: '2026-03-20',
  });
});

test('an all-day event from the UTC-misconfigured calendar lands on exactly ONE local date', async () => {
  const { calendar } = servingEvents('events.utc-misconfigured.json');
  const events = await calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01'));

  // The upstream author created "No school" on the 10th. Their calendar's timezone is UTC,
  // so it arrives as midnight-UTC instants. Stored as instants it would occupy 2026-02-09
  // 17:00 through 2026-02-10 17:00 in Denver, i.e. two local days.
  const noSchool = byTitle(events, 'No school');
  assert.deepEqual(noSchool.when, {
    kind: 'allDay',
    startDate: '2026-02-10',
    endDate: '2026-02-11',
  });
  assert.ok(!('startsAtUtc' in noSchool.when), 'an all-day event carries no instant at all');

  // Reading the instant back in Denver would ALSO collapse it to one day - the day before.
  // One local date is necessary; the right one is the point.
  assert.equal(noSchool.when.kind === 'allDay' && noSchool.when.startDate, '2026-02-10');

  // A multi-day span keeps its exclusive end and stays whole.
  assert.deepEqual(byTitle(events, 'Break week').when, {
    kind: 'allDay',
    startDate: '2026-02-14',
    endDate: '2026-02-17',
  });

  // The same calendar also emits properly-formed all-day events; they are untouched.
  assert.deepEqual(byTitle(events, 'Library visit').when, {
    kind: 'allDay',
    startDate: '2026-02-18',
    endDate: '2026-02-19',
  });

  // 02:00Z-03:00Z is a real one-hour event, not an all-day one.
  assert.equal(byTitle(events, 'Evening call').when.kind, 'timed');
});

test('a real evening event whose instants coincide with midnight UTC stays TIMED', async () => {
  const { calendar } = servingEvents('events.household.json');
  const events = await calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01'));

  // 2026-02-09T17:00:00-07:00 IS 2026-02-10T00:00:00Z, and it runs exactly 24 hours. Only
  // the raw wire form separates it from the misconfigured calendar's all-day events - which
  // is why the rule keys on the string the upstream wrote, never on the instant.
  assert.deepEqual(byTitle(events, 'Late pickup').when, {
    kind: 'timed',
    startsAtUtc: '2026-02-10T00:00:00.000Z',
    endsAtUtc: '2026-02-11T00:00:00.000Z',
  });
});

test('the UTC-midnight rule can be switched off once the upstream is fixed', async () => {
  const body = loadFixture('events.utc-misconfigured.json');
  const { calendar } = adapterFor(
    { [EVENTS_PATH]: () => json(body) },
    { utcMidnightIsAllDay: false },
  );
  const events = await calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01'));
  assert.equal(byTitle(events, 'No school').when.kind, 'timed');
  assert.equal(byTitle(events, 'Library visit').when.kind, 'allDay', 'real all-day is unaffected');
});

test('recurring instances get distinct ids, and an exact repeat collapses to one', async () => {
  const { calendar } = servingEvents('events.recurring.json');
  const events = await calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01'));

  // Four entries, three occurrences: HA reuses one uid for the series and distinguishes
  // instances with recurrence_id. Keying on uid alone would collapse the series to one row
  // - or trip UNIQUE(sync_run_id, external_uid) and fail the whole sync.
  assert.equal(events.length, 3);
  assert.equal(new Set(events.map((e) => e.externalUid)).size, 3);
  assert.ok(events.every((e) => e.externalUid.startsWith('evt-weekly-2001::')));
});

test('recorded edge cases normalise instead of blanking the calendar', async () => {
  const { calendar } = servingEvents('events.edge-cases.json');
  const events = await calendar.fetchEvents(ENTITY, win('2026-04-01', '2026-05-01'));

  // A missing end and an INCLUSIVE end both violate `all_day_start_date < all_day_end_date`,
  // which would abort the whole generation over one event. Both clamp to [d, d+1).
  assert.deepEqual(byTitle(events, 'No end supplied').when, {
    kind: 'allDay',
    startDate: '2026-04-01',
    endDate: '2026-04-02',
  });
  assert.deepEqual(byTitle(events, 'Inclusive end').when, {
    kind: 'allDay',
    startDate: '2026-04-02',
    endDate: '2026-04-03',
  });

  // Zero-length is legal upstream and unrepresentable in the schema.
  assert.deepEqual(byTitle(events, 'Zero length').when, {
    kind: 'timed',
    startsAtUtc: '2026-04-03T14:00:00.000Z',
    endsAtUtc: '2026-04-03T14:01:00.000Z',
  });

  // An untitled event still needs a card; a blank one reads as a rendering bug.
  assert.ok(byTitle(events, '(no title)'));

  // Two identical entries from a platform that sends no uid are one event, not two
  // (H1 finding #7 - a retried page once rendered soccer practice twice).
  const noUid = events.filter((e) => e.externalUid.startsWith('syn:'));
  assert.equal(noUid.length, 1);
  assert.equal(noUid[0]?.title, 'Platform sends no uid');

  // A flattened wire form must not blank the wall if an HA release ships one.
  assert.deepEqual(byTitle(events, 'Flattened wire form').when, {
    kind: 'allDay',
    startDate: '2026-04-06',
    endDate: '2026-04-07',
  });
});

test('a series sharing one uid with no recurrence ids survives, disambiguated', async () => {
  const { calendar } = servingEvents('events.edge-cases.json');
  const events = await calendar.fetchEvents(ENTITY, win('2026-04-01', '2026-05-01'));

  // Older HA releases and some CalDAV bridges omit recurrence_id, so every occurrence of a
  // weekly practice arrives under one uid. Letting that reach UNIQUE(sync_run_id,
  // external_uid) would fail the sync and freeze the calendar of a household whose only
  // sin is having a weekly practice - so distinct occurrences are disambiguated instead.
  const series = events.filter((e) => e.title === 'Series without recurrence ids');
  assert.equal(series.length, 2, 'three entries, two occurrences: the verbatim repeat drops');
  assert.equal(new Set(series.map((e) => e.externalUid)).size, 2);
  assert.ok(series.every((e) => e.externalUid.startsWith('evt-series-3006::')));
  assert.deepEqual(
    series.map((e) => (e.when.kind === 'timed' ? e.when.startsAtUtc : null)).sort(),
    ['2026-04-07T22:00:00.000Z', '2026-04-14T22:00:00.000Z'],
  );
});

test('identifiers do not depend on the order the upstream returned events in', async () => {
  const forwards = loadFixture('events.edge-cases.json') as unknown[];
  const backwards = [...forwards].reverse();

  const a = adapterFor({ [EVENTS_PATH]: () => json(forwards) });
  const b = adapterFor({ [EVENTS_PATH]: () => json(backwards) });
  const window = win('2026-04-01', '2026-05-01');

  const idsA = (await a.calendar.fetchEvents(ENTITY, window)).map((e) => e.externalUid).sort();
  const idsB = (await b.calendar.fetchEvents(ENTITY, window)).map((e) => e.externalUid).sort();
  assert.deepEqual(idsA, idsB, 'an id that reshuffles between syncs is not an identifier');
});

test('a synthesised id is stable across fetches, so the same event is recognised again', async () => {
  const { calendar } = servingEvents('events.edge-cases.json');
  const first = await calendar.fetchEvents(ENTITY, win('2026-04-01', '2026-05-01'));
  const second = await calendar.fetchEvents(ENTITY, win('2026-04-01', '2026-05-01'));
  assert.deepEqual(
    first.map((e) => e.externalUid),
    second.map((e) => e.externalUid),
  );
});

// ---------------------------------------------------------------------------
// Failure - the contract is "throw", never "return fewer"
// ---------------------------------------------------------------------------

test('every malformed payload throws rather than returning a short list', async () => {
  const cases = loadFixture('events.malformed.json') as Record<string, unknown>;
  const names = Object.keys(cases).filter((k) => !k.startsWith('_'));
  assert.ok(names.length >= 9, 'the malformed corpus should not shrink silently');

  for (const name of names) {
    const { calendar } = adapterFor({ [EVENTS_PATH]: () => json(cases[name]) });
    await assert.rejects(
      () => calendar.fetchEvents(ENTITY, win('2026-05-01', '2026-06-01')),
      (err: unknown) => err instanceof Error,
      `${name} must throw`,
    );
  }
});

test('a non-2xx response throws, and a transient one is retried first', async () => {
  let calls = 0;
  const { calendar } = adapterFor(
    {
      [EVENTS_PATH]: (_call, attempt) => {
        calls = attempt;
        return attempt < 3 ? json({ error: 'busy' }, 503) : json(loadFixture('events.household.json'));
      },
    },
    { retries: 2 },
  );

  const events = await calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01'));
  assert.equal(calls, 3, 'two 503s are retried');
  assert.equal(events.length, 5);
});

test('a 404 is not retried - asking again cannot make an entity exist', async () => {
  let attempts = 0;
  const { calendar } = adapterFor(
    {
      [EVENTS_PATH]: () => {
        attempts += 1;
        return json({ message: 'Entity not found' }, 404);
      },
    },
    { retries: 3 },
  );
  await assert.rejects(() => calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01')));
  assert.equal(attempts, 1);
});

test('a transport failure throws instead of resolving empty', async () => {
  const { calendar } = adapterFor({
    [EVENTS_PATH]: () => {
      throw new TypeError('fetch failed');
    },
  });
  await assert.rejects(() => calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01')));
});

test('a 200 whose body is not JSON throws instead of parsing what it can', async () => {
  const { calendar } = adapterFor({
    [EVENTS_PATH]: () => new Response('<html>login</html>', { status: 200 }),
  });
  await assert.rejects(() => calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01')));
});

// HA keeps answering the events endpoint from its local copy after Google stops syncing it,
// and only the entity's state admits that. All seven calendars sat `unavailable` from
// 2026-09-15 to 2026-10-02 while the wall logged "4 ok, 0 failed", so nothing added to
// Google in that time reached the wall, and nothing said so.
test('an entity HA reports as unavailable throws, though its events still answer 200', async () => {
  const { calendar } = adapterFor({
    [EVENTS_PATH]: () => json(loadFixture('events.household.json')),
    [`/api/states/${ENTITY}`]: () => json({ entity_id: ENTITY, state: 'unavailable' }),
  });
  await assert.rejects(
    () => calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01')),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      assert.match(err.message, /unavailable/);
      assert.ok(!err.message.includes(ENTITY), 'the entity id must never be in a message');
      assert.ok(!err.message.includes('ha.invalid'), 'the host must never be in a message');
      return true;
    },
  );
});

test('on, off and the post-restart unknown are all live', async () => {
  for (const state of ['on', 'off', 'unknown']) {
    const { calendar } = adapterFor({
      [EVENTS_PATH]: () => json(loadFixture('events.household.json')),
      [`/api/states/${ENTITY}`]: () => json({ entity_id: ENTITY, state }),
    });
    const events = await calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01'));
    assert.equal(events.length, 5, `${state} must not fail the sync`);
  }
});

test('a state payload the adapter cannot read throws rather than passing as live', async () => {
  for (const body of [null, [], { entity_id: ENTITY }]) {
    const { calendar } = adapterFor({
      [EVENTS_PATH]: () => json(loadFixture('events.household.json')),
      [`/api/states/${ENTITY}`]: () => json(body),
    });
    await assert.rejects(() => calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01')));
  }
});

test('a thrown error carries neither the token nor the host into a persistable message', async () => {
  const { calendar } = adapterFor({ [EVENTS_PATH]: () => json({ message: 'nope' }, 500) });
  await assert.rejects(
    () => calendar.fetchEvents(ENTITY, win('2026-02-01', '2026-03-01')),
    (err: unknown) => {
      assert.ok(err instanceof Error);
      // `sync_run.error` is a database column an admin surface may show.
      assert.ok(!err.message.includes(TEST_TOKEN), 'the token must never be in a message');
      assert.ok(!err.message.includes('ha.invalid'), 'the host must never be in a message');
      assert.ok(!err.message.includes(ENTITY), 'the entity id must never be in a message');
      assert.match(err.message, /HTTP 500/);
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// probe()
// ---------------------------------------------------------------------------

test('probe resolves true on an authenticated 2xx', async () => {
  const { calendar } = adapterFor({ '/api/': () => json({ message: 'API running.' }) });
  assert.equal(await calendar.probe(), true);
});

test('probe resolves false and never throws when the upstream is unusable', async () => {
  const unreachable = adapterFor({
    '/api/': () => {
      throw new TypeError('fetch failed');
    },
  });
  assert.equal(await unreachable.calendar.probe(), false);

  // A reachable HA that rejects the token cannot answer a sync either. Reporting it as
  // "up" would put a green freshness indicator on a quietly frozen calendar.
  const unauthorised = adapterFor({ '/api/': () => json({ message: 'Unauthorized' }, 401) });
  assert.equal(await unauthorised.calendar.probe(), false);

  const broken = adapterFor({ '/api/': () => new Response('nope', { status: 200 }) });
  assert.equal(await broken.calendar.probe(), false);
});

// ---------------------------------------------------------------------------
// Configuration and the boundary
// ---------------------------------------------------------------------------

test('configuration comes from the environment, and a missing value fails loudly', () => {
  assert.throws(
    () => createHomeAssistantCalendar({ HA_TOKEN: 'x' }),
    /HA_BASE_URL/,
    'a missing base URL must not degrade into an adapter that fetches nothing',
  );
  assert.throws(() => createHomeAssistantCalendar({ HA_BASE_URL: TEST_BASE_URL }), /HA_TOKEN/);
  assert.throws(
    () => createHomeAssistantCalendar({ HA_BASE_URL: 'ftp://nope', HA_TOKEN: 'x' }),
    /http/,
  );
  // The message names the variable, never a value.
  try {
    createHomeAssistantCalendar({ HA_BASE_URL: TEST_BASE_URL });
    assert.fail('expected a throw');
  } catch (err) {
    assert.ok(err instanceof Error);
    assert.ok(!err.message.includes(TEST_BASE_URL));
  }
});

test('the adapter exposes only a factory - no entity ids, URLs or wire shapes', async () => {
  const mod = (await import('../src/calendar/homeassistant/index.ts')) as Record<string, unknown>;
  assert.deepEqual(
    Object.keys(mod).filter((k) => typeof mod[k] === 'function'),
    ['createHomeAssistantCalendar'],
  );
});

test('nothing outside src/calendar/homeassistant/ imports it (ADR-0004)', () => {
  const root = fileURLToPath(new URL('../src', import.meta.url));
  const offenders: string[] = [];

  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name !== 'homeassistant') walk(full);
        continue;
      }
      if (!entry.name.endsWith('.ts')) continue;
      if (/from\s+['"][^'"]*homeassistant/.test(readFileSync(full, 'utf8'))) offenders.push(full);
    }
  };
  walk(root);

  assert.deepEqual(
    offenders,
    [],
    'the moment an HA type leaks out, swapping to the Google API stops being a config change',
  );
});
