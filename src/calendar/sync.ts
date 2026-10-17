/**
 * Unit B - calendar sync: stage into a new generation, validate, promote atomically.
 *
 * This module is implementation-agnostic. It takes a `CalendarSource` and never learns
 * which one it has: no entity ids, no URLs, no wire shapes. `external_ref` is read out of
 * the database and handed straight back to the adapter without being parsed (ADR-0004).
 *
 * ## The shape of the algorithm IS the contract (H3 finding #7)
 *
 * The failure being designed against is concrete. `DELETE FROM calendar_event WHERE
 * source_id = ?` followed by inserts, and the upstream 429s halfway. The table is now
 * empty or partial. Rendering has no cloud dependency, so it faithfully displays the
 * poisoned local state as "no events today" - never an error, on a wall nobody is watching
 * at 06:00.
 *
 * So:
 *
 *  1. Open a `sync_run` in state `running` and COMMIT IT IMMEDIATELY. A crash, a 500 or a
 *     timeout after this point leaves a durable record of the attempt. A run opened inside
 *     the same transaction as the writes would vanish with them, and a failed sync would
 *     be indistinguishable from a sync that never ran.
 *  2. Fetch OUTSIDE any transaction. `better-sqlite3` is synchronous; a write transaction
 *     held across an `await` blocks every reader for the duration of a network call
 *     (H3 finding #8).
 *  3. Stage the events, mark the run `complete`, mark it `promoted`, and repoint
 *     `calendar_source.current_sync_run_id` - all in ONE immediate transaction. Readers
 *     join through that pointer, so they see the old generation or the new one and never a
 *     mix. Nothing is ever deleted to make room.
 *  4. On any failure, mark the run `failed` with the error and leave the promoted
 *     generation exactly where it was. Yesterday's schedule, still on the wall, is a
 *     success by the prime invariant: stale is acceptable, wrong is not.
 *
 * ## On errors as values
 *
 * `syncSource` does NOT throw when the upstream fails - it records the failure and returns
 * it. A throw would abort `syncAllSources` partway, so one unreachable calendar would stop
 * the other six from refreshing. The failure is durable in `sync_run` either way, and the
 * wall renders it through `Freshness.calendarSyncAgeSeconds`. Programmer errors (an
 * unknown source id, a corrupt row) still throw.
 */

import type { Database as Db } from 'better-sqlite3';
import { inTransaction } from '../db/connection.ts';
import { fallbackCategories, resolveAsset } from '../db/repo.ts';
import { classifyEventTitle, eventEmoji, isEventCategory } from './classify.ts';
import { isLocalDate, nowUtc } from '../time.ts';
import type { CalendarEventView, EventWhen, Utc } from '../types.ts';
import type { CalendarSource, FetchedEvent, FetchWindow } from './CalendarSource.ts';

/** Fallback icon category for an event the upstream gave no category for. */
export const DEFAULT_EVENT_CATEGORY = 'calendar';

/** Generations retained per source, newest first, on top of the promoted one. */
export const DEFAULT_RETAINED_GENERATIONS = 3;

export interface SyncSuccess {
  ok: true;
  sourceId: string;
  syncRunId: number;
  eventCount: number;
  /** Superseded generations deleted afterwards (H1 outstanding: retention). */
  pruned: number;
}

export interface SyncFailure {
  ok: false;
  sourceId: string;
  syncRunId: number;
  /** Safe to persist and to show: adapters keep host, token and entity id out of it. */
  error: string;
}

export type SyncResult = SyncSuccess | SyncFailure;

