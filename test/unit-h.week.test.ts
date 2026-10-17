/**
 * Unit H acceptance: the calendar destination's week, and the axis it compresses.
 *
 * `web/src/views/logic/week.ts` carries the one genuinely interesting derivation on this
 * wall — a time axis built from the events rather than from the clock — and the properties
 * below are the ones the household actually asked for, in the order they asked for them:
 * today is findable without reading, the days are named in words a five-year-old has, the
 * axis spends its height where things happen, and a day reads as a sequence.
 *
 * The fifth property is the one this codebase cares about most and it is not a design
 * property at all: NOTHING IS SILENTLY DROPPED. An event we cannot read a time from must
 * come back somewhere, because a wall that quietly loses the orthodontist is worse than a
 * wall that says it is confused.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { CalendarEventView, LocalDate, Utc } from '../src/types.ts';
import {
  CHIP_ROW_MAX_DAYS,
  CHIP_TITLE_LINES,
  chipShape,
  CHIP_TITLE_STEPDOWN_DAYS,
  WEEK_DAYS,
  WEEK_HORIZON_DAYS,
  WEEK_METRICS,
  WEEK_SWIPE_PX,
  chipEmojiPx,
  chipPxFor,
  chipTitlePx,
  clampWeekPage,
  swipeDirection,
  weekPageCount,
  weekPageOffset,
  dayHeading,
  daySubheading,
  gridBudgetPx,
  headingPxFor,
  pageRangeWords,
  WEEK_HEAD_GAP_PX,
  WEEK_HEAD_PX,
  weekLayout,
  weekPanePx,
} from '../web/src/views/logic/week.ts';
import { bandTypography, layoutPx, nearTypography, spacePx, tapPx } from '../web/src/design/tokens.ts';
import { WALL_LAYOUTS, shellGeometry } from '../web/src/views/logic/theme.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const ICON = { assetId: 'a1', url: '/assets/a1.png', isFallback: false };

/**
 * America/Denver is on MDT (UTC−6) for the whole of August 2026, so a local hour is a UTC
 * hour plus six. Written out rather than derived, so a helper bug cannot silently agree with
 * the code under test; `the fixture really does mean local time` below proves it.
 */
const MDT_OFFSET_HOURS = 6;
const HOUR_MS = 3_600_000;

function localHourUtc(date: string, hour: number, minute = 0): Utc {
  const midnightUtc = Date.parse(`${date}T00:00:00Z`);
  const at = midnightUtc + (hour + MDT_OFFSET_HOURS) * HOUR_MS + minute * 60_000;
  return new Date(at).toISOString() as Utc;
}

function timed(
  id: number,
  title: string,
  date: string,
  hour: number,
  opts: { minute?: number; lengthHours?: number; childId?: string | null } = {},
): CalendarEventView {
  const start = localHourUtc(date, hour, opts.minute ?? 0);
  const end = new Date(Date.parse(start) + (opts.lengthHours ?? 1) * HOUR_MS).toISOString();
  return {
    id,
    title,
    when: { kind: 'timed', startsAtUtc: start, endsAtUtc: end as Utc },
    sourceId: 's',
    colourToken: '--c-id-1',
    childId: opts.childId ?? null,
    icon: ICON,
    emoji: null,
    category: null,
  };
}

function allDay(
  id: number,
  title: string,
  startDate: string,
  endDate: string,
  childId: string | null = null,
): CalendarEventView {
  return {
    id,
    title,
    when: { kind: 'allDay', startDate: startDate as LocalDate, endDate: endDate as LocalDate },
    sourceId: 's',
    colourToken: '--c-id-1',
    childId,
    icon: ICON,
    emoji: null,
    category: null,
  };
}

/** 07:00 local on Tuesday 2026-08-25. Tomorrow is the 26th. */
const NOW = Date.parse('2026-08-25T13:00:00Z');
const TODAY = '2026-08-25';
const TOMORROW = '2026-08-26';
const THURSDAY = '2026-08-27';

const heights = (rows: readonly { heightPx: number }[]): number =>
  rows.reduce((sum, row) => sum + row.heightPx, 0);

test('the fixture really does mean local time', () => {
  const layout = weekLayout([timed(1, 'Dance', TOMORROW, 16)], { nowMs: NOW, days: 4 });
  const item = layout.days[1]?.timed[0];
  assert.equal(item?.minutesOfDay, 16 * 60, '16:00 local, not 22:00 UTC');
  assert.equal(layout.rows[0]?.startHour, 16);
});

// ---------------------------------------------------------------------------
// 1. The day headings — words, not dates
// ---------------------------------------------------------------------------

test('the first two columns are words and the rest are weekdays', () => {
  const layout = weekLayout([], { nowMs: NOW, days: 7 });
  assert.equal(layout.days.length, 7);
  assert.equal(layout.days[0]?.heading, 'Today');
  assert.equal(layout.days[1]?.heading, 'Tomorrow');
  for (const day of layout.days.slice(2)) {
    assert.match(day.heading, /^[A-Z][a-z]{2}$/, 'a short weekday, never a bare date');
  }
  assert.equal(layout.days[0]?.isToday, true);
  assert.deepEqual(
    layout.days.slice(1).map((d) => d.isToday),
    [false, false, false, false, false, false],
  );
});

