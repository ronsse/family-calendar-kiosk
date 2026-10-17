/**
 * Unit B fixtures - a stand-in Home Assistant that serves the recorded JSON beside this
 * file. There is no network in the Unit B suite: `fetchImpl` is injected, so a test that
 * accidentally reaches a real HA would 404 here instead of quietly passing on live data.
 *
 * The recorded bodies are synthetic (build-plan §6): no real names, events or schedules.
 */

import { readFileSync } from 'node:fs';

export function loadFixture(name: string): unknown {
  return JSON.parse(readFileSync(new URL(`./${name}`, import.meta.url), 'utf8')) as unknown;
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export interface FixtureCall {
  path: string;
  start: string | null;
  end: string | null;
  authorization: string | null;
}

/** `attempt` counts calls to this path, so a handler can fail once and then succeed. */
export type FixtureHandler = (call: FixtureCall, attempt: number) => Response;

export interface FixtureServer {
  fetchImpl: typeof globalThis.fetch;
  calls: FixtureCall[];
}

export const TEST_BASE_URL = 'http://ha.invalid:8123';
export const TEST_TOKEN = 'test-token-not-a-real-secret';

export function fixtureServer(handlers: Record<string, FixtureHandler>): FixtureServer {
  const calls: FixtureCall[] = [];
  const attempts = new Map<string, number>();

  const fetchImpl: typeof globalThis.fetch = async (input, init) => {
    const href =
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const url = new URL(href);
    const headers = new Headers(init?.headers);
    const call: FixtureCall = {
      path: url.pathname,
      start: url.searchParams.get('start'),
      end: url.searchParams.get('end'),
      authorization: headers.get('authorization'),
    };
    calls.push(call);

    const attempt = (attempts.get(url.pathname) ?? 0) + 1;
    attempts.set(url.pathname, attempt);

    const handler = handlers[url.pathname];
    if (!handler) {
      // Every served calendar is LIVE unless a test says otherwise. The adapter asks for
      // the state after every fetch, and a test about all-day dates should not have to
      // stub that. A calendar the test did not serve stays a 404.
      const entity = /^\/api\/states\/(calendar\.[A-Za-z0-9_]+)$/.exec(url.pathname)?.[1];
      if (entity !== undefined && handlers[`/api/calendars/${entity}`] !== undefined) {
        return json({ entity_id: entity, state: 'off' });
      }
      return new Response('not found', { status: 404 });
    }
    return handler(call, attempt);
  };

  return { fetchImpl, calls };
}
