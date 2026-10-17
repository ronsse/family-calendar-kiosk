/**
 * Unit I — the bundle's entry point.
 *
 * Small on purpose. Everything interesting is in `data/` and `app/`; this is only the mount,
 * plus the two things that must be true of a page that is never reloaded for months:
 *
 *  - **No `StrictMode`.** It double-invokes effects in development, which here means two
 *    controllers, two open streams and two heartbeat timers. The thing it is there to catch —
 *    an effect that is not idempotent — is caught instead by `controller.start()` being a
 *    no-op when already running, and the cost of getting it wrong on a wall is a duplicated
 *    connection that nobody is watching.
 *  - **The mount never throws.** If the root element is missing, we make one rather than
 *    letting an exception leave Chromium on a blank document. There is no adult to read a
 *    console at 6:00 AM.
 */

import { createRoot } from 'react-dom/client';
import { WallRoot } from './data/WallRoot.tsx';

/**
 * The DOM, described narrowly. `tsconfig.json` builds this project with `lib: ["es2023"]`
 * because the same pass covers `src/**`, where `document` being a valid identifier would make
 * a real bug compile. See `web/src/data/browser.ts` for the same reasoning at length.
 */
interface MountPoint {
  setAttribute(name: string, value: string): void;
}

interface MinimalDocument {
  getElementById(id: string): MountPoint | null;
  createElement(tag: string): MountPoint;
  body: { appendChild(node: MountPoint): void };
}

const doc = (globalThis as unknown as { document: MinimalDocument }).document;

let host = doc.getElementById('wall');
if (host === null) {
  host = doc.createElement('div');
  host.setAttribute('id', 'wall');
  doc.body.appendChild(host);
}

createRoot(host as unknown as Parameters<typeof createRoot>[0]).render(<WallRoot />);