export interface SyncOptions {
  window: FetchWindow;
  /** Generations kept per source. 0 keeps only the promoted one. */
  retain?: number;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

interface SourceRow {
  id: string;
  external_ref: string;
  included: number;
  event_filter: string;
  keep_terms: string | null;
}

/**
 * Does `title` contain any of `terms` as a whole phrase?
 *
 * Whole-word on both ends, which is what keeps "grade 1" off "Grade 10" and off "Grades K&1".
 * Whitespace is collapsed first, because a subscribed feed's titles are typed by people and
 * arrive with double spaces and trailing spaces in them.
 */
export function matchesKeepTerms(title: string, terms: string | null | undefined): boolean {
  if (terms === null || terms === undefined) return false;
  const haystack = title.replace(/\s+/g, ' ').trim().toLowerCase();
  for (const raw of terms.split(',')) {
    const term = raw.replace(/\s+/g, ' ').trim().toLowerCase();
    if (term.length === 0) continue;
    // Escaped, because these come from a config column and a stray `(` would otherwise throw
    // inside the sync — turning a typo into a failed generation instead of a term that misses.
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`(?<![\\w])${escaped}(?![\\w])`, 'i').test(haystack)) return true;
  }
  return false;
}

/**
 * Drops the events a source's `event_filter` says the wall should not carry.
 *
 * Applied HERE, between the fetch and the staging transaction, so the filtered events never
 * enter a generation at all. That is the important half: a source filtered at RENDER time
 * would still have written every club and PTA meeting into `calendar_event`, and the next
 * screen that read the table without applying the same rule would show them again.
 *
 * `all_day_only` keeps the all-day entries and drops the timed ones. On a subscribed school
 * feed that is precisely the household's rule — "days off, no school, test days, half days,
 * picture days; remove all regularly scheduled days during the school day" — because a day
 * that is CANCELLED or RESHAPED is written as an all-day entry and a thing that happens
 * inside an ordinary school day is written with a time. Jefferson County's 132 series split
 * 21/44 that way with no exceptions.
 *
 * A structural test rather than a keyword list, and that is the point: it does not rot when
 * the district renames Chess Club, and it needs no vocabulary maintained against a feed
 * nobody here controls.
 */
export function applyEventFilter(
  events: readonly FetchedEvent[],
  filter: string,
  keepTerms: string | null = null,
): readonly FetchedEvent[] {
  // Unknown filters keep everything. A typo in a config column must not silently empty a
  // calendar — an empty wall looks exactly like a calendar with nothing on it.
  if (filter !== 'all_day_only') return events;
  // `keep_terms` readmits what the filter would have dropped. On the school feed that is the
  // eight first-grade outings — the zoo, the planetarium, a regional arts centre, a picnic — which
  // are precisely the things the seven-year-old counts down to, and which are timed because
  // they happen during the school day like everything else the filter is there to remove.
  return events.filter((e) => e.when.kind === 'allDay' || matchesKeepTerms(e.title, keepTerms));
}

function requireSource(db: Db, sourceId: string): SourceRow {
  const row = db
    .prepare(
      `SELECT id, external_ref, included, event_filter, keep_terms FROM calendar_source WHERE id = ?`,
    )
    .get(sourceId) as SourceRow | undefined;
  if (!row) throw new Error(`no calendar_source ${sourceId}`);
  return row;
}

/** Step 1. Committed on its own so the attempt survives whatever happens next. */
export function openSyncRun(db: Db, sourceId: string): number {
  const info = db
    .prepare(`INSERT INTO sync_run (source_id, state, started_at_utc) VALUES (?, 'running', ?)`)
    .run(sourceId, nowUtc());
  return Number(info.lastInsertRowid);
}

/** Step 4. Never touches `calendar_source`, so the promoted generation is untouched. */
export function failSyncRun(db: Db, syncRunId: number, error: string): void {
  db.prepare(
    `UPDATE sync_run SET state = 'failed', completed_at_utc = ?, error = ?
      WHERE id = ? AND state = 'running'`,
  ).run(nowUtc(), error.slice(0, 2000), syncRunId);
}

/**
 * Step 3. Stage, validate, promote - one transaction, one visible step.
 *
 * The order inside the transaction is forced by the schema: `trg_promote_must_be_promoted`
 * refuses a `current_sync_run_id` that is not already a `promoted` run of that same source,
 * so the run's own state must be advanced before the pointer moves.
 *
 * Every insert is checked. `UNIQUE(sync_run_id, external_uid)` and the discriminated-union
 * CHECK on `calendar_event` are the last line of defence against a generation that would
 * render an event twice or on the wrong day; a violation must abort the whole generation,
 * not be caught and skipped.
 */