test('the date is present but never the label a child reads first', () => {
  const layout = weekLayout([], { nowMs: NOW, days: 3 });
  // Both fields exist and they are different things: the word locates the day for the child,
  // the date locates it for the adult standing next to her.
  assert.equal(layout.days[0]?.heading, 'Today');
  assert.equal(layout.days[0]?.subheading, 'Aug 25');
  assert.equal(layout.days[2]?.subheading, 'Aug 27');
  assert.notEqual(layout.days[2]?.heading, layout.days[2]?.subheading);
});

test('the words survive an unusable date rather than throwing', () => {
  assert.equal(dayHeading(0, 'nope' as LocalDate), 'Today');
  assert.equal(dayHeading(1, 'nope' as LocalDate), 'Tomorrow');
  assert.equal(dayHeading(4, 'nope' as LocalDate), '');
  assert.equal(daySubheading('nope' as LocalDate), '');
});

test('"today" is the household date and does not roll over at dinner', () => {
  // 19:00 local on the 25th, which is already the 26th in UTC. `toISOString().slice(0,10)`
  // would move the whole wall on a day forward while the children are eating (H3 finding #6).
  const atDinner = Date.parse('2026-08-26T01:00:00Z');
  const layout = weekLayout([], { nowMs: atDinner, days: 2 });
  assert.equal(layout.days[0]?.date, TODAY);
  assert.equal(layout.days[1]?.date, TOMORROW);
});

test('a nonsense span still yields one column rather than none', () => {
  assert.equal(weekLayout([], { nowMs: NOW, days: 0 }).days.length, 1);
  assert.equal(weekLayout([], { nowMs: NOW, days: -3 }).days.length, 1);
});

// ---------------------------------------------------------------------------
// 2. The compressed axis
// ---------------------------------------------------------------------------

test('a quiet day and a busy one do not get the same axis', () => {
  const quiet = weekLayout([timed(1, 'Dance', TOMORROW, 16)], { nowMs: NOW, days: 4 });
  const busy = weekLayout(
    [7, 8, 9, 12, 16, 18].map((hour, i) => timed(i + 1, `E${String(hour)}`, TOMORROW, hour)),
    { nowMs: NOW, days: 4 },
  );

  // One event is one row. Not an empty 06:00-21:00 clock with one thing on it.
  assert.deepEqual(
    quiet.rows.map((r) => r.kind),
    ['live'],
  );
  assert.equal(heights(quiet.rows), quiet.chipPx);

  // Six events across six hours is six live rows, with the three gaps between them collapsed.
  assert.equal(busy.rows.filter((r) => r.kind === 'live').length, 6);
  assert.equal(busy.rows.filter((r) => r.kind === 'quiet').length, 3);
  assert.ok(heights(busy.rows) > heights(quiet.rows));
  assert.ok(heights(busy.rows) <= busy.gridPx, 'and it still fits the pane');
  assert.equal(busy.bucketHours, 1, 'no coarsening was needed for six events');
});

test('an empty span costs the same whether it is one hour or eight', () => {
  // THE compression rule, in one assertion. A school day is not eight rows of nothing.
  const shortGap = weekLayout([timed(1, 'A', TOMORROW, 8), timed(2, 'B', TOMORROW, 10)], {
    nowMs: NOW,
    days: 4,
  });
  const schoolDay = weekLayout([timed(1, 'A', TOMORROW, 8), timed(2, 'B', TOMORROW, 16)], {
    nowMs: NOW,
    days: 4,
  });

  assert.deepEqual(
    shortGap.rows.map((r) => r.kind),
    ['live', 'quiet', 'live'],
  );
  assert.deepEqual(
    schoolDay.rows.map((r) => r.kind),
    ['live', 'quiet', 'live'],
  );
  assert.equal(shortGap.rows[1]?.heightPx, WEEK_METRICS.quietPx);
  assert.equal(schoolDay.rows[1]?.heightPx, WEEK_METRICS.quietPx);
  assert.equal(heights(shortGap.rows), heights(schoolDay.rows));

  // The row still says how much time it swallowed, so the jump is not silent.
  assert.equal(schoolDay.rows[1]?.startHour, 9);
  assert.equal(schoolDay.rows[1]?.endHour, 16);
});

test('nothing is drawn before the first event or after the last', () => {
  const layout = weekLayout([timed(1, 'Dinner', TOMORROW, 18)], { nowMs: NOW, days: 4 });
  assert.equal(layout.rows.length, 1);
  assert.equal(layout.rows[0]?.startHour, 18);
});

test('an hour that holds three things is three chips tall in every column', () => {
  const layout = weekLayout(
    [
      timed(1, 'Soccer', THURSDAY, 9),
      timed(2, 'Swim', THURSDAY, 9, { minute: 30 }),
      timed(3, 'Party', THURSDAY, 9, { minute: 45 }),
      timed(4, 'Dance', TOMORROW, 16),
    ],
    { nowMs: NOW, days: 4 },
  );
  const nine = layout.rows.find((r) => r.startHour === 9);
  const four = layout.rows.find((r) => r.startHour === 16);
  assert.equal(nine?.stack, 3, "the busiest day sets the row's height");
  assert.equal(nine?.heightPx, 3 * layout.chipPx);
  assert.equal(four?.stack, 1);
  assert.equal(four?.heightPx, layout.chipPx);
});

