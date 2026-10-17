-- family-calendar — the household definition.
--
--   cp db/household.example.sql db/household.sql     # household.sql is GITIGNORED
--   $EDITOR db/household.sql                          # real names go here, never in the repo
--
-- Apply it into the RUNNING wall (docs/runbook.md §1.5):
--
--   cd ~/projects/family-calendar/stacks/wall
--   docker compose cp ../../db/household.sql wall:/tmp/household.sql
--   docker compose exec wall node --experimental-strip-types \
--     stacks/wall/entry/provision.ts --household /tmp/household.sql
--
-- WHY THIS FILE EXISTS. M1 shipped no way to create a child, a routine or a chore: the admin
-- API only approves, rejects and adjusts rows that already exist, and db/seed.dev.sql is
-- synthetic test fixtures. Until parent-facing authoring exists, this is how a household is
-- defined. It runs in ONE transaction — a half-applied household is worse than an empty one.
--
-- REDACTION RULE (build-plan.md §3.1). This *.example.sql file is committed and must stay
-- synthetic: Child A / B / C, no real names, no real schedules, no real birthdays. Your real
-- household.sql is gitignored and never leaves the box — and never goes into a model prompt.
--
-- ASSETS ARE NOT DEFINED HERE. entry/main.ts seeds and registers the baseline set from
-- assets/manifest.json on every boot, including the mandatory `_default` fallback. Use those
-- ids: ico-fallback, ico-teeth, ico-dress, ico-shoes, ico-bag, ico-table, ico-pet, ico-cake,
-- ico-calendar, av-a, av-b, av-c. Referencing an id that does not exist is a foreign key error
-- at apply time, which is the loud failure you want.
--
-- RE-APPLYING. Uncomment the reset block below to replace a household wholesale. It must clear
-- the MATERIALIZED tables too: chore_day, chore_assignment, routine_run and routine_run_step
-- deliberately do not cascade from chore/routine/child, so without them the transaction fails
-- on a foreign key the moment a single day has been rendered. (Found exactly that way on
-- 2026-08-25 — it applied fine to a virgin database and failed against the live one.)
--
-- It also deletes ledger_entry, which ERASES MONEY THE CHILDREN HAVE EARNED. provision.ts
-- refuses to apply any household file while the ledger is non-empty unless you pass --force.
--
-- DELETE FROM routine_step_completion;
-- DELETE FROM routine_run_step;
-- DELETE FROM routine_run;
-- DELETE FROM chore_assignment;
-- DELETE FROM chore_day;
-- DELETE FROM redemption_request;
-- DELETE FROM ledger_entry;
-- DELETE FROM countdown;
-- DELETE FROM chore_rotation_member;
-- DELETE FROM chore;
-- DELETE FROM routine_step_assignment;
-- DELETE FROM routine_step;
-- DELETE FROM routine;
-- DELETE FROM child;

-- Household config -----------------------------------------------------------
-- cents_per_point converts the points ledger into real money. 10 = a point is a dime.
-- Remove this row entirely and Balance.cashCents is null everywhere: stars, no money.
INSERT INTO household_config VALUES ('cents_per_point','10');

-- Children -------------------------------------------------------------------
-- (id, display_name, reading_band, ledger_enabled, avatar_asset_id, sort_order, active)
--
-- reading_band is 'fluent' | 'emergent' | 'picture' and drives PRESENTATION ONLY — one state,
-- three renderings. Set it by what the child can actually read, not by age.
--
-- ledger_enabled = 0 means chores still run the full state machine and never write a ledger
-- row: the pre-reader gets the satisfaction of ticking things off without money entering it.
INSERT INTO child VALUES
  ('child-a','Child A','fluent',  1,'av-a',1,1),
  ('child-b','Child B','emergent',1,'av-b',2,1),
  ('child-c','Child C','picture', 0,'av-c',3,1);

-- Routines -------------------------------------------------------------------
-- (id, label_short, label_full, icon_asset_id, opens_at_local, closes_at_local, byday, sort, active)
--
-- opens/closes are DATA, never a server-evaluated open/locked flag: a snapshot built at 00:00
-- carrying `locked` would never open at 06:00. The client decides from its own clock.
INSERT INTO routine VALUES
  ('rt-morning','Morning','Morning routine','ico-calendar','06:00','08:00','MO,TU,WE,TH,FR',1,1),
  ('rt-bed','Bedtime','Bedtime routine','ico-calendar','19:00','20:30','SU,MO,TU,WE,TH,FR,SA',2,1);

