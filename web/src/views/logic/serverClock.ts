/**
 * Unit H — clock evidence taken from the SERVER's stamp, and an honest account of what that
 * can and cannot prove.
 *
 * `timeTrust.ts` decides whether the wall may show the playful idle screen and needs evidence
 * that the clock is right. The source of record is the Pi's own `systemd-timesyncd` state
 * (backlog item 2.3 (private notes)), which needs a Pi-side service that does not exist yet. This module is the
 * half that ships without one.
 *
 * Every snapshot carries `freshness.generatedAtUtc`, stamped by the server — a mains-powered box
 * with a hardware clock and NTP — at the moment the snapshot was built. So the wall does not
 * have to trust its own clock; it can ask whether its clock is CONSISTENT with one it has
 * reason to believe.
 *
 * ## The asymmetry, which is the whole of it
 *
 * The first version of this compared `|now - stamped|` against a two-minute tolerance and it
 * was wrong on the wall within two minutes. `generatedAtUtc` is a BUILD STAMP, not a
 * heartbeat: the page holds one snapshot and its own clock keeps ticking, so `now - stamped`
 * grows without bound and a symmetric test closes the gate on a perfectly good clock. Measured
 * on the panel, the gate's own `data-idle-why` went `not-synchronised` and then
 * `no fresh server time` thirty seconds apart, on a Pi whose clock was correct.
 *
 * Being AHEAD of the stamp is the normal condition of a wall that has been up a while.
 * Being BEHIND it is proof of a broken clock: the server cannot have built a snapshot at a
 * moment this wall has not yet reached.
 *
 * So the test is one-sided, with a loose sanity bound on the other end to catch a clock that
 * is absurdly ahead rather than merely later.
 *
 * ## What this source CANNOT answer, said plainly
 *
 * **It cannot speak to sync recency.** A build stamp says when a snapshot was made, not when
 * this device last heard a trustworthy time. `evaluateClockEvidence`'s three-hour ceiling is
 * therefore satisfied here by construction rather than by evidence, and that is a real gap:
 * a Pi whose clock drifted after a good snapshot would not be caught by this source. It would
 * be caught by the Pi-side collector, which is why that is still on the list.
 *
 * **It says nothing while the network is down** — the post-power-cut case the gate exists for.
 * The failure lands safe: no snapshot, no evidence, no trust, information board. The wall
 * renders last-known-good from local state either way, so the child still sees a real day.
 */

import type { Freshness } from '../../../../src/types.ts';
import type { ClockEvidence } from './timeTrust.ts';

/**
 * How far BEHIND the server's stamp this wall's clock may be and still be believed.
 *
 * Two minutes, and this is the direction that matters. A clock behind the moment the server
 * already reached is wrong; the only question is whether it is wrong by enough to care about,
 * and the failures this gate exists for — an unset clock, a large NTP step, a wrong timezone
 * baked into an image — are hours or decades out, never ninety seconds.
 */
export const CLOCK_BEHIND_TOLERANCE_MS = 2 * 60_000;

/**
 * How far AHEAD of the stamp the wall may be before we stop believing it.
 *
 * Forty-eight hours, which is not a tolerance so much as an absurdity check. The wall refetches
 * its snapshot when the local date rolls over, so in normal running the newest stamp is at most
 * a day old. Two days of drift means either the wall has not refetched since the day before
 * last — which is its own problem, and the board is the right screen for it — or the clock is
 * somewhere it should not be.
 */
export const CLOCK_AHEAD_LIMIT_MS = 48 * 60 * 60_000;

/**
 * Turn a snapshot's freshness plus the browser's own clock into the evidence `timeTrust`
 * grades.
 *
 * Total, and pessimistic on every unreadable input: an unparseable timestamp is not a
 * near-miss to be tolerated, it is the absence of evidence.
 */
export function serverClockEvidence(freshness: Freshness | undefined, nowMs: number): ClockEvidence {
  const stampedMs = Date.parse(freshness?.generatedAtUtc ?? '');
  const usable = Number.isFinite(nowMs) && !Number.isNaN(stampedMs);

  const notBehind = usable && nowMs >= stampedMs - CLOCK_BEHIND_TOLERANCE_MS;
  const notAbsurdlyAhead = usable && nowMs <= stampedMs + CLOCK_AHEAD_LIMIT_MS;

  return {
    // Condition 1. Consistent with a clock we believe, one-sided. See the header.
    osSynchronised: notBehind && notAbsurdlyAhead,
    // Condition 2. A snapshot arrives over the network and is NEVER restored from disk, so
    // holding one at all is evidence about this page's life. There is no stale copy on disk
    // to be fooled by, which is the same property that makes the tmpfs marker the right
    // source on the Pi.
    syncedSinceBoot: usable,
    // Condition 3. Satisfied by construction, NOT by evidence — see the header. Reporting
    // `nowMs` rather than the stamp is the honest encoding of "this source cannot tell you how
    // long ago we last heard a good time"; pretending the build stamp is a sync time would
    // make a wall that has been up four hours fail for a reason that is not true of it.
    lastSyncAtMs: usable ? nowMs : null,
    nowMs,
    // Condition 4. The server's own stamp is a real floor: this wall's clock may not be behind
    // a moment the server has already reached. A clock stuck in 1970 fails here as well as on
    // condition 1, which is the redundancy the gate wants.
    lastShutdownAtMs: usable ? stampedMs - CLOCK_BEHIND_TOLERANCE_MS : null,
  };
}
