/**
 * Unit H — poll the kiosk gate for the Pi's own clock evidence.
 *
 * Why a poll and not a one-shot at load: the wall runs for months without reloading, and
 * `timeTrust`'s three-hour staleness ceiling means the verdict FLIPS WITH TIME. A value fetched
 * once at boot is wrong by breakfast, and — the case this is really for — a Pi that comes up
 * after a power cut with no sync yet will acquire one a minute or two later. Polling is what
 * lets the wall show the board immediately and move to the picture once sync lands, instead of
 * delaying the wall's own start until the clock is right. That inversion IS the design
 * (backlog item 2.3 (private notes), constraint 3).
 *
 * Every failure resolves to `null`, which means "no Pi evidence" and never "bad clock". The
 * caller falls back to the server-stamp evidence it used before this existed, so the worst this
 * hook can do is leave the wall exactly as good as it was.
 */

import { useEffect, useState } from 'react';
import type { ClockEvidence } from '../views/logic/timeTrust.ts';
import { gateOriginFromHash, readPiClock } from '../views/logic/piClock.ts';
import { browserWindow } from '../data/browser.ts';

/**
 * One minute.
 *
 * Cheap — it is a loopback request to a Python handler that stats two files — and the thing it
 * is watching for, a first sync after a cold boot, is worth catching within a minute rather
 * than within an hour. It is NOT tied to the render tick: the wall re-renders every second and
 * a request per second to answer a question whose answer changes hourly would be silly.
 */
export const PI_CLOCK_POLL_MS = 60_000;

export function usePiClock(pollMs: number = PI_CLOCK_POLL_MS): ClockEvidence | null {
  const [evidence, setEvidence] = useState<ClockEvidence | null>(null);

  useEffect(() => {
    // Through the established shim, so this module loads in Node — a type check, or a test —
    // without a DOM. `gate=` SURVIVES the address-bar scrub: `hashWithoutToken` filters only
    // the device token, so it is still readable after `claimDeviceToken` has run and after the
    // `minClientBuild` hard reload, which navigates to whatever the address bar then holds.
    const origin = gateOriginFromHash(browserWindow()?.location.hash);
    if (origin === null) return;

    let live = true;
    const tick = () => {
      void readPiClock(origin).then((next) => {
        // A failed read does NOT clear the last good evidence. The gate restarting, or one
        // request timing out, is not new information about the clock — and dropping to server
        // evidence for one tick would make the wall flip screens for a reason that has nothing
        // to do with the time.
        if (live && next !== null) setEvidence(next);
      });
    };
    tick();
    const id = setInterval(tick, pollMs);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [pollMs]);

  return evidence;
}

/**
 * The evidence to grade, preferring the Pi's own.
 *
 * `nowMs` is REPLACED with the browser's current value rather than kept from the payload, and
 * that is the one subtle part. They are the same physical clock — the gate runs on the box the
 * browser runs on — but the payload's `nowMs` is as old as the last poll, up to a minute. Left
 * alone it would understate the sync age by that much, which fails OPEN on a gate whose entire
 * purpose is to fail closed. Taking the browser's `now` with the Pi's `lastSyncAtMs` is not
 * mixing two clocks; it is reading the same clock at the more recent moment.
 */
export function preferPiEvidence(
  pi: ClockEvidence | null,
  server: ClockEvidence,
  nowMs: number,
): ClockEvidence {
  if (pi === null) return server;
  return { ...pi, nowMs };
}
