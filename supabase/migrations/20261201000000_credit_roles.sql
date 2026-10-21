-- AUD-170: what the book's statement writes in front of a role is left out
-- too, and a statement that names the people in another order than the
-- authority does is not paired with them.
--
-- The role: "他訳", "ほか著" and "[ほか述]" are "訳", "著" and "述" (there
-- are others; whether to show that is decided apart, as for the name). The
-- rule of 20261129000000 took "[ほか" off "[ほか述]" and left "述]", and
-- that migration made again only the people whose name changed, so the
-- roles of the people whose name was right stayed as they were.
--
-- The order: when the statements name as many people as the authority,
-- each person was paired with the statement in the same place. When the
-- book lists them in another order, a person got another's name and role
-- (the heading "野呂, 香" named "小川剛生"). Now, when a statement names a
-- person of another place and not the one of its own, the names come from
-- the headings, as when the numbers differ (private.ndl_credits_fit). A
-- statement naming someone the authority does not have is still paired by
-- its place: it cannot be told from a name the book writes in its own way
-- ("せなけいこ", "…編集部"). The examples are tests/fixtures/credit-names.ts.
--
-- The names and roles already kept are made again the same way: the
-- library's answers (private.edition_sources) of a person with a heading.
-- On 10-21 in production, 18 roles with "ほか" or "他" in front, and 30
-- people of 10 editions named in another order. Then, as in
-- 20261129000000, the author of the catalog rows whose editions' names
-- changed, and the readers' books of those editions are judged again
-- (book_rechecks; one in production on 10-21). Nothing else changes, and
-- no row is taken out.
--
-- Before that, the sources, the books, their checks and the books' search
-- words are copied (private.keep_copy), and compared after
-- (private.check_copy).
--
-- Rollback: a new migration that makes private.ndl_named() and
-- private.ndl_answer() again as 20261129000000_credit_names.sql has them,
-- and drops private.ndl_credits_fit(); the names and roles made again stay
-- as they are, or come back from the copy keep."20261201000000_credit_roles"
-- (private.restore_copy).

select private.keep_copy('20261201000000_credit_roles',
  array['private.edition_sources', 'public.books', 'private.book_checks',
    'private.book_grams']::regclass[]);

