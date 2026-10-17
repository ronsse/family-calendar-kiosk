/**
 * Unit H — the calendar destination: a week of DAY COLUMNS, on a time axis that is not linear.
 *
 * The agenda beside this one (`logic/agenda.ts`) is a list, and a list answers "what is next".
 * It cannot answer the question this household actually asked, which is a question about
 * SHAPE: *"dance class happens tomorrow at four PM — and what happens is school before that."*
 * That is two relations at once, which day and what comes before what, and columns are the
 * only arrangement that carries both without asking a five-year-old to reason about dates.
 *
 * ## The compression rule, and why it is not a linear clock
 *
 * A linear 06:00–21:00 axis spends two thirds of its height on the school block, which holds
 * one event, and then squeezes the four things that happen between 16:00 and 19:00 into the
 * last fifth of the column. That is not a legibility compromise; it is most of a 540px wall
 * used to draw the hours nothing happens in.
 *
 * So the axis is built FROM THE EVENTS, never from the clock:
 *
 *   1. Every timed event in the window is reduced to its local start hour, and those hours,
 *      deduplicated ACROSS all the days on screen, are the axis's LIVE ROWS. An hour nothing
 *      starts in gets no row anywhere.
 *   2. A live row is as tall as its BUSIEST day needs — one chip per event, stacked in clock
 *      order. This is the half that gives the hours which actually contain events their room:
 *      an hour where three things happen on Saturday is three chips tall in every column,
 *      including the five columns where it is empty.
 *   3. Any run of skipped hours between two live rows collapses to ONE thin QUIET ROW, whatever
 *      its length. Six empty school hours and one empty hour cost the same. The row is drawn
 *      rather than deleted, because a jump forward in time that leaves no mark is a lie about
 *      the day.
 *   4. Nothing before the first event or after the last one exists at all. The day starts when
 *      something starts.
 *
 * The axis is shared by every column on purpose. Same height means same time, which is what
 * makes "everyone is busy Saturday morning" visible without reading a single word — and it is
 * why the row's height is the maximum over the days rather than each day's own.
 *
 * ## When it does not fit
 *
 * A wall cannot scroll, so the rule needs an answer for a week with more distinct hours in it
 * than the pane has room for. It coarsens: the hour bucket widens along 1, 2, 3, 4, 6, 12, 24
 * until the axis fits. Widening is safe in the direction it needs to be — merging two rows can
 * only reduce the total, since one day's two events in adjacent hours were already two chips
 * tall — so the walk always terminates, and it terminates as late as possible.
 *
 * Where it usually lands is worth noticing: a genuinely busy week settles on four-hour buckets,
 * which is morning / midday / afternoon / evening. That is the granularity a five-year-old
 * already has for time, so the degradation moves TOWARD how the reader thinks rather than away
 * from it. At the far end, 24, the axis is one row per day and the view is a per-day sequence.
 *
 * SEQUENCE is the property that survives every step of that, and it is the load-bearing one:
 * whatever the bucket width, reading a column top to bottom is reading the day in order. A
 * child who cannot place "four PM" can still see that school is above dance.
 *
 * ## Nothing is dropped
 *
 * An event whose instant will not parse cannot be given a day, and the wrong answer is to let
 * it fall out of a filter — a wall that silently loses the orthodontist is the failure this
 * codebase fears most. Those events come back in `unplaceable`, for the caller to show
 * somewhere honest, rather than being pinned to a day we guessed at. Events that do not fit a
 * capped row are counted, never discarded, the same way `agendaDays` counts its overflow.
 *
 * Days are LOCAL DATES throughout — never instants, never UTC dates. `addDays` walks the
 * calendar, so a DST boundary inside the window shifts nothing (H3 finding #6).
 */

import type { CalendarEventView, LocalDate } from '../../../../src/types.ts';
import { addDays, isLocalDate, localDate } from '../../../../src/time.ts';
import { householdLocale } from '../../../../src/config/presentation.ts';
import {
  cssTokens,
  fontSizePx,
  iconPx,
  layoutPx,
  spacePx,
  stepDown,
  strokePx,
  tapPx,
  type BandTypography,
} from '../../design/tokens.ts';
import { eventStartLocalTime, minutesOfDay } from './clock.ts';

// ---------------------------------------------------------------------------
// The shape the renderer consumes
// ---------------------------------------------------------------------------

