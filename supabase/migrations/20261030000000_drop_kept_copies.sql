-- The copies two moves took before they changed data (docs/09「移す工事の前の
-- 控えと戻す手順」), dropped now that both were checked in production:
--
-- - 20261027000000_works (作品と版, item 4 of the 2026-10-16 plan): the books
--   and the nine tables that hold a book's id. Every book was found in its
--   edition's work, and the app now reads that work with the book.
-- - 20261029000000_visibility (見せる範囲, item 8): reading_entries and
--   reader_settings. The records kept what they showed.
--
-- No table changes. Without the copies those moves can still be undone by
-- the SQL at the head of each file (the works' only once the app no longer
-- reads work_id), but rows can no longer be written back from a copy.
select private.drop_copy('20261027000000_works');
select private.drop_copy('20261029000000_visibility');