test('a week with too many distinct hours coarsens instead of overflowing', () => {
  // Eight starts spread over four days: no single day is unfittable, but hourly rows are.
  const events = [
    timed(1, 'a', TOMORROW, 6),
    timed(2, 'b', TOMORROW, 7),
    timed(3, 'c', THURSDAY, 9),
    timed(4, 'd', THURSDAY, 11),
    timed(5, 'e', '2026-08-28', 13),
    timed(6, 'f', '2026-08-28', 15),
    timed(7, 'g', TODAY, 17),
    timed(8, 'h', TODAY, 19),
  ];
  const hourly = weekLayout(events, { nowMs: NOW, days: 4, gridPx: 10_000 });
  const fitted = weekLayout(events, { nowMs: NOW, days: 4 });

  assert.equal(hourly.bucketHours, 1);
  assert.ok(heights(hourly.rows) > fitted.gridPx, 'hourly really would not have fitted');
  assert.ok(fitted.bucketHours > 1, 'so the axis widened its buckets');
  assert.ok(heights(fitted.rows) <= fitted.gridPx);

  // And every one of the eight is still on the wall, in the right column.
  const placed = fitted.days.reduce((n, day) => n + day.timed.length, 0);
  const lost = fitted.days.reduce((n, day) => n + day.overflow, 0);
  assert.equal(placed, 8);
  assert.equal(lost, 0);
});

test('a day nothing can fit is capped and COUNTED, never quietly shortened', () => {
  const events = Array.from({ length: 12 }, (_, i) =>
    timed(i + 1, `E${String(i)}`, TOMORROW, 8 + i),
  );
  const layout = weekLayout(events, { nowMs: NOW, days: 4 });
  const day = layout.days[1];
  assert.ok(day !== undefined);
  assert.ok(day.timed.length < 12, 'twelve chips do not fit 304px');
  assert.equal(day.timed.length + day.overflow, 12, 'the rest are counted, not lost');
  assert.ok(heights(layout.rows) <= layout.gridPx);
});

// ---------------------------------------------------------------------------
// 3. Sequence — the property that has to survive everything above
// ---------------------------------------------------------------------------

test('a day reads top to bottom in clock order however the events arrived', () => {
  // Ids descending on purpose: insertion order is per-source and says nothing about time.
  const layout = weekLayout(
    [
      timed(30, 'Dance', TOMORROW, 16),
      timed(20, 'Lunch', TOMORROW, 12),
      timed(10, 'School', TOMORROW, 8, { lengthHours: 7 }),
    ],
    { nowMs: NOW, days: 4 },
  );
  const day = layout.days[1];
  assert.deepEqual(
    day?.timed.map((t) => t.event.title),
    ['School', 'Lunch', 'Dance'],
  );
  assert.deepEqual(
    day?.timed.map((t) => t.sequence),
    [0, 1, 2],
  );
  // School is above dance on the axis, which is the whole point: "school before that".
  const school = day?.timed[0];
  const dance = day?.timed[2];
  assert.ok(school !== undefined && dance !== undefined);
  assert.ok(school.row < dance.row);
});

test('two events in the same row stack in clock order, not id order', () => {
  const layout = weekLayout(
    [timed(9, 'Later', TOMORROW, 9, { minute: 45 }), timed(1, 'Earlier', TOMORROW, 9)],
    { nowMs: NOW, days: 4 },
  );
  const day = layout.days[1];
  assert.deepEqual(
    day?.timed.map((t) => [t.event.title, t.stack]),
    [
      ['Earlier', 0],
      ['Later', 1],
    ],
  );
});

test('today keeps what has already happened, faded rather than removed', () => {
  // The agenda drops a finished event because "what is next" is its whole job. This view's
  // job is the SHAPE of the day, and a morning with school missing from it is the wrong
  // shape — "what happens is school before that" needs school to still be there at 16:00.
  const afternoon = Date.parse('2026-08-25T22:00:00Z'); // 16:00 local
  const layout = weekLayout(
    [timed(1, 'School', TODAY, 8, { lengthHours: 7 }), timed(2, 'Dance', TODAY, 18)],
    { nowMs: afternoon, days: 4 },
  );
  assert.deepEqual(
    layout.days[0]?.timed.map((t) => [t.event.title, t.isPast]),
    [
      ['School', true],
      ['Dance', false],
    ],
  );
});

test('only today can hold a past event', () => {
  const layout = weekLayout([timed(1, 'Dance', TOMORROW, 8)], { nowMs: NOW, days: 4 });
  assert.equal(layout.days[1]?.timed[0]?.isPast, false);
});

// ---------------------------------------------------------------------------
// 4. All-day events
// ---------------------------------------------------------------------------

test('an all-day event covers a half-open span and never the day it ends on', () => {
  const layout = weekLayout([allDay(1, 'Mountains', TOMORROW, '2026-08-29')], {
    nowMs: NOW,
    days: 5,
  });
  assert.deepEqual(
    layout.days.map((d) => d.allDay.map((e) => e.title)),
    [[], ['Mountains'], ['Mountains'], ['Mountains'], []],
  );
});

test('an all-day event already under way still frames today', () => {
  const layout = weekLayout([allDay(1, 'Mountains', '2026-08-23', '2026-08-27')], {
    nowMs: NOW,
    days: 4,
  });
  assert.deepEqual(
    layout.days.map((d) => d.allDay.length),
    [1, 1, 0, 0],
  );
});