export interface WeekEvent {
  readonly event: CalendarEventView;
  /** Index into `WeekLayout.rows`. Always a live row. */
  readonly row: number;
  /** Position within this day's slice of that row, 0-based. Geometry. */
  readonly stack: number;
  /** Position within the whole day in clock order, 0-based. SEQUENCE, not geometry. */
  readonly sequence: number;
  /** Minutes since local midnight, for anything that needs the raw ordering. */
  readonly minutesOfDay: number;
  /** It has already finished. Only ever true on today's column. */
  readonly isPast: boolean;
}

export interface WeekRow {
  /** A live row holds events; a quiet row is a collapsed span of empty hours. */
  readonly kind: 'live' | 'quiet';
  /** Local hour this row opens at, 0–23. */
  readonly startHour: number;
  /** Exclusive. For a quiet row this is the hour the next live row opens at. */
  readonly endHour: number;
  /** Chips the busiest day stacks here. 0 on a quiet row. */
  readonly stack: number;
  /** MINIMUM height. The renderer stretches live rows into whatever slack it has. */
  readonly heightPx: number;
}

export interface WeekDay {
  readonly date: LocalDate;
  /** 0 = today, 1 = tomorrow, and so on. */
  readonly offset: number;
  readonly isToday: boolean;
  /** "Today", "Tomorrow", then the short weekday. Never a bare date. */
  readonly heading: string;
  /** "Aug 27". SECONDARY, and only ever secondary — see `dayHeading`. */
  readonly subheading: string;
  readonly allDay: readonly CalendarEventView[];
  /** In clock order. */
  readonly timed: readonly WeekEvent[];
  /** Events on this day the axis had no room for. Counted, never hidden. */
  readonly overflow: number;
}

export interface WeekLayout {
  readonly days: readonly WeekDay[];
  readonly rows: readonly WeekRow[];
  /** Hours per live row after the fit walk: 1, 2, 3, 4, 6, 12 or 24. */
  readonly bucketHours: number;
  /** Rows in the all-day strip above the grid. 0 when the window has no all-day event. */
  readonly allDayRows: number;
  /** The vertical room the grid was fitted against. */
  readonly gridPx: number;
  readonly chipPx: number;
  /** Row or stack — from the column count, so the renderer and the budget cannot disagree. */
  readonly chipShape: ChipShape;
  /**
   * How tall a live row may GROW into a quiet day's slack, per chip it holds. A stacked chip
   * grows to a card so a week with one thing in it reads as one; a row chip does not grow at
   * all — a 48px agenda line stretched to 88 is the panel-sized chip the row shape exists to
   * replace, and it is what the board drew until 2026-09-15.
   */
  readonly chipGrowMaxPx: number;
  /** Events we could not place on any day. Never dropped. */
  readonly unplaceable: readonly CalendarEventView[];
}

// ---------------------------------------------------------------------------
// The height budget
// ---------------------------------------------------------------------------

/**
 * Every number here is derived from Unit G, so the pane can only be wrong in one place.
 *
 * The arithmetic, for a 960x540 wall at `--force-device-scale-factor=2.0`:
 *
 *   pane    540 − 2x24 wall padding − 56 header − 16 gutter        = 420
 *   frame   − 2x8 card padding − 2x2 card border                   = 400
 *   heading − 44   the day word at 20px over its date at 14px
 *   gap     − 8
 *   all-day − 44   one 36px row plus its gap; 0 when the week has none
 *   ------------------------------------------------------------------
 *   grid      304, which is six chips, or four chips and three quiet rows
 *
 * `chipPx` is an agenda row plus a line for the time. It is deliberately NOT the 64px tap
 * floor: nothing on this wall opens an event, so a chip is not a control and the rule about
 * three-year-old fingers does not govern it.
 */
export const WEEK_METRICS = {
  panePx:
    layoutPx.wallHeight -
    2 * layoutPx.wallPad -
    layoutPx.wallHeaderHeight -
    layoutPx.wallGutter,
  framePx: 2 * spacePx.xs + 2 * strokePx.min,
  headingPx: layoutPx.agendaRowHeight + spacePx.xs,
  gapPx: spacePx.xs,
  allDayRowPx: layoutPx.agendaRowHeight,
  /**
   * Two, not "as many as there are". A week with five overlapping trips on it would otherwise
   * eat the grid the trips are the context for, and the fifth one is still counted in the
   * day's overflow rather than lost.
   */
  maxAllDayRows: 2,
  chipPx: layoutPx.agendaRowHeight + spacePx.sm,
  quietPx: spacePx.sm,
} as const;

