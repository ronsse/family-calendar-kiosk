/**
 * Unit H — clock evidence from the Pi's own `systemd-timesyncd`, read through the kiosk gate.
 *
 * This is the source `serverClock.ts` says it is standing in for. Its header names two things
 * it cannot do, and this module exists to do both:
 *
 *   - **It cannot speak to sync recency.** A snapshot's `generatedAtUtc` is a build stamp: it
 *     says when the server made a snapshot, not when this device last heard a trustworthy time. So
 *     a Pi whose clock drifted *after* a good snapshot was never caught. Here `lastSyncAtMs` is
 *     a real last-sync time and the three-hour ceiling in `timeTrust` finally means something.
 *   - **It says nothing while the network is down** — which is precisely the post-power-cut
 *     case the whole time box exists for. This answers from the Pi's own loopback, so it is
 *     still answering when the server is unreachable.
 *
 * ## Where it comes from
 *
 * `kiosk-gate.py`, the loopback origin Chromium already points at, gained a `/clock` endpoint.
 * Not a new service: the gate is already there, already restarts forever, and is already
 * installed by `pi/scripts/setup.sh`, so this costs nothing extra on a Pi that must stay
 * disposable.
 *
 * The page is served by the server and the gate is on the Pi, so this is a cross-origin request to
 * a loopback address. **Verified on the actual panel, 2026-08-27**: Chromium 151 there does not
 * enforce Private Network Access, and with the gate's `Access-Control-Allow-Origin` the fetch
 * succeeds. That was the one unknown in the design and it was measured rather than assumed — if
 * a future Chromium starts enforcing PNA, this fetch fails, `readPiClock` returns null, and the
 * wall falls back to server evidence exactly as it does today. The failure is a loss of
 * fidelity, never a loss of the wall.
 *
 * ## Total, and pessimistic
 *
 * Every unreadable input answers `null` rather than a partially-filled evidence object. A
 * half-built `ClockEvidence` would be graded by `timeTrust` as if it were real, and the
 * direction it would fail in is not predictable — which is exactly the property this gate
 * cannot have. No evidence is an honest answer; invented evidence is not.
 */

import type { ClockEvidence } from './timeTrust.ts';

/** Where the gate said it lives, or null when nothing told us. */
export function gateOriginFromHash(hash: string | undefined): string | null {
  if (typeof hash !== 'string' || hash.length === 0) return null;
  for (const part of hash.replace(/^#/, '').split('&')) {
    if (!part.startsWith('gate=')) continue;
    const raw = decodeURIComponent(part.slice('gate='.length));
    // Loopback only, and http only. This value arrives in a URL fragment, which anything that
    // can put a URL in front of this kiosk can write — so it is treated as untrusted input and
    // not as configuration. A non-loopback origin here would turn the wall into a client of
    // whatever a passer-by typed, and the answer it fetches decides whether the playful screen
    // is allowed to cover the morning routine.
    try {
      const url = new URL(raw);
      if (url.protocol !== 'http:') return null;
      if (url.hostname !== '127.0.0.1' && url.hostname !== 'localhost') return null;
      return url.origin;
    } catch {
      return null;
    }
  }
  return null;
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === 'number' && Number.isFinite(v);
}

function isNullOrFiniteNumber(v: unknown): v is number | null {
  return v === null || isFiniteNumber(v);
}

/**
 * Turn the gate's payload into evidence, or refuse it.
 *
 * The shape is checked field by field rather than cast, because this crosses a process
 * boundary AND a language boundary — the producer is Python, and a rename on that side would
 * otherwise arrive here as `undefined` wearing a `number` type.
 */
export function parsePiClock(raw: unknown): ClockEvidence | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const { osSynchronised, syncedSinceBoot, lastSyncAtMs, nowMs, lastShutdownAtMs } = o;
  if (typeof osSynchronised !== 'boolean') return null;
  if (typeof syncedSinceBoot !== 'boolean') return null;
  if (!isFiniteNumber(nowMs)) return null;
  if (!isNullOrFiniteNumber(lastSyncAtMs)) return null;
  if (!isNullOrFiniteNumber(lastShutdownAtMs)) return null;
  return { osSynchronised, syncedSinceBoot, lastSyncAtMs, nowMs, lastShutdownAtMs };
}

/** How long to wait for the gate.  It is on loopback; if it is slow, it is broken. */
export const PI_CLOCK_TIMEOUT_MS = 2_000;

/**
 * Ask the gate. Resolves to `null` for every failure, and never rejects.
 *
 * A rejection here would land in whatever effect called it and, on the render path of a wall
 * that must not go dark, that is not a risk worth taking for a diagnostic.
 */
export async function readPiClock(
  origin: string | null,
  fetchImpl: typeof fetch = fetch,
  timeoutMs: number = PI_CLOCK_TIMEOUT_MS,
): Promise<ClockEvidence | null> {
  if (origin === null) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, timeoutMs);
  try {
    // A PLAIN GET with no custom headers, deliberately. That makes it a CORS "simple request",
    // so no preflight is sent — and the gate is a ~40-line stdlib handler with no OPTIONS
    // route, so a preflight would fail the whole thing. Staleness is already handled at the
    // other end: the gate sends `Cache-Control: no-store, must-revalidate` on every response.
    const res = await fetchImpl(`${origin}/clock`, { signal: controller.signal });
    if (!res.ok) return null;
    return parsePiClock(await res.json());
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
