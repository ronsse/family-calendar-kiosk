/**
 * Unit H — "get ready, we leave at": the leave-by alert, minus its pixels.
 *
 * The household's ask: *"get dressed for dance, get dressed for gymnastics … an alarm
 * component before those events because we got to get ready before we go. School is 10
 * minutes away, we try to leave between 7:30 and 7:40."* So a DEPARTURE is a moment to leave
 * the house, and the alert has two phases around it:
 *
 *   ready   readyFrom ≤ now < leaveAt      "Get ready for Dance — leave at 4:15"
 *   go      leaveAt ≤ now < leaveAt + 10   "Time to go — Dance"
 *
 * There are two kinds of departure and they come from different places:
 *
 *   - **The school run** is a RULE, not an event. Nothing on any calendar says "school at
 *     8:00" on a normal day — the calendars say when school is NOT on. So school departs at
 *     `rules.school.leaveAt` on its days, and is suppressed on a day that carries an all-day
 *     day-off event (the 🏠 family: no school, breaks, teacher work days). That reads the
 *     event's EMOJI, which is the one channel the classifier already funnels every day-off
 *     phrase through — a second keyword list here would drift from the first.
 *   - **A timed event** whose category the rules name (dance, sport by default) departs
 *     `travelMinutes` before it starts. Category, not title: the household's calendar titles
 *     are theirs, and a match on words would be a keyword list that lives in the wall.
 *
 * Everything here is computed on the CLIENT from the snapshot's events, the snapshot's rules
 * and the wall's own clock, in minutes since local midnight, the way the idle gate judges the
 * board windows. The server has no local→UTC converter and does not need one; the server
 * stores rules, the wall makes the call. Same shape as every other time-of-day judgement on
 * this wall. It is NOT an input to the idle gate — the gate has exactly two inputs and the
 * test `unit-h.timetrust.test.ts` pins that — so the alert is an overlay on whatever screen is
 * up, never a reason to change the screen.
 *
 * No React, no `.tsx` import: this is the half of the feature with tests.
 */

import type {
  CalendarEventView,
  DepartureRules,
  LocalDate,
  LocalTime,
} from '../../../../src/types.ts';
import { dayCode, localDate } from '../../../../src/time.ts';
import { HOME_DAY_EMOJI } from '../../../../src/calendar/classify.ts';
import { fontSizePx } from '../../design/tokens.ts';
import { eventStartLocalTime, minutesOfDay } from './clock.ts';
import { counted, NOUN } from './plural.ts';
import { firstThatFits, type FittedWords, type MeasureText } from './textFit.ts';

/** How long "time to go" stays up after the leave-by minute has passed. */
export const GO_LINGER_MINUTES = 10;

/**
 * The floating card on the picture: wide enough for "Get ready for Gymnastics" at 24px with
 * a face beside it, and no wider — the picture is the point of that screen.
 */
export const DEPARTURE_SCENE_MAX_WIDTH_PX = 480;

/** The one symbol for the school run: the day it means school, unlike "No School" (🏠). */
export const SCHOOL_EMOJI = '🎒';

export type DeparturePhase = 'ready' | 'go';

export interface Departure {
  /** `school`, or `event:<id>`. Stable across ticks, so a renderer may key on it. */
  readonly key: string;
  /** "School", or the event's title. */
  readonly label: string;
  /** The pre-reader's reading of the label. */
  readonly emoji: string;
  /** Minutes since local midnight. */
  readonly leaveAtMinutes: number;
  readonly readyFromMinutes: number;
  /** Whose event, when the calendar says. The school run is everyone's. */
  readonly childId: string | null;
}

export interface DepartureAlert {
  readonly departure: Departure;
  readonly phase: DeparturePhase;
  /** Whole minutes until the leave-by minute; 0 once it has passed. */
  readonly minutesLeft: number;
}

function minutesText(minutes: number): string {
  const hh = Math.floor(minutes / 60) % 24;
  const mm = minutes % 60;
  const hour12 = hh % 12 === 0 ? 12 : hh % 12;
  return `${String(hour12)}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'AM' : 'PM'}`;
}

