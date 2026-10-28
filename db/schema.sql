-- family-calendar — Phase 0 contract: the schema.
--
-- FROZEN 2026-08-24 (H1 review passed, 16 findings closed). Nothing in Phase 1+ may
-- alter this file; a change here is a stop-the-world event (build-plan.md §1).
--
-- Conventions, applied without exception:
--   * `*_utc`   TEXT, ISO-8601 UTC instant  ("2026-08-24T13:05:00Z")
--   * `*_date`  TEXT, floating LOCAL date   ("2026-08-24"), America/Denver, no instant
--   * `*_local` TEXT, floating LOCAL time   ("06:30")
--   Never store a local date as an instant. Never step a date by 24h of UTC.
--   Booleans are INTEGER 0/1 with a CHECK. All tables STRICT.

-- WARNING: `PRAGMA foreign_keys` is PER-CONNECTION and is NOT persisted by running this
-- file. Every connection the application opens must set it, or every FK below is silently
-- unenforced. Unit A owns that; it is asserted in db/verify-schema.py. (H1 lens 4.)
PRAGMA foreign_keys = ON;
PRAGMA journal_mode = WAL;

-- ---------------------------------------------------------------------------
-- Household
-- ---------------------------------------------------------------------------

-- Single source of tunables. `cents_per_point` lives here and is household-wide,
-- NOT per child (H2 Q2): differing rates make one balance mean different things to
-- siblings and create arbitrage on shared chores.
CREATE TABLE household_config (
  key        TEXT PRIMARY KEY,
  value_text TEXT NOT NULL
) STRICT;

-- Every renderable image. Assets are resolved and validated BEFORE activation, never
-- fetched hopefully at render time (H2 gap #1: for a pre-reader a missing icon is a
-- blank screen).
CREATE TABLE asset (
  id               TEXT PRIMARY KEY,
  kind             TEXT NOT NULL CHECK (kind IN ('icon','illustration','avatar')),
  category         TEXT NOT NULL,           -- drives the fallback lookup below
  rel_path         TEXT NOT NULL UNIQUE,    -- relative to the served asset root
  validated_at_utc TEXT                     -- NULL = unvalidated; see rule below
) STRICT;

-- The guaranteed terminal fallback per category. Resolution order at snapshot time:
--   explicit asset -> asset_fallback[category] -> asset_fallback['_default']
-- The '_default' row is mandatory and its asset must be validated. This chain is
-- resolved when a snapshot row is written, so the render path can never miss.
CREATE TABLE asset_fallback (
  category TEXT PRIMARY KEY,
  asset_id TEXT NOT NULL REFERENCES asset(id)
) STRICT;

-- REFERENCES proves the asset row exists, not that its file was ever validated. A
-- fallback pointing at an unvalidated asset resolves to an empty URL, which for the
-- pre-reader is a blank screen — the exact failure the chain exists to prevent (H1 lens 4).
CREATE TRIGGER trg_fallback_asset_validated_ins
BEFORE INSERT ON asset_fallback
BEGIN
  SELECT RAISE(ABORT, 'fallback asset must be validated')
  WHERE NOT EXISTS (SELECT 1 FROM asset
                    WHERE id = NEW.asset_id AND validated_at_utc IS NOT NULL);
END;

CREATE TRIGGER trg_fallback_asset_validated_upd
BEFORE UPDATE OF asset_id ON asset_fallback
BEGIN
  SELECT RAISE(ABORT, 'fallback asset must be validated')
  WHERE NOT EXISTS (SELECT 1 FROM asset
                    WHERE id = NEW.asset_id AND validated_at_utc IS NOT NULL);
END;

-- The terminal '_default' row is what makes the chain total. Deleting it, or
-- un-validating the asset it points at, silently re-opens the blank-icon hole.
CREATE TRIGGER trg_fallback_default_undeletable
BEFORE DELETE ON asset_fallback
WHEN OLD.category = '_default'
BEGIN
  SELECT RAISE(ABORT, 'the _default fallback may not be deleted');
END;

CREATE TRIGGER trg_asset_unvalidate_guard
BEFORE UPDATE OF validated_at_utc ON asset
WHEN NEW.validated_at_utc IS NULL AND OLD.validated_at_utc IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'asset is a fallback target and may not be un-validated')
  WHERE EXISTS (SELECT 1 FROM asset_fallback WHERE asset_id = OLD.id);
END;

