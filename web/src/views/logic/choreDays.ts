/**
 * Which days a chore comes, as a SET of weekdays rather than one preset (2026-10-11).
 *
 * The New-chore sheet used to offer ten single choices — three spans and seven lone days — so
 * "Mondays and Thursdays" was a file-only chore. The seven day pills are toggles now, and the
 * three spans are shortcuts that SET the toggles (and light up when the toggles happen to equal
 * them). The draft holds the set; this module is the only translation between a set and an
 * rrule, in both directions.
 *
 * Two rules keep it honest:
 *
 *   - The set is never empty. A chore that comes on no day is not a chore, and the server would
 *     refuse `BYDAY=` anyway, so the last lit day simply will not untoggle — a dead tap, but the
 *     only lit pill in a row says why.
 *   - An rrule this cannot represent EXACTLY (an interval, a start date, an end) reads back as
 *     `null`, which the sheet calls "Custom" and leaves alone unless a day is tapped. Folding
 *     "every other Monday" into "Mondays" on an edit that only meant to change the name would
 *     double the chore without anybody asking.
 */

export type DayCode = 'MO' | 'TU' | 'WE' | 'TH' | 'FR' | 'SA' | 'SU';

/** The week as the pills draw it: Monday first, like the file's BYDAY lists. */
export const DAY_ORDER: readonly DayCode[] = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];

export const DAY_WORDS: Readonly<Record<DayCode, string>> = {
  MO: 'Mon',
  TU: 'Tue',
  WE: 'Wed',
  TH: 'Thu',
  FR: 'Fri',
  SA: 'Sat',
  SU: 'Sun',
};

export interface DaySpan {
  readonly id: string;
  readonly word: string;
  readonly days: readonly DayCode[];
}

/** The shortcuts above the seven toggles. */
export const SPANS: readonly DaySpan[] = [
  { id: 'daily', word: 'Every day', days: DAY_ORDER },
  { id: 'weekdays', word: 'School days', days: ['MO', 'TU', 'WE', 'TH', 'FR'] },
  { id: 'weekends', word: 'Weekends', days: ['SA', 'SU'] },
];

function isDayCode(value: string): value is DayCode {
  return (DAY_ORDER as readonly string[]).includes(value);
}

/** The set in week order, each day once. */
export function canonicalDays(days: readonly DayCode[]): DayCode[] {
  return DAY_ORDER.filter((d) => days.includes(d));
}

/** The rrule for a set: all seven is `FREQ=DAILY`, which is how the file says it. Null when empty. */
export function daysToRrule(days: readonly DayCode[]): string | null {
  const set = canonicalDays(days);
  if (set.length === 0) return null;
  if (set.length === DAY_ORDER.length) return 'FREQ=DAILY';
  return `FREQ=WEEKLY;BYDAY=${set.join(',')}`;
}

/** The set an rrule names, or null when the rule says more than a set of weekdays can. */
export function rruleToDays(rrule: string): DayCode[] | null {
  const parts = new Map<string, string>();
  for (const piece of rrule.split(';')) {
    const at = piece.indexOf('=');
    if (at <= 0) return null;
    const key = piece.slice(0, at).trim().toUpperCase();
    if (parts.has(key)) return null;
    parts.set(key, piece.slice(at + 1).trim().toUpperCase());
  }
  const interval = parts.get('INTERVAL');
  if (interval !== undefined && interval !== '1') return null;
  for (const key of parts.keys()) {
    if (key !== 'FREQ' && key !== 'BYDAY' && key !== 'INTERVAL' && key !== 'WKST') return null;
  }
  const freq = parts.get('FREQ');
  if (freq === 'DAILY') return parts.has('BYDAY') ? null : [...DAY_ORDER];
  if (freq !== 'WEEKLY') return null;
  const byday = parts.get('BYDAY');
  if (byday === undefined) return null;
  const codes = byday.split(',').map((c) => c.trim());
  if (codes.length === 0 || !codes.every(isDayCode)) return null;
  return canonicalDays(codes);
}

/** Lights or darkens one day. The last lit day stays lit. */
export function toggleDay(days: readonly DayCode[], day: DayCode): DayCode[] {
  if (!days.includes(day)) return canonicalDays([...days, day]);
  if (days.length <= 1) return canonicalDays(days);
  return canonicalDays(days.filter((d) => d !== day));
}

/** The span a set equals exactly, if any — that pill is drawn lit. */
export function spanOf(days: readonly DayCode[]): DaySpan | null {
  const rule = daysToRrule(days);
  return SPANS.find((s) => daysToRrule(s.days) === rule) ?? null;
}

/**
 * How each pill on the days rows is drawn, as `pillState`'s three flags (`logic/pill.ts`).
 *
 * A DAY is a toggle, so a lit day must stay a BUTTON — `solid`, not `on`, because `on` is "the
 * chosen one of a set, tapping it means nothing" and that would make a lit day impossible to
 * turn off. The one exception is the last lit day: tapping it is refused, so it is drawn `on`
 * (filled and inert) rather than live-then-ignored. A SPAN is a shortcut: when the set already
 * equals it, it is `on`, because tapping it would change nothing.
 */
export function dayPillFlags(
  days: readonly DayCode[] | null,
  day: DayCode,
  busy: boolean,
): { on: boolean; solid: boolean; live: boolean } {
  const lit = days !== null && days.includes(day);
  const last = lit && days.length === 1;
  return { on: last, solid: lit && !last, live: !busy };
}

export function spanPillFlags(
  days: readonly DayCode[] | null,
  span: DaySpan,
  busy: boolean,
): { on: boolean; solid: boolean; live: boolean } {
  return { on: days !== null && spanOf(days)?.id === span.id, solid: false, live: !busy };
}
