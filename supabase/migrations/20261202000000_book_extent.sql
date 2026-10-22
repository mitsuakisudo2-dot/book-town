-- The book's size and pages, as the library writes them (dcterms:extent,
-- "302p ; 15cm"), kept with the rest of its record: a shop's shelf will
-- show a 文庫 shorter than a 単行本, and a thick book thicker (けにーさん
-- 10-22 23:22Z「保存したい」「ページ数と本の大きさは反映されるようにしたい」).
-- Nothing shows them yet.
--
-- private.ndl_extent() reads them into three fields of the library's answer
-- (private.edition_sources.fields, and the catalog rows' the same way, as
-- the import reads with private.ndl_answer):
--   extent     the words, as the library has them (spaces tidied)
--   pages      the largest number of pages it gives ("xxii, 302 p." 302,
--              "12, 18, 302p" 302), before the first ";" and before what
--              comes with the book (" + CD-ROM1枚")
--   height_mm  the height, after the last ";": cm times ten, or mm; the
--              first of "21 × 30 cm"; none for a range ("26-30cm"), for
--              less than 3 cm or more than 100 cm ("0×0mm")
-- The words are read in NFKC first, so "２０７ｐ ; １８ｃｍ" is 207 and 180.
-- A book with no pages given ("1冊 ; 21cm", "18cm") has no pages, and one
-- with no height none. The examples are tests/fixtures/extents.ts.
--
-- The answers kept with their record (a reader's book, asked by SRU) are
-- read again now; a catalog row has no record kept and gets them when its
-- record comes again (the month's files, or the day's changes). The update
-- has the editions' books compared again, as any change of the answer does
-- (edition_sources_changed); their words have not changed.
--
-- Before that, the sources and the books' checks are copied
-- (private.keep_copy), and compared after (private.check_copy).
--
-- Rollback: a new migration that makes private.ndl_more() again as
-- 20261118000000_bibliography_judging.sql has it, drops
-- private.ndl_extent(), and runs
--   update private.edition_sources
--   set fields = fields - 'extent' - 'pages' - 'height_mm';

select private.keep_copy('20261202000000_book_extent',
  array['private.edition_sources', 'private.book_checks']::regclass[]);

create function private.ndl_extent(raw text) returns jsonb
language sql immutable set search_path = '' as $$
  with t as (
    select private.bib_text(normalize(raw, nfkc)) as e
  ), m as (
    select e, btrim(split_part(e, ' + ', 1)) as main from t
  ), h as (
    select m.e, m.main,
      regexp_match(regexp_replace(m.main, '^.*;', ''),
        '(?:^|[^0-9.-])([0-9]+(?:\.[0-9]+)?)\s*(?:[×xX]\s*[0-9]+(?:\.[0-9]+)?\s*)?(cm|mm)') as size
    from m
  )
  select coalesce(jsonb_strip_nulls(jsonb_build_object(
    'extent', h.e,
    'pages', (
      select max(p[1]::integer)
      from regexp_matches(split_part(h.main, ';', 1),
        '([0-9]{1,5})\s*(?:pages|page|p(?![a-zA-Z])|頁|ページ)', 'g') p
      where p[1]::integer between 1 and 20000),
    'height_mm', (
      select v from (
        select round(h.size[1]::numeric * case h.size[2] when 'cm' then 10 else 1 end)::integer as v) s
      where s.v between 30 and 1000))), '{}')
  from h
$$;
revoke all on function private.ndl_extent(text) from public, anon, authenticated;

create or replace function private.ndl_more(main xml) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(jsonb_build_object(
    'volume_reading', (
      select private.bib_text(x.v)
      from xmltable(
        xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
          'http://ndl.go.jp/dcndl/terms/' as dcndl),
        '/dcndl:BibResource' passing main
        columns v text path 'string(dcndl:volume[1]/rdf:Description/dcndl:transcription)') x),
    'alternatives', (
      select nullif(jsonb_agg(o.v order by o.n), '[]')
      from (
        select d.v, d.n
        from (
          select distinct on (a.v) a.v, a.n
          from (
            select private.bib_text(x.v) as v, x.n
            from xmltable(
              xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
                'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
              '/dcndl:BibResource/dcndl:alternative/rdf:Description/rdf:value
               | /dcndl:BibResource/dcndl:alternative/rdf:Description/dcndl:transcription
               | /dcndl:BibResource/dcterms:alternative[not(*)]' passing main
              columns v text path 'string(.)', n for ordinality) x
            union all
            select private.bib_text(substring(x.v from '^\s*原タイトル\s*[:：]\s*(.+)$')), 1000 + x.n
            from xmltable(
              xmlnamespaces('http://purl.org/dc/terms/' as dcterms,
                'http://ndl.go.jp/dcndl/terms/' as dcndl),
              '/dcndl:BibResource/dcterms:description' passing main
              columns v text path 'string(.)', n for ordinality) x
          ) a
          where a.v is not null
          order by a.v, a.n
        ) d
        order by d.n
        limit 20
      ) o)))
    || private.ndl_extent((
      select x.v
      from xmltable(
        xmlnamespaces('http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
        '/dcndl:BibResource' passing main
        columns v text path 'string(dcterms:extent[1])') x))
$$;

revoke all on function private.ndl_more(xml) from public, anon, authenticated;

-- The library's records kept, read again for the size and pages.
-- (A record that does not read is left as it is.)
do $$
declare
  r record;
  more jsonb;
begin
  for r in
    select s.edition_id, s.record from private.edition_sources s
    where s.source = 'ndl' and s.record is not null
    order by s.edition_id
  loop
    begin
      more := private.ndl_more(r.record::xml);
    exception when others then
      more := '{}';
    end;
    update private.edition_sources s set fields = s.fields || more
    where s.edition_id = r.edition_id and s.source = 'ndl'
      and s.fields is distinct from s.fields || more;
  end loop;
end;
$$;

select private.check_copy('20261202000000_book_extent');