test('all-day events sit above the axis and never on it', () => {
  const layout = weekLayout(
    [allDay(1, 'Mountains', TOMORROW, THURSDAY), timed(2, 'Dance', TOMORROW, 16)],
    { nowMs: NOW, days: 4 },
  );
  assert.equal(layout.allDayRows, 1);
  assert.deepEqual(
    layout.rows.map((r) => r.startHour),
    [16],
    'the trip did not invent an hour',
  );
  assert.equal(layout.days[1]?.timed.length, 1);
});

test('the all-day strip is capped, and what it cannot show is counted', () => {
  const events = [
    allDay(1, 'Trip', TOMORROW, THURSDAY),
    allDay(2, 'Birthday', TOMORROW, THURSDAY),
    allDay(3, 'Bin day', TOMORROW, THURSDAY),
  ];
  const layout = weekLayout(events, { nowMs: NOW, days: 4 });
  assert.equal(layout.allDayRows, WEEK_METRICS.maxAllDayRows);
  assert.equal(layout.days[1]?.allDay.length, 2);
  assert.equal(layout.days[1]?.overflow, 1);
});

test('a week with no all-day event spends nothing on the strip', () => {
  const layout = weekLayout([timed(1, 'Dance', TOMORROW, 16)], { nowMs: NOW, days: 4 });
  assert.equal(layout.allDayRows, 0);
  assert.equal(layout.gridPx, gridBudgetPx(0));
});

// ---------------------------------------------------------------------------
// 5. Nothing is silently dropped
// ---------------------------------------------------------------------------

test('an event whose instant will not parse is KEPT', () => {
  const broken: CalendarEventView = {
    id: 9,
    title: 'Orthodontist',
    when: { kind: 'timed', startsAtUtc: 'nope' as Utc, endsAtUtc: 'nope' as Utc },
    sourceId: 's',
    colourToken: '--c-id-1',
    childId: null,
    icon: ICON,
    emoji: null,
    category: null,
  };
  const layout = weekLayout([broken, timed(1, 'Dance', TOMORROW, 16)], { nowMs: NOW, days: 4 });

  assert.deepEqual(
    layout.unplaceable.map((e) => e.title),
    ['Orthodontist'],
    'a wall that quietly loses the orthodontist is the failure this codebase fears most',
  );
  // And it is not ALSO pinned to a day we guessed at, which would be a different lie.
  assert.equal(
    layout.days.reduce((n, day) => n + day.timed.length + day.allDay.length, 0),
    1,
  );
});

test('an all-day event with dates that are not dates is kept too', () => {
  const layout = weekLayout([allDay(1, 'Camp', 'someday', '2026-08-30')], { nowMs: NOW, days: 4 });
  assert.deepEqual(
    layout.unplaceable.map((e) => e.title),
    ['Camp'],
  );
  assert.equal(layout.allDayRows, 0);
});

test('an all-day event with an empty span is recovered onto the day it starts', () => {
  // `endDate` is exclusive, so end === start is a source bug whose half-open range contains
  // nothing. Every containment test would be false and the event would vanish off a wall
  // that is holding it; one day is both the likely intent and the visible answer.
  const layout = weekLayout([allDay(1, 'Picture day', TOMORROW, TOMORROW)], {
    nowMs: NOW,
    days: 4,
  });
  assert.deepEqual(
    layout.days.map((d) => d.allDay.map((e) => e.title)),
    [[], ['Picture day'], [], []],
  );
  assert.equal(layout.unplaceable.length, 0);
});

test('a broken end time does not cost us a start we can read', () => {
  const half: CalendarEventView = {
    id: 5,
    title: 'Dentist',
    when: { kind: 'timed', startsAtUtc: localHourUtc(TOMORROW, 14), endsAtUtc: 'nope' as Utc },
    sourceId: 's',
    colourToken: '--c-id-1',
    childId: null,
    icon: ICON,
    emoji: null,
    category: null,
  };
  const layout = weekLayout([half], { nowMs: NOW, days: 4 });
  assert.equal(layout.unplaceable.length, 0);
  assert.equal(layout.days[1]?.timed[0]?.event.title, 'Dentist');
  assert.equal(layout.days[1]?.timed[0]?.isPast, false);
});

test('an event outside the window is out of view, not unplaceable', () => {
  const layout = weekLayout([timed(1, 'October', '2026-10-22', 9)], { nowMs: NOW, days: 4 });
  assert.equal(layout.unplaceable.length, 0);
  assert.equal(layout.rows.length, 0);
});

// ---------------------------------------------------------------------------
// 6. Whose week it is
// ---------------------------------------------------------------------------

test('a child sees their own events and the household ones, never a sibling s', () => {
  const events = [
    timed(1, 'Dance', TOMORROW, 16, { childId: 'child-a' }),
    timed(2, 'Soccer', TOMORROW, 17, { childId: 'child-b' }),
    timed(3, 'Dinner', TOMORROW, 18),
  ];
  const mine = weekLayout(events, { nowMs: NOW, days: 4, childId: 'child-a' });
  assert.deepEqual(
    mine.days[1]?.timed.map((t) => t.event.title),
    ['Dance', 'Dinner'],
  );
  const household = weekLayout(events, { nowMs: NOW, days: 4, childId: null });
  assert.equal(household.days[1]?.timed.length, 3);
});