/**
 * How tall a chip has to be for THIS reader, which is not a constant.
 *
 * `WEEK_METRICS.chipPx` is 48, and it was right while this grid had exactly one caller: the
 * calendar destination, which somebody walks up to, where the fluent band draws a 20px title
 * over a 14px time. The idle board reads the same grid from the KITCHEN (H8), one step up the
 * scale — 24 over 17 — which needs 52. Four pixels, and every title on the wall clipped.
 *
 * So the number is derived from the two lines the chip actually draws rather than asserted, and
 * the floor keeps the picture band (which draws an icon and has no text sizes at all) exactly
 * where it was.
 */
/**
 * How many lines of TITLE a chip draws.
 *
 * Exported and consumed by the renderer's clamp, because the two have to be the same number or
 * the budget is a fiction: on 2026-09-10 the budget paid for one line, the renderer clamped to
 * two, and five of the six chips on the calendar were cut through the middle of their second
 * line — "Coffee with a frie", "House cleanin", "Call from a frie". A 143px column holds
 * about fourteen characters at 20px, so two lines is not a luxury here, it is the ordinary case.
 */
export const CHIP_TITLE_LINES = 2;

/**
 * How many day columns before a chip title takes a step down the type scale.
 *
 * At five across a column is 143px, and "Gymnastics" in 20px bold does not fit on one line in
 * it — so `overflow-wrap: break-word` did what it is supposed to do and broke a word in half:
 * *Gymnastic / s practice*. That is the defect this project already has a rule about, from the
 * chore card that broke a name at 116px, and the answer is the same one: the thing that must
 * not break gets the room, and something else gives.
 *
 * What gives here is one step, 20px to 17px, which is still three above the wall's floor. The
 * board at two days and a focused single day keep the band's own size, because at 350px and
 * 880px there is nothing to solve.
 */
export const CHIP_TITLE_STEPDOWN_DAYS = 4;

/**
 * At how many day columns or fewer a chip is ONE ROW — time, emoji and title side by side —
 * instead of a time line over a wrapped title.
 *
 * The stacked chip was built for a 143px column, where the title needs two lines and the time
 * cannot share one with it. The board has two columns of ~350px and the focused day has one of
 * ~880, and there the same chip is mostly air: measured on the real wall on 2026-09-14, "2:00
 * PM / House cleaning" stood 85px tall for eleven characters of title, and the household's
 * verdict was that the board "is much larger than it needs to be". In a row the chip is two
 * title lines tall, 58px at the near scale — the agenda row this grid replaced, with room for
 * a long title to wrap beside its time — so the day shows nearly half again the events in the
 * same pane.
 */
export const CHIP_ROW_MAX_DAYS = 2;

export type ChipShape = 'row' | 'stack';

/** Which of the two chip layouts a grid of `days` columns draws. */
export function chipShape(days: number): ChipShape {
  return days <= CHIP_ROW_MAX_DAYS ? 'row' : 'stack';
}

/**
 * The title's size in a chip, which is a function of how wide the column is.
 *
 * `chipEmojiPx` and `chipIconPx` in the renderer already take this shape — a chip's contents
 * are sized from the band AND from the grid — so this is the third of a family rather than a
 * special case, and it goes through `stepDown` so "smaller" means one step of the scale and
 * never a number somebody picked.
 */
export function chipTitlePx(primaryTextPx: number | null, days: number): number | null {
  if (primaryTextPx === null) return null;
  return days >= CHIP_TITLE_STEPDOWN_DAYS ? stepDown(primaryTextPx) : primaryTextPx;
}

export function chipPxFor(
  primaryTextPx: number | null,
  secondaryTextPx: number | null,
  emojiPx?: number,
  shape: ChipShape = 'stack',
): number {
  // The PICTURE band has no text sizes because it draws no text: its chip is an icon, and the
  // constant is already the right height for one. Falling back to the fluent sizes here would
  // silently retune the pre-reader's grid to fit words she is not being shown.
  if (primaryTextPx === null && secondaryTextPx === null) return WEEK_METRICS.chipPx;
  // The token is a CSS string; `n()` in tokens.ts is not exported, and a line height is the one
  // token family that is unitless, so it parses cleanly here.
  const lh = Number(cssTokens['--lh-snug']);
  const titleLine = Math.ceil((primaryTextPx ?? fontSizePx.body) * lh);
  // The time LINE, not the time text: the emoji that sits beside "4:30 PM" is drawn at the
  // band's icon size, which is bigger than the time, and the line is as tall as its tallest
  // thing. Budgeting for the text alone left every chip WITH an emoji 12px short, and the
  // second line of "Child A & Child B" was cut through the middle on 2026-09-13 while
  // "House cleaning", with no emoji, fitted beside it.
  const time = Math.max(
    Math.ceil((secondaryTextPx ?? fontSizePx.meta) * lh),
    emojiPx === undefined ? 0 : Math.ceil(emojiPx * lh),
  );
  // A ROW is as tall as its tallest thing; a STACK is the title's lines over the time line.
  // The title keeps its two lines in BOTH shapes: on the first row-shaped board the 20px
  // "Child A & Child B gymnastics" was 310px against the ~256px left beside its time and emoji,
  // and came out "Child A & Child B…" — the truncation the two-column board exists to avoid.
  // Two lines beside the time is 58px, still under the 85 the stacked chip stood at.
  const title = titleLine * CHIP_TITLE_LINES;
  const inner = shape === 'row' ? Math.max(title, time) : title + time;
  return Math.max(WEEK_METRICS.chipPx, inner + 2 * spacePx.xxs);
}

