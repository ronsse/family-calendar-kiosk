/**
 * Unit I — reading the event stream, by hand.
 *
 * ## Why not `EventSource`
 *
 * Because `EventSource` cannot send a header, and `/api/wall/v1/stream` requires
 * `Authorization: Device <token>`. The alternatives were to move the credential into the query
 * string — where it lands in every access log and in Chromium's history — or to weaken the
 * wall surface to an IP allowlist, which docs/api.md rejects outright (a renewed DHCP lease
 * 403s every read, and the released address is handed to a guest phone). So the stream is read
 * off `fetch` with a real header, and this file is the wire format that `EventSource` would
 * otherwise have implemented.
 *
 * Doing it by hand also buys the reconnect policy back: `EventSource` retries on a schedule it
 * does not expose, and "never leave the wall without a refresh path" is not a property you can
 * assert about a black box.
 *
 * ## The format, exactly as Unit F emits it
 *
 * Every message is a DEFAULT event — no `event:` name line — whose `data` is one `WallEvent`
 * JSON object. `id:` and `retry:` appear and are ignored here: ids are not resumed (the client
 * refetches the whole snapshot on reconnect, so there is nothing to replay) and the retry
 * interval is this bundle's decision, not the server's.
 */

import type { Utc, WallEvent } from '../../../src/types.ts';

export interface SseDecoder {
  /** Feeds a chunk of decoded text in; returns every COMPLETE `data` payload it completed. */
  push(chunk: string): string[];
}

/**
 * A line-oriented decoder that survives arbitrary chunk boundaries.
 *
 * This matters more than it looks: a 60-byte heartbeat can arrive split across two TCP reads,
 * and a decoder that assumed whole messages would drop the invalidation that follows it. The
 * wall would then be a stream that is open, quiet, and useless.
 */
export function createSseDecoder(): SseDecoder {
  let buffer = '';
  let data: string[] = [];

  function dispatch(out: string[]): void {
    if (data.length === 0) return;
    out.push(data.join('\n'));
    data = [];
  }

  return {
    push(chunk: string): string[] {
      const out: string[] = [];
      // Normalise the three line terminators the spec allows before splitting, so a server or
      // proxy that emits CRLF does not leave a stray CR glued to every payload.
      buffer += chunk.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

      let index = buffer.indexOf('\n');
      while (index !== -1) {
        const line = buffer.slice(0, index);
        buffer = buffer.slice(index + 1);

        if (line.length === 0) {
          dispatch(out);
        } else if (!line.startsWith(':')) {
          const colon = line.indexOf(':');
          const field = colon === -1 ? line : line.slice(0, colon);
          let value = colon === -1 ? '' : line.slice(colon + 1);
          if (value.startsWith(' ')) value = value.slice(1);
          if (field === 'data') data.push(value);
          // `event`, `id` and `retry` are deliberately dropped — see the header note.
        }

        index = buffer.indexOf('\n');
      }
      return out;
    },
  };
}

/**
 * A payload turned into a `WallEvent`, or `null`.
 *
 * Never throws and never guesses. An unrecognised `type` is dropped rather than coerced: this
 * channel exists only to say "refetch", so a message the bundle does not understand costs
 * nothing, while a message it MISREADS could suppress the refetch that a message it understood
 * would have caused.
 */
export function parseWallEvent(payload: string): WallEvent | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  const type = record['type'];

  if (type === 'invalidate') {
    const scope = record['scope'];
    const known = scope === 'all' || scope === 'chores' || scope === 'routines'
      || scope === 'ledger' || scope === 'calendar' || scope === 'dog';
    // An unknown scope still means "something changed". Widening it to `all` is safe by
    // construction: the client refetches the whole snapshot for every scope anyway.
    return { type: 'invalidate', scope: known ? scope : 'all' };
  }

  if (type === 'heartbeat') {
    const generatedAtUtc = record['generatedAtUtc'];
    const minClientBuild = record['minClientBuild'];
    if (typeof generatedAtUtc !== 'string') return null;
    if (typeof minClientBuild !== 'number' || !Number.isFinite(minClientBuild)) return null;
    return { type: 'heartbeat', generatedAtUtc: generatedAtUtc as Utc, minClientBuild };
  }

  return null;
}
