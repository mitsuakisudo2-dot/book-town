-- 読書の統計 (management table 19): the reader arranges the statistics' cards
-- (long press: move, size 2×2・2×4・最大, take out, an empty place with ＋).
-- けにーさん 10-28 11:36Z chose to keep the arrangement with the account, so
-- a new phone shows the same cards in the same places.
--
-- reader_settings.stats_layout: the cards in order, as the app keeps them
-- (src/lib/reading-stats/layout.ts); null for the first arrangement, which
-- the app knows. Like library_shelves.rule, the database checks only that it
-- is a small array: the app reads what is in it and drops a card it does not
-- know, so an arrangement from a newer app never breaks an older one. Only
-- the reader reads and writes it (reader_settings' policies); nothing about
-- the reader's books is in it, only which cards and how big.
--
-- Nothing moves: one column is added, empty for every reader. The old app's
-- upsert does not send it, so it never changes it.
--
-- Rollback (a new migration; only arrangements are lost, the cards go back
-- to the first one):
--   alter table public.reader_settings drop column stats_layout;
-- An app that sends the column has to go first: a town that writes a column
-- the database does not have keeps its changes unsent.

alter table public.reader_settings
  add column stats_layout jsonb
    check (stats_layout is null or (jsonb_typeof(stats_layout) = 'array'
      and jsonb_array_length(stats_layout) <= 64
      and octet_length(stats_layout::text) <= 4096));
grant insert (stats_layout), update (stats_layout)
  on public.reader_settings to authenticated;