// ---------------------------------------------------------------------------
// 7. The height budget
// ---------------------------------------------------------------------------

test('the pane arithmetic is the wall, and it comes out at 412', () => {
  // 540 − 2x24 wall padding − 64 header − 16 gutter. If any of those tokens move, this
  // number moves with them and the axis refits; it is never a figure somebody typed —
  // which is exactly what happened on 2026-08-30 when the header went 56 → 64 to hold the
  // 64px tap floor its own doors need, and every pane on the wall lost 8px.
  assert.equal(WEEK_METRICS.panePx, 412);
  assert.equal(WEEK_METRICS.framePx, 20);
  assert.equal(gridBudgetPx(0), 340);
  assert.equal(gridBudgetPx(1), 296);
  assert.equal(gridBudgetPx(2), 260);
});

test('the ordinary week fits with room to spare', () => {
  // Four live rows and the three quiet spans between them, against a grid that has an
  // all-day strip on it as well.
  assert.ok(4 * WEEK_METRICS.chipPx + 3 * WEEK_METRICS.quietPx <= gridBudgetPx(1));
  // Six chips fit when nothing is all-day, which is what a Saturday needs.
  assert.ok(6 * WEEK_METRICS.chipPx <= gridBudgetPx(0));
});

test('every axis fits the room it was given, for four days through seven', () => {
  const events = [
    allDay(1, 'Trip', TOMORROW, '2026-08-30'),
    ...[7, 8, 12, 16, 18].map((hour, i) => timed(i + 10, `E${String(hour)}`, TOMORROW, hour)),
    ...[9, 10, 17].map((hour, i) => timed(i + 30, `F${String(hour)}`, THURSDAY, hour)),
  ];
  for (const days of [4, 5, 6, 7]) {
    const layout = weekLayout(events, { nowMs: NOW, days });
    assert.equal(layout.days.length, days);
    assert.ok(
      heights(layout.rows) <= layout.gridPx,
      `${String(days)} columns overflowed the grid`,
    );
    const drawn = layout.days.reduce((n, d) => n + d.timed.length, 0);
    const counted = layout.days.reduce((n, d) => n + d.overflow, 0);
    assert.equal(drawn + counted, 8, 'every timed event is either drawn or counted');
    assert.equal(counted, 0, 'and at this size none of them had to be counted');
    assert.ok(layout.days[1] !== undefined && layout.days[1].allDay.length === 1);
  }
});


// ---------------------------------------------------------------------------
// 7. One grid, three widths — the 2026-09-10 rebuild
// ---------------------------------------------------------------------------

/**
 * The idle board, the calendar destination and a single focused day are now the same
 * component, and the only differences between them are `days` and `startOffset`.  Two things
 * had to become functions of the READER for that to be safe, and both were found by looking at
 * a screenshot of the real panel rather than by any test that existed.
 */

test('a window can open on a day that is not today', () => {
  const events = [timed(1, 'Dance', TOMORROW, 16), timed(2, 'Swim', THURSDAY, 9)];

  const week = weekLayout(events, { nowMs: NOW, days: 5 });
  assert.equal(week.days.length, 5);
  assert.equal(week.days[0]?.date, TODAY);

  // Focusing Thursday is days:1 with an offset, and NOTHING else changes.
  const one = weekLayout(events, { nowMs: NOW, days: 1, startOffset: 2 });
  assert.equal(one.days.length, 1);
  assert.equal(one.days[0]?.date, THURSDAY);
  assert.equal(one.days[0]?.offset, 2, 'the offset is from TODAY, not from the window');
  assert.equal(one.days[0]?.isToday, false, 'and the third day is not today because it is first');
  assert.equal(one.days[0]?.heading, week.days[2]?.heading, 'the same day is worded the same way');
  assert.equal(one.days[0]?.timed.length, 1, 'and it carries its own events');
  assert.equal(one.days[0]?.timed[0]?.event.title, 'Swim');
});

test('focusing TODAY keeps everything that is true of today', () => {
  // The half that would break if `isToday` had stayed `i === 0`: today's fill and the fade on
  // events that have already finished are both keyed off the offset, not the column index.
  // 05:00 and not 06:00: the fixture's events are an hour long, so a 06:00 event ENDS at the
  // 07:00 clock, and `isPast` is a strict comparison — a thing that is finishing right now has
  // not finished.
  const one = weekLayout([timed(1, 'Early', TODAY, 5)], { nowMs: NOW, days: 1, startOffset: 0 });
  assert.equal(one.days[0]?.isToday, true);
  assert.equal(one.days[0]?.heading, 'Today');
  assert.equal(one.days[0]?.timed[0]?.isPast, true, '05:00-06:00 is behind a 07:00 clock');

  // And a LATER day never fades, however early its events are — `isPast` is only ever true on
  // today's column, and a focused Thursday is still Thursday.
  const later = weekLayout([timed(1, 'Early', THURSDAY, 5)], {
    nowMs: NOW,
    days: 1,
    startOffset: 2,
  });
  assert.equal(later.days[0]?.timed[0]?.isPast, false);
});

