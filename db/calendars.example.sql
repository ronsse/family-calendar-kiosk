-- family-calendar — WHICH CALENDARS RENDER ON THE WALL.
--
-- Copy to `db/calendars.sql` (gitignored) and edit. Apply:
--
--   cd ~/projects/family-calendar/stacks/wall
--   docker compose cp ../../db/calendars.sql wall:/tmp/calendars.sql
--   docker compose exec wall node --experimental-strip-types \
--     stacks/wall/entry/provision.ts --calendars /tmp/calendars.sql
--
-- ## Why this is not in household.sql
--
-- `household.sql` RESETS what it owns — it deletes children, which cascades to their ledger.
-- Calendar sources own sync history (`sync_run` -> `calendar_event`), and that history is what
-- the wall is rendering right now. Tying the two together would mean either re-syncing every
-- calendar to change a child's chore, or being unable to change a calendar without erasing
-- balances. They are separate files because they have separate lifetimes.
--
-- This file is therefore ADDITIVE and re-appliable: it upserts by `id` and never deletes, so
-- flipping `included` or renaming a label leaves the promoted generation on the wall untouched.
--
-- ## external_ref is OPAQUE
--
-- Only `src/calendar/<impl>/` may interpret it (ADR-0004). For the Home Assistant adapter it
-- happens to be the calendar entity id; for the Google-direct adapter it will be a calendar id.
-- Nothing outside the adapter — no route, no component, no other table — may parse it. That
-- boundary is what keeps swapping upstreams a config change.
--
-- List what the current upstream offers:
--   curl -sf -H "Authorization: Bearer $TOK" http://homeserver:8123/api/calendars
--
-- ## included
--
--   1  syncs and renders.
--   0  recorded and inert: not fetched, not rendered, one UPDATE away from being either.
--
-- Keep the excluded ones listed. A calendar that is absent looks like a calendar nobody
-- thought about; a calendar sitting at 0 is a decision somebody can read and reverse.
--
-- ## colour_token
--
-- Free-form, and currently INERT: the snapshot carries it (`CalendarEventView.colourToken`)
-- but no renderer reads it — event colour comes from the child accent, and a household event
-- has none. Set it to what you mean anyway; it is the field a per-calendar colour will use.

INSERT INTO calendar_source (id, label, external_ref, child_id, colour_token, included, event_filter, keep_terms) VALUES
  -- Household-wide. `child_id` NULL means it belongs to no one child.
  ('cs-family',    'Family',    'calendar.family',    NULL, 'slate', 1, 'all', NULL),
  ('cs-birthdays', 'Birthdays', 'calendar.birthdays', NULL, 'plum',  1, 'all', NULL),
  ('cs-holidays',  'Holidays',  'calendar.holidays',  NULL, 'sun',   1, 'all', NULL),
  -- A SUBSCRIBED calendar nobody here curates — a school district feed, say. `all_day_only`
  -- keeps the breaks, no-school days, conferences and picture days and drops the clubs and
  -- meetings that happen inside an ordinary school day. See db/schema.sql for why the split
  -- is structural rather than a keyword list.
  -- ('cs-school',  'School',  'calendar.school',  NULL, 'moss', 1, 'all_day_only', NULL),

  -- Excluded, deliberately.
  --   todoist  — the standing rule. It survived Todoist itself being dropped (PRD §5): the
  --              calendar still exists upstream and would flood the wall with task rows.
  --   adult-*  — an adult's work calendar is not one of the four kid-facing jobs, and putting
  --              it on a screen at child height is a disclosure decision, not a layout one.
  ('cs-todoist',   'Todoist',   'calendar.todoist',   NULL, 'grey',  0, 'all', NULL),
  ('cs-adult-1',   'Adult 1',   'calendar.adult_1',   NULL, 'teal',  0, 'all', NULL)
ON CONFLICT(id) DO UPDATE SET
  label        = excluded.label,
  external_ref = excluded.external_ref,
  child_id     = excluded.child_id,
  colour_token = excluded.colour_token,
  included     = excluded.included,
  event_filter = excluded.event_filter,
  keep_terms   = excluded.keep_terms;

-- Per-child calendars do not exist upstream yet (docs/calendar-structure.md "To create").
-- When they do, add them here with the child's id and they render in that child's accent:
--   ('cs-child-a', 'Child A', 'calendar.child_a', 'child-a', 'green', 1),
