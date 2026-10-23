-- The copies the four moves of the authors' names took before they changed
-- data (docs/開発と運用/DBの変え方.md「移す工事の前の控えと戻す手順」),
-- dropped now that all four were checked in production (AUD-185, けにーさん
-- 10-23 14:34Z「古い4回分を消す」):
--
-- - 20261125000000_authority_qualifiers (AUD-163, #268)
-- - 20261128000000_authority_trades (AUD-167, #277)
-- - 20261129000000_credit_names (AUD-168, #282)
-- - 20261201000000_credit_roles (AUD-170)
--
-- Each copied the library's answers, the books, the search words and the
-- books' checks whole (about 17MB a time, 68MB in all, of a 131MB database).
-- keep.copies had them all checked with no row and no link lost. Each later
-- move changed the same answers again, so writing one back now would take
-- the later moves' changes with it: they no longer serve to undo a move.
--
-- The newest copy, 20261202000000_book_extent, stays until its own time.
--
-- No table the app reads changes. Without the copies these moves can only
-- be put right by a new move forward (the answers can be read again from
-- the library), not written back from a copy. drop_copy raises when a copy
-- is not there, which rolls the whole file back.
select private.drop_copy('20261125000000_authority_qualifiers');
select private.drop_copy('20261128000000_authority_trades');
select private.drop_copy('20261129000000_credit_names');
select private.drop_copy('20261201000000_credit_roles');