/**
 * The emoji on a text chip.
 *
 * Bigger than the time it sits beside, because it is not decoration on that line — it is the
 * whole of the line for a reader who cannot read the rest of the chip. Bounded by the band's
 * own secondary icon size so it never becomes the largest thing in a column.
 *
 * Here rather than in the renderer because `chipPxFor` has to budget for it: the size that is
 * drawn and the size that is paid for must be one number.
 */
export function chipEmojiPx(typo: Pick<BandTypography, 'secondaryIconPx'>): number {
  return Math.max(iconPx.xs, Math.min(typo.secondaryIconPx, iconPx.sm));
}

// ---------------------------------------------------------------------------
// Paging — later days, five at a time
// ---------------------------------------------------------------------------

/**
 * How many days the calendar destination shows at once.
 *
 * FIVE, and the measurement is why. The axis is shared across columns so days cost WIDTH, not
 * height — and width is what a title needs. At seven columns the pane gives each one ~120px and
 * the wall rendered "Trip to …", "Child B…", "Child A &…": a calendar that tells a five-year-old
 * there is a thing on Friday without telling her what. At five it is 143px and, with the title
 * one step down, the titles fit.
 *
 * Seven is the unit a household PLANS in; five is the distance a child can see. So the week is
 * not squeezed to seven — it is PAGED: the same five columns, moved later by five days.
 */
export const WEEK_DAYS = 5;

/**
 * How far ahead the pages go, in days. Inside the 60-day sync window with room to spare, so the
 * last page is never a page of days the store has not been told about yet — a blank column on
 * page six would read as "nothing on", which is a different statement from "not synced".
 */
export const WEEK_HORIZON_DAYS = 30;

/** Pages of `WEEK_DAYS` inside the horizon. Six, at the numbers above. */
export function weekPageCount(days: number = WEEK_DAYS, horizonDays: number = WEEK_HORIZON_DAYS): number {
  return Math.max(1, Math.floor(horizonDays / days));
}

/** Where a page opens, in days after today. */
export function weekPageOffset(page: number, days: number = WEEK_DAYS): number {
  return Math.max(0, page) * days;
}

/**
 * How far a finger has to travel sideways before the card reads it as a swipe rather than a
 * tap that wandered. 80 logical px is a third of a column: well past the tap slop, well short
 * of the whole card, and a child dragging a finger across "Tuesday" to point at it does not
 * turn the page.
 */
export const WEEK_SWIPE_PX = 80;

/**
 * -1 for a swipe that asks for EARLIER days, +1 for LATER, 0 for anything that was not a
 * swipe. A finger moving left drags the later days into view, the way a page turns.
 */
export function swipeDirection(dx: number, dy: number, thresholdPx: number = WEEK_SWIPE_PX): -1 | 0 | 1 {
  if (Math.abs(dx) < thresholdPx) return 0;
  if (Math.abs(dy) > Math.abs(dx)) return 0;
  return dx < 0 ? 1 : -1;
}

/** Clamp a page move into the pages that exist. */
export function clampWeekPage(page: number, pages: number = weekPageCount()): number {
  return Math.min(pages - 1, Math.max(0, page));
}

/**
 * The head row the pager stands in when the shell puts it in the week card (`pagerPlace` in
 * logic/theme.ts): its two keys are tap targets, so the row is the tap floor tall.
 */
export const WEEK_HEAD_PX = tapPx.min;

/**
 * The space between the head row and the columns: the TAP gutter, not the card's 8px rhythm.
 * The pager's keys sit directly above the days, and a day is a control (tap it and it fills the
 * screen), so 8px there put two targets a finger's width apart — the panel audit's tap rule
 * found it in both side shells (2026-10-11).
 */