test('a chip is as tall as the reader needs, not as tall as the constant says', () => {
  // FAR is the idle board — a parent glancing from the kitchen — and NEAR is the calendar
  // destination somebody walks up to. One step apart on the type scale, and 9px apart here.
  const far = bandTypography.fluent;
  const near = nearTypography.fluent;
  // 90 and 76, and the second line of the title is most of both: a 143px column holds about
  // fourteen characters, so "Coffee with a friend" is a two-line title in the ordinary case.
  assert.equal(chipPxFor(far.primaryTextPx, far.secondaryTextPx), 90);
  assert.equal(chipPxFor(near.primaryTextPx, near.secondaryTextPx), 76);
  assert.equal(CHIP_TITLE_LINES, 2, 'and the renderer clamps to the SAME number');
  assert.ok(
    chipPxFor(far.primaryTextPx, far.secondaryTextPx) > WEEK_METRICS.chipPx,
    'the constant was sized for the near scale, which is why the far one clipped',
  );
  // The picture band draws an ICON, not two lines of text, and must be left exactly alone.
  assert.equal(chipPxFor(null, null), WEEK_METRICS.chipPx);
});

test('the day heading is too — "Today" lost the tail of its Y on the real panel', () => {
  const far = bandTypography.fluent;
  const near = nearTypography.fluent;
  assert.equal(headingPxFor(far.primaryTextPx, far.secondaryTextPx), 52);
  assert.equal(headingPxFor(near.primaryTextPx, near.secondaryTextPx), WEEK_METRICS.headingPx);
  assert.equal(headingPxFor(null, null), WEEK_METRICS.headingPx);
  // 44 was the constant, and 24px over 17px at a 1.25 line height is 52. Eight pixels, and the
  // one word on the column that a child who cannot read is learning to recognise by SHAPE.
  assert.equal(WEEK_METRICS.headingPx, 44);
});

test('the grid budget pays for the heading that is actually drawn', () => {
  assert.equal(gridBudgetPx(0), 340, 'unchanged when nobody says otherwise');
  assert.equal(gridBudgetPx(0, 52), 332, 'a taller heading costs the grid exactly its extra');
  assert.equal(gridBudgetPx(1, 52), 288);
  // And the fit walk uses it: the same events against a taller heading may coarsen sooner,
  // never later.
  const events = [6, 8, 10, 12, 14, 16, 18, 20].map((h, i) => timed(i, `E${String(h)}`, TOMORROW, h));
  const tight = weekLayout(events, { nowMs: NOW, days: 5, headingPx: 52, chipPx: 90 });
  const loose = weekLayout(events, { nowMs: NOW, days: 5 });
  assert.ok(
    tight.bucketHours >= loose.bucketHours,
    'a bigger reader gets a coarser axis, never a clipped one',
  );
  assert.ok(heights(tight.rows) <= tight.gridPx, 'and it still fits the room it was given');
});

test("the grid is fitted to the pane the SHELL left — felt's bottom rail leaves 348, not 412", () => {
  // The side shell's body is the 412 every number above was measured against, and it stays the
  // default. Felt puts the faces along the bottom and leaves the body 348 (logic/theme.ts); a
  // grid fitted against 412 there would draw its last rows under the faces.
  const side = shellGeometry(WALL_LAYOUTS.gallery, false).body.height;
  const felt = shellGeometry(WALL_LAYOUTS.felt, false).body.height;
  assert.equal(side, WEEK_METRICS.panePx, 'the default IS the side shell');
  assert.equal(felt, 348);
  assert.equal(gridBudgetPx(0, undefined, side), gridBudgetPx(0));
  assert.equal(gridBudgetPx(0, undefined, felt), gridBudgetPx(0) - (side - felt), 'every pixel the rail takes comes off the grid');

  // Driven through the layout, not just the arithmetic: the fit walk is handed the short pane
  // and what it lays out fits inside it.
  const events = [6, 8, 10, 12, 14, 16, 18, 20].map((h, i) => timed(i, `E${String(h)}`, TOMORROW, h));
  const short = weekLayout(events, { nowMs: NOW, days: 5, panePx: felt });
  const tall = weekLayout(events, { nowMs: NOW, days: 5 });
  assert.equal(short.gridPx, gridBudgetPx(0, undefined, felt));
  assert.equal(tall.gridPx, gridBudgetPx(0));
  assert.ok(short.bucketHours >= tall.bucketHours, 'a shorter pane may coarsen sooner, never later');
  assert.ok(heights(short.rows) <= short.gridPx, 'and it fits the room it was given');
});

