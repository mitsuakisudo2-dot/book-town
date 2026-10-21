-- AUD-168: a person named as the book itself puts it, without what the
-- statement of who made it writes after the name. private.ndl_credit takes
-- a role off a statement only when it is one word of 8 letters at most or
-- one [], so "山田一郎 [ほか] 著" was named "山田一郎 [ほか]", and "山田一郎
-- [ほか]著", "山田一郎 [他][著]" or "山田一郎 キャラクターデザイン" were names
-- in whole. Now, when the authority's heading and the book's statement name
-- as many people (private.ndl_answer, as before), a statement's name
-- leaves out "[ほか]", "[他]" and "ほか" (there are others; whether to show
-- that is decided apart), and a name that is the heading's name and words
-- after it is the heading's name, the words its role (private.ndl_named,
-- with the examples of tests/fixtures/credit-names.ts). Words with Latin
-- letters or brackets ( ) stay in the name: they are the name ("…
-- Books", "…(出版部)").
--
-- The names already kept are made again the same way: the library's
-- answers (private.edition_sources) of a person with a heading. 81 people
-- of 79 editions in production on 10-21, all of them catalog rows. Then, as
-- in 20261125000000, the author of the catalog rows whose editions' names
-- changed, and the readers' books of those editions are judged again
-- (book_rechecks). Nothing else changes, and no row is taken out.
--
-- Before that, the sources, the books, their checks and the books' search
-- words are copied (private.keep_copy), and compared after
-- (private.check_copy).
--
-- Rollback: a new migration that makes private.ndl_answer() again as
-- 20261118000000_bibliography_judging.sql has it, and drops
-- private.ndl_named(); the names made again stay as they are, or come back
-- from the copy keep."20261129000000_credit_names" (private.restore_copy).

select private.keep_copy('20261129000000_credit_names',
  array['private.edition_sources', 'public.books', 'private.book_checks',
    'private.book_grams']::regclass[]);

-- A person as the book's statement names them (named: name and role, from
-- private.ndl_credit), against the name the authority's heading gives
-- (heading_name): the statement's name without "[ほか]" or "ほか", and the
-- heading's name when the statement's is it and words after it, the words
-- the role (before the one the statement gave, if any).
create function private.ndl_named(heading_name text, named jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(case
    when rest ~ '^(\s|ほか|他)' and btrim(rest) !~ '[A-Za-z()（）]'
      then jsonb_build_object('name', heading_name, 'role',
        nullif(concat_ws(' ', nullif(btrim(regexp_replace(rest, '^\s*(ほか|他)?', '')), ''), role), ''))
    else jsonb_build_object('name', coalesce(s, named ->> 'name'), 'role', role)
  end)
  from (select nullif(btrim(regexp_replace(regexp_replace(named ->> 'name',
      '\s*[［\[](ほか|他)[］\]]', ' ', 'g'), '\s+(ほか|他)(\s|$)', ' ', 'g')), '') as s,
    nullif(regexp_replace(named ->> 'role', '^[［\[]?(ほか|他)[］\]]?\s*', ''), '') as role) x
  cross join lateral (select case when heading_name <> '' and starts_with(s, heading_name)
    then substr(s, length(heading_name) + 1) else '' end as rest) y
$$;
revoke all on function private.ndl_named(text, jsonb) from public, anon, authenticated;

create or replace function private.ndl_answer(content text, isbn text,
  out state text, out record text, out record_id text, out status text, out fields jsonb)
language plpgsql immutable set search_path = '' as $$
declare
  main xml;
  doc xml;
  t record;
  agents jsonb;
  named jsonb;
begin
  if content is null then
    state := 'failed';
    return;
  end if;
  begin
    doc := xmlparse(document content);
  exception when others then
    state := 'failed';
    return;
  end;
  if xpath_exists('/s:searchRetrieveResponse/s:diagnostics', doc,
      array[array['s', 'http://www.loc.gov/zing/srw/']]) then
    -- "Record does not exist" is how it says it has nothing for the ISBN.
    state := case when (
      select bool_and(x.m = 'Record does not exist')
      from xmltable(
        xmlnamespaces('http://www.loc.gov/zing/srw/' as s, 'http://www.loc.gov/zing/srw/diagnostic/' as d),
        '/s:searchRetrieveResponse/s:diagnostics/d:diagnostic' passing doc
        columns m text path 'string(d:message)') x
    ) then 'missing' else 'failed' end;
    return;
  end if;
  if not xpath_exists('/s:searchRetrieveResponse/s:numberOfRecords', doc,
      array[array['s', 'http://www.loc.gov/zing/srw/']]) then
    state := 'failed';
    return;
  end if;

  select r.main, nullif(r.status, '') into main, status
  from xmltable(
    xmlnamespaces('http://www.loc.gov/zing/srw/' as s,
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
      'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
    '/s:searchRetrieveResponse/s:records/s:record/s:recordData/rdf:RDF' passing doc
    columns
      main xml path 'dcndl:BibResource[dcterms:title][1]',
      category text path 'string(dcndl:BibAdminResource/dcndl:bibRecordCategory)',
      status text path 'string(dcndl:BibAdminResource/dcndl:catalogingStatus)',
      n for ordinality) r
  cross join lateral (
    select coalesce(array_agg(private.isbn13(i.v)), array[]::text[]) as isbns
    from xmltable(
      xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
        'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
      '/dcndl:BibResource/dcterms:identifier[@rdf:datatype = "http://ndl.go.jp/dcndl/terms/ISBN"]'
      passing r.main columns v text path '.') i
  ) k
  where r.category = 'R100000002' and r.main is not null and ndl_answer.isbn = any (k.isbns)
  order by r.status is not distinct from 'C3', cardinality(k.isbns), r.n
  limit 1;
  if main is null then
    state := 'missing';
    return;
  end if;
  state := 'found';
  record := main::text;

  select * into t
  from xmltable(
    xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
      'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms,
      'http://purl.org/dc/elements/1.1/' as dc, 'http://xmlns.com/foaf/0.1/' as foaf),
    '/dcndl:BibResource' passing main
    columns
      bib_id text path 'dcterms:identifier[@rdf:datatype = "http://ndl.go.jp/dcndl/terms/NDLBibID"][1]',
      full_title text path 'string(dc:title[1]/rdf:Description/rdf:value)',
      plain_title text path 'string(dcterms:title[1])',
      full_reading text path 'string(dc:title[1]/rdf:Description/dcndl:transcription)',
      volume text path 'string(dcndl:volume[1]/rdf:Description/rdf:value)',
      edition text path 'string(dcndl:edition[1])',
      publisher text path 'string(dcterms:publisher[1]/foaf:Agent/foaf:name)',
      date text path 'string(dcterms:date[1])',
      issued text path 'string(dcterms:issued[1])') x;
  record_id := private.bib_text(t.bib_id);

  -- The people as the library's name authority has them, in order, and its
  -- statements of who made the book as the book itself puts it. When the
  -- statements name as many people as there are, in the same order, each
  -- person gets the name and the role the book gives them; else the name
  -- comes from the authority's heading (bib_person).
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'name', private.bib_person(a.name),
      'heading', private.bib_text(a.name),
      'reading', private.bib_person(a.reading, ' '),
      'authority', private.bib_text(a.about))) order by a.n), '[]')
  into agents
  from xmltable(
    xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
      'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms,
      'http://xmlns.com/foaf/0.1/' as foaf),
    '/dcndl:BibResource/dcterms:creator/foaf:Agent' passing main
    columns name text path 'string(foaf:name)', reading text path 'string(dcndl:transcription)',
      about text path 'string(@rdf:about)', n for ordinality) a;
  select coalesce(jsonb_agg(jsonb_build_object('name', p.name, 'role', p.role) order by p.c, p.o), '[]')
  into named
  from (
    select c.n as c, u.o, u.name, k.role
    from xmltable(
      xmlnamespaces('http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/elements/1.1/' as dc),
      '/dcndl:BibResource/dc:creator' passing main
      columns credit text path '.', n for ordinality) c
    cross join lateral private.ndl_credit(c.credit) k
    cross join lateral unnest(k.names) with ordinality u (name, o)
  ) p;
  if jsonb_array_length(named) = jsonb_array_length(agents) then
    select jsonb_agg(a.v || private.ndl_named(a.v ->> 'name', n.v) order by a.i)
    into agents
    from jsonb_array_elements(agents) with ordinality a (v, i)
    join jsonb_array_elements(named) with ordinality n (v, i) on n.i = a.i;
  end if;

  fields := jsonb_strip_nulls(jsonb_build_object(
    'title', (private.bib_title_parts(coalesce(nullif(t.full_title, ''), t.plain_title))).title,
    'title_reading', (private.bib_title_parts(t.full_reading)).title,
    'subtitle', (private.bib_title_parts(coalesce(nullif(t.full_title, ''), t.plain_title))).subtitle,
    'volume', private.bib_text(t.volume),
    'edition', private.bib_text(t.edition),
    'publisher', private.bib_text(t.publisher),
    'issued', coalesce(private.bib_issued(t.date), private.bib_issued(t.issued)),
    'ndc', (
      select substring(s.r from '/class/ndc(?:10|9|8)/(.+)$')
      from xmltable(
        xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
          'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
        '/dcndl:BibResource/dcterms:subject[@rdf:resource]' passing main
        columns r text path 'string(@rdf:resource)') s
      where s.r ~ '/class/ndc(10|9|8)/'
      order by substring(s.r from '/class/ndc(10|9|8)/')::int desc
      limit 1),
    'series', (
      select nullif(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'name', private.bib_text(coalesce(v[1], s.value)),
          'number', private.bib_text(v[2]),
          'reading', private.bib_text(coalesce(r[1], s.reading)))) order by s.n), '[]')
      from xmltable(
        xmlnamespaces('http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
          'http://ndl.go.jp/dcndl/terms/' as dcndl),
        '/dcndl:BibResource/dcndl:seriesTitle/rdf:Description' passing main
        columns value text path 'string(rdf:value)', reading text path 'string(dcndl:transcription)',
          n for ordinality) s
      cross join lateral regexp_match(s.value, '^(.*?)\s+;\s+(.*)$') v
      cross join lateral regexp_match(s.reading, '^(.*?)\s+;\s+(.*)$') r
      where private.bib_text(s.value) is not null),
    'creators', nullif(agents, '[]'),
    'credits', (
      select nullif(jsonb_agg(private.bib_text(c.credit) order by c.n), '[]')
      from xmltable(
        xmlnamespaces('http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/elements/1.1/' as dc),
        '/dcndl:BibResource/dc:creator' passing main
        columns credit text path '.', n for ordinality) c
      where private.bib_text(c.credit) is not null)));
  fields := fields || private.ndl_more(main);
