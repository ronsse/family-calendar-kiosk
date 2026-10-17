/**
 * A DATE-ONLY value is a calendar day, not an instant, and must come back as the day it was.
 *
 * clock.ts and week.ts anchor a `LocalDate` at noon UTC. Until 2026-10-12 they then formatted
 * that instant in the HOUSEHOLD zone, which is only the same day while the zone is within 12
 * hours of UTC: in UTC+13 (New Zealand in summer) noon UTC is 01:00 tomorrow, and every date on
 * the wall — the header, the column headings, the page range — read a day ahead. Date-only
 * values are formatted in UTC now. Two halves pinned here: Auckland in January gets the right
 * day, and America/Denver is byte-identical to what it rendered before.
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { addDays, configureTime } from '../src/time.ts';
import { DEFAULT_TZ, type LocalDate } from '../src/types.ts';
import { localDateText } from '../web/src/views/logic/clock.ts';
import { dayHeading, daySubheading, pageRangeWords } from '../web/src/views/logic/week.ts';

after(() => {
  configureTime({ timeZone: DEFAULT_TZ });
});

test('Pacific/Auckland in summer (UTC+13): a date reads as itself, not tomorrow', () => {
  configureTime({ timeZone: 'Pacific/Auckland' });
  try {
    // 2026-01-15 is a Thursday. Noon UTC on it is 01:00 Friday in Auckland.
    assert.equal(localDateText('2026-01-15' as LocalDate, 'full'), 'Thursday, January 15');
    assert.equal(localDateText('2026-01-15' as LocalDate, 'short'), 'Thu, Jan 15');
    assert.equal(localDateText('2026-01-15' as LocalDate, 'monthDay'), 'Jan 15');
    assert.equal(localDateText('2026-01-15' as LocalDate, 'weekday'), 'Thu');
    assert.equal(dayHeading(2, '2026-01-15' as LocalDate), 'Thu');
    assert.equal(daySubheading('2026-01-15' as LocalDate), 'Jan 15');
    // A page that ends on the last day of a month must not spill into the next.
    assert.equal(pageRangeWords('2026-01-27' as LocalDate, 0, 5), 'Jan 27 – 31');
  } finally {
    configureTime({ timeZone: DEFAULT_TZ });
  }
});

test('Pacific/Kiritimati (UTC+14): still the same day', () => {
  configureTime({ timeZone: 'Pacific/Kiritimati' });
  try {
    assert.equal(localDateText('2026-07-04' as LocalDate, 'full'), 'Saturday, July 4');
    assert.equal(daySubheading('2026-12-31' as LocalDate), 'Dec 31');
  } finally {
    configureTime({ timeZone: DEFAULT_TZ });
  }
});

test('America/Denver: byte-identical to the old household-zone rendering, every day of 2026', () => {
  configureTime({ timeZone: DEFAULT_TZ });
  // The formatting the code used before the fix: noon UTC, read in the household zone.
  const old = (opts: Intl.DateTimeFormatOptions) =>
    new Intl.DateTimeFormat('en-US', { timeZone: DEFAULT_TZ, ...opts });
  const full = old({ weekday: 'long', month: 'long', day: 'numeric' });
  const short = old({ weekday: 'short', month: 'short', day: 'numeric' });
  const monthDay = old({ month: 'short', day: 'numeric' });
  const weekday = old({ weekday: 'short' });
  let d = '2026-01-01' as LocalDate;
  for (let i = 0; i < 365; i += 1, d = addDays(d, 1)) {
    const at = new Date(`${d}T12:00:00Z`);
    assert.equal(localDateText(d, 'full'), full.format(at), d);
    assert.equal(localDateText(d, 'short'), short.format(at), d);
    assert.equal(localDateText(d, 'monthDay'), monthDay.format(at), d);
    assert.equal(localDateText(d, 'weekday'), weekday.format(at), d);
    assert.equal(dayHeading(3, d), weekday.format(at), d);
    assert.equal(daySubheading(d), monthDay.format(at), d);
  }
});