test('beside a side rail the pager stands in the week card, and the grid pays for it in HEIGHT', () => {
  // `pagerPlace` (logic/theme.ts): an 816px side header has no room for the pager once the
  // status is stale, so the side shells draw it as a head row of the card. The row is the tap
  // floor tall, and it and the card's gap under it come off the pane the grid is fitted to.
  const side = shellGeometry(WALL_LAYOUTS.gallery, false).body.height;
  const felt = shellGeometry(WALL_LAYOUTS.felt, false).body.height;
  assert.equal(WEEK_HEAD_PX, tapPx.min, 'the row holds two tap targets, so it is the floor');
  // The pager's keys above, the days below, and a day is a control: the space between them is
  // the tap gutter, not the card's 8px rhythm (the panel audit's finding, 2026-10-11).
  assert.ok(WEEK_HEAD_GAP_PX >= spacePx.tapGap, 'the head row and the days are a tap gutter apart');
  assert.ok(WEEK_HEAD_GAP_PX > WEEK_METRICS.gapPx, "more than the card's own gap, which is the rhythm, not a gutter");
  assert.equal(weekPanePx(side, true), 332);
  assert.equal(side - weekPanePx(side, true), WEEK_HEAD_PX + WEEK_HEAD_GAP_PX);
  assert.equal(weekPanePx(side, false), side, 'no head row, no cost');
  assert.equal(weekPanePx(felt, false), 348, "felt's pager stays in its header and its pane stays whole");

  // Driven through the layout: the fit walk is handed the shorter pane, and what it lays out
  // fits under the head row with nothing dropped.
  const events = [6, 8, 10, 12, 14, 16, 18, 20].map((h, i) => timed(i, `E${String(h)}`, TOMORROW, h));
  const headed = weekLayout(events, { nowMs: NOW, days: WEEK_DAYS, panePx: weekPanePx(side, true) });
  assert.equal(headed.gridPx, gridBudgetPx(0, undefined, 332));
  assert.ok(heights(headed.rows) <= headed.gridPx, 'it fits the room under the head row');
  const drawn = headed.days.reduce((n, d) => n + d.timed.length, 0);
  const counted = headed.days.reduce((n, d) => n + d.overflow, 0);
  assert.equal(drawn + counted, events.length, 'every event is drawn or counted');
  // Sixteen pixels shorter than felt's grid, which holds the same five columns.
  const feltGrid = weekLayout(events, { nowMs: NOW, days: WEEK_DAYS, panePx: felt }).gridPx;
  assert.equal(feltGrid - headed.gridPx, 16);
});

test('the head row names the days the page shows, as a range rather than a week it is not', () => {
  const sunday = '2026-10-11' as LocalDate;
  assert.equal(pageRangeWords(sunday, 0), 'Oct 11 – 15');
  assert.equal(pageRangeWords(sunday, 1), 'Oct 16 – 20', 'page two of a Sunday is Friday to Tuesday');
  assert.equal(pageRangeWords(sunday, 4), 'Oct 31 – Nov 4', 'across a month, both months are named');
  assert.equal(pageRangeWords('2026-12-29' as LocalDate, 0), 'Dec 29 – Jan 2', 'and across a year');
  assert.equal(pageRangeWords(sunday, 0, 1), 'Oct 11', 'a page of one day is that day');
  assert.equal(pageRangeWords(sunday, -1), pageRangeWords(sunday, 0), 'there is nothing before today');

  // The range is the layout's: page three's first and last columns are its two ends.
  const page = weekLayout([], { nowMs: NOW, days: WEEK_DAYS, startOffset: weekPageOffset(2) });
  assert.equal(page.days[0]?.date, '2026-09-04');
  assert.equal(page.days[WEEK_DAYS - 1]?.date, '2026-09-08');
  assert.equal(pageRangeWords(TODAY as LocalDate, 2), 'Sep 4 – 8');

  // It is drawn on the wall, so a bad input is an empty line, never a throw.
  const bad: readonly (readonly [string, number])[] = [
    ['nope', 0],
    ['2026-13-40', 0],
    [TODAY, Number.NaN],
    [TODAY, Number.POSITIVE_INFINITY],
    [TODAY, 1e300],
  ];
  for (const [today, n] of bad) {
    assert.equal(pageRangeWords(today as LocalDate, n), '', `${today} page ${String(n)}`);
  }
  assert.equal(pageRangeWords(sunday, 0, Number.NaN), '');
});

test('a five-across column steps the title down rather than breaking a word in half', () => {
  // "Gymnastic / s practice" on the real panel, 2026-09-10. A 143px column does not hold
  // "Gymnastics" in 20px bold, so `overflow-wrap: break-word` did exactly what it is for.
  const near = nearTypography.fluent;
  const far = bandTypography.fluent;

  assert.equal(chipTitlePx(near.primaryTextPx, 5), 17, 'one step down, and still 3 above the floor');
  assert.equal(chipTitlePx(near.primaryTextPx, 2), near.primaryTextPx, 'the board keeps its size');
  assert.equal(chipTitlePx(far.primaryTextPx, 1), far.primaryTextPx, 'and so does a focused day');
  assert.equal(CHIP_TITLE_STEPDOWN_DAYS, 4);
  // The picture band has no title at all; it draws an icon.
  assert.equal(chipTitlePx(null, 5), null);

  // And the HEIGHT budget follows the size that is actually drawn — the two cannot disagree,
  // which is the whole failure this pair of functions exists to make impossible.
  assert.equal(chipPxFor(chipTitlePx(near.primaryTextPx, 5), near.secondaryTextPx), 70);
  assert.ok(
    chipPxFor(chipTitlePx(near.primaryTextPx, 5), near.secondaryTextPx) <
      chipPxFor(near.primaryTextPx, near.secondaryTextPx),
    'a smaller title buys the grid height back',
  );
});

