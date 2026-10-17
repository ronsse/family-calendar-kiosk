/**
 * The household's zone is a SETTING now (2026-10-12), held by `configureTime` in src/time.ts.
 * Every local date on both sides comes from there, so moving it must move "today" — and moving
 * it back must restore it, or one test's zone leaks into every file after it.
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { configureTime, householdTimeZone, localDate, localTime } from '../src/time.ts';
import { DEFAULT_TZ } from '../src/types.ts';

after(() => {
  configureTime({ timeZone: DEFAULT_TZ });
});

const LATE_EVENING_UTC = new Date('2026-07-01T23:30:00Z');

test('the default zone is the one the wall always used', () => {
  assert.equal(householdTimeZone(), DEFAULT_TZ);
  assert.equal(localDate(LATE_EVENING_UTC), '2026-07-01');
});

test('configureTime moves "today": 23:30 UTC is already tomorrow in Berlin', () => {
  configureTime({ timeZone: 'Europe/Berlin' });
  assert.equal(householdTimeZone(), 'Europe/Berlin');
  assert.equal(localDate(LATE_EVENING_UTC), '2026-07-02');
  assert.equal(localTime(LATE_EVENING_UTC), '01:30');

  configureTime({ timeZone: DEFAULT_TZ });
  assert.equal(localDate(LATE_EVENING_UTC), '2026-07-01');
  assert.equal(localTime(LATE_EVENING_UTC), '17:30');
});

test('an unknown zone throws and changes nothing', () => {
  configureTime({ timeZone: 'Europe/Berlin' });
  assert.throws(() => configureTime({ timeZone: 'Mars/Olympus_Mons' }), RangeError);
  assert.equal(householdTimeZone(), 'Europe/Berlin');
  assert.equal(localDate(LATE_EVENING_UTC), '2026-07-02');
  configureTime({ timeZone: DEFAULT_TZ });
});
