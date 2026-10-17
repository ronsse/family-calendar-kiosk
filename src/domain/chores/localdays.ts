/**
 * Unit C — chores. Local-date arithmetic, in one place.
 *
 * Everything recurrence and rotation do is indexed off a whole number of LOCAL days.
 * That number is derived from the date STRING, never from an instant: adding
 * `24*60*60*1000` to a Date works until Denver's local midnight shifts by an hour, at
 * which point a school-day chore is skipped, duplicated, or handed to the adjacent day —
 * twice a year, silently, months after launch (H3 finding #6).
 *
 * `daysBetween` from src/time.ts anchors BOTH operands at `T00:00:00Z`, so the
 * subtraction is exact and DST-immune. This module exists so there is exactly one epoch
 * and exactly one call site for that trick.
 */

import { daysBetween } from '../../time.ts';
import type { LocalDate } from '../../types.ts';

/** Arbitrary but fixed origin. Only differences of `dayIndex` are ever meaningful. */
export const EPOCH = '1970-01-01' as LocalDate;

/** Whole local days from EPOCH. Negative before 1970; callers use a floored modulus. */
export function dayIndex(date: LocalDate): number {
  return daysBetween(EPOCH, date);
}

/** Floored modulus — `%` alone is sign-preserving in JS and would break pre-1970 dates. */
export function mod(a: number, n: number): number {
  return ((a % n) + n) % n;
}
