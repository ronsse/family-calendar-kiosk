/**
 * Unit I — the browser, described narrowly enough that `tsc` never needs the DOM lib.
 *
 * `tsconfig.json` builds this project with `lib: ["es2023"]` and `types: ["node"]`, and that
 * is not an oversight to route around: the same compiler pass covers the server, and pulling
 * `lib.dom` in would make `document`, `localStorage` and `window` valid identifiers in
 * `src/**` — where reaching for one is a bug that currently does not compile.
 *
 * So the handful of browser surfaces this bundle actually touches are declared here as
 * structural types and reached through `globalThis`. Everything below is also injectable,
 * which is what lets the whole data layer be tested in Node with no DOM at all.
 */

import {
  TOKEN_FRAGMENT_KEY,
  TOKEN_STORAGE_KEY,
  hashWithoutToken,
  resolveDeviceToken,
  type KeyValueStore,
} from './device.ts';

export interface BrowserLocation {
  readonly href: string;
  readonly pathname: string;
  readonly search: string;
  hash: string;
  reload(): void;
}

export interface BrowserHistory {
  replaceState(data: unknown, unused: string, url?: string): void;
}

export interface BrowserWindow {
  location: BrowserLocation;
  history: BrowserHistory;
  localStorage?: KeyValueStore | undefined;
}

/** The real window, or null when this module is loaded in Node (tests, SSR, a type check). */
export function browserWindow(): BrowserWindow | null {
  const g = globalThis as unknown as { window?: BrowserWindow };
  const w = g.window;
  return w !== undefined && w !== null && typeof w === 'object' ? w : null;
}

/** `localStorage`, wrapped so a disabled or full store is a null rather than a throw. */
export function safeStorage(win: BrowserWindow | null): KeyValueStore | null {
  if (win === null) return null;
  try {
    const store = win.localStorage;
    if (store === undefined || store === null) return null;
    // Prove it works before handing it out: Chromium exposes `localStorage` and then throws
    // on access when storage is disabled or the quota is gone.
    store.getItem(TOKEN_STORAGE_KEY);
    return store;
  } catch {
    return null;
  }
}

/**
 * Lifts the device token out of the URL fragment, stores it, and scrubs the address bar.
 *
 * `history.replaceState`, never `location.reload()`. CLAUDE.md records the reload trap this
 * repo already paid for once: HA's `trusted_networks` callback carried a single-use code, a
 * reload discarded it, and the frontend hung forever on "Unable to connect to Home Assistant".
 * `replaceState` rewrites the address without a navigation, so nothing in flight is lost —
 * and the token is in storage before the rewrite, so nothing is lost by the scrub either.
 */
export function claimDeviceToken(win: BrowserWindow | null, store: KeyValueStore | null): string | null {
  if (win === null) return resolveDeviceToken(null, store);

  const hash = win.location.hash;
  const token = resolveDeviceToken(hash, store);

  if (token !== null && hash.includes(`${TOKEN_FRAGMENT_KEY}=`)) {
    const remainder = hashWithoutToken(hash);
    try {
      win.history.replaceState(null, '', `${win.location.pathname}${win.location.search}${remainder}`);
    } catch {
      // Cosmetic only. A credential visible in an address bar nobody can see, on a kiosk with
      // no URL bar, is not worth failing the boot over.
    }
  }
  return token;
}

/** The only `location.reload()` in the bundle. Guarded by `shouldHardReload` at every call. */
export function hardReload(win: BrowserWindow | null): void {
  try {
    win?.location.reload();
  } catch {
    /* nothing sensible left to do */
  }
}