export const WEEK_HEAD_GAP_PX = spacePx.tapGap;

/**
 * The pane the grid is fitted against: the body the shell left, less the head row and the
 * gutter under it when the pager stands there. 412 − 80 = 332 beside a side rail — still five
 * columns at full width, and 16px shorter than felt's 348, which holds the same week.
 */
export function weekPanePx(bodyPx: number, headRow: boolean): number {
  return headRow ? bodyPx - WEEK_HEAD_PX - WEEK_HEAD_GAP_PX : bodyPx;
}

/**
 * "Oct 11 – 15", or "Oct 31 – Nov 4" across a month: the days a page shows, for the head row
 * the pager stands in. A RANGE rather than "This week", because a page is five days from
 * today and not a calendar week — page two of a Sunday is Friday to Tuesday, which no week
 * name describes. Empty, never a throw, for a date that is not one: it is drawn on the wall.
 */
export function pageRangeWords(today: LocalDate, page: number, days: number = WEEK_DAYS): string {
  if (!isLocalDate(today) || !Number.isFinite(page) || !Number.isFinite(days)) return '';
  const span = Math.max(1, Math.trunc(days));
  let first: LocalDate;
  let last: LocalDate;
  try {
    first = addDays(today, weekPageOffset(Math.trunc(page), span));
    last = addDays(first, span - 1);
  } catch {
    // A page so far out that the calendar has no date for it (`addDays` past year 275760).
    return '';
  }
  const a = atNoon(first);
  const b = atNoon(last);
  if (a === null || b === null) return '';
  const f = current();
  if (first === last) return f.monthDay.format(a);
  const sameMonth = first.slice(0, 7) === last.slice(0, 7);
  return sameMonth
    ? `${f.month.format(a)} ${f.day.format(a)} – ${f.day.format(b)}`
    : `${f.monthDay.format(a)} – ${f.monthDay.format(b)}`;
}

/**
 * How tall a DAY HEADING has to be for this reader, for the same reason `chipPxFor` exists and
 * caught by the same screenshot.
 *
 * `WEEK_METRICS.headingPx` is 44 and the far scale draws a 24px word over a 17px date, which is
 * 52. The word "Today" lost the tail of its Y on the first idle board that rendered this grid —
 * a heading that reads "Todav" is not a small overflow, it is the one word on that column a
 * non-reader is being taught to recognise by shape.
 */
export function headingPxFor(primaryTextPx: number | null, secondaryTextPx: number | null): number {
  // Same reason as `chipPxFor`: the picture band's heading renders nothing at all.
  if (primaryTextPx === null && secondaryTextPx === null) return WEEK_METRICS.headingPx;
  const lh = Number(cssTokens['--lh-snug']);
  const word = Math.ceil((primaryTextPx ?? fontSizePx.body) * lh);
  const date = Math.ceil((secondaryTextPx ?? fontSizePx.meta) * lh);
  return Math.max(WEEK_METRICS.headingPx, word + date);
}

/**
 * Room left for the time grid once the headings and the all-day strip are paid for.
 *
 * `panePx` is the body the shell actually left (`ShellGeometry.body.height`). It defaults to
 * the side shell's 412, which is `WEEK_METRICS.panePx`; felt's bottom rail leaves 348, and a
 * grid fitted against 412 there would put its last rows under the faces.
 */
export function gridBudgetPx(allDayRows: number, headingPx?: number, panePx?: number): number {
  const inner = (panePx ?? WEEK_METRICS.panePx) - WEEK_METRICS.framePx;
  const strip =
    allDayRows <= 0 ? 0 : allDayRows * WEEK_METRICS.allDayRowPx + WEEK_METRICS.gapPx;
  // The heading is a caller's fact now, not a constant: the idle board draws it a step larger
  // than the calendar destination does, and the grid has to be told or it fits against a
  // heading that is not the one on screen.
  return inner - (headingPx ?? WEEK_METRICS.headingPx) - WEEK_METRICS.gapPx - strip;
}

/**
 * The bucket widths the axis may coarsen through, finest first.
 *
 * 5 is missing on purpose: hours are read in halves and quarters of a day, and a five-hour
 * band puts 08:00 and 12:00 in the same row while 13:00 starts a new one, which is a division
 * nobody has a name for.
 */
const BUCKET_LADDER: readonly number[] = [1, 2, 3, 4, 6, 12, 24];

// ---------------------------------------------------------------------------
// Day headings — the words, because a date a child cannot place is not a date
// ---------------------------------------------------------------------------

const TODAY_WORD = 'Today';
const TOMORROW_WORD = 'Tomorrow';

