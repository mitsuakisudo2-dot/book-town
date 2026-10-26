-- The first terms (管理表44): the version every reader is asked to agree to.
--
-- The terms and the privacy page went up on 2026-10-26 (#382, /terms/ and
-- /privacy/). From here a reader who starts agrees to them with the one box
-- of the first screen, and a reader from before is asked once over the town
-- (TermsGate.tsx, けにーさん 10-26 「次に開いたとき小窓で聞く」). The version
-- is the day they apply from, as the terms page says it
-- (LegalPages.tsx, TERMS_DATE).
--
-- One row is added; no row changes.
--
-- Rollback (a new migration), once no consent points to it, which loses no
-- reader's row:
--   delete from private.terms_versions where version = '2026-10-26';
insert into private.terms_versions (version, published_at, asks_again)
values ('2026-10-26', '2026-10-26 00:00:00+09', true);