/** "7:35 AM" from a leave-by minute, for the banner's second line. */
export function leaveAtText(departure: Departure): string {
  return minutesText(departure.leaveAtMinutes);
}

/** The household-local date an instant falls on; null when the instant does not parse. */
function eventLocalDate(utc: string): LocalDate | null {
  const ms = Date.parse(utc);
  return Number.isNaN(ms) ? null : localDate(new Date(ms));
}

function isHomeDay(events: readonly CalendarEventView[], date: LocalDate): boolean {
  return events.some(
    (e) =>
      e.when.kind === 'allDay' &&
      e.emoji === HOME_DAY_EMOJI &&
      e.when.startDate <= date &&
      date < e.when.endDate,
  );
}

/**
 * Every departure on one local date, soonest first. Empty when the rules are off.
 *
 * A malformed instant on one event drops that event, never the list: `eventStartLocalTime`
 * answers null and the loop moves on, the same bargain the rest of the calendar makes.
 */
export function departuresForDay(
  events: readonly CalendarEventView[],
  rules: DepartureRules,
  date: LocalDate,
): Departure[] {
  if (!rules.enabled) return [];
  const out: Departure[] = [];

  if (rules.school.days.includes(dayCode(date)) && !isHomeDay(events, date)) {
    const leave = minutesOfDay(rules.school.leaveAt);
    if (leave !== null) {
      out.push({
        key: 'school',
        label: rules.school.label,
        emoji: SCHOOL_EMOJI,
        leaveAtMinutes: leave,
        readyFromMinutes: Math.max(0, leave - rules.readyMinutes),
        childId: null,
      });
    }
  }

  for (const e of events) {
    if (e.when.kind !== 'timed') continue;
    if (e.category === null || !rules.eventCategories.includes(e.category)) continue;
    // The event's own local DATE, not the snapshot's: today's list carries an event that
    // started this evening in Denver and ends tomorrow in UTC, and it is still today's.
    const startsAt = eventStartLocalTime(e.when);
    if (startsAt === null || eventLocalDate(e.when.startsAtUtc) !== date) continue;
    const start = minutesOfDay(startsAt);
    if (start === null) continue;
    const leave = Math.max(0, start - rules.travelMinutes);
    out.push({
      key: `event:${String(e.id)}`,
      label: e.title,
      emoji: e.emoji ?? SCHOOL_EMOJI,
      leaveAtMinutes: leave,
      readyFromMinutes: Math.max(0, leave - rules.readyMinutes),
      childId: e.childId,
    });
  }

  out.sort((a, b) => a.leaveAtMinutes - b.leaveAtMinutes || a.key.localeCompare(b.key));
  return out;
}

/**
 * The alert to draw right now, or null. The SOONEST active departure wins: when dance is at
 * 4:25 and again at 4:40, the second one's "get ready" is already covered by the first's, and
 * its own turn comes when the first has gone quiet.
 */
export function departureNow(departures: readonly Departure[], localTime: LocalTime): DepartureAlert | null {
  const now = minutesOfDay(localTime);
  if (now === null) return null;
  for (const d of departures) {
    if (now >= d.readyFromMinutes && now < d.leaveAtMinutes) {
      return { departure: d, phase: 'ready', minutesLeft: d.leaveAtMinutes - now };
    }
    if (now >= d.leaveAtMinutes && now < d.leaveAtMinutes + GO_LINGER_MINUTES) {
      return { departure: d, phase: 'go', minutesLeft: 0 };
    }
  }
  return null;
}

/**
 * The words, one line each. The second line is the number a parent glances for.
 *
 * `compact` is the header's version. The chrome bar's middle is ~260px between the time and
 * the doors — and ~100px less while the calendar's pager is up — and "Get ready for School" /
 * "Leave at 7:35 AM · 15 min" was 2026-09-15's first thing to be measured and the first to
 * truncate ("Get ready for Sch…"). The header already says the time; it does not need it said
 * again, and the label moves to the second line so the first is the same two words every
 * morning. The picture's card has the room and keeps the full sentence.
 */