/**
 * These duplicate the shape of `logic/clock.ts`'s formatters rather than reusing them, for one
 * reason: a COLUMN heading wants the weekday alone, and clock.ts has no style that emits it.
 * The discipline is copied exactly — every value here is a DATE, not an instant, so it is
 * anchored at noon UTC and formatted in UTC (clock.ts's `DATE_ONLY_ZONE` explains why). The
 * household zone used to be the formatting zone, which put every heading a day ahead in
 * UTC+13/+14; in America/Denver the output is byte-identical.
 */
interface WeekFormats {
  readonly weekday: Intl.DateTimeFormat;
  readonly monthDay: Intl.DateTimeFormat;
  readonly month: Intl.DateTimeFormat;
  readonly day: Intl.DateTimeFormat;
}

/**
 * Built per locale on first use, at most two held — the same scheme as clock.ts. They were
 * module constants pinned to the compile-time zone until 2026-10-12. The zone is not part of
 * the key: date-only values are always formatted in UTC.
 */
const FORMATS = new Map<string, WeekFormats>();
const DATE_ONLY_ZONE = 'UTC';

function fmts(locale: string): WeekFormats {
  const timeZone = DATE_ONLY_ZONE;
  const key = locale;
  const hit = FORMATS.get(key);
  if (hit !== undefined) return hit;
  const f: WeekFormats = {
    weekday: new Intl.DateTimeFormat(locale, { timeZone, weekday: 'short' }),
    monthDay: new Intl.DateTimeFormat(locale, { timeZone, month: 'short', day: 'numeric' }),
    month: new Intl.DateTimeFormat(locale, { timeZone, month: 'short' }),
    day: new Intl.DateTimeFormat(locale, { timeZone, day: 'numeric' }),
  };
  if (FORMATS.size >= 2) {
    const oldest = FORMATS.keys().next().value;
    if (oldest !== undefined) FORMATS.delete(oldest);
  }
  FORMATS.set(key, f);
  return f;
}

function current(): WeekFormats {
  return fmts(householdLocale());
}

function atNoon(date: LocalDate): Date | null {
  const ms = Date.parse(`${date}T12:00:00Z`);
  return Number.isNaN(ms) ? null : new Date(ms);
}

/**
 * "Today", "Tomorrow", then "Thu".
 *
 * The household's finding, verbatim: *"at this age, today, tomorrow, next day are
 * confusing."* Which is not an argument for putting the date up instead — it is an argument
 * for the two words everybody actually uses, and for the weekday after them, which is the
 * shortest thing that still locates a day in a week a child hears named every morning.
 */
export function dayHeading(offset: number, date: LocalDate): string {
  if (offset === 0) return TODAY_WORD;
  if (offset === 1) return TOMORROW_WORD;
  const at = atNoon(date);
  return at === null ? '' : current().weekday.format(at);
}

/** "Aug 27" — for the adult in the room. Never the primary label on a column. */
export function daySubheading(date: LocalDate): string {
  const at = atNoon(date);
  return at === null ? '' : current().monthDay.format(at);
}

// ---------------------------------------------------------------------------
// Reading a when
// ---------------------------------------------------------------------------

interface TimedStart {
  readonly date: LocalDate;
  readonly minutesOfDay: number;
  readonly endMs: number;
}

/**
 * `null` when the instant is unusable, which sends the event to `unplaceable` rather than to
 * the floor. Everything here is the household zone, through the same two helpers the rest of
 * the wall uses: the DAY a 23:30Z event belongs to is the local one, and in America/Denver
 * those differ. A second parse of the same instant here is how the agenda and the calendar
 * would come to disagree about which day something is on.
 */
function timedStart(event: CalendarEventView): TimedStart | null {
  if (event.when.kind !== 'timed') return null;
  const startMs = Date.parse(event.when.startsAtUtc);
  if (Number.isNaN(startMs)) return null;
  const at = new Date(startMs);
  const wallClock = eventStartLocalTime(event.when);
  const mins = wallClock === null ? null : minutesOfDay(wallClock);
  if (mins === null) return null;
  const endMs = Date.parse(event.when.endsAtUtc);
  return {
    date: localDate(at),
    minutesOfDay: mins,
    // A broken end with a good start is still placeable; it just never reads as finished.
    endMs: Number.isNaN(endMs) ? startMs : endMs,
  };
}

interface AllDaySpan {
  readonly start: LocalDate;
  /** Exclusive. */
  readonly end: LocalDate;
}

