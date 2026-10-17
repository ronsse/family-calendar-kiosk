-- family-calendar — a household with ONE child (synthetic example).
--
-- The same shape as db/household.example.sql, cut down to one child: the wall's rail holds one
-- face, the picture has one figure to find, and nothing rotates because there is nobody to hand
-- a turn to. Copy it to db/household.sql (gitignored) and edit there; apply it with
--
--   npm run provision -- --household db/household.sql
--
-- REDACTION RULE (build-plan.md §3.1): this committed file stays synthetic — Child A, no real
-- names, schedules or birthdays. See db/household.example.sql for what every column means.

-- Household config -----------------------------------------------------------
-- 10 = a point is a dime. Remove the row for stars without money.
INSERT INTO household_config VALUES ('cents_per_point','10');

-- Children -------------------------------------------------------------------
-- (id, display_name, reading_band, ledger_enabled, avatar_asset_id, sort_order, active)
INSERT INTO child VALUES
  ('child-a','Child A','emergent',1,'av-a',1,1);

-- Routines -------------------------------------------------------------------
-- (id, label_short, label_full, icon_asset_id, opens_at_local, closes_at_local, byday, sort, active)
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

-- (routine_id, child_id, routine_step_id, position)
INSERT INTO routine_step_assignment VALUES
  ('rt-morning','child-a','st-dress',1),
  ('rt-morning','child-a','st-teeth',2),
  ('rt-morning','child-a','st-shoes',3),
  ('rt-morning','child-a','st-bag',4),
  ('rt-bed','child-a','st-pj',1),
  ('rt-bed','child-a','st-teeth-pm',2);

-- Chores ---------------------------------------------------------------------
-- No `rotation` chore and no chore_rotation_member rows: a roster with no rows means "every
-- active child", which here is the one child, so every chore is hers without naming her.
-- (id, label_short, label_full, icon_asset_id, category, assignment_model, base_points, rrule, active)
INSERT INTO chore(id, label_short, label_full, icon_asset_id, category, assignment_model, base_points, rrule, active) VALUES
  ('ch-table','Table','Set the table','ico-table','kitchen','individual',5,'FREQ=DAILY',1),
  ('ch-pet','Feed pet','Feed the pet','ico-pet','kitchen','individual',3,'FREQ=DAILY',1),
  ('ch-tidy','Tidy','Tidy the playroom','ico-fallback','tidy','shared',2,'FREQ=WEEKLY;BYDAY=SA',1),
  ('ch-bed','Bed','Make your bed','ico-fallback','tidy','individual',1,'FREQ=DAILY',1);

-- Countdowns -----------------------------------------------------------------
-- Columns NAMED, never positional (see db/household.example.sql).
INSERT INTO countdown (id,label_short,label_full,icon_asset_id,emoji,target_date,annual_md,child_id,active) VALUES
  ('cd-winter','Winter','Winter holiday','ico-cake','🎄','2026-12-25',NULL,NULL,1);