export function departureWords(
  alert: DepartureAlert,
  compact = false,
): { readonly head: string; readonly detail: string } {
  const at = leaveAtText(alert.departure);
  const label = alert.departure.label;
  const mins = counted(alert.minutesLeft, NOUN.min);
  if (alert.phase === 'go') {
    // Compact: the label alone. The clock is two inches to the left, and on the week screen —
    // where the pager takes 160px of this strip — "School · 12:05 AM" was already an ellipsis.
    return compact
      ? { head: 'Time to go!', detail: label }
      : { head: 'Time to go!', detail: `${label} · leave ${at}` };
  }
  return compact
    ? { head: 'Get ready', detail: `${label} · ${mins}` }
    : { head: `Get ready for ${label}`, detail: `Leave at ${at} · ${mins}` };
}

/**
 * The banner's last words: "16 min" while getting ready, "Go!" once it is time. With the emoji
 * beside it — "🎒 16 min" — it is the whole alert in the room a stale wall leaves it.
 */
export function departureMinutes(alert: DepartureAlert): string {
  return alert.phase === 'go' ? 'Go!' : counted(alert.minutesLeft, NOUN.min);
}

/** What the header's banner draws, chosen by the room it is given. */
export type DepartureFit =
  | { readonly form: 'words'; readonly head: FittedWords; readonly detail: FittedWords; readonly face: boolean }
  | { readonly form: 'minutes'; readonly line: FittedWords; readonly face: boolean }
  | { readonly form: 'glyph'; readonly face: boolean };

/** The banner's room, measured on the glass, and the fixed things in it. */
export interface DepartureRoom {
  /** The banner's content box: its width less its padding and its edge. */
  readonly roomPx: number;
  /** The emoji's own width at the size it is drawn. */
  readonly emojiPx: number;
  /** The child's face, when the departure is one child's; null for the school run. */
  readonly facePx: number | null;
  /** The gap between the emoji, the face and the words. */
  readonly gapPx: number;
}

/**
 * The header banner, in the room it has — never clipped (logic/textFit.ts).
 *
 * Beside a side rail the header is 816px, and a stale wall's label keeps all of its words (it is
 * the honest one and never shrinks), so the banner can be left under a hundred pixels; on
 * 2026-10-11 that drew "G… / S…". The order it gives way in:
 *
 *   1. the two lines, "Get ready" / "School · 16 min";
 *   2. the same two lines with the first at the 14px floor too;
 *   3. one line, "🎒 16 min" — the emoji says what, the number says when — at 17 then 14px;
 *   4. the same without the child's face, because the minutes are what a parent glances for and
 *      the emoji still says what;
 *   5. the emoji (and the face, if it fits) alone. The banner's colour already says get ready or
 *      go, and the picture's card has the whole sentence. Measured 2026-10-11, felt with the
 *      calendar open on a stale wall reaches this: the pager shares the bar, and at 7:48 AM the
 *      banner has 72px inside for the 85 that "🎒 16 min" needs.
 *
 * The picture's card does not come through here: it has the room and keeps every word.
 */
export function departureFit(alert: DepartureAlert, room: DepartureRoom, measure: MeasureText): DepartureFit {
  const words = departureWords(alert, true);
  const short = departureMinutes(alert);
  const hasFace = room.facePx !== null;
  const lead = (face: boolean): number => room.emojiPx + (face && room.facePx !== null ? room.gapPx + room.facePx : 0);
  const at = (w: string, sizePx: number): FittedWords => ({ words: w, sizePx });

  const candidates: DepartureFit[] = [
    { form: 'words', head: at(words.head, fontSizePx.small), detail: at(words.detail, fontSizePx.meta), face: hasFace },
    { form: 'words', head: at(words.head, fontSizePx.meta), detail: at(words.detail, fontSizePx.meta), face: hasFace },
    { form: 'minutes', line: at(short, fontSizePx.small), face: hasFace },
    { form: 'minutes', line: at(short, fontSizePx.meta), face: hasFace },
  ];
  if (hasFace) candidates.push({ form: 'minutes', line: at(short, fontSizePx.meta), face: false });
  candidates.push({ form: 'glyph', face: hasFace });

  const widthOf = (c: DepartureFit): number => {
    switch (c.form) {
      case 'words':
        return lead(c.face) + room.gapPx + Math.max(measure(c.head.words, c.head.sizePx), measure(c.detail.words, c.detail.sizePx));
      case 'minutes':
        return lead(c.face) + room.gapPx + measure(c.line.words, c.line.sizePx);
      case 'glyph':
        return lead(c.face);
    }
  };
  return firstThatFits(candidates, room.roomPx, widthOf) ?? { form: 'glyph', face: false };
}

