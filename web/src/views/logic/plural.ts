/**
 * Unit H — a count and the word for it: "1 point", "2 points", "0 points" (2026-10-11).
 *
 * Every number the wall sets beside a noun goes through `counted`. Each site used to write its
 * own template — `${n} points` — and a chore worth one point read "1 points" on the fluent
 * reader's card, on her balance and in the grown-up queue, three places at once. English takes
 * the singular for exactly one and for minus one (a ledger's "-1 point"); zero, every other
 * number and a fraction take the plural.
 *
 * The nouns are a closed table so a site cannot spell its own. The wording drift the grown-up
 * review found — "stars" on the new-chore sheet, "points" on every other screen — was the same
 * bug one level up: two words for one thing, and the one the child reads is "points".
 */

export interface Noun {
  readonly one: string;
  readonly many: string;
}

export const NOUN = {
  point: { one: 'point', many: 'points' },
  sleep: { one: 'sleep', many: 'sleeps' },
  chore: { one: 'chore', many: 'chores' },
  step: { one: 'step', many: 'steps' },
  thing: { one: 'thing', many: 'things' },
  /** Abbreviated, and the same either way: "1 min", "16 min". In the table so no site has to know. */
  min: { one: 'min', many: 'min' },
  hour: { one: 'hour', many: 'hours' },
  /** "3 days in a row" on the Money screen, and "2 days ago" under a claim. */
  day: { one: 'day', many: 'days' },
  /** A chore that comes round "every 3 weeks". */
  week: { one: 'week', many: 'weeks' },
  calendar: { one: 'calendar', many: 'calendars' },
  /** The two kinds of chore, as the grown-up Chores screen counts them: "4 duties · 2 extras". */
  duty: { one: 'duty', many: 'duties' },
  extra: { one: 'extra', many: 'extras' },
  /** The grown-up Home's Today tile: "2 of 6 routines finished". */
  routine: { one: 'routine', many: 'routines' },
} as const satisfies Record<string, Noun>;

/** The noun alone, for a site that sets the number and the word in two styles. */
export function nounFor(n: number, noun: Noun): string {
  return Math.abs(n) === 1 ? noun.one : noun.many;
}

/** The number and its noun: "1 point", "12 points", "-1 point". */
export function counted(n: number, noun: Noun): string {
  return `${String(n)} ${nounFor(n, noun)}`;
}
