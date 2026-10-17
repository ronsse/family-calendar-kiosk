/**
 * Unit C — chores. Recurrence, expanded ONLY in local-date space (H3 finding #6).
 *
 * `chore.rrule` is TEXT and the schema places no CHECK on it, so this module is the only
 * thing standing between a typo and the wall. Two rules follow from the prime invariant:
 *
 *  1. **Never throw.** A malformed rrule on one chore must not take down the sweep that
 *     builds the whole board. `evaluateRrule` returns `supported: false` with a reason;
 *     `materializeChoresForDate` collects those and reports `status: 'error'` so an adult
 *     can see it, while every other chore still materializes.
 *  2. **Unsupported means "does not occur", never "occurs every day".** A chore that is
 *     silently absent is recoverable — an adult notices and fixes the rule. A chore that
 *     appears on the wrong day teaches a child the board is lying.
 *
 * The supported subset is deliberately small, and is the subset that can be evaluated
 * from the rule ALONE. `chore` has no DTSTART column, so anything needing an anchor —
 * `COUNT`, `FREQ=WEEKLY` without `BYDAY`, `FREQ=MONTHLY`, `BYSETPOS` — is unsupported
 * rather than guessed at.
 *
 *   FREQ=DAILY [;INTERVAL=n]
 *   FREQ=WEEKLY;BYDAY=MO,WE,FR [;INTERVAL=n]
 *   ... optionally bounded by DTSTART= / UNTIL= (date part only, both inclusive)
 */

import { dayCode } from '../../time.ts';
import type { LocalDate } from '../../types.ts';
import { dayIndex, mod } from './localdays.ts';

const DAY_CODES = new Set(['SU', 'MO', 'TU', 'WE', 'TH', 'FR', 'SA']);
const KNOWN_PARTS = new Set(['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'DTSTART', 'WKST']);

export type RruleEvaluation =
  | { supported: true; occurs: boolean }
  | { supported: false; occurs: false; reason: string };

/**
 * Does `rrule` place an occurrence on `date`?
 *
 * `date` is a floating local date and is compared only against other floating local
 * dates or against a whole-day index. No instant is constructed anywhere in here.
 */
export function evaluateRrule(rrule: string, date: LocalDate): RruleEvaluation {
  const parts = new Map<string, string>();
  const body = rrule.trim().replace(/^RRULE:/i, '');
  if (body.length === 0) return unsupported('empty rrule');

  for (const chunk of body.split(';')) {
    if (chunk.trim().length === 0) continue;
    const eq = chunk.indexOf('=');
    if (eq <= 0) return unsupported(`malformed part "${chunk}"`);
    const key = chunk.slice(0, eq).trim().toUpperCase();
    if (!KNOWN_PARTS.has(key)) return unsupported(`unsupported part ${key}`);
    if (parts.has(key)) return unsupported(`duplicate part ${key}`);
    parts.set(key, chunk.slice(eq + 1).trim().toUpperCase());
  }

  // WKST only changes anything for INTERVAL > 1, but guessing it wrong shifts a whole
  // week's worth of occurrences, so anything but the RFC default is refused outright.
  const wkst = parts.get('WKST');
  if (wkst !== undefined && wkst !== 'MO') return unsupported(`unsupported WKST=${wkst}`);

  // Window bounds. Both are floating local dates, so a lexicographic compare on
  // YYYY-MM-DD is a calendar compare — no instant, no timezone.
  const dtstart = parts.get('DTSTART');
  if (dtstart !== undefined) {
    const from = datePart(dtstart);
    if (from === null) return unsupported(`malformed DTSTART=${dtstart}`);
    if (date < from) return { supported: true, occurs: false };
  }
  const until = parts.get('UNTIL');
  if (until !== undefined) {
    const to = datePart(until);
    if (to === null) return unsupported(`malformed UNTIL=${until}`);
    if (date > to) return { supported: true, occurs: false };
  }

  const rawInterval = parts.get('INTERVAL');
  let interval = 1;
  if (rawInterval !== undefined) {
    interval = Number.parseInt(rawInterval, 10);
    if (!Number.isInteger(interval) || interval < 1) {
      return unsupported(`bad INTERVAL=${rawInterval}`);
    }
  }

  const freq = parts.get('FREQ');
  const idx = dayIndex(date);

  if (freq === 'DAILY') {
    // BYDAY narrows a DAILY rule in RFC 5545. Supporting it here would duplicate the
    // WEEKLY branch with different interval semantics; refuse rather than approximate.
    if (parts.has('BYDAY')) return unsupported('BYDAY with FREQ=DAILY');
    return { supported: true, occurs: mod(idx, interval) === 0 };
  }

  if (freq === 'WEEKLY') {
    const byday = parts.get('BYDAY');
    if (byday === undefined) {
      return unsupported('FREQ=WEEKLY without BYDAY — no DTSTART anchor to infer the weekday');
    }
    const codes = byday.split(',').map((c) => c.trim());
    if (codes.length === 0 || codes.some((c) => !DAY_CODES.has(c))) {
      return unsupported(`bad BYDAY=${byday}`);
    }
    if (!codes.includes(dayCode(date))) return { supported: true, occurs: false };
    // EPOCH (1970-01-01) was a Thursday; its Monday is dayIndex -3. WKST=MO is enforced
    // above, so this is the RFC week boundary.
    const week = Math.floor((idx + 3) / 7);
    return { supported: true, occurs: mod(week, interval) === 0 };
  }

  return unsupported(freq === undefined ? 'missing FREQ' : `unsupported FREQ=${freq}`);
}

/** Convenience wrapper. An unsupported rule does NOT occur — see the header. */
export function occursOn(rrule: string, date: LocalDate): boolean {
  return evaluateRrule(rrule, date).occurs;
}

function unsupported(reason: string): RruleEvaluation {
  return { supported: false, occurs: false, reason };
}

/** Accepts `20261225`, `20261225T000000Z` and `2026-12-25`; returns the local date. */
function datePart(value: string): LocalDate | null {
  const compact = /^(\d{4})(\d{2})(\d{2})/.exec(value);
  if (compact) {
    const [, y, m, d] = compact;
    if (y && m && d) return `${y}-${m}-${d}` as LocalDate;
  }
  const dashed = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  const hit = dashed?.[1];
  return hit ? (hit as LocalDate) : null;
}