/** What the header bar still draws while the banner holds its middle. */
export interface HeaderKeeps {
  /** The date beside the clock. */
  readonly date: boolean;
  /** The analog dial before the clock. */
  readonly dial: boolean;
  /** The freshness pill's words; its glyph always stays. */
  readonly statusWords: boolean;
}

/**
 * What the header gives up so the banner can say its minutes rather than its emoji alone.
 *
 *   - The date always steps aside: the banner is a time already, and the date is one tap away.
 *   - A FRESH status drops its words to the check, which frees ~200px.
 *   - A STALE status cannot. "Showing older information" is the honest label and never shrinks.
 *     So the dial steps aside instead, but only beside numerals that already say the time. On a
 *     screen with no numerals the dial is a pre-reader's only "when", and it stays.
 *
 * Measured 2026-10-11 in gallery, stale, at 10:08 AM (the widest time on this face). Beside a side
 * rail the banner's content had 41px with the dial and 89px without it. "🎒 16 min" needs 85px.
 */
export function headerKeeps(banner: boolean, statusFresh: boolean, numerals: boolean): HeaderKeeps {
  if (!banner) return { date: true, dial: true, statusWords: true };
  return { date: false, dial: statusFresh || !numerals, statusWords: !statusFresh };
}

// ---------------------------------------------------------------------------
// Settings → Leave-by alerts (behind the PIN): the household’s switch and three numbers.

/** The lead times move in fives from the wall; a stepper that walks by ones is a chore. */
export const LEAD_STEP_MINUTES = 5;

/**
 * The rails the server holds a lead time to (src/domain/departures MIN/MAX_LEAD_MINUTES,
 * mirrored because a web module may not import the domain; a test pins the pair). A step past
 * either is a 400 the household would read as a broken key, so the stepper draws that side
 * inert instead of offering it.
 */
export const LEAD_MIN_MINUTES = 0;
export const LEAD_MAX_MINUTES = 120;

/** Where each key of a lead-time stepper goes, or null where it would leave the rails. */
export function leadStep(minutes: number): { readonly down: number | null; readonly up: number | null } {
  const down = minutes - LEAD_STEP_MINUTES;
  const up = minutes + LEAD_STEP_MINUTES;
  return {
    down: down >= LEAD_MIN_MINUTES ? down : minutes > LEAD_MIN_MINUTES ? LEAD_MIN_MINUTES : null,
    up: up <= LEAD_MAX_MINUTES ? up : minutes < LEAD_MAX_MINUTES ? LEAD_MAX_MINUTES : null,
  };
}

/** `HH:MM` moved by whole minutes, wrapping at midnight; the school stepper's arithmetic. */
export function stepLocalTime(t: LocalTime, deltaMinutes: number): LocalTime {
  const m = minutesOfDay(t);
  if (m === null) return t;
  const next = (((m + deltaMinutes) % 1440) + 1440) % 1440;
  return `${String(Math.floor(next / 60)).padStart(2, '0')}:${String(next % 60).padStart(2, '0')}` as LocalTime;
}

/** "7:35 AM" for the school row. */
export function localTimeText(t: LocalTime): string {
  const m = minutesOfDay(t);
  return m === null ? t : minutesText(m);
}

/** One line under the leave-by heading, saying where the departures come from. Counts nothing, names nothing. */
export function leavingSourcesLine(rules: DepartureRules): string {
  const kinds = rules.eventCategories.join(' and ');
  const days = rules.school.days.length === 5 ? 'Mon–Fri' : rules.school.days.join(' ');
  return `${rules.school.label} ${days}, except a day off · ${kinds} from the calendar`;
}
