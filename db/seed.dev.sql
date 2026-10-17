-- family-calendar — Phase 0 contract: development fixtures.
--
-- SYNTHETIC ONLY. No real names, no real schedules, no real dates (build-plan.md §3.1).
-- These rows are safe to hand to any agent, local or remote, and safe to paste into a
-- prompt. The household's actual roster lives in the running database and nowhere in
-- this repo.
--
--   python3 db/verify-schema.py     # contracts
--   sqlite3 dev.db < db/schema.sql && sqlite3 dev.db < db/seed.dev.sql

-- Assets ---------------------------------------------------------------------
-- '_default' is mandatory and terminates the fallback chain. Every asset here is
-- pre-validated; activation requires validated_at_utc to be non-NULL.
INSERT INTO asset VALUES
  ('ico-fallback','icon','_default','icons/fallback.svg','2026-01-01T00:00:00Z'),
  ('ico-teeth','icon','hygiene','icons/teeth.svg','2026-01-01T00:00:00Z'),
  ('ico-dress','icon','dressing','icons/dress.svg','2026-01-01T00:00:00Z'),
  ('ico-shoes','icon','dressing','icons/shoes.svg','2026-01-01T00:00:00Z'),
  ('ico-bag','icon','school','icons/bag.svg','2026-01-01T00:00:00Z'),
  ('ico-table','icon','kitchen','icons/table.svg','2026-01-01T00:00:00Z'),
  ('ico-pet','icon','kitchen','icons/pet.svg','2026-01-01T00:00:00Z'),
  ('ico-cake','icon','celebration','icons/cake.svg','2026-01-01T00:00:00Z'),
  ('ico-cal','icon','calendar','icons/calendar.svg','2026-01-01T00:00:00Z'),
  ('av-a','avatar','avatar','avatars/a.svg','2026-01-01T00:00:00Z'),
  ('av-b','avatar','avatar','avatars/b.svg','2026-01-01T00:00:00Z'),
  ('av-c','avatar','avatar','avatars/c.svg','2026-01-01T00:00:00Z');

INSERT INTO asset_fallback VALUES
  ('_default','ico-fallback'),
  ('hygiene','ico-teeth'),
  ('dressing','ico-dress'),
  ('school','ico-bag'),
  ('kitchen','ico-table'),
  ('celebration','ico-cake'),
  ('calendar','ico-cal');

-- Household ------------------------------------------------------------------
INSERT INTO household_config VALUES ('cents_per_point','10');

-- One child per literacy band. Child C is the pre-reader: ledger_enabled = 0, so her
-- chores run the full state machine and never write a ledger row.
INSERT INTO child VALUES
  ('child-a','Child A','fluent',  1,'av-a',1,1),
  ('child-b','Child B','emergent',1,'av-b',2,1),
  ('child-c','Child C','picture', 0,'av-c',3,1);

-- Routines -------------------------------------------------------------------
-- opens/closes are DATA. The client computes locked/open/closed from its own clock;
-- the server never ships an evaluated flag (H2 Q1 fatal flaw).
INSERT INTO routine VALUES
  ('rt-morning','Morning','Morning routine','ico-cal','06:00','08:00','MO,TU,WE,TH,FR',1,1),
  ('rt-bed','Bedtime','Bedtime routine','ico-cal','19:00','20:30','SU,MO,TU,WE,TH,FR,SA',2,1);

INSERT INTO routine_step VALUES
  ('st-dress','rt-morning','Dressed','Get dressed','ico-dress','dressing',1),
  ('st-teeth','rt-morning','Teeth','Brush your teeth','ico-teeth','hygiene',1),
  ('st-shoes','rt-morning','Shoes','Put your shoes on','ico-shoes','dressing',1),
  ('st-bag','rt-morning','Bag','Pack your bag','ico-bag','school',1),
  ('st-pj','rt-bed','PJs','Put on pyjamas','ico-dress','dressing',1),
  ('st-teeth-pm','rt-bed','Teeth','Brush your teeth','ico-teeth','hygiene',1);

-- One shared routine, different step sets per child: an assignment concern, not two
-- routines. Child C (pre-reader) gets a shorter sequence.
INSERT INTO routine_step_assignment VALUES
  ('rt-morning','child-a','st-dress',1),
  ('rt-morning','child-a','st-teeth',2),
  ('rt-morning','child-a','st-shoes',3),
  ('rt-morning','child-a','st-bag',4),
  ('rt-morning','child-b','st-dress',1),
  ('rt-morning','child-b','st-teeth',2),
  ('rt-morning','child-b','st-shoes',3),
  ('rt-morning','child-c','st-dress',1),
  ('rt-morning','child-c','st-teeth',2),
  ('rt-bed','child-a','st-pj',1),
  ('rt-bed','child-a','st-teeth-pm',2),
  ('rt-bed','child-c','st-pj',1);

-- Chores ---------------------------------------------------------------------
-- One of each assignment model, so every branch has a fixture.
INSERT INTO chore(id, label_short, label_full, icon_asset_id, category, assignment_model, base_points, rrule, active) VALUES
  ('ch-table','Table','Set the table','ico-table','kitchen','rotation',5,'FREQ=DAILY',1),
  ('ch-pet','Feed pet','Feed the pet','ico-pet','kitchen','first_complete',3,'FREQ=DAILY',1),
  ('ch-tidy','Tidy','Tidy the playroom','ico-fallback','tidy','shared',2,'FREQ=WEEKLY;BYDAY=SA',1),
  ('ch-bed','Bed','Make your bed','ico-fallback','tidy','individual',1,'FREQ=DAILY',1);

-- Rotation order is fixed; the day's assignee is a deterministic function of
-- (chore, local_date), so no child can re-roll it by refreshing.
INSERT INTO chore_rotation_member VALUES
  ('ch-table','child-a',1),
  ('ch-table','child-b',2);

-- Countdowns -----------------------------------------------------------------
-- Floating local dates. "3 sleeps until" is a date subtraction, never an instant delta.
INSERT INTO countdown (id,label_short,label_full,icon_asset_id,emoji,target_date,annual_md,child_id,active) VALUES
  ('cd-winter','Winter','Winter holiday','ico-cake','🎄','2026-12-25',NULL,NULL,1),
  -- NULL on purpose, so the derive-from-the-label path is exercised by the dev seed.
  ('cd-bday-a','Birthday','Child A birthday','ico-cake',NULL,NULL,'03-15','child-a',1);

-- Calendar -------------------------------------------------------------------
-- external_ref is opaque: nothing outside src/calendar/<impl>/ may parse it.
INSERT INTO calendar_source (id,label,external_ref,child_id,colour_token,included)
VALUES
  ('cs-family','Household','opaque-source-1',NULL,'blue',1),
  ('cs-a','Child A','opaque-source-2','child-a','green',1);