test('a chip with an emoji beside its time is budgeted for the emoji, not the time', () => {
  // "Child A & Child B" cut through its second line on 2026-09-13, while "House cleaning" in
  // the next column fitted: the difference was the 32px emoji sitting on a line the budget had
  // priced at 14px of text. The line is as tall as its tallest thing.
  const near = nearTypography.fluent;
  const title = chipTitlePx(near.primaryTextPx, 5);
  const bare = chipPxFor(title, near.secondaryTextPx);
  const withEmoji = chipPxFor(title, near.secondaryTextPx, chipEmojiPx(near));
  assert.equal(chipEmojiPx(near), 32, 'bounded by the band, floored at the small icon');
  assert.equal(withEmoji - bare, Math.ceil(32 * 1.25) - Math.ceil(14 * 1.25));
  // An emoji no taller than the time line changes nothing — the budget is a max, not a sum.
  assert.equal(chipPxFor(title, near.secondaryTextPx, 10), bare);
  // And the picture band is still left exactly alone.
  assert.equal(chipPxFor(null, null, 32), WEEK_METRICS.chipPx);
});

test('at two columns or fewer a chip is one row, and it is the 48px floor', () => {
  // The board on the real wall, 2026-09-14: "2:00 PM / House cleaning" stood 85px tall and
  // the household said the board "is much larger than it needs to be". The stacked chip was
  // sized for a 143px column; at 350 the same title fits beside its time.
  assert.equal(chipShape(1), 'row');
  assert.equal(chipShape(2), 'row');
  assert.equal(chipShape(3), 'stack');
  assert.equal(chipShape(5), 'stack');
  assert.equal(CHIP_ROW_MAX_DAYS, 2);

  const near = nearTypography.fluent;
  const emoji = chipEmojiPx(near);
  // A row is as tall as its tallest thing: two 20px title lines at 1.25 are 50, the 32px
  // emoji beside them is 40, plus the chip's own 2 x 4 padding. 58 — not the 48 floor, because
  // a title still gets its two lines; the first one-line row ellipsised "Child A & Child B…".
  assert.equal(chipPxFor(near.primaryTextPx, near.secondaryTextPx, emoji, 'row'), 58);
  assert.equal(chipPxFor(near.primaryTextPx, near.secondaryTextPx, undefined, 'row'), 58);
  assert.ok(
    chipPxFor(near.primaryTextPx, near.secondaryTextPx, emoji, 'row') <
      chipPxFor(near.primaryTextPx, near.secondaryTextPx, emoji, 'stack'),
  );
  // The far scale is a taller row — 60px of title — and still well under the stack's 90+.
  const far = bandTypography.fluent;
  assert.equal(chipPxFor(far.primaryTextPx, far.secondaryTextPx, chipEmojiPx(far), 'row'), 68);
  // The default is the stack, so every existing caller and number above is unchanged.
  assert.equal(chipPxFor(near.primaryTextPx, near.secondaryTextPx), chipPxFor(near.primaryTextPx, near.secondaryTextPx, undefined, 'stack'));
  // The picture band is left alone in both shapes.
  assert.equal(chipPxFor(null, null, 32, 'row'), WEEK_METRICS.chipPx);
});

test('a row chip does not grow into a quiet day; a stacked chip grows to a card', () => {
  // The 85px chip on the board was not the budget — it was a 48px row stretched into the
  // slack of a day with one thing on it, up to the 88px card cap. A row that grows is the
  // panel-sized chip the row shape exists to replace, so the cap is the chip itself.
  const events = [timed(1, 'One thing', TOMORROW, 14)];
  const board = weekLayout(events, { nowMs: NOW, days: 2 });
  assert.equal(board.chipShape, 'row');
  assert.equal(board.chipGrowMaxPx, board.chipPx);
  const week = weekLayout(events, { nowMs: NOW, days: 5 });
  assert.equal(week.chipShape, 'stack');
  assert.equal(week.chipGrowMaxPx, layoutPx.listCardHeight);
  assert.ok(week.chipGrowMaxPx > week.chipPx);
});

test('later days come five at a time, inside the sync horizon', () => {
  assert.equal(WEEK_DAYS, 5, 'seven was measured and rejected — see the comment on the constant');
  assert.equal(WEEK_HORIZON_DAYS, 30);
  assert.equal(weekPageCount(), 6);
  assert.ok(WEEK_HORIZON_DAYS < 60, 'every page is inside the 60-day sync window');
  assert.equal(weekPageOffset(0), 0, 'the first page is today');
  assert.equal(weekPageOffset(2), 10);
  assert.equal(weekPageOffset(-1), 0, 'and there is nothing before today');
  assert.equal(clampWeekPage(-1), 0);
  assert.equal(clampWeekPage(3), 3);
  assert.equal(clampWeekPage(99), 5, 'the last page, never a blank one past the horizon');
  // The pages line up with the layout: page two's first column is day ten, headed by its weekday.
  const page = weekLayout([], { nowMs: NOW, days: WEEK_DAYS, startOffset: weekPageOffset(2) });
  assert.equal(page.days.length, 5);
  assert.equal(page.days[0]?.offset, 10);
  assert.notEqual(page.days[0]?.heading, 'Today');
});

test('a swipe is a sideways drag past the slop; anything else is a finger that wandered', () => {
  assert.equal(WEEK_SWIPE_PX, 80);
  assert.equal(swipeDirection(-120, 4), 1, 'dragging left brings later days into view');
  assert.equal(swipeDirection(120, -4), -1, 'dragging right goes back');
  assert.equal(swipeDirection(-40, 0), 0, 'under the threshold is a tap that moved');
  assert.equal(swipeDirection(-100, 130), 0, 'more down than across is not a page turn');
  assert.equal(swipeDirection(-80, 79), 1, 'exactly the threshold counts');
});