end;
$$;
revoke all on function private.ndl_answer(text, text) from public, anon, authenticated;

-- The names to make again: the library's answers of a person with a heading
-- and a name the statement gave that the rule now makes another.
create temporary table credit_people on commit drop as
  select * from (
    select s.edition_id, s.source, x.n, x.c ->> 'name' as was,
      private.ndl_named(private.bib_person(x.c ->> 'heading'),
        jsonb_strip_nulls(jsonb_build_object('name', x.c ->> 'name', 'role', x.c ->> 'role'))) as now
    from private.edition_sources s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.fields -> 'creators') = 'array'
      then s.fields -> 'creators' else '[]' end) with ordinality x (c, n)
    where s.source = 'ndl' and x.c ? 'heading' and x.c ? 'name') p
  where now ->> 'name' is distinct from was;

update private.edition_sources s set fields = jsonb_set(s.fields, '{creators}', (
    select jsonb_agg(case when f.n is null then x.c else (x.c - 'role') || f.now end order by x.n)
    from jsonb_array_elements(s.fields -> 'creators') with ordinality x (c, n)
    left join credit_people f on f.edition_id = s.edition_id and f.source = s.source and f.n = x.n))
where exists (select 1 from credit_people f where f.edition_id = s.edition_id and f.source = s.source);

-- The catalog rows of those editions, named by the master's people as
-- catalog_take and catalog_promote name them, and judged the same as when
-- they came (the update has them judged again, book_retitled).
create temporary table credit_rows on commit drop as
  select b.id, w.author
  from public.books b
  cross join lateral private.edition_bibliography(b.edition_id) m
  cross join lateral private.catalog_words(jsonb_build_object('title', 'x', 'creators', m.creators)) w
  where b.source = 'ndl'
    and b.edition_id in (select f.edition_id from credit_people f)
    and b.author is distinct from w.author;
update public.books b set author = r.author from credit_rows r where b.id = r.id;
update private.book_checks c set checked_at = now(), confirmed_at = null
from credit_rows r where c.book_id = r.id;

insert into private.book_rechecks (book_id)
  select b.id from public.books b
  where b.source = 'manual' and b.edition_id in (select f.edition_id from credit_people f)
on conflict do nothing;

select private.check_copy('20261129000000_credit_names');
