/**
 * Unit H — one child's money.
 *
 * Rendered only for a child with `ledgerEnabled`.  The three-year-old's chores run
 * the same state machine and write no ledger row, so she gets no balance surface
 * at all rather than a balance that is always zero (types.ts: "chores still run the
 * state machine, no ledger row is ever written").
 *
 * Cashing out USED to request the whole balance, on the reasoning that a partial amount
 * needs a numeric picker the emergent reader cannot use.  That reasoning was right about
 * pickers and wrong about the conclusion (panel, 2026-09-07, unanimous): fixed money
 * buttons need no picker and no arithmetic, and a five-year-old already understands "a
 * dollar" as a thing.
 *
 * The old default was not conservative, either.  Points are DESTROYED at approval, so
 * "ask for all of it and let the adult hand over less" silently burns the difference —
 * a child with $6 who wanted $2 loses $4 of ledger to a handover nobody recorded.
 *
 * The request goes through the same tap gate as everything else, so the two-second
 * undo window applies: a mis-tapped cash-out is cancelled locally and no parent is
 * ever asked to approve something a child did not mean.
 */

import type { Child } from '../../../../src/types.ts';
import { childAccentForSlot } from '../../design/tokens.ts';
import { useWall } from '../../app/wallContext.ts';
import { BandLeaf, useActiveBand } from '../bands/registry.tsx';
import { balanceFor, cashOutOptions, cashText, streakFor } from '../logic/balances.ts';
import { pipsForCount } from '../logic/pips.ts';
import { pendingRedemptionFor } from '../logic/summary.ts';
import { redemptionKey } from '../logic/tap.ts';

export function PointsPanel({ child }: { child: Child }) {
  const { snapshot, gate, actions, resetKey } = useWall();
  const band = useActiveBand();
  if (!child.ledgerEnabled) return null;

  const balance = balanceFor(snapshot.balances, child.id);
  const pending = pendingRedemptionFor(snapshot.redemptions, child.id);
  const key = redemptionKey(child.id);
  const requested = gate.value(key, pending !== null);
  const canRequest = pending === null && !requested && balance.points > 0;
  // The rate is derived rather than plumbed: `Balance` already carries both halves, and
  // `cashCents` is `points * centsPerPoint` by construction. Adding a field to the frozen
  // snapshot to restate that would be a contract amendment for arithmetic.
  const centsPerPoint =
    balance.cashCents !== null && balance.points > 0 ? balance.cashCents / balance.points : null;
  const options = canRequest ? cashOutOptions(balance.points, centsPerPoint) : [];

  return (
    <BandLeaf
      leaf="PointsBadge"
      resetKey={resetKey}
      props={{
        childId: child.id,
        points: balance.points,
        pips: pipsForCount(balance.points, band),
        cashText: cashText(balance.cashCents),
        // Days running she has done what was asked — `null` below three, which is the
        // wall saying nothing rather than "0 day streak" on a screen a sibling can read
        // (ADR-0005).  The server applies that rule, so the three bands cannot disagree
        // about when a streak is worth drawing.
        streakDays: streakFor(snapshot.streaks, child.id),
        accent: childAccentForSlot(child.sortOrder),
        pendingRedemptionPoints: pending?.pointsRequested ?? (requested ? balance.points : null),
        cashOutOptions: options,
        onRequestRedemption:
          canRequest && options.length > 0
            ? (points: number) => {
                gate.tap(key, true, () => actions.requestRedemption(child.id, points));
              }
            : null,
      }}
    />
  );
}
