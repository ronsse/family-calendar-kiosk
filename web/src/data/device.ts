/**
 * Unit I — how the panel proves it is the panel.
 *
 * ## The token comes from the Pi, not from the server
 *
 * `/api/wall/*` needs `Authorization: Device <token>`, and the bundle that must send it is
 * served by the same origin as the API. The obvious shortcut — have the server stamp the token
 * into the HTML it serves — hands a wall credential to anything on the LAN that can GET `/`,
 * which is a guest phone, and is the same mistake docs/api.md rejects when it forbids an IP
 * allowlist. So the token lives ON THE PI, in `~/.config/kiosk.env`, and `kiosk-gate.py`
 * appends it to the redirect as a URL FRAGMENT.
 *
 * A fragment, specifically. It is never sent to the server, so it lands in no access log; it
 * is not a query string, so it is not in any proxy's request line. The bundle lifts it out on
 * first paint, parks it, and rewrites the address bar with `history.replaceState`.
 *
 * **`replaceState`, never `location.reload()`.** CLAUDE.md records what happened last time
 * something in this repo reloaded to clean up a URL: HA's `trusted_networks` callback carries
 * a single-use code, the reload discarded it, and the frontend hung forever on "Unable to
 * connect". `replaceState` mutates the address without a navigation, so nothing in flight is
 * thrown away.
 */

export const TOKEN_FRAGMENT_KEY = 'dt';
export const TOKEN_STORAGE_KEY = 'wall.deviceToken';

export interface KeyValueStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Tolerates a leading `#`, extra fragment params, and percent-encoding. */
export function tokenFromHash(hash: string | null | undefined): string | null {
  if (typeof hash !== 'string') return null;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  if (raw.length === 0) return null;
  for (const pair of raw.split('&')) {
    const eq = pair.indexOf('=');
    if (eq === -1) continue;
    if (pair.slice(0, eq) !== TOKEN_FRAGMENT_KEY) continue;
    let value: string;
    try {
      value = decodeURIComponent(pair.slice(eq + 1));
    } catch {
      value = pair.slice(eq + 1);
    }
    return value.length > 0 ? value : null;
  }
  return null;
}

/**
 * Is this session a PROBE — an agent driving the panel to verify a change, rather than a
 * person using the wall?
 *
 * Set with `#probe=1` in the kiosk URL. It suppresses one thing only: the door-tap counter.
 *
 * This exists because the counter measured its own verification. `door_tap` was built to
 * answer backlog item 5.1 (private notes) — do adults reach for the calendar while the picture is up — and the
 * honest answer after two weeks is expected to be a small number, so a couple of stray taps
 * can tip it. On 2026-08-27 an agent verified an icon change over the Chrome DevTools
 * Protocol, clicked the calendar door twice to navigate, and wrote the only two rows the
 * instrument has ever held. It had deleted an earlier set of its own rows THAT SAME DAY and
 * then immediately made more, which is what a convention enforced by memory buys you.
 *
 * Deliberately fragment-only and never stored: a reload without it counts taps again, so this
 * cannot be left switched on. It also cannot hide anything a child does — nothing else in the
 * app reads it.
 */
export function isProbeSession(hash: string | null | undefined): boolean {
  if (typeof hash !== 'string') return false;
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  return raw.split('&').some((pair) => pair === 'probe=1');
}

/** The same fragment with the credential removed; '' when nothing else was in it. */
export function hashWithoutToken(hash: string | null | undefined): string {
  if (typeof hash !== 'string') return '';
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const kept = raw
    .split('&')
    .filter((pair) => pair.length > 0 && pair.split('=')[0] !== TOKEN_FRAGMENT_KEY);
  return kept.length === 0 ? '' : `#${kept.join('&')}`;
}

/**
 * The token for this session: the fragment if the gate supplied one, otherwise whatever was
 * stored last time.
 *
 * Storage is what makes the `minClientBuild` hard reload survivable. That reload navigates to
 * the address bar's URL, which by then has had the fragment stripped — so without a stored
 * copy the wall would come back credential-less and render the offline card forever, which is
 * a worse outcome than the stale bundle the reload was fixing.
 *
 * A wiped Chromium profile loses the store, and that is fine: the profile wipe is followed by
 * a load of the gate, and the gate supplies the fragment again. Nothing has to be re-entered
 * by a human, which is the acceptance criterion (build-plan §5, step 5).
 */
export function resolveDeviceToken(
  hash: string | null | undefined,
  store: KeyValueStore | null,
): string | null {
  const fromHash = tokenFromHash(hash);
  if (fromHash !== null) {
    try {
      store?.setItem(TOKEN_STORAGE_KEY, fromHash);
    } catch {
      // A full or disabled storage costs persistence across a reload, never this boot.
    }
    return fromHash;
  }
  try {
    const stored = store?.getItem(TOKEN_STORAGE_KEY) ?? null;
    return stored !== null && stored.length > 0 ? stored : null;
  } catch {
    return null;
  }
}

/** `Authorization` and the build header, for every wall request. */
export function wallHeaders(
  token: string | null,
  clientBuildHeader: string,
  clientBuild: number,
): Record<string, string> {
  const headers: Record<string, string> = { [clientBuildHeader]: String(clientBuild) };
  if (token !== null && token.length > 0) headers['authorization'] = `Device ${token}`;
  return headers;
}