CREATE TABLE child (
  id              TEXT PRIMARY KEY,
  display_name    TEXT NOT NULL,
  -- Presentation band. Set once by an adult; never inferred, never overridden at
  -- render time. 'picture' = pre-reader, 'emergent' = some words, 'fluent' = reads.
  reading_band    TEXT NOT NULL CHECK (reading_band IN ('picture','emergent','fluent')),
  -- H2 Q2: false for the pre-reader. Chores still run the full state machine; no
  -- ledger row is EVER written. She has a completion history, not a balance.
  ledger_enabled  INTEGER NOT NULL DEFAULT 1 CHECK (ledger_enabled IN (0,1)),
  avatar_asset_id TEXT NOT NULL REFERENCES asset(id),
  sort_order      INTEGER NOT NULL UNIQUE,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;

-- The wall proves it is the wall (PRD §4, H3 finding #3). Never trust an IP: a renewed
-- DHCP lease 403s every read while the screenshot fallback hides it, and the released
-- address can be reassigned to a guest phone.
CREATE TABLE device_token (
  id            TEXT PRIMARY KEY,
  label         TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,       -- hash only; the token itself is never stored
  issued_at_utc TEXT NOT NULL,
  last_seen_utc TEXT,
  revoked_at_utc TEXT
) STRICT;

-- ---------------------------------------------------------------------------
-- Calendar  (H3 finding #7 — stage, then promote atomically)
-- ---------------------------------------------------------------------------

CREATE TABLE calendar_source (
  id                  TEXT PRIMARY KEY,
  label               TEXT NOT NULL,
  -- Adapter-scoped opaque handle. MUST NOT be parsed or interpreted outside
  -- src/calendar/<impl>/ — that boundary is what keeps the Google-direct swap a
  -- config change (ADR-0004).
  external_ref        TEXT NOT NULL UNIQUE,
  child_id            TEXT REFERENCES child(id),   -- NULL = household-wide
  colour_token        TEXT NOT NULL,
  included            INTEGER NOT NULL DEFAULT 1 CHECK (included IN (0,1)),
  -- WHICH of a source's events reach the wall. v7, 2026-09-09.
  --
  --   all           every event the adapter returns. The default, and right for a
  --                 household calendar where somebody chose each entry.
  --   all_day_only  keep the all-day events, drop the timed ones.
  --
  -- `all_day_only` exists for a SUBSCRIBED calendar nobody here curates — a school district
  -- feed. Jefferson County's has 132 series, and the split falls out of the data almost
  -- perfectly: every ALL-DAY entry is a break, a no-school day, an assessment day, a
  -- conference or a picture day, and every TIMED entry is a club, a class, a PTA meeting or a
  -- curriculum night happening inside an ordinary school day. That is the household's own
  -- rule — "days off, no school, test days, half days, picture days; remove all regularly
  -- scheduled days during the school day" — and it is a structural property rather than a
  -- keyword list, so it does not rot when the district renames a club.
  --
  -- It is on the SOURCE and not global because it is a fact about that feed. The family
  -- calendar's timed events are the whole point of it.
  event_filter        TEXT NOT NULL DEFAULT 'all' CHECK (event_filter IN ('all','all_day_only')),
  -- Titles that survive `event_filter` even when it would have dropped them. Comma-separated
  -- phrases, matched whole-word and case-insensitively; NULL or empty means no exception.
  -- v8, 2026-09-09.
  --
  -- The case it exists for: `all_day_only` correctly drops the school feed's 100 timed events,
  -- and 8 of those are the FIRST GRADE's — a zoo trip, the planetarium, a regional arts
  -- centre, a picnic — which are exactly the things a first-grader counts down to.
  -- "grade 1" readmits them and nothing else; it does not match "Grades K&1 Meet Up", and
  -- whole-word matching keeps it off a hypothetical "Grade 10".
  --
  -- THIS GOES STALE EVERY AUGUST. It names a grade, and children move up one. That is why it
  -- is a column and not a constant in the classifier: changing it is re-applying
  -- db/calendars.sql, not a deploy. See docs/runbook.md.
  keep_terms          TEXT,
  -- The promoted generation. Readers join on this; promotion is a single UPDATE and
  -- is therefore atomic. Live rows are NEVER deleted before their replacement exists.
  -- The FK is COMPOSITE: a single-column reference let a source point at ANOTHER source's
  -- generation, rendering one child's calendar as the household's (H1 lens 1).
  current_sync_run_id INTEGER,
  FOREIGN KEY (id, current_sync_run_id) REFERENCES sync_run(source_id, id)
) STRICT;

CREATE TABLE sync_run (
  id               INTEGER PRIMARY KEY,
  source_id        TEXT NOT NULL REFERENCES calendar_source(id),
  state            TEXT NOT NULL CHECK (state IN ('running','complete','failed','promoted')),
  started_at_utc   TEXT NOT NULL,
  completed_at_utc TEXT,
  promoted_at_utc  TEXT,
  event_count      INTEGER,
  error            TEXT,
  -- Parent key for the composite FKs above and below.
  UNIQUE (source_id, id)
) STRICT;
CREATE INDEX ix_sync_run_source ON sync_run(source_id, started_at_utc DESC);

-- A source may only promote a generation that is its own AND actually complete. Without
-- this a half-staged 'running' generation can be promoted and render as authoritative.
CREATE TRIGGER trg_promote_must_be_promoted
BEFORE UPDATE OF current_sync_run_id ON calendar_source
WHEN NEW.current_sync_run_id IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'current_sync_run_id must be a promoted run of this source')
  WHERE NOT EXISTS (
    SELECT 1 FROM sync_run
    WHERE id = NEW.current_sync_run_id AND source_id = NEW.id AND state = 'promoted'
  );
END;

CREATE TABLE calendar_event (
  id               INTEGER PRIMARY KEY,
  sync_run_id      INTEGER NOT NULL REFERENCES sync_run(id) ON DELETE CASCADE,
  source_id        TEXT NOT NULL REFERENCES calendar_source(id),
  external_uid     TEXT NOT NULL,
  title            TEXT NOT NULL,
  -- A timed event carries instants. An all-day event carries floating local dates and
  -- NO instant — storing all-day as UTC midnight is what puts an event on two local
  -- days (H3 finding #5, already visible on the current wall). end is EXCLUSIVE.
  starts_at_utc    TEXT,
  ends_at_utc      TEXT,
  all_day_start_date TEXT,
  all_day_end_date   TEXT,
  icon_asset_id    TEXT NOT NULL REFERENCES asset(id),
  -- The emoji for the children who cannot read the title, resolved from that title at SYNC
  -- time exactly like icon_asset_id and by the same matcher (src/calendar/classify.ts).
  -- NULL is the common case and draws nothing: an emoji that is a guess is worse than no
  -- emoji, because the readers who need it cannot check it against the words. v5, 2026-09-09.
  emoji            TEXT,
  -- What the title is ABOUT, as the classifier derived it (src/calendar/classify.ts) — the
  -- category BEFORE the illustrated-or-not step that decides icon_asset_id, so `dance` is
  -- kept here even while nobody has drawn a dancer. Read by the leave-by rules, which pick
  -- the events worth getting ready for by category and never by title. NULL when the title
  -- matched nothing. v10, 2026-09-15.
  category         TEXT,
  -- The FULL discriminated union. The earlier version constrained only the START columns,
  -- so a timed event with a NULL end, or a reversed interval, was accepted — and neither
  -- can be represented by EventWhen in src/types.ts, so the snapshot mapper would throw
  -- while building the wall's only read. Found independently by two lenses.
  CHECK (
    (starts_at_utc      IS NOT NULL AND ends_at_utc      IS NOT NULL
     AND all_day_start_date IS NULL AND all_day_end_date IS NULL
     AND starts_at_utc < ends_at_utc)
    OR
    (starts_at_utc      IS NULL     AND ends_at_utc      IS NULL
     AND all_day_start_date IS NOT NULL AND all_day_end_date IS NOT NULL
     AND all_day_start_date < all_day_end_date)
  ),
  -- A retried fetch page staged the same upstream event twice and the wall rendered
  -- soccer practice twice. One upstream event, one row per generation.
  UNIQUE (sync_run_id, external_uid),
  FOREIGN KEY (source_id, sync_run_id) REFERENCES sync_run(source_id, id) ON DELETE CASCADE
) STRICT;
CREATE INDEX ix_event_gen  ON calendar_event(sync_run_id);
CREATE INDEX ix_event_when ON calendar_event(source_id, starts_at_utc, all_day_start_date);

-- ---------------------------------------------------------------------------
-- Chores
-- ---------------------------------------------------------------------------

CREATE TABLE chore (
  id               TEXT PRIMARY KEY,
  -- Per-band labels are mandatory at WRITE time (H2 Q3 graft). Nothing may be authored
  -- without them, so the blank-card failure lands on an adult at authoring time rather
  -- than on a child at 06:00.
  label_short      TEXT NOT NULL CHECK (length(label_short) BETWEEN 1 AND 14),
  label_full       TEXT NOT NULL CHECK (length(label_full) >= 1),
  icon_asset_id    TEXT NOT NULL REFERENCES asset(id),
  category         TEXT NOT NULL,
  assignment_model TEXT NOT NULL
      CHECK (assignment_model IN ('individual','shared','first_complete','rotation')),
  base_points      INTEGER NOT NULL CHECK (base_points >= 0),
  -- Is this a DUTY or a PAID EXTRA?  The household's own distinction: duties are required
  -- and pay nothing, extras are chosen and earn money.  Presentational only — what a chore
  -- actually pays is `chore_day.points_each`, snapshotted at materialization — so this is
  -- deliberately NOT snapshotted onto chore_day.  Reclassifying mid-day changes which
  -- destination the tile appears under and cannot change what today pays.
  kind             TEXT NOT NULL DEFAULT 'duty' CHECK (kind IN ('duty','extra')),
  -- "HH:MM" local, or NULL for a chore with no window.  This is the ONLY thing stored about
  -- lateness: `overdue` is DERIVED in the view layer from (state='pending', due_by_local,
  -- the wall's own clock) and is never a persisted state.
  --
  -- That is the whole point.  A persisted `overdue` needs something to write it, and the
  -- only somethings are a cron or a request — a 5:55 AM cron that fails leaves a blank wall
  -- at 6:00, which PRD §4 forbids, and a request-triggered transition means a chore is only
  -- late if somebody happened to look.  Derived, it is correct at every instant with nothing
  -- running, and it updates on the clock tick the wall already has rather than waiting for a
  -- snapshot rebuild.
  due_by_local     TEXT CHECK (due_by_local IS NULL OR due_by_local GLOB '[0-2][0-9]:[0-5][0-9]'),
  -- Recurrence, expanded ONLY in local-date space (H3 finding #6).
  rrule            TEXT NOT NULL,
  active           INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  -- Does finishing this duty count toward a FULL DAY (ADR-0006 s4)? 1 for almost every duty.
  -- 0 for a reminder that is not asked of the child every single day in fact: homework on a
  -- day with none or eye exercises. Leaving one undone must not cost the day; it leaves the
  -- count on both sides like superseded. Extras never count whatever this says. v13.
  -- NO COMMAS in this comment: SQLite drops a LAST column by cutting back to the nearest
  -- comma before it and finds one inside a comment just as readily.
  counts_toward_day INTEGER NOT NULL DEFAULT 1 CHECK (counts_toward_day IN (0,1))
) STRICT;

CREATE TABLE chore_rotation_member (
  chore_id TEXT NOT NULL REFERENCES chore(id),
  child_id TEXT NOT NULL REFERENCES child(id),
  position INTEGER NOT NULL,
  PRIMARY KEY (chore_id, child_id),
  UNIQUE (chore_id, position)
) STRICT;

-- H2 left "one shared row vs one row per child" open. Resolved here as BOTH, layered:
-- chore_day is the once-per-day materialization point and carries the uniqueness that
-- makes the lazy read idempotent; chore_assignment is the per-child fact underneath it.
-- A rotation's assignee is a deterministic function of (chore, local_date) computed at
-- materialization, so no child can re-roll it by refreshing.
CREATE TABLE chore_day (
  id            INTEGER PRIMARY KEY,
  chore_id      TEXT NOT NULL REFERENCES chore(id),
  local_date    TEXT NOT NULL,
  points_each   INTEGER NOT NULL CHECK (points_each >= 0),  -- snapshot of base_points
  model         TEXT NOT NULL,                              -- snapshot of assignment_model
  created_at_utc TEXT NOT NULL,
  UNIQUE (chore_id, local_date)
) STRICT;

CREATE TABLE chore_assignment (
  id           INTEGER PRIMARY KEY,
  chore_day_id INTEGER NOT NULL REFERENCES chore_day(id) ON DELETE CASCADE,
  child_id     TEXT NOT NULL REFERENCES child(id),
  -- 'superseded' exists only for first_complete: the losers of the claim race. It is a
  -- terminal, non-paying state — not a failure.
  -- There is deliberately NO 'rejected': a parent rejecting a claim returns the chore to
  -- 'pending' so the child can redo it. An earlier draft had 'rejected' in the CHECK while
  -- api.md documented reject -> pending, which two parallel agents would have implemented
  -- two different ways, one of them leaving the card stuck all day (H1 lens 2).
  state        TEXT NOT NULL DEFAULT 'pending'
      CHECK (state IN ('pending','claimed','approved','superseded')),
  claimed_at_utc  TEXT,
  decided_at_utc  TEXT,
  UNIQUE (chore_day_id, child_id)
) STRICT;
CREATE INDEX ix_assignment_state ON chore_assignment(state, child_id);

-- ---------------------------------------------------------------------------
-- Ledger and redemption
-- ---------------------------------------------------------------------------

-- Append-only. Balance is always SUM(delta) computed on read — never a stored column,
-- so there is no second copy of truth to diverge or to argue with.
-- The UNIQUE below is the structural backstop behind the real guard, which is the state
-- transition itself: UPDATE ... WHERE state='claimed' RETURNING id, and write the
-- ledger row only if a row came back (H3 finding #2).
CREATE TABLE ledger_entry (
  id            INTEGER PRIMARY KEY,
  child_id      TEXT NOT NULL REFERENCES child(id),
  delta         INTEGER NOT NULL CHECK (delta <> 0),
  reason        TEXT NOT NULL
      CHECK (reason IN ('chore_approved','redemption_approved','adjustment')),
  ref_type      TEXT NOT NULL
      CHECK (ref_type IN ('chore_assignment','redemption_request','manual')),
  ref_id        TEXT NOT NULL,
  note          TEXT,
  created_at_utc TEXT NOT NULL,
  UNIQUE (child_id, ref_type, ref_id, reason)
) STRICT;
CREATE INDEX ix_ledger_child ON ledger_entry(child_id, id);

-- Points are destroyed at APPROVAL. There is deliberately no 'paid' state: the physical
-- handover is unobservable, and any state depending on an adult remembering to tap it
-- will drift and then lie to a child (H2 Q2, unanimous). Recorded as unsettled in
-- docs/design-review/H2-tournament.md — the cost is that nothing tracks who is owed cash.
CREATE TABLE redemption_request (
  id               INTEGER PRIMARY KEY,
  child_id         TEXT NOT NULL REFERENCES child(id),
  points_requested INTEGER NOT NULL CHECK (points_requested > 0),
  cents_per_point  INTEGER NOT NULL CHECK (cents_per_point > 0),  -- snapshot at request
  cash_cents       INTEGER NOT NULL CHECK (cash_cents > 0),
  state            TEXT NOT NULL DEFAULT 'pending'
      CHECK (state IN ('pending','approved','rejected','cancelled')),
  requested_at_utc TEXT NOT NULL,
  decided_at_utc   TEXT
) STRICT;

-- At most one open request per child: prevents stacking requests to overdraw.
CREATE UNIQUE INDEX ux_one_pending_redemption
  ON redemption_request(child_id) WHERE state = 'pending';

-- ---------------------------------------------------------------------------
-- Routines  (H2 Q1 winner — snapshot model)
-- ---------------------------------------------------------------------------

CREATE TABLE routine (
  id             TEXT PRIMARY KEY,
  label_short    TEXT NOT NULL CHECK (length(label_short) BETWEEN 1 AND 14),
  label_full     TEXT NOT NULL,
  icon_asset_id  TEXT NOT NULL REFERENCES asset(id),
  -- The time box is DATA. It is never evaluated server-side into a locked/open/closed
  -- flag and shipped in a snapshot: a snapshot generated at 00:00 would say "locked" and
  -- never open at 06:00, because the wall only refetches on SSE open and at the date
  -- boundary (H2 Q1 fatal flaw). The client computes the state from its own clock.
  opens_at_local  TEXT NOT NULL,
  closes_at_local TEXT NOT NULL,
  days_of_week    TEXT NOT NULL,   -- 'MO,TU,WE,TH,FR' — local days
  sort_order      INTEGER NOT NULL,
  active          INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1))
) STRICT;

CREATE TABLE routine_step (
  id            TEXT PRIMARY KEY,
  routine_id    TEXT NOT NULL REFERENCES routine(id),
  label_short   TEXT NOT NULL CHECK (length(label_short) BETWEEN 1 AND 14),
  label_full    TEXT NOT NULL,
  icon_asset_id TEXT NOT NULL REFERENCES asset(id),
  category      TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  -- Parent key for the composite FK below.
  UNIQUE (routine_id, id)
) STRICT;

-- One shared routine may give different children different step sets in a different
-- order. That is an assignment concern, not two routines.
CREATE TABLE routine_step_assignment (
  routine_id      TEXT NOT NULL REFERENCES routine(id),
  child_id        TEXT NOT NULL REFERENCES child(id),
  routine_step_id TEXT NOT NULL,
  position        INTEGER NOT NULL CHECK (position > 0),
  PRIMARY KEY (routine_id, child_id, routine_step_id),
  UNIQUE (routine_id, child_id, position),
  -- COMPOSITE: two independent FKs let a bedtime step be assigned to the morning
  -- routine. The pre-reader would see "put on pyjamas" at 06:00 with an authoritative
  -- icon and no text to contradict it. Found independently by three lenses.
  FOREIGN KEY (routine_id, routine_step_id) REFERENCES routine_step(routine_id, id)
) STRICT;

-- Materialized lazily on read. The UNIQUE is what makes that idempotent:
--   INSERT ... ON CONFLICT DO NOTHING, then RE-SELECT the canonical row.
-- Never proceed on the insert's return value; never swallow the conflict (H3 #1, 5/5).
CREATE TABLE routine_run (
  id              INTEGER PRIMARY KEY,
  routine_id      TEXT NOT NULL REFERENCES routine(id),
  local_date      TEXT NOT NULL,
  opens_at_local  TEXT NOT NULL,   -- snapshot
  closes_at_local TEXT NOT NULL,   -- snapshot
  created_at_utc  TEXT NOT NULL,
  UNIQUE (routine_id, local_date)
) STRICT;

-- The steps as they were at materialization. This is what makes a parent's mid-day edit
-- harmless: today's run stops reading the definition. `icon_asset_id` is the RESOLVED
-- asset after the fallback chain, so the render path cannot miss.
-- If a run exists with no rows here — the crash-between-writes case — the next read
-- inserts them. That self-repair is the property that won H2 Q1.
CREATE TABLE routine_run_step (
  id             INTEGER PRIMARY KEY,
  run_id         INTEGER NOT NULL REFERENCES routine_run(id) ON DELETE CASCADE,
  child_id       TEXT NOT NULL REFERENCES child(id),
  source_step_id TEXT REFERENCES routine_step(id) ON DELETE SET NULL,
  position       INTEGER NOT NULL,
  label_short    TEXT NOT NULL,   -- snapshot
  label_full     TEXT NOT NULL,   -- snapshot
  icon_asset_id  TEXT NOT NULL REFERENCES asset(id),
  UNIQUE (run_id, child_id, position)
) STRICT;

-- Completion is a row; un-completion is a soft revoke, never a DELETE. A 3-year-old's
-- mis-tap must be recoverable BY THE CHILD (PIN-gating it bricks the routine until an
-- adult intervenes — an H2 Q1 fatal flaw), and history must survive.
CREATE TABLE routine_step_completion (
  id               INTEGER PRIMARY KEY,
  run_step_id      INTEGER NOT NULL REFERENCES routine_run_step(id) ON DELETE CASCADE,
  completed_at_utc TEXT NOT NULL,
  revoked_at_utc   TEXT
) STRICT;

-- At most one LIVE completion per step; revoked rows accumulate freely.
CREATE UNIQUE INDEX ux_one_live_completion
  ON routine_step_completion(run_step_id) WHERE revoked_at_utc IS NULL;

-- ---------------------------------------------------------------------------
-- Countdowns  (the one idea worth taking from DinkyDash — ADR-0004)
-- ---------------------------------------------------------------------------

CREATE TABLE countdown (
  id            TEXT PRIMARY KEY,
  label_short   TEXT NOT NULL CHECK (length(label_short) BETWEEN 1 AND 14),
  label_full    TEXT NOT NULL,
  icon_asset_id TEXT NOT NULL REFERENCES asset(id),
  -- The emoji drawn beside this countdown, or NULL to derive one from `label_full`.
  --
  -- AUTHORED, unlike an event's, and that is the difference between the two: a calendar event
  -- arrives from upstream with a title nobody here chose, so its emoji has to be inferred; a
  -- countdown is written by an adult in this house, who knows what it is. All four countdowns
  -- drew a birthday cake until v6 because they all pointed at the one `celebration` icon —
  -- including "Winter holiday". v6, 2026-09-09.
  emoji          TEXT,
  -- Either a fixed date, or an annually recurring MM-DD. Both are floating local dates:
  -- "3 sleeps until Christmas" is a local-date subtraction, never an instant delta.
  target_date   TEXT,
  annual_md     TEXT,
  child_id      TEXT REFERENCES child(id),   -- NULL = whole household
  active        INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0,1)),
  -- How many days ahead this countdown appears. NULL = the household default
  -- (COUNTDOWN_HORIZON_DAYS, 60). A grown-up's birthday sets 14. v12, 2026-10-20.
  horizon_days  INTEGER CHECK (horizon_days IS NULL OR horizon_days BETWEEN 0 AND 366),
  CHECK ((target_date IS NOT NULL) <> (annual_md IS NOT NULL))
) STRICT;

-- ---------------------------------------------------------------------------
-- Door taps  (schema v3)
-- ---------------------------------------------------------------------------

-- How often somebody opens the calendar or the grown-ups door, split by whether the
-- SEARCH-AND-FIND PICTURE was up at the time.
--
-- It exists to answer one question and then to be ignored or dropped: does the picture --- up
-- ~18 hours a day and deliberately carrying no information --- need an at-a-glance readout?
-- Two independent reviewers split on that, and both named the same thing that would settle it:
-- a tap count nobody had (BACKLOG 5.1).
--
-- AGGREGATED ON PURPOSE, and that is the load-bearing part. One row per (date, door, picture),
-- so this table CANNOT become a record of who touched what at which second. That would be
-- surveillance in a family's living room to answer a question a daily count answers. The CHECK
-- on `target` is what holds the line: a third thing cannot quietly start being counted without
-- a deliberate migration.
--
-- `minutes` is the honest number. A three-year-old hammering the button forty times is ONE
-- reach for the calendar, not forty, and `taps` alone would read as overwhelming demand for
-- exactly the readout under argument. `minutes` counts distinct minutes in which at least one
-- tap landed, so a hammering day is self-evident rather than silently poisoning the evidence.
CREATE TABLE door_tap (
  local_date  TEXT NOT NULL,
  target      TEXT NOT NULL CHECK (target IN ('calendar','grown-ups')),
  scene       INTEGER NOT NULL CHECK (scene IN (0,1)),
  taps        INTEGER NOT NULL DEFAULT 0 CHECK (taps >= 0),
  minutes     INTEGER NOT NULL DEFAULT 0 CHECK (minutes >= 0),
  -- The last local "HH:MM" counted, so `minutes` can be advanced without storing a timeline.
  last_local  TEXT,
  PRIMARY KEY (local_date, target, scene)
) STRICT;

-- ---------------------------------------------------------------------------
-- Scenes  (v4, 2026-09-08)
-- ---------------------------------------------------------------------------
--
-- The search-and-find picture behind the wall. This table is the LIBRARY — which pictures
-- exist and whether each is allowed on the wall. It is deliberately not the picture and not
-- the tap regions: those are files, `scenes/<id>.jpg` and `scenes/<id>.json`, written by
-- tools/gen-scene.py and tools/scene-regions.py, and the manifest stays the single source of
-- truth for geometry. Copying the rectangles in here would create a second copy free to
-- disagree with the one the region finder wrote.
--
-- WHY IT IS A TABLE AT ALL. Until now the pool was a committed array in the frontend bundle
-- (web/src/views/logic/sceneCatalog.ts) and the wall showed its first element. That made a new
-- picture a code edit and a redeploy, which is why the weekly cadence never happened: the
-- generator can produce a scene at 2am, and nothing it can do puts one on the wall. State that
-- a cron may write and a parent may change is state, and it belongs here.
--
-- The committed list does not go away and is not merely legacy — `registerBaselineScenes` puts
-- every committed scene in here as `approved` on every boot, insert-if-absent. So the pool
-- cannot empty: lose this table's rows, restore an old volume, start from a blank database,
-- and the four committed pictures are still there. That is the exact objection sceneCatalog.ts
-- raised against a runtime index — "lose it and every scene disappears at once, and the wall's
-- honest answer to an empty pool is a screen that looks completely fine" — answered by keeping
-- the shipped set as the floor rather than by refusing to have a library.
--
--   candidate  generated, not yet looked at. NEVER on the wall.
--   approved   allowed on the wall. The one with the newest `decided_at_utc` is the one up.
--   retired    looked at and turned down, or taken out of service. Never on the wall.
--
-- Ordering approval by `decided_at_utc` rather than by creation is what makes "go back to the
-- one from three weeks ago" a normal act with no extra concept: approving an old scene again
-- promotes it. There is no separate pin, because a pin would be a second mechanism for the
-- thing approval already does.
--
-- No CASCADE to anything and nothing references it: a scene is content, and losing the row for
-- a picture must never be able to take a child's ledger with it.
CREATE TABLE scene (
  id              TEXT PRIMARY KEY,
  -- Under the asset root, e.g. 'scenes/autumn-forest.jpg'. Stored rather than derived from the
  -- id so a scene can be a .png, or be named differently from its file, exactly as the
  -- manifest's `image` field already allows.
  rel_path        TEXT NOT NULL,
  state           TEXT NOT NULL CHECK (state IN ('candidate','approved','retired')),
  -- 'baseline' is committed art that ships in the image; 'generated' arrived from the weekly
  -- run. Kept apart because they have different rules: a baseline scene is re-registered every
  -- boot and its file is restored by the asset seeder, and a generated one exists only in the
  -- volume and is exactly as durable as the backup.
  source          TEXT NOT NULL CHECK (source IN ('baseline','generated')),
  -- Which entry in tools/scene-styles.json drew it, when that is known. Nullable: the four
  -- scenes that predate the style table have no honest answer, and inventing one would make
  -- the column a guess rather than a record.
  style_id        TEXT,
  created_at_utc  TEXT NOT NULL,
  -- When it became approved or retired; NULL while it is still a candidate. This is the sort
  -- key for "which picture is up", so it is written on every decision, including a re-approval.
  decided_at_utc  TEXT
) STRICT;

-- The wall asks exactly one question of this table on every snapshot — "the newest approved
-- one" — and it asks it in front of a child waiting for a screen to draw.
CREATE INDEX ix_scene_active ON scene(state, decided_at_utc DESC);

-- Every decision ever made about a scene, appended and never rewritten (v11, 2026-10-18).
--
-- `scene.decided_at_utc` is overwritten by every approval — that is what makes approving also
-- SELECTING — so the table above can say which picture is up and never which pictures WERE up,
-- or for how long. Replaying this log in time order with the same rule `activeScene` uses (the
-- newest approval that has not been retired since) gives each picture's time as the chosen
-- one: the household's favourites, measured instead of remembered (`sceneHistory`).
--
-- Time as the CHOSEN picture, not time looked at: the board windows and the dark screen at
-- night are inside it, and so is a picture whose file went missing and was skipped.
CREATE TABLE scene_decision (
  scene_id  TEXT NOT NULL,
  kind      TEXT NOT NULL CHECK (kind IN ('approved','retired')),
  at_utc    TEXT NOT NULL,
  PRIMARY KEY (scene_id, at_utc, kind)
) STRICT;

-- ---------------------------------------------------------------------------
-- The dog's week  (the Easter egg)
-- ---------------------------------------------------------------------------

-- Which of the dog's deeds the household has ticked off this week. The deeds themselves are
-- CODE (src/domain/dog/deeds.ts): a fixed pool, six drawn per ISO week by a seeded shuffle,
-- so the wall and a fresh database agree on the list without a row existing anywhere. Only
-- the ticks are state. A row present means done; deleting it is the undo. No child id, no
-- points, no approval — there is nothing here a guardrail has to protect, which is what
-- lets the tap sit behind the dog in the picture with no PIN and no rail.
CREATE TABLE dog_deed_done (
  week        TEXT NOT NULL,     -- ISO week key, "2026-W38"
  deed_id     TEXT NOT NULL,     -- a key in the pool; an unknown one is refused by the writer
  done_at_utc TEXT NOT NULL,
  PRIMARY KEY (week, deed_id)
) STRICT;

-- ---------------------------------------------------------------------------
-- Schema version
-- ---------------------------------------------------------------------------

CREATE TABLE schema_migration (
  version    INTEGER PRIMARY KEY,
  applied_at_utc TEXT NOT NULL
) STRICT;
INSERT INTO schema_migration(version, applied_at_utc) VALUES (1, '2026-08-24T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (2, '2026-08-27T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (3, '2026-08-27T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (4, '2026-09-08T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (5, '2026-09-09T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (6, '2026-09-09T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (7, '2026-09-09T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (8, '2026-09-09T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (9, '2026-09-15T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (10, '2026-09-15T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (11, '2026-10-18T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (12, '2026-10-20T00:00:00Z');
INSERT INTO schema_migration(version, applied_at_utc) VALUES (13, '2026-10-27T00:00:00Z');
