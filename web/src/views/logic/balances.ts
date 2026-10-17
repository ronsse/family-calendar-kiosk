/**
 * Unit H — reading a balance without trusting `.find()`.
 *
 * `WallSnapshot.balances` is contracted to hold one row per ACTIVE child, built as
 * a LEFT JOIN so a child with no ledger history still gets `points: 0` (H1 lens 5).
 * The renderer still must not assume the row is there: a snapshot from an older
 * server, a child added between fetch and render, or a bug upstream would
 * otherwise put `undefined.points` on the wall — which is a blank card, which is
 * the failure this project exists to prevent.
 */

import type { Balance, ChildStreak } from '../../../../src/types.ts';
import { householdCurrency, householdLocale } from '../../../../src/config/presentation.ts';

/** Total by construction.  Never returns undefined. */
export function balanceFor(balances: readonly Balance[] | null | undefined, childId: string): Balance {
  const found = (balances ?? []).find((b) => b.childId === childId);
  return found ?? { childId, points: 0, cashCents: null };
}

/**
 * The streak to draw, or `null` for none — and `null` for a snapshot that predates the field.
 *
 * Total for the same reason `balanceFor` is: an older server, or a child added between fetch
 * and render, must degrade to "no streak line" and never to `undefined.days` on the wall.
 * A missing streak is a badge with one less line on it; a thrown renderer is a blank screen.
 */
export function streakFor(
  streaks: readonly ChildStreak[] | null | undefined,
  childId: string,
): number | null {
  const found = (streaks ?? []).find((s) => s.childId === childId);
  return found?.days ?? null;
}

/**
 * One formatter per (locale, currency), at most two held. A module constant pinned to en-US/USD
 * until 2026-10-12; the household's pair now arrives with the snapshot.
 */
const CASH = new Map<string, Intl.NumberFormat>();

function cash(locale: string, currency: string): Intl.NumberFormat {
  const key = `${locale}|${currency}`;
  const hit = CASH.get(key);
  if (hit !== undefined) return hit;
  const f = new Intl.NumberFormat(locale, { style: 'currency', currency });
  if (CASH.size >= 2) {
    const oldest = CASH.keys().next().value;
    if (oldest !== undefined) CASH.delete(oldest);
  }
  CASH.set(key, f);
  return f;
}

/** `null` when the household rate is unset or the child has no ledger. */
export function cashText(cents: number | null | undefined): string | null {
  if (cents === null || cents === undefined || !Number.isFinite(cents)) return null;
  return cash(householdLocale(), householdCurrency()).format(Math.trunc(cents) / 100);
}

// ---------------------------------------------------------------------------
// Partial cash-out — the denominations a child may ask for
// ---------------------------------------------------------------------------

/**
 * What a child may ask for, as MONEY rather than as points.
 *
 * H-panel decision 2026-09-07, unanimous (openai/gpt-5.5 + x-ai/grok-4.5): fixed
 * denominations shown as money, unaffordable ones removed. The alternatives were a coin jar
 * the child drags tokens into, three proportions ("some / half / all"), and doing nothing.
 * Money buttons won because a five-year-old already understands "a dollar" as a thing, and
 * because unaffordability becomes STRUCTURAL — the option is not there rather than there and
 * refused, which is this codebase's rule for guardrails generally.
 *
 * WHY DOING NOTHING WAS NOT NEUTRAL, and this is the sharpest thing the panel said. The
 * existing workaround is "ask for the whole balance and let the adult hand over less". Points
 * are DESTROYED at approval, so that silently burns the difference: a child with $6 who wanted
 * $2 loses $4 of ledger to a cash handover nobody recorded. Whole-balance-only was not a
 * conservative default, it was a way to corrupt the ledger.
 */
export const CASH_OUT_DOLLARS: readonly number[] = [1, 2, 5];

export interface CashOutOption {
  /** What the child taps, e.g. `$2`. */
  readonly label: string;
  /** What gets sent as `pointsRequested`. */
  readonly points: number;
  /** `true` for the option that clears the balance exactly. */
  readonly isAll: boolean;
}

/**
 * The buttons to offer, cheapest first, with "all" last.
 *
 * `centsPerPoint` comes from the snapshot rather than a constant: it is household config and it
 * has already moved once (10 -> 25 on 2026-09-06). A hardcoded 25 here would silently mislabel
 * every button the day it changes again.
 *
 * ALL is always offered when the balance is not already exactly a denomination. That closes the
 * risk grok-4.5 named — a balance of 10 points is $2.50, and without it the 2 points above $2
 * are stranded with no way to ever ask for them. It also keeps the old one-tap behaviour
 * available, so nothing a child could do yesterday became harder today.
 *
 * A denomination is offered only when the balance COVERS it. An affordable-looking button that
 * refuses on tap teaches a child the wall lies; an absent one teaches her to earn more.
 */
export function cashOutOptions(
  points: number,
  centsPerPoint: number | null | undefined,
): CashOutOption[] {
  const rate = typeof centsPerPoint === 'number' && centsPerPoint > 0 ? centsPerPoint : 0;
  if (!Number.isFinite(points) || points <= 0 || rate === 0) return [];

  const out: CashOutOption[] = [];
  for (const dollars of CASH_OUT_DOLLARS) {
    const cost = Math.round((dollars * 100) / rate);
    // Only whole-point denominations. At 25c a dollar is 4 points; at some other rate a
    // dollar may not divide evenly, and asking for 3.6 points is not a thing.
    if (cost * rate !== dollars * 100) continue;
    if (cost > points) continue;
    out.push({ label: `$${String(dollars)}`, points: cost, isAll: cost === points });
  }
  if (!out.some((o) => o.isAll)) {
    out.push({ label: cashLabel(points * rate), points, isAll: true });
  }
  return out;
}

/** `$6` or `$6.50` — never `$6.00`, which reads as precision a child does not need. */
function cashLabel(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rem = cents % 100;
  return rem === 0 ? `$${String(whole)}` : `$${String(whole)}.${String(rem).padStart(2, '0')}`;
}