-- As 20261129000000 has it, but for the role: "[ほか]" and "[他]" anywhere,
-- the brackets round a role with "ほか" or "他" in front ("[ほか述]"), and
-- "ほか" or "他" in front are left out.
create or replace function private.ndl_named(heading_name text, named jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select jsonb_strip_nulls(case
    when rest ~ '^(\s|ほか|他)' and btrim(rest) !~ '[A-Za-z()（）]'
      then jsonb_build_object('name', heading_name, 'role',
        nullif(concat_ws(' ', nullif(btrim(regexp_replace(rest, '^\s*(ほか|他)?', '')), ''), role), ''))
    else jsonb_build_object('name', coalesce(s, named ->> 'name'), 'role', role)
  end)
  from (select nullif(btrim(regexp_replace(regexp_replace(named ->> 'name',
      '\s*[［\[](ほか|他)[］\]]', ' ', 'g'), '\s+(ほか|他)(\s|$)', ' ', 'g')), '') as s,
    nullif(btrim(regexp_replace(regexp_replace(regexp_replace(named ->> 'role',
      '[［\[](ほか|他)[］\]]', '', 'g'),
      '^\s*[［\[](ほか|他)\s*(.*)[］\]]\s*$', '\2'),
      '^\s*(ほか|他)\s*', '')), '') as role) x
  cross join lateral (select case when heading_name <> '' and starts_with(s, heading_name)
    then substr(s, length(heading_name) + 1) else '' end as rest) y
$$;
revoke all on function private.ndl_named(text, jsonb) from public, anon, authenticated;

-- Whether the book's statements (named: name and role of each person, from
-- private.ndl_credit) are paired with the authority's people (agents, their
-- names from the headings) by their places: as many, and none naming a
-- person of another place and not the one of its own.
create function private.ndl_credits_fit(agents jsonb, named jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select jsonb_array_length(named) = jsonb_array_length(agents) and not exists (
    select 1
    from jsonb_array_elements(named) with ordinality n (v, i)
    join jsonb_array_elements(agents) with ordinality own (v, i) on own.i = n.i
    join jsonb_array_elements(agents) with ordinality a (v, i) on a.i <> n.i
    where a.v ->> 'name' <> ''
      and private.ndl_named(a.v ->> 'name', n.v) ->> 'name' = a.v ->> 'name'
      and private.ndl_named(own.v ->> 'name', n.v) ->> 'name' is distinct from own.v ->> 'name')
$$;
revoke all on function private.ndl_credits_fit(jsonb, jsonb) from public, anon, authenticated;

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
  -- statements name as many people as there are, in the same order
  -- (ndl_credits_fit), each person gets the name and the role the book
  -- gives them; else the name comes from the authority's heading
  -- (bib_person).
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
  if private.ndl_credits_fit(agents, named) then
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

-- The people to name again: the library's answers of a person with a
-- heading. Of an answer whose kept names pair a statement with a person of
-- another place, every such person is named by the heading, without a role;
-- else the name and the role are what the rule now makes of them.
create temporary table shifted on commit drop as
  select distinct s.edition_id, s.source
  from private.edition_sources s
  cross join lateral jsonb_array_elements(s.fields -> 'creators') with ordinality x (c, n)
  cross join lateral jsonb_array_elements(s.fields -> 'creators') with ordinality o (c, n)
  where s.source = 'ndl' and jsonb_typeof(s.fields -> 'creators') = 'array'
    and o.n <> x.n and x.c ? 'heading' and o.c ? 'heading'
    and x.c ->> 'name' = private.bib_person(o.c ->> 'heading')
    and x.c ->> 'name' <> private.bib_person(x.c ->> 'heading');

create temporary table role_people on commit drop as
  select * from (
    select s.edition_id, s.source, x.n, x.c as was,
      (x.c - 'name' - 'role') || case when exists (select 1 from shifted f
          where f.edition_id = s.edition_id and f.source = s.source)
        then jsonb_build_object('name', private.bib_person(x.c ->> 'heading'))
        else private.ndl_named(private.bib_person(x.c ->> 'heading'),
          jsonb_strip_nulls(jsonb_build_object('name', x.c ->> 'name', 'role', x.c ->> 'role'))) end as now
    from private.edition_sources s
    cross join lateral jsonb_array_elements(case when jsonb_typeof(s.fields -> 'creators') = 'array'
      then s.fields -> 'creators' else '[]' end) with ordinality x (c, n)
    where s.source = 'ndl' and x.c ? 'heading' and x.c ? 'name') p
  where now is distinct from was;

update private.edition_sources s set fields = jsonb_set(s.fields, '{creators}', (
    select jsonb_agg(coalesce(f.now, x.c) order by x.n)
    from jsonb_array_elements(s.fields -> 'creators') with ordinality x (c, n)
    left join role_people f on f.edition_id = s.edition_id and f.source = s.source and f.n = x.n))
where exists (select 1 from role_people f where f.edition_id = s.edition_id and f.source = s.source);

-- The catalog rows of those editions, named by the master's people as
-- catalog_take and catalog_promote name them, and judged the same as when
-- they came (the update has them judged again, book_retitled).
create temporary table role_rows on commit drop as
  select b.id, w.author
  from public.books b
  cross join lateral private.edition_bibliography(b.edition_id) m
  cross join lateral private.catalog_words(jsonb_build_object('title', 'x', 'creators', m.creators)) w
  where b.source = 'ndl'
    and b.edition_id in (select f.edition_id from role_people f)
    and b.author is distinct from w.author;
update public.books b set author = r.author from role_rows r where b.id = r.id;
update private.book_checks c set checked_at = now(), confirmed_at = null
from role_rows r where c.book_id = r.id;

insert into private.book_rechecks (book_id)
  select b.id from public.books b
  where b.source = 'manual' and b.edition_id in (select f.edition_id from role_people f)
on conflict do nothing;

select private.check_copy('20261201000000_credit_roles');