-- (id, routine_id, label_short, label_full, icon_asset_id, icon_category, active)
INSERT INTO routine_step VALUES
  ('st-dress','rt-morning','Dressed','Get dressed','ico-dress','dressing',1),
  ('st-teeth','rt-morning','Teeth','Brush your teeth','ico-teeth','hygiene',1),
  ('st-shoes','rt-morning','Shoes','Put your shoes on','ico-shoes','dressing',1),
  ('st-bag','rt-morning','Bag','Pack your bag','ico-bag','school',1),
  ('st-pj','rt-bed','PJs','Put on pyjamas','ico-dress','dressing',1),
  ('st-teeth-pm','rt-bed','Teeth','Brush your teeth','ico-teeth','hygiene',1);

-- One shared routine, a different step sequence per child — an assignment concern, not two
-- routines. The pre-reader gets a shorter sequence so the card stays finishable.
-- (routine_id, child_id, routine_step_id, position)
INSERT INTO routine_step_assignment VALUES
  ('rt-morning','child-a','st-dress',1),
  ('rt-morning','child-a','st-teeth',2),
  ('rt-morning','child-a','st-shoes',3),
  ('rt-morning','child-a','st-bag',4),
  ('rt-morning','child-b','st-dress',1),
  ('rt-morning','child-b','st-teeth',2),
  ('rt-morning','child-b','st-shoes',3),
  ('rt-morning','child-b','st-bag',4),
  ('rt-morning','child-c','st-dress',1),
  ('rt-morning','child-c','st-teeth',2),
  ('rt-bed','child-a','st-pj',1),
  ('rt-bed','child-a','st-teeth-pm',2),
  ('rt-bed','child-b','st-pj',1),
  ('rt-bed','child-b','st-teeth-pm',2),
  ('rt-bed','child-c','st-pj',1);

-- Chores ---------------------------------------------------------------------
-- (id, label_short, label_full, icon_asset_id, icon_category, assignment_model, points, rrule, active)
--
-- assignment_model:
--   individual     — every child gets their own copy each occurrence
--   shared         — one instance the household completes together
--   first_complete — a race; the losers go to `superseded`, which never pays
--   rotation       — a deterministic function of (chore, local_date), so refreshing cannot re-roll it
INSERT INTO chore(id, label_short, label_full, icon_asset_id, category, assignment_model, base_points, rrule, active) VALUES
  ('ch-table','Table','Set the table','ico-table','kitchen','rotation',5,'FREQ=DAILY',1),
  ('ch-pet','Feed pet','Feed the pet','ico-pet','kitchen','first_complete',3,'FREQ=DAILY',1),
  ('ch-tidy','Tidy','Tidy the playroom','ico-fallback','tidy','shared',2,'FREQ=WEEKLY;BYDAY=SA',1),
  ('ch-bed','Bed','Make your bed','ico-fallback','tidy','individual',1,'FREQ=DAILY',1);

-- Rotation order. Only children listed here take a turn.
INSERT INTO chore_rotation_member VALUES
  ('ch-table','child-a',1),
  ('ch-table','child-b',2);

-- Countdowns -----------------------------------------------------------------
-- (id, label_short, label_full, icon_asset_id, target_date, annual_md, child_id, active)
--
-- Either a one-off target_date OR a annually recurring MM-DD, never both. child_id NULL = whole
-- household; set it and the countdown belongs to that child.
-- "3 sleeps until" is a local-date subtraction, never an instant delta.
-- Columns are NAMED, not positional. A bare `INSERT INTO countdown VALUES (...)` breaks on
-- the next migration that adds a column, which is how v6 broke the dev seed and every
-- end-to-end test at once.
--
-- `emoji` is AUTHORED here because you know what the countdown is; NULL derives one from
-- the label instead. Every countdown drew a birthday cake until 2026-09-09, because they
-- all pointed at the one `celebration` icon — "Winter holiday" included.
INSERT INTO countdown (id,label_short,label_full,icon_asset_id,emoji,target_date,annual_md,child_id,active) VALUES
  ('cd-winter','Winter','Winter holiday','ico-cake','🎄','2026-12-25',NULL,NULL,1);

-- Calendar sources -----------------------------------------------------------
-- external_ref is OPAQUE: only src/calendar/<impl>/ may parse it. For the Home Assistant
-- adapter it is the calendar entity id. Rows here do nothing until HA_TOKEN is configured.
-- Excluded by convention and still true: `Todoist` and `Working Location` never render.
-- INSERT INTO calendar_source (id,label,external_ref,child_id,colour_token,included) VALUES
--   ('cs-family','Household','calendar.family',NULL,'blue',1),
--   ('cs-a','Child A','calendar.child_a','child-a','green',1);