/**
 * `null` only when the dates are not dates at all.
 *
 * A span that ends on or before it starts is a source bug — the half-open range is empty, so
 * every containment test would be false and the event would vanish from a wall that is
 * holding it. It is recovered as the single day it starts on, which is the reading that keeps
 * it visible and is almost certainly what was meant.
 */
function allDaySpan(event: CalendarEventView): AllDaySpan | null {
  if (event.when.kind !== 'allDay') return null;
  const { startDate, endDate } = event.when;
  if (!isLocalDate(startDate) || !isLocalDate(endDate)) return null;
  return { start: startDate, end: endDate > startDate ? endDate : addDays(startDate, 1) };
}

// ---------------------------------------------------------------------------
// The layout
// ---------------------------------------------------------------------------

export interface WeekOptions {
  readonly nowMs: number;
  /** How many local day columns. */
  readonly days: number;
  /**
   * Where the window OPENS, in days after today.  0 is today, which is what every caller wanted
   * until one day got a screen of its own.
   *
   * It exists so that a single day can be shown full-width without a second layout engine:
   * focusing Friday is `{ days: 1, startOffset: 4 }`, and everything downstream — the heading
   * words, the past-event fade, today's fill — keeps working because they were all written
   * against the OFFSET rather than against the column index.  A negative value is allowed and
   * means the past; nothing asks for it yet, and refusing it would be a rule with no reason.
   */
  readonly startOffset?: number | undefined;
  /** Household events (childId === null) are always included. */
  readonly childId?: string | null | undefined;
  /** Override the derived height budget. The renderer's pane is the truth when it differs. */
  readonly gridPx?: number | undefined;
  readonly chipPx?: number | undefined;
  /** The heading's real height for this reader — see `headingPxFor`. */
  readonly headingPx?: number | undefined;
  /** The pane the shell left, when it is not the side shell's 412 — see `gridBudgetPx`. */
  readonly panePx?: number | undefined;
  readonly quietPx?: number | undefined;
  readonly maxAllDayRows?: number | undefined;
}

interface Placed {
  readonly event: CalendarEventView;
  readonly minutesOfDay: number;
  readonly isPast: boolean;
}

