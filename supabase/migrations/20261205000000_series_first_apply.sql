-- The first grouping of series (plan item 6), applied as planned in
-- production by 20261204000000_series: 134 series, 327 editions, no move,
-- no removal (けにーさん approved it after reading the plan, 10-24).
--
-- Only that run is applied, by its id, so a different plan is never applied
-- by mistake. A database without it (a local one, the tests) has nothing to
-- apply. series_apply refuses, and rolls the whole file back, when another
-- run was applied or undone since or a step no longer matches; then plan
-- again and read the new plan before applying it.
--
-- Once applied, series_nightly adds the plain groups of new books each
-- night (19:43 UTC). Readers' books and records are not touched.
--
-- Rollback: select private.series_undo('39bc31bc-6362-4c29-94d1-4cc8d37b652f');
-- (it takes back what this run did and keeps what a person did by hand;
-- undo later runs first).
select private.series_apply(id)
from private.series_runs
where id = '39bc31bc-6362-4c29-94d1-4cc8d37b652f' and applied_at is null;
