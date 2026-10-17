-- family-calendar — a household with NO children (synthetic example).
--
-- A wall that is only a calendar and a countdown: no child rows, so no rail faces, no routines,
-- no chores and no ledger. `cents_per_point` is absent on purpose — there is no money to convert.
-- Pair it with a db/household.json whose `features` turn chores, money and routines off, so
-- the grown-up screens do not offer empty catalogs. Apply it with
--
--   npm run provision -- --household db/household.sql
--
-- REDACTION RULE (build-plan.md §3.1): this committed file stays synthetic.

-- Countdowns -----------------------------------------------------------------
-- (id, label_short, label_full, icon_asset_id, emoji, target_date, annual_md, child_id, active)
-- child_id is NULL on both: with no children, every countdown belongs to the household. Both
-- recur every year (annual_md), so this example never goes stale. The wall shows a countdown
-- only inside its horizon (60 days), so in October neither is up yet.
INSERT INTO countdown (id,label_short,label_full,icon_asset_id,emoji,target_date,annual_md,child_id,active) VALUES
  ('cd-winter','Winter','Winter holiday','ico-cake','🎄',NULL,'12-25',NULL,1),
  ('cd-newyear','New Year','New Year''s Day','ico-calendar','🎉',NULL,'01-01',NULL,1);