export function stageAndPromote(
  db: Db,
  sourceId: string,
  syncRunId: number,
  events: readonly FetchedEvent[],
): number {
  return inTransaction(db, () => {
    const insert = db.prepare(
      `INSERT INTO calendar_event
         (sync_run_id, source_id, external_uid, title,
          starts_at_utc, ends_at_utc, all_day_start_date, all_day_end_date, icon_asset_id,
          emoji, category)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    // Which categories actually have art, read once. A DERIVED category with no icon of its
    // own would otherwise walk the chain past `calendar` to the `_default` question mark,
    // which is a worse picture than the one every event draws today - so the classifier's
    // vocabulary is allowed to name categories before anybody has drawn them.
    const illustrated = fallbackCategories(db);

    let staged = 0;
    for (const event of events) {
      // The upstream's own category wins if it ever supplies one; today none does, which is
      // why every event drew the same glyph. The title is the only signal there is, and it is
      // read HERE, at sync time, exactly once per event per generation - never at render.
      const derived = event.category ?? classifyEventTitle(event.title);
      const category =
        derived !== null && illustrated.has(derived) ? derived : DEFAULT_EVENT_CATEGORY;
      const icon = resolveAsset(db, null, category);
      // The second channel, resolved from the same title at the same moment and by the same
      // matcher. Finer than the category on purpose — an emoji costs nothing to add, which is
      // the whole constraint that kept `sport` from being split (classify.ts). `null` for a
      // title the table does not know, which draws nothing.
      const emoji = eventEmoji(event.title);
      // A timed event carries instants and NO dates; an all-day event carries floating
      // dates and NO instant. Never both - storing all-day as a UTC midnight is what puts
      // an event on two local days (H3 finding #5). The schema's CHECK enforces it too.
      const when = event.when;
      const info = insert.run(
        syncRunId,
        sourceId,
        event.externalUid,
        event.title,
        when.kind === 'timed' ? when.startsAtUtc : null,
        when.kind === 'timed' ? when.endsAtUtc : null,
        when.kind === 'allDay' ? when.startDate : null,
        when.kind === 'allDay' ? when.endDate : null,
        icon.assetId,
        emoji,
        // The DERIVED category, not the illustrated one: the leave-by rules choose events by
        // what they are about, and a dance class is a dance class before anyone draws it.
        derived,
      );
      staged += info.changes;
    }

    // A staged generation smaller than what was fetched is the exact shape of the bug
    // this whole module exists to prevent, so it is checked rather than assumed.
    if (staged !== events.length) {
      throw new Error(`staged ${staged} of ${events.length} events - refusing to promote`);
    }

    const at = nowUtc();
    db.prepare(
      `UPDATE sync_run SET state = 'complete', completed_at_utc = ?, event_count = ?
        WHERE id = ? AND state = 'running'`,
    ).run(at, staged, syncRunId);
    const promoted = db
      .prepare(`UPDATE sync_run SET state = 'promoted', promoted_at_utc = ? WHERE id = ? AND state = 'complete'`)
      .run(at, syncRunId);
    if (promoted.changes !== 1) {
      throw new Error(`sync run ${syncRunId} did not reach state 'complete' - refusing to promote`);
    }

    db.prepare(`UPDATE calendar_source SET current_sync_run_id = ? WHERE id = ?`).run(
      syncRunId,
      sourceId,
    );

    return staged;
  });
}

/**
 * Syncs one source. Returns the outcome; throws only on programmer error.
 *
 * An empty result IS promoted. The adapter contract requires it to throw rather than
 * return a short list, so a successfully-parsed empty array means the upstream really has
 * no events in the window - a child with a clear week - and freezing the previous
 * generation over it would be its own kind of wrong.
 */
export async function syncSource(
  db: Db,
  adapter: CalendarSource,
  sourceId: string,
  options: SyncOptions,
): Promise<SyncResult> {
  const source = requireSource(db, sourceId);
  const syncRunId = openSyncRun(db, sourceId);

  let events: FetchedEvent[];
  try {
    // Outside every transaction, by design. See the header note on H3 finding #8.
    events = await adapter.fetchEvents(source.external_ref, options.window);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    failSyncRun(db, syncRunId, error);
    return { ok: false, sourceId, syncRunId, error };
  }

  const kept = applyEventFilter(events, source.event_filter, source.keep_terms);

  let eventCount: number;
  try {
    eventCount = stageAndPromote(db, sourceId, syncRunId, kept);
  } catch (cause) {
    const error = cause instanceof Error ? cause.message : String(cause);
    // The staging transaction rolled back in full, so there is nothing to clean up and
    // `calendar_source.current_sync_run_id` still points at the last good generation.
    failSyncRun(db, syncRunId, error);
    return { ok: false, sourceId, syncRunId, error };
  }

  // Retention is housekeeping and runs AFTER the wall is already showing the new
  // generation. It must never be able to turn a promotion that succeeded into a reported
  // failure: `sync_run` would say `promoted` while the caller was told the sync failed,
  // and the two would disagree about what is on the screen.
  let pruned = 0;
  try {
    pruned = pruneSyncRuns(db, sourceId, options.retain ?? DEFAULT_RETAINED_GENERATIONS);
  } catch {
    pruned = 0;
  }
  return { ok: true, sourceId, syncRunId, eventCount, pruned };
}

/**
 * Syncs every included source, one after another.
 *
 * Sequential on purpose: `better-sqlite3` is synchronous, and seven parallel promotions
 * would serialise on the write lock anyway while holding seven sockets open. One failure
 * never stops the rest - that is why `syncSource` returns its error instead of throwing.
 */
export async function syncAllSources(
  db: Db,
  adapter: CalendarSource,
  options: SyncOptions,
): Promise<SyncResult[]> {
  const ids = db
    .prepare(`SELECT id FROM calendar_source WHERE included = 1 ORDER BY id`)
    .all() as { id: string }[];
  const results: SyncResult[] = [];
  for (const { id } of ids) results.push(await syncSource(db, adapter, id, options));
  return results;
}

/**
 * Deletes superseded generations, keeping the promoted one plus the newest `keep`.
 *
 * H1 left retention unowned: nothing pruned `sync_run`, so every sync appended a full
 * generation forever, on a disk whose filling is its own blank-wall failure mode. The
 * promoted run is excluded explicitly as well as being protected by the composite foreign
 * key; `calendar_event` cascades, which is why this is a single statement.
 */
export function pruneSyncRuns(db: Db, sourceId: string, keep: number): number {
  const info = db
    .prepare(
      `DELETE FROM sync_run
        WHERE source_id = :sourceId
          AND id IS NOT (SELECT current_sync_run_id FROM calendar_source WHERE id = :sourceId)
          AND id NOT IN (
            SELECT id FROM sync_run WHERE source_id = :sourceId
             ORDER BY started_at_utc DESC, id DESC LIMIT :keep
          )`,
    )
    .run({ sourceId, keep: Math.max(0, keep) });
  return info.changes;
}

// ---------------------------------------------------------------------------
// Reading the promoted generation
// ---------------------------------------------------------------------------

interface EventRow {
  id: number;
  source_id: string;
  title: string;
  starts_at_utc: string | null;
  ends_at_utc: string | null;
  all_day_start_date: string | null;
  all_day_end_date: string | null;
  icon_asset_id: string;
  emoji: string | null;
  category: string | null;
  colour_token: string;
  child_id: string | null;
}

export interface ReadOptions {
  /** One source, or every included source when omitted. */
  sourceId?: string;
  /** Include sources flagged `included = 0`. Off by default. */
  includeExcluded?: boolean;
}

/**
 * The events the wall should render: the promoted generation, and only that.
 *
 * The join is through `calendar_source.current_sync_run_id`, which is the whole point.
 * Staged generations sit in the same table and are invisible here until a single UPDATE
 * makes them current, so there is no window in which a half-written sync can be read.
 */
export function listPromotedEvents(db: Db, options: ReadOptions = {}): CalendarEventView[] {
  const rows = db
    .prepare(
      `SELECT ce.id, ce.source_id, ce.title,
              ce.starts_at_utc, ce.ends_at_utc,
              ce.all_day_start_date, ce.all_day_end_date,
              ce.icon_asset_id, ce.emoji, ce.category, cs.colour_token, cs.child_id
         FROM calendar_source cs
         JOIN calendar_event ce
           ON ce.sync_run_id = cs.current_sync_run_id
          AND ce.source_id   = cs.id
        WHERE cs.current_sync_run_id IS NOT NULL
          AND (:sourceId IS NULL OR cs.id = :sourceId)
          AND (:includeExcluded = 1 OR cs.included = 1)
        -- A STABLE, ROUGHLY CHRONOLOGICAL PRE-SORT. Not the ranking, and callers must not
        -- treat it as one: SQLite cannot convert an instant to a household-local date
        -- without a fixed UTC offset, which DST makes wrong twice a year (H3 finding #6).
        -- Comparing the two columns as text does most of the job — 'YYYY-MM-DD' sorts
        -- before 'YYYY-MM-DDTHH:MM' of the same day, so an all-day event leads its own day —
        -- but a Denver evening carries the NEXT UTC date and would sort a day late.
        -- Ranking is upcomingEvents() in web/src/views/logic/summary.ts, on the client's own
        -- clock. Until 2026-08-25 this clause read "all_day_start_date IS NULL" FIRST, which
        -- put every all-day event in the window ahead of every timed one; the wall showed a
        -- birthday two months out and never showed that afternoon's appointments.
        ORDER BY COALESCE(ce.all_day_start_date, ce.starts_at_utc),
                 ce.id`,
    )
    .all({
      sourceId: options.sourceId ?? null,
      includeExcluded: options.includeExcluded ? 1 : 0,
    }) as EventRow[];

  return rows.map((row) => ({
    id: row.id,
    title: row.title,
    when: whenFromRow(row),
    sourceId: row.source_id,
    colourToken: row.colour_token,
    childId: row.child_id,
    icon: resolveAsset(db, row.icon_asset_id, DEFAULT_EVENT_CATEGORY),
    emoji: row.emoji,
    category: isEventCategory(row.category) ? row.category : null,
  }));
}

/**
 * The schema's CHECK already guarantees exactly one arm of the union, so this cannot fail
 * on a database written through the migration - which is why a failure here is reported as
 * corruption rather than papered over. `EventWhen` has no third arm to fall back to, and
 * the snapshot mapper throwing while building the wall's only read is a blank wall
 * (H1 finding #1).
 */
function whenFromRow(row: EventRow): EventWhen {
  if (row.starts_at_utc !== null) {
    if (row.ends_at_utc === null) throw new Error(`calendar_event ${row.id} has no end instant`);
    return {
      kind: 'timed',
      startsAtUtc: row.starts_at_utc as Utc,
      endsAtUtc: row.ends_at_utc as Utc,
    };
  }
  const { all_day_start_date: start, all_day_end_date: end } = row;
  if (start === null || end === null) {
    throw new Error(`calendar_event ${row.id} is neither timed nor all-day`);
  }
  if (!isLocalDate(start) || !isLocalDate(end)) {
    throw new Error(`calendar_event ${row.id} holds a malformed all-day date`);
  }
  return { kind: 'allDay', startDate: start, endDate: end };
}

/** The id of the generation currently on the wall for a source, or null. */
export function promotedSyncRunId(db: Db, sourceId: string): number | null {
  const row = db
    .prepare(`SELECT current_sync_run_id AS id FROM calendar_source WHERE id = ?`)
    .get(sourceId) as { id: number | null } | undefined;
  return row?.id ?? null;
}

/**
 * How each included calendar's last fetch went, for the grown-up Settings screen.
 *
 * Built from four columns and nothing else: the source's `label`, and the latest run's `state`
 * and two timestamps. **Never `external_ref`** — the adapter's handle, an entity id or a secret
 * iCal address, which nothing outside `src/calendar/<impl>/` may read (ADR-0004) — and **never
 * `sync_run.error`**, whose text is the upstream's own words and can quote a URL. An event title
 * never appears either: this is about the pipe, not what came down it.
 *
 * `last` is the LATEST attempt, so a calendar that worked yesterday and failed this morning reads
 * `failed` with yesterday's `goodAtUtc` — which is exactly the frozen-copy story the wall's stale
 * label tells, said per calendar.
 */
export type CalendarFetchState = 'ok' | 'failed' | 'running' | 'never';

export interface CalendarSourceHealth {
  readonly label: string;
  readonly last: CalendarFetchState;
  /** When the latest attempt finished, or started while it is still running. Null if never tried. */
  readonly triedAtUtc: Utc | null;
  /** When the generation on the wall now was promoted. Null if nothing has ever arrived. */
  readonly goodAtUtc: Utc | null;
}

export function calendarHealth(db: Db): CalendarSourceHealth[] {
  const rows = db
    .prepare(
      `SELECT cs.label,
              (SELECT sr.state FROM sync_run sr WHERE sr.source_id = cs.id
                ORDER BY sr.started_at_utc DESC, sr.id DESC LIMIT 1) AS last_state,
              (SELECT COALESCE(sr.completed_at_utc, sr.started_at_utc) FROM sync_run sr
                WHERE sr.source_id = cs.id
                ORDER BY sr.started_at_utc DESC, sr.id DESC LIMIT 1) AS tried_at,
              (SELECT sr.promoted_at_utc FROM sync_run sr
                WHERE sr.id = cs.current_sync_run_id AND sr.source_id = cs.id) AS good_at
         FROM calendar_source cs
        WHERE cs.included = 1
        ORDER BY cs.label, cs.id`,
    )
    .all() as { label: string; last_state: string | null; tried_at: string | null; good_at: string | null }[];
  return rows.map((r) => ({
    label: r.label,
    last:
      r.last_state === null
        ? 'never'
        : r.last_state === 'failed'
          ? 'failed'
          : r.last_state === 'running'
            ? 'running'
            : 'ok',
    triedAtUtc: (r.tried_at ?? null) as Utc | null,
    goodAtUtc: (r.good_at ?? null) as Utc | null,
  }));
}

/**
 * Age of the STALEST promoted generation across included sources, for `Freshness`.
 *
 * The oldest, not the newest: six fresh calendars and one frozen one is a stale wall, and
 * the whole point of the freshness fields is that stale-but-labelled satisfies the prime
 * invariant while stale-and-confident does not (H3 finding #10). Null when nothing has
 * ever been promoted.
 */
/**
 * Does this household expect a calendar at all?
 *
 * The distinction matters because `promotedSyncAgeSeconds` returns null for two situations
 * that are not remotely alike: "configured and never synced" (genuinely stale — an adult
 * asked for these calendars and they are not arriving) and "nobody configured a calendar"
 * (nothing is owed, nothing is late). Collapsing them made the wall permanently display
 * "Showing older information", and a badge that is always lit is a badge nobody reads —
 * which costs exactly the signal H2 gap #3 exists to preserve.
 */
export function calendarIsConfigured(db: Db): boolean {
  const row = db
    .prepare(`SELECT COUNT(*) AS n FROM calendar_source WHERE included = 1`)
    .get() as { n: number };
  return row.n > 0;
}

export function promotedSyncAgeSeconds(db: Db, now: Date = new Date()): number | null {
  const row = db
    .prepare(
      `SELECT MIN(sr.promoted_at_utc) AS oldest
         FROM calendar_source cs
         JOIN sync_run sr ON sr.id = cs.current_sync_run_id AND sr.source_id = cs.id
        WHERE cs.included = 1 AND sr.promoted_at_utc IS NOT NULL`,
    )
    .get() as { oldest: string | null } | undefined;
  if (!row?.oldest) return null;
  const at = Date.parse(row.oldest);
  if (Number.isNaN(at)) return null;
  return Math.max(0, Math.round((now.getTime() - at) / 1000));
}