export function weekLayout(
  events: readonly CalendarEventView[] | undefined,
  opts: WeekOptions,
): WeekLayout {
  const childId = opts.childId ?? null;
  const span = Math.max(1, Math.trunc(opts.days));
  const startOffset = Math.trunc(opts.startOffset ?? 0);
  const chipPx = Math.max(1, opts.chipPx ?? WEEK_METRICS.chipPx);
  const quietPx = Math.max(0, opts.quietPx ?? WEEK_METRICS.quietPx);
  const maxAllDayRows = Math.max(0, opts.maxAllDayRows ?? WEEK_METRICS.maxAllDayRows);

  const today = localDate(new Date(opts.nowMs));
  const dates: LocalDate[] = [];
  for (let i = 0; i < span; i += 1) dates.push(addDays(today, startOffset + i));
  const columnOf = new Map<string, number>(dates.map((d, i) => [d, i]));

  const mine = (events ?? []).filter(
    (e) => e.childId === null || childId === null || e.childId === childId,
  );

  const unplaceable: CalendarEventView[] = [];
  const allDayByDay: CalendarEventView[][] = dates.map(() => []);
  const timedByDay: Placed[][] = dates.map(() => []);

  for (const event of mine) {
    const at = timedStart(event);
    if (at !== null) {
      const column = columnOf.get(at.date);
      // Outside the window is not the same as unreadable: it has a day, that day is simply
      // not on screen. Only an event we cannot place AT ALL goes to `unplaceable`.
      if (column === undefined) continue;
      timedByDay[column]?.push({
        event,
        minutesOfDay: at.minutesOfDay,
        isPast: startOffset + column === 0 && at.endMs < opts.nowMs,
      });
      continue;
    }
    const range = allDaySpan(event);
    if (range === null) {
      unplaceable.push(event);
      continue;
    }
    dates.forEach((date, i) => {
      if (date >= range.start && date < range.end) allDayByDay[i]?.push(event);
    });
  }

  for (const list of timedByDay) {
    list.sort((a, b) => a.minutesOfDay - b.minutesOfDay || a.event.id - b.event.id);
  }
  for (const list of allDayByDay) {
    list.sort((a, b) => a.id - b.id);
  }

  const busiestAllDay = allDayByDay.reduce((most, list) => Math.max(most, list.length), 0);
  const allDayRows = Math.min(maxAllDayRows, busiestAllDay);
  const gridPx = Math.max(0, opts.gridPx ?? gridBudgetPx(allDayRows, opts.headingPx, opts.panePx));

  // The fit walk. Coarsening is weakly monotone downward — merging two rows can only reduce
  // the total, because a day already holding both events was already that tall — so the first
  // width that fits is also the finest one that fits, and the walk cannot oscillate.
  let bucketHours = BUCKET_LADDER[0] ?? 1;
  let built = buildRows(timedByDay, bucketHours, chipPx, quietPx);
  for (const width of BUCKET_LADDER) {
    bucketHours = width;
    built = buildRows(timedByDay, width, chipPx, quietPx);
    if (built.totalPx <= gridPx) break;
  }

  // Last resort, and only reachable when a single DAY holds more events than the pane has
  // chips: cap how tall a row may grow. Nothing is deleted — what does not fit is counted
  // into that day's overflow, which is the wall telling you it is holding something you
  // cannot see rather than pretending it is not.
  const capStack = Math.max(1, Math.floor(gridPx / chipPx));
  const rows: WeekRow[] =
    built.totalPx <= gridPx
      ? built.rows
      : built.rows.map((row) => {
          if (row.kind !== 'live') return row;
          const stack = Math.min(row.stack, capStack);
          return { ...row, stack, heightPx: stack * chipPx };
        });

  const rowOfBucket = new Map<number, number>();
  rows.forEach((row, i) => {
    if (row.kind === 'live') rowOfBucket.set(row.startHour, i);
  });

  const days: WeekDay[] = dates.map((date, i) => {
    const used = new Map<number, number>();
    const timed: WeekEvent[] = [];
    let overflow = 0;

    (timedByDay[i] ?? []).forEach((placed, sequence) => {
      const bucket = bucketOf(placed.minutesOfDay, bucketHours);
      const row = rowOfBucket.get(bucket);
      const room = row === undefined ? 0 : (rows[row]?.stack ?? 0);
      const taken = row === undefined ? 0 : (used.get(row) ?? 0);
      if (row === undefined || taken >= room) {
        overflow += 1;
        return;
      }
      used.set(row, taken + 1);
      timed.push({
        event: placed.event,
        row,
        stack: taken,
        sequence,
        minutesOfDay: placed.minutesOfDay,
        isPast: placed.isPast,
      });
    });

    const allDay = allDayByDay[i] ?? [];
    overflow += Math.max(0, allDay.length - allDayRows);

    return {
      date,
      offset: startOffset + i,
      isToday: startOffset + i === 0,
      heading: dayHeading(startOffset + i, date),
      subheading: daySubheading(date),
      allDay: allDay.slice(0, allDayRows),
      timed,
      overflow,
    };
  });

  const shape = chipShape(span);
  return {
    days,
    rows,
    bucketHours,
    allDayRows,
    gridPx,
    chipPx,
    chipShape: shape,
    chipGrowMaxPx: shape === 'row' ? chipPx : layoutPx.listCardHeight,
    unplaceable,
  };
}

/** Local hour, floored to the bucket it belongs to. */
function bucketOf(minutes: number, bucketHours: number): number {
  const hour = Math.floor(minutes / 60);
  return Math.floor(hour / bucketHours) * bucketHours;
}

function buildRows(
  timedByDay: readonly (readonly Placed[])[],
  bucketHours: number,
  chipPx: number,
  quietPx: number,
): { rows: WeekRow[]; totalPx: number } {
  const perDay = timedByDay.map((list) => {
    const counts = new Map<number, number>();
    for (const placed of list) {
      const bucket = bucketOf(placed.minutesOfDay, bucketHours);
      counts.set(bucket, (counts.get(bucket) ?? 0) + 1);
    }
    return counts;
  });

  const live = [...new Set(perDay.flatMap((counts) => [...counts.keys()]))].sort((a, b) => a - b);

  const rows: WeekRow[] = [];
  let previousEnd: number | null = null;
  for (const bucket of live) {
    if (previousEnd !== null && bucket > previousEnd) {
      rows.push({
        kind: 'quiet',
        startHour: previousEnd,
        endHour: bucket,
        stack: 0,
        heightPx: quietPx,
      });
    }
    const stack = perDay.reduce((most, counts) => Math.max(most, counts.get(bucket) ?? 0), 1);
    rows.push({
      kind: 'live',
      startHour: bucket,
      endHour: Math.min(24, bucket + bucketHours),
      stack,
      heightPx: stack * chipPx,
    });
    previousEnd = bucket + bucketHours;
  }

  return { rows, totalPx: rows.reduce((sum, row) => sum + row.heightPx, 0) };
}
