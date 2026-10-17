-- The bibliographic master (item 4 of the 2026-10-16 plan; the owner's
-- review, 2026-10-16 22:36Z). Each edition with an ISBN gets what the
-- National Diet Library and openBD say about it, fetched behind the scenes,
-- kept per source with when it was fetched and what came back, and fetched
-- again when it is worth it. What the master shows, field by field, is the
-- operator's correction, else the library's value, else openBD's: the first
-- that is not empty. The registration is never stopped or changed for it: a
-- book keeps what its reader typed, and the app chooses where each is shown
-- (the master on pages others read, the reader's own words on their own
-- shelf; docs/09「書誌マスタ」).
--
-- What is fetched. From the library, only its own records (those its search
-- marks R100000002, its catalogue and the ones still in the making): the
-- reuse that needs no application. From openBD, the parts of its record the
-- master uses; what publishers wrote about the book and its authors is left
-- out. Covers stay where they are (src/lib/covers.ts, cover_refusals).
-- Editions without an ISBN get nothing from either: nothing public says
-- what they are, and the only thing to go by would be a reader's own entry.
--
-- How. pg_cron runs private.bib_tick() every minute: it reads the answers
-- that came back (pg_net), keeps what they say, and asks again for what is
-- due, a little at a time. Nothing leaves through GitHub Actions, whose logs
-- anyone may read: the ISBNs asked about include those of books registered
-- privately. An edition is first asked about when it is made; then again
-- by need (one still in the making within a week, one not found after a
-- day, a week, a month and then every three months, a new or incomplete one
-- each month, openBD's each month so its corrections and deletions reach
-- the master, the library's finished ones twice a year), and at once when
-- the operator asks. One with no book left is not asked about.
--
-- When an answer changes something. Not found or failed: what was kept stays
-- (openBD's goes when openBD no longer has the book). Found: the source's
-- fields become what it says now, so a field it emptied is emptied for that
-- source (the other may still fill it), except a title that would leave the
-- master with none, which stays and is listed for the operator.
--
-- Who reads what. Nobody reads the master's tables through the API.
-- book_bibliography(ids) gives what the master shows for books a reader may
-- see the bibliography of: books in public places (book_is_listed), the
-- reader's own (book_is_mine, or registered by them). Never for a book
-- placed in its edition less than ten minutes ago, whoever asks, so how soon
-- a reader's new book gets it does not tell whether someone registered that
-- ISBN before (a new edition is fetched within those minutes; an old one has
-- it already). The judging of registrations against the master (the next
-- step) waits the same way, from private.book_checks.
--
-- The copy the edition ids took (20261031000000_edition_ids) is dropped: the
-- move was checked in production.
--
-- Rollback: a new migration undoes this one with
--   select cron.unschedule('bibliography');
--   select cron.unschedule('cron-history');
--   drop function public.book_bibliography(uuid[]);
--   drop trigger editions_asked on public.editions;
--   drop trigger books_checked on public.books;
--   drop trigger books_placed on public.books;
--   drop view private.bibliography_review;
--   drop table private.edition_fixes, private.edition_sources, private.book_checks;
--   drop function private.bib_tick(), private.bib_send(), private.bib_receive(),
--     private.bib_take(uuid, text, text, text, text, text, jsonb),
--     private.bib_next(text, text, smallint, smallint, text, jsonb),
--     private.edition_bibliography(uuid), private.bib_filled(jsonb),
--     private.ndl_answer(text, text), private.openbd_answer(jsonb, text),
--     private.onix_list(jsonb), private.ndl_credit(text),
--     private.bib_title_parts(text), private.bib_issued(text), private.bib_text(text),
--     private.isbn13(text), private.edition_asked(), private.book_checked(),
--     private.bib_edition_of(uuid), private.fix_bibliography(uuid, text, jsonb, text),
--     private.unfix_bibliography(uuid, text), private.refetch_bibliography(uuid),
--     private.withdraw_bibliography(uuid, text), private.allow_bibliography(uuid, text);
-- pg_net and pg_cron can stay. Nothing else changes, so nothing comes back
-- from a copy.

-- pg_net asks the sources, pg_cron runs the asking. Supabase has both (pg_net
-- in its extensions schema, as its dashboard puts it; its own objects are in
-- net); the tests' stand-in for it (tests/fixtures/pglite-supabase.ts) makes
-- the parts of their schemas this file uses instead.
do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net with schema extensions;
  end if;
  if exists (select 1 from pg_available_extensions where name = 'pg_cron') then
    create extension if not exists pg_cron;
  end if;
  if to_regnamespace('net') is null or to_regnamespace('cron') is null then
    raise exception 'the bibliographic master needs pg_net and pg_cron';
  end if;
end;
$$;

-- Reading the sources' answers ------------------------------------------------------

-- An ISBN as the books hold it (13 digits), from the ways a source writes
-- it: with hyphens, in full-width digits, or as the old 10 digits.
create function private.isbn13(raw text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  d text := upper(regexp_replace(
    translate(coalesce(raw, ''), '０１２３４５６７８９Ｘｘ', '0123456789XX'), '[^0-9Xx]', '', 'g'));
  s int := 0;
begin
  if d ~ '^[0-9]{9}[0-9X]$' then
    for i in 1..10 loop
      s := s + (case when substr(d, i, 1) = 'X' then 10 else substr(d, i, 1)::int end) * (11 - i);
    end loop;
    if s % 11 <> 0 then
      return null;
    end if;
    d := '978' || left(d, 9);
    s := 0;
    for i in 1..12 loop
      s := s + substr(d, i, 1)::int * case when i % 2 = 0 then 3 else 1 end;
    end loop;
    return d || ((10 - s % 10) % 10)::text;
  end if;
  return case when public.isbn13_valid(d) then d end;
end;
$$;
revoke all on function private.isbn13(text) from public, anon, authenticated;

-- A text field's value: spaces run together and trimmed, null when empty.
create function private.bib_text(raw text) returns text
language sql immutable set search_path = '' as $$
  select nullif(btrim(regexp_replace(raw, '[\s　]+', ' ', 'g')), '')
$$;
revoke all on function private.bib_text(text) from public, anon, authenticated;

-- When a book came out, as a year or a year and month (2014-06), from the
-- ways the sources write it: 2014.6, １９９７．１２, 201406, 20260916, 2026.
create function private.bib_issued(raw text) returns text
language sql immutable set search_path = '' as $$
  select case
    when m[2] <> '' and m[2]::int between 1 and 12 then m[1] || '-' || lpad(m[2], 2, '0')
    else m[1]
  end
  from (
    select coalesce(
      regexp_match(d, '^([12][0-9]{3})[.\-/]([0-9]{1,2})(?![0-9])'),
      regexp_match(d, '^([12][0-9]{3})([0-9]{2})'),
      regexp_match(d, '^([12][0-9]{3})()')
    ) as m
    from (select btrim(translate(coalesce(raw, ''), '０１２３４５６７８９．－', '0123456789.-')) as d) t
  ) p
$$;
revoke all on function private.bib_issued(text) from public, anon, authenticated;

-- A title as the library writes it (ISBD): the title, then " : " and the
-- rest of it (a subtitle), then " = " and the same title in another
-- language. The reading is split the same way.
create function private.bib_title_parts(full_title text, out title text, out subtitle text)
language sql immutable set search_path = '' as $$
  select private.bib_text(regexp_replace(t, '\s+:\s+.*$', '')),
    private.bib_text(substring(t from '\s+:\s+(.*)$'))
  from (select regexp_replace(coalesce(full_title, ''), '\s+=\s+.*$', '') as t) p
$$;
revoke all on function private.bib_title_parts(text) from public, anon, authenticated;

-- One statement of who made a book, as the library writes it ("レイ・ブラッ
-- ドベリ 著", "高橋美野梨, 中丸禎子, 小澤実 編著", "尾田栄一郎∥著", "村上春樹
-- [著]"): the names, and the role after them when there is one.
create function private.ndl_credit(credit text, out names text[], out role text)
language sql immutable set search_path = '' as $$
  select coalesce(
      (select array_agg(private.bib_text(n) order by o)
       from unnest(regexp_split_to_array(coalesce(m[1], credit), '\s*[,，、]\s*')) with ordinality u (n, o)
       where private.bib_text(n) is not null),
      array[]::text[]),
    m[2]
  from (select regexp_match(btrim(credit),
    '^(.*?\S)\s*(?:∥|\s)\s*(\[[^\]\s]{1,8}\]|[^\s∥\[\]A-Za-z0-9]{1,8})$') as m) p
$$;
revoke all on function private.ndl_credit(text) from public, anon, authenticated;

-- What one answer of the National Diet Library's SRU (recordSchema=dcndl)
-- says about one ISBN: found, with the record and its fields; missing; or
-- failed (not the answer it should be). Only the library's own records
-- count (bibRecordCategory R100000002): the others in its search are other
-- libraries' and companies' records, which the free reuse does not cover.
-- When it has more than one record with the ISBN, a finished one comes
-- before one still in the making (C3), and one of fewer ISBNs (a volume)
-- before a set's.
create function private.ndl_answer(content text, isbn text,
  out state text, out record text, out record_id text, out status text, out fields jsonb)
language plpgsql immutable set search_path = '' as $$
declare
  main xml;
  doc xml;
  t record;
  agents jsonb;
  named jsonb;
begin
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
        columns m text path 'd:message') x
    ) then 'missing' else 'failed' end;
    return;
  end if;
  if not xpath_exists('/s:searchRetrieveResponse/s:numberOfRecords', doc,
      array[array['s', 'http://www.loc.gov/zing/srw/']]) then
    state := 'failed';
    return;
  end if;

  select r.main, r.status into main, status
  from xmltable(
    xmlnamespaces('http://www.loc.gov/zing/srw/' as s,
      'http://www.w3.org/1999/02/22-rdf-syntax-ns#' as rdf,
      'http://ndl.go.jp/dcndl/terms/' as dcndl, 'http://purl.org/dc/terms/' as dcterms),
    '/s:searchRetrieveResponse/s:records/s:record/s:recordData/rdf:RDF' passing doc
    columns
      main xml path 'dcndl:BibResource[dcterms:title][1]',
      category text path 'dcndl:BibAdminResource/dcndl:bibRecordCategory',
      status text path 'dcndl:BibAdminResource/dcndl:catalogingStatus',
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
  -- person gets the name and the role the book gives them.
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'heading', private.bib_text(a.name),
      'reading', private.bib_text(a.reading),
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
    select jsonb_agg(a.v || jsonb_strip_nulls(n.v) order by a.i)
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
end;
$$;
revoke all on function private.ndl_answer(text, text) from public, anon, authenticated;

-- An ONIX element that may come as one object or a list of them, as a list.
create function private.onix_list(v jsonb) returns setof jsonb
language sql immutable set search_path = '' as $$
  select e from jsonb_array_elements(case jsonb_typeof(v) when 'array' then v when 'object' then jsonb_build_array(v) else '[]' end) e
$$;
revoke all on function private.onix_list(jsonb) from public, anon, authenticated;

-- What openBD says about one ISBN: found, with the parts of its record the
-- master uses and their fields, or missing (its answer for the ISBN is
-- null). Its record also has what the publisher wrote about the book and
-- its authors; the master keeps none of that.
create function private.openbd_answer(element jsonb, isbn text,
  out state text, out record text, out fields jsonb)
language plpgsql immutable set search_path = '' as $$
declare
  onix jsonb := element -> 'onix';
  title jsonb;
begin
  if element is null or jsonb_typeof(element) = 'null' then
    state := 'missing';
    return;
  end if;
  if jsonb_typeof(element) <> 'object'
      or private.isbn13(element #>> '{summary,isbn}') is distinct from isbn then
    state := 'failed';
    return;
  end if;
  state := 'found';
  record := jsonb_strip_nulls(jsonb_build_object(
    'summary', (element -> 'summary') - 'cover',
    'TitleDetail', onix #> '{DescriptiveDetail,TitleDetail}',
    'Collection', onix #> '{DescriptiveDetail,Collection}',
    'Contributor', (
      select jsonb_agg(c - 'BiographicalNote')
      from private.onix_list(onix #> '{DescriptiveDetail,Contributor}') c),
    'PublishingDetail', onix -> 'PublishingDetail'))::text;
  select t into title
  from private.onix_list(onix #> '{DescriptiveDetail,TitleDetail,TitleElement}') t
  order by t ->> 'TitleElementLevel' = '01' desc
  limit 1;
  fields := jsonb_strip_nulls(jsonb_build_object(
    'title', private.bib_text(coalesce(title #>> '{TitleText,content}', element #>> '{summary,title}')),
    'title_reading', private.bib_text(title #>> '{TitleText,collationkey}'),
    'subtitle', private.bib_text(title #>> '{Subtitle,content}'),
    'volume', private.bib_text(title ->> 'PartNumber'),
    'publisher', private.bib_text(coalesce(
      element #>> '{summary,publisher}', onix #>> '{PublishingDetail,Imprint,ImprintName}')),
    'issued', private.bib_issued(element #>> '{summary,pubdate}'),
    'series', (
      select nullif(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'name', private.bib_text(s #>> '{TitleText,content}'),
          'number', private.bib_text(s ->> 'PartNumber'),
          'reading', private.bib_text(s #>> '{TitleText,collationkey}'))) order by n), '[]')
      from private.onix_list(onix #> '{DescriptiveDetail,Collection,TitleDetail,TitleElement}')
        with ordinality u (s, n)
      where private.bib_text(s #>> '{TitleText,content}') is not null),
    'creators', (
      select nullif(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
          'name', private.bib_text(c #>> '{PersonName,content}'),
          'reading', private.bib_text(c #>> '{PersonName,collationkey}'),
          'role', (
            select private.bib_text(string_agg(r, ','))
            from jsonb_array_elements_text(case jsonb_typeof(c -> 'ContributorRole')
              when 'array' then c -> 'ContributorRole' else '[]' end) r)))
        order by coalesce(nullif(c ->> 'SequenceNumber', ''), '0')::numeric, n), '[]')
      from private.onix_list(onix #> '{DescriptiveDetail,Contributor}') with ordinality u (c, n)
      where private.bib_text(c #>> '{PersonName,content}') is not null),
    'credits', (
      select jsonb_build_array(a) from private.bib_text(element #>> '{summary,author}') a
      where a is not null)));
end;
$$;
revoke all on function private.openbd_answer(jsonb, text) from public, anon, authenticated;

-- What is kept ------------------------------------------------------------------

-- One row for each source of each edition with an ISBN, from when the
-- edition is made. Its state is the last answer: waiting (none yet), found,
-- missing, failed; or withdrawn, when the operator took the source's data
-- off on request, and it is not asked again until the operator allows it.
-- record is the source's record as it last found it (the library's record
-- without the libraries that hold the book; openBD's without what the
-- publisher wrote), and fields what the master reads from it: title,
-- title_reading, subtitle, volume, edition, series [{name, number,
-- reading}], creators [{name, role, heading, reading, authority}], credits
-- (who made it, as the book puts it), publisher, issued (2014 or 2014-06),
-- ndc. A field the record does not have is left out.
create table private.edition_sources (
  edition_id uuid not null references public.editions (id) on delete cascade,
  source text not null check (source in ('ndl', 'openbd')),
  state text not null default 'waiting'
    check (state in ('waiting', 'found', 'missing', 'failed', 'withdrawn')),
  record text,
  -- The library's id for its record (NDLBibID), and how far it is made
  -- (catalogingStatus; C3 is still in the making).
  record_id text,
  status text,
  fields jsonb not null default '{}' check (jsonb_typeof(fields) = 'object'),
  answered_at timestamptz,
  found_at timestamptz,
  -- Answers in a row that did not find it, and that failed.
  misses smallint not null default 0,
  failures smallint not null default 0,
  -- When to ask next (null: not again), and when the operator asked.
  next_at timestamptz,
  asked_at timestamptz,
  -- The question out, if one is: pg_net's id for it, when it went, and where
  -- this edition's ISBN is in it (openBD answers in the order asked).
  request_id bigint,
  sent_at timestamptz,
  request_place smallint,
  -- Set when a found answer had no title and the master would have had none
  -- (the title it had stays), for the operator to look at.
  title_kept_at timestamptz,
  primary key (edition_id, source),
  check ((request_id is null) = (sent_at is null))
);
create index edition_sources_due on private.edition_sources (source, next_at)
  where request_id is null and state <> 'withdrawn';
create index edition_sources_out on private.edition_sources (request_id)
  where request_id is not null;
alter table private.edition_sources enable row level security;
revoke all on private.edition_sources from public, anon, authenticated;

-- The operator's corrections, field by field, over both sources. value is the
-- field's value as the fields above have it ("題名", [{"name": ...}]), or
-- JSON null to show nothing for that field.
create table private.edition_fixes (
  edition_id uuid not null references public.editions (id) on delete cascade,
  field text not null check (field in ('title', 'title_reading', 'subtitle', 'volume',
    'edition', 'series', 'creators', 'credits', 'publisher', 'issued', 'ndc')),
  value jsonb not null,
  note text,
  made_at timestamptz not null default now(),
  primary key (edition_id, field)
);
alter table private.edition_fixes enable row level security;
revoke all on private.edition_fixes from public, anon, authenticated;

-- When each book was placed in its edition: registered, or moved to another
-- edition by an edited ISBN. The master's bibliography of a book is shown
-- from ten minutes after, and the judging of the registration against it
-- (the next step) is timed from it too.
create table private.book_checks (
  book_id uuid primary key references public.books (id) on delete cascade,
  placed_at timestamptz not null default now()
);
alter table private.book_checks enable row level security;
revoke all on private.book_checks from public, anon, authenticated;

insert into private.book_checks (book_id, placed_at)
select b.id, b.created_at from public.books b;

insert into private.edition_sources (edition_id, source, next_at)
select e.id, s.source, now()
from public.editions e cross join (values ('ndl'), ('openbd')) s (source)
where e.isbn is not null;

-- A new edition with an ISBN is asked about at the next turn; a book's place
-- is written down when it is registered and when its edition changes.
create function private.edition_asked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.isbn is not null then
    insert into private.edition_sources (edition_id, source, next_at)
    values (new.id, 'ndl', now()), (new.id, 'openbd', now())
    on conflict do nothing;
  end if;
  return null;
end;
$$;
revoke all on function private.edition_asked() from public, anon, authenticated;
create trigger editions_asked after insert on public.editions
  for each row execute function private.edition_asked();

create function private.book_checked() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.book_checks (book_id, placed_at) values (new.id, now())
  on conflict (book_id) do update set placed_at = excluded.placed_at;
  return null;
end;
$$;
revoke all on function private.book_checked() from public, anon, authenticated;
create trigger books_checked after insert on public.books
  for each row execute function private.book_checked();
-- Not "update of edition_id": a reader edits the ISBN, and the trigger that
-- moves the book (book_work_edited) is what changes edition_id.
create trigger books_placed after update on public.books
  for each row when (old.edition_id is distinct from new.edition_id)
  execute function private.book_checked();

-- Asking ------------------------------------------------------------------------

-- When to ask a source about an edition again, after its answer: one still in
-- the making in a week; one not found after a day, a week, a month, then
-- every three months; one that failed in ten minutes, an hour, six hours,
-- then every day; openBD's each month, so its corrections and deletions reach
-- the master; the library's each month while the book is new (out within a
-- year) or its record lacks a title, a creator, a publisher or a date, else
-- twice a year. None for one withdrawn.
create function private.bib_next(source text, state text, misses smallint,
  failures smallint, status text, fields jsonb) returns timestamptz
language sql stable set search_path = '' as $$
  select now() + case state
    when 'found' then case
      when source = 'ndl' and status = 'C3' then interval '7 days'
      when source = 'openbd' then interval '30 days'
      when coalesce(fields ->> 'issued', '') >= to_char(now() - interval '1 year', 'YYYY-MM')
        or not (fields ?& array['title', 'creators', 'publisher', 'issued'])
        then interval '30 days'
      else interval '180 days'
    end
    when 'missing' then case misses
      when 1 then interval '1 day' when 2 then interval '7 days' when 3 then interval '30 days'
      else interval '90 days'
    end
    when 'failed' then case failures
      when 1 then interval '10 minutes' when 2 then interval '1 hour' when 3 then interval '6 hours'
      else interval '1 day'
    end
  end
$$;
revoke all on function private.bib_next(text, text, smallint, smallint, text, jsonb)
  from public, anon, authenticated;

-- Keeps what one answer says about one edition. Found: the source's record and
-- fields become what it says now; a title it no longer gives stays when
-- nothing else (the other source, a correction) would give one, and the
-- edition is listed for the operator (bibliography_review). Missing: openBD's
-- data goes (it no longer has the book); the library's stays. Failed: all
-- stays, and the question goes again sooner. An answer that comes back after
-- the operator withdrew the source is not kept.
create function private.bib_take(edition uuid, source text, state text, record text,
  record_id text, status text, fields jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare
  s private.edition_sources;
begin
  select * into s from private.edition_sources x
  where x.edition_id = bib_take.edition and x.source = bib_take.source
  for update;
  if not found then
    return;
  end if;
  s.request_id := null;
  s.sent_at := null;
  s.request_place := null;
  if s.state <> 'withdrawn' then
    s.answered_at := now();
    if bib_take.state = 'found' then
      if not (bib_take.fields ? 'title') and s.fields ? 'title'
          and not exists (
            select 1 from private.edition_sources o
            where o.edition_id = s.edition_id and o.source <> s.source and o.fields ? 'title')
          and not exists (
            select 1 from private.edition_fixes f
            where f.edition_id = s.edition_id and f.field = 'title') then
        bib_take.fields := bib_take.fields || jsonb_build_object('title', s.fields -> 'title');
        s.title_kept_at := coalesce(s.title_kept_at, now());
      else
        s.title_kept_at := null;
      end if;
      s.state := 'found';
      s.record := bib_take.record;
      s.record_id := bib_take.record_id;
      s.status := bib_take.status;
      s.fields := bib_take.fields;
      s.found_at := now();
      s.misses := 0;
      s.failures := 0;
      s.asked_at := null;
    elsif bib_take.state = 'missing' then
      s.state := 'missing';
      s.misses := least(s.misses + 1, 1000);
      s.failures := 0;
      s.asked_at := null;
      if s.source = 'openbd' then
        s.record := null;
        s.record_id := null;
        s.status := null;
        s.fields := '{}';
        s.title_kept_at := null;
      end if;
    else
      s.state := 'failed';
      s.failures := least(s.failures + 1, 1000);
    end if;
    s.next_at := private.bib_next(s.source, s.state, s.misses, s.failures, s.status, s.fields);
  end if;
  update private.edition_sources x set
    state = s.state, record = s.record, record_id = s.record_id, status = s.status,
    fields = s.fields, answered_at = s.answered_at, found_at = s.found_at,
    misses = s.misses, failures = s.failures, next_at = s.next_at, asked_at = s.asked_at,
    request_id = null, sent_at = null, request_place = null, title_kept_at = s.title_kept_at
  where x.edition_id = s.edition_id and x.source = s.source;
end;
$$;
revoke all on function private.bib_take(uuid, text, text, text, text, text, jsonb)
  from public, anon, authenticated;

-- Asks what is due, a little each turn: the library about one edition, openBD
-- about up to a hundred in one question. First what the operator asked
-- about, then editions never asked about, then the library's records still in
-- the making, then those not found, then the rest, each by when it fell due.
-- Not about an edition with no book. The library's search takes one ISBN a
-- question (its API spec, 第1.5版 表3-3) and is asked only for its own
-- records, finished (iss-ndl-opac) or in the making (iss-ndl-opac-inprocess),
-- without its holdings (onlyBib).
create function private.bib_send() returns void
language plpgsql security definer set search_path = '' as $$
declare
  ask record;
  asked bigint;
  ids uuid[];
  isbns text[];
  agent constant jsonb := '{"User-Agent": "BookTown (+https://booktown.page)"}';
begin
  for ask in
    select s.edition_id, e.isbn
    from private.edition_sources s
    join public.editions e on e.id = s.edition_id
    where s.source = 'ndl' and s.request_id is null and s.state <> 'withdrawn'
      and s.next_at <= now()
      and exists (select 1 from public.books b where b.edition_id = s.edition_id)
    order by s.asked_at is null, s.state <> 'waiting', s.status is distinct from 'C3',
      s.state <> 'missing', s.next_at
    limit 1
    for update of s skip locked
  loop
    asked := net.http_get(
      url := 'https://ndlsearch.ndl.go.jp/api/sru?operation=searchRetrieve&version=1.2'
        || '&recordSchema=dcndl&recordPacking=xml&onlyBib=true&maximumRecords=20'
        || '&query=isbn%3D%22' || ask.isbn || '%22'
        || '%20AND%20dpid%3D%22iss-ndl-opac%20iss-ndl-opac-inprocess%22',
      headers := agent,
      timeout_milliseconds := 30000);
    update private.edition_sources s set request_id = asked, sent_at = now(), request_place = 1
    where s.edition_id = ask.edition_id and s.source = 'ndl';
  end loop;

  select array_agg(d.edition_id), array_agg(d.isbn) into ids, isbns
  from (
    select s.edition_id, e.isbn
    from private.edition_sources s
    join public.editions e on e.id = s.edition_id
    where s.source = 'openbd' and s.request_id is null and s.state <> 'withdrawn'
      and s.next_at <= now()
      and exists (select 1 from public.books b where b.edition_id = s.edition_id)
    order by s.asked_at is null, s.state <> 'waiting', s.state <> 'missing', s.next_at
    limit 100
    for update of s skip locked
  ) d;
  if ids is not null then
    asked := net.http_get(
      url := 'https://api.openbd.jp/v1/get?isbn=' || array_to_string(isbns, ','),
      headers := agent,
      timeout_milliseconds := 30000);
    update private.edition_sources s set request_id = asked, sent_at = now(), request_place = u.n
    from unnest(ids) with ordinality u (id, n)
    where s.edition_id = u.id and s.source = 'openbd';
  end if;
end;
$$;
revoke all on function private.bib_send() from public, anon, authenticated;

-- Reads the answers that came back (pg_net keeps them in net._http_response)
-- and keeps what they say; a question with no answer after fifteen minutes
-- failed. An answer read is deleted from pg_net's table.
create function private.bib_receive() returns void
language plpgsql security definer set search_path = '' as $$
declare
  out_q record;
  answer record;
  body jsonb;
  s record;
  a record;
begin
  for out_q in
    select x.request_id, x.source, min(x.sent_at) as sent_at
    from private.edition_sources x
    where x.request_id is not null
    group by x.request_id, x.source
  loop
    select h.status_code, h.content, h.timed_out, h.error_msg into answer
    from net._http_response h where h.id = out_q.request_id;
    if not found then
      if out_q.sent_at < now() - interval '15 minutes' then
        perform private.bib_take(x.edition_id, x.source, 'failed', null, null, null, null)
        from private.edition_sources x where x.request_id = out_q.request_id;
      end if;
      continue;
    end if;
    body := null;
    if out_q.source = 'openbd' and answer.status_code = 200 then
      begin
        body := answer.content::jsonb;
      exception when others then
        body := null;
      end;
    end if;
    for s in
      select x.edition_id, x.request_place, e.isbn
      from private.edition_sources x join public.editions e on e.id = x.edition_id
      where x.request_id = out_q.request_id
    loop
      if answer.status_code is distinct from 200 or answer.timed_out or answer.error_msg is not null
          or (out_q.source = 'openbd' and jsonb_typeof(body) is distinct from 'array') then
        perform private.bib_take(s.edition_id, out_q.source, 'failed', null, null, null, null);
      elsif out_q.source = 'ndl' then
        select * into a from private.ndl_answer(answer.content, s.isbn);
        perform private.bib_take(s.edition_id, 'ndl', a.state, a.record, a.record_id, a.status, a.fields);
      else
        select * into a from private.openbd_answer(body -> (s.request_place - 1), s.isbn);
        perform private.bib_take(s.edition_id, 'openbd', a.state, a.record, null, null, a.fields);
      end if;
    end loop;
    begin
      delete from net._http_response h where h.id = out_q.request_id;
    exception when insufficient_privilege then
      null;
    end;
  end loop;
end;
$$;
revoke all on function private.bib_receive() from public, anon, authenticated;

create function private.bib_tick() returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform private.bib_receive();
  perform private.bib_send();
end;
$$;
revoke all on function private.bib_tick() from public, anon, authenticated;

-- Every minute. pg_cron keeps a line for each run; lines older than a week go
-- once a day.
select cron.schedule('bibliography', '* * * * *', 'select private.bib_tick()');
select cron.schedule('cron-history', '17 3 * * *',
  $$delete from cron.job_run_details where end_time < now() - interval '7 days'$$);

-- What the master shows ------------------------------------------------------------

create function private.bib_filled(v jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select v is not null and v not in ('null'::jsonb, '""'::jsonb, '[]'::jsonb, '{}'::jsonb)
$$;
revoke all on function private.bib_filled(jsonb) from public, anon, authenticated;

-- An edition's bibliography, field by field: the operator's correction, else
-- the library's value, else openBD's, the first that is not empty (a
-- correction to JSON null shows nothing). sources says where each field
-- shown came from: fix, ndl or openbd.
create function private.edition_bibliography(ed uuid)
returns table (title text, title_reading text, subtitle text, volume text, edition text,
  series jsonb, creators jsonb, credits jsonb, publisher text, issued text, ndc text,
  sources jsonb)
language sql stable set search_path = '' as $$
  with picked as (
    select k.field, coalesce(
      (select jsonb_build_array(f.value, 'fix') from private.edition_fixes f
       where f.edition_id = ed and f.field = k.field),
      (select jsonb_build_array(s.fields -> k.field, s.source) from private.edition_sources s
       where s.edition_id = ed and private.bib_filled(s.fields -> k.field)
       order by s.source = 'ndl' desc
       limit 1)) as pick
    from unnest(array['title', 'title_reading', 'subtitle', 'volume', 'edition', 'series',
      'creators', 'credits', 'publisher', 'issued', 'ndc']) k (field)
  ), shown as (
    select
      coalesce(jsonb_object_agg(p.field, p.pick -> 0)
        filter (where private.bib_filled(p.pick -> 0)), '{}') as v,
      coalesce(jsonb_object_agg(p.field, p.pick -> 1)
        filter (where private.bib_filled(p.pick -> 0)), '{}') as sources
    from picked p
  )
  select v ->> 'title', v ->> 'title_reading', v ->> 'subtitle', v ->> 'volume',
    v ->> 'edition', v -> 'series', v -> 'creators', v -> 'credits', v ->> 'publisher',
    v ->> 'issued', v ->> 'ndc', sources
  from shown
$$;
revoke all on function private.edition_bibliography(uuid) from public, anon, authenticated;

-- What the master shows for each of the books asked about (up to 200) that the
-- reader may see it for: a book in public places, or the reader's own. Only
-- once the book has been in its edition for ten minutes, and only when the
-- master has something for it. The app shows it where others read about the
-- book; on the reader's own shelf, what they typed (docs/09「書誌マスタ」).
create function public.book_bibliography(ids uuid[])
returns table (book_id uuid, title text, title_reading text, subtitle text, volume text,
  edition text, series jsonb, creators jsonb, credits jsonb, publisher text, issued text,
  ndc text, sources jsonb)
language sql stable security definer set search_path = '' as $$
  select b.id, d.title, d.title_reading, d.subtitle, d.volume, d.edition, d.series,
    d.creators, d.credits, d.publisher, d.issued, d.ndc, d.sources
  from public.books b
  join private.book_checks c on c.book_id = b.id
  cross join lateral private.edition_bibliography(b.edition_id) d
  where b.id = any ((book_bibliography.ids)[1:200])
    and c.placed_at <= now() - interval '10 minutes'
    and d.sources <> '{}'
    and (b.created_by = (select auth.uid())
      or private.book_is_listed(b.id)
      or private.book_is_mine(b.id))
$$;
revoke all on function public.book_bibliography(uuid[]) from public, anon, authenticated;
grant execute on function public.book_bibliography(uuid[]) to anon, authenticated;

-- The operator's tools (the SQL Editor; never a migration, so book ids stay out
-- of the repository). Each takes a book and works on its edition, so every
-- registration of that ISBN shows the change.

create function private.bib_edition_of(book uuid) returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare
  ed uuid;
begin
  select b.edition_id into ed from public.books b where b.id = book;
  if ed is null then
    raise exception 'no book %', book;
  end if;
  return ed;
end;
$$;
revoke all on function private.bib_edition_of(uuid) from public, anon, authenticated;

-- Shows value for field over both sources: text fields take a JSON string,
-- series and creators a list of objects with a name, credits a list of
-- strings; JSON null shows nothing for the field.
create function private.fix_bibliography(book uuid, field text, value jsonb,
  note text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  ok boolean;
begin
  ok := case
    when value = 'null'::jsonb then true
    when field in ('series', 'creators') then jsonb_typeof(value) = 'array'
      and jsonb_array_length(value) > 0
      and not exists (select 1 from jsonb_array_elements(value) e
        where jsonb_typeof(e) <> 'object' or private.bib_text(e ->> 'name') is null)
    when field = 'credits' then jsonb_typeof(value) = 'array'
      and jsonb_array_length(value) > 0
      and not exists (select 1 from jsonb_array_elements(value) e
        where jsonb_typeof(e) <> 'string' or private.bib_text(e #>> '{}') is null)
    when field = 'issued' then jsonb_typeof(value) = 'string'
      and value #>> '{}' ~ '^[12][0-9]{3}(-(0[1-9]|1[0-2]))?$'
    else jsonb_typeof(value) = 'string' and private.bib_text(value #>> '{}') is not null
  end;
  if ok is not true then
    raise exception 'not a value for %', field;
  end if;
  insert into private.edition_fixes (edition_id, field, value, note)
  values (private.bib_edition_of(book), field, value, note)
  on conflict on constraint edition_fixes_pkey do update
    set value = excluded.value, note = excluded.note, made_at = now();
end;
$$;
revoke all on function private.fix_bibliography(uuid, text, jsonb, text)
  from public, anon, authenticated;

create function private.unfix_bibliography(book uuid, field text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from private.edition_fixes f
  where f.edition_id = private.bib_edition_of(book) and f.field = unfix_bibliography.field;
  if not found then
    raise exception 'no correction of %', field;
  end if;
end;
$$;
revoke all on function private.unfix_bibliography(uuid, text) from public, anon, authenticated;

-- Asks both sources again at the next turn, before anything else (a
-- correction or a deletion was asked for).
create function private.refetch_bibliography(book uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.edition_sources s set asked_at = now(), next_at = now()
  where s.edition_id = private.bib_edition_of(book) and s.state <> 'withdrawn';
  if not found then
    raise exception 'nothing to ask about: the book has no ISBN, or both sources are withdrawn';
  end if;
end;
$$;
revoke all on function private.refetch_bibliography(uuid) from public, anon, authenticated;

-- Takes a source's data off an edition and stops asking it (the source, or
-- whoever the book is about, asked for it to go), and puts it back to be
-- asked again.
create function private.withdraw_bibliography(book uuid, source text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.edition_sources s set state = 'withdrawn', record = null, record_id = null,
    status = null, fields = '{}', next_at = null, asked_at = null, misses = 0, failures = 0,
    title_kept_at = null
  where s.edition_id = private.bib_edition_of(book) and s.source = withdraw_bibliography.source;
  if not found then
    raise exception 'no % data for the book', source;
  end if;
end;
$$;
revoke all on function private.withdraw_bibliography(uuid, text) from public, anon, authenticated;

create function private.allow_bibliography(book uuid, source text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update private.edition_sources s set state = 'waiting', next_at = now()
  where s.edition_id = private.bib_edition_of(book) and s.source = allow_bibliography.source
    and s.state = 'withdrawn';
  if not found then
    raise exception 'the book''s % data was not withdrawn', source;
  end if;
end;
$$;
revoke all on function private.allow_bibliography(uuid, text) from public, anon, authenticated;

-- For the operator: editions whose found answer had no title (the master kept
-- the one it had), and those whose source failed four times in a row.
create view private.bibliography_review as
select e.isbn, s.source, s.state, s.failures, s.answered_at, s.title_kept_at,
  case when s.title_kept_at is not null then 'title kept' else 'failing' end as why,
  (select b.id from public.books b where b.edition_id = e.id order by b.created_at limit 1)
    as a_book
from private.edition_sources s
join public.editions e on e.id = s.edition_id
where s.title_kept_at is not null or s.failures >= 4;
revoke all on private.bibliography_review from public, anon, authenticated;

-- The edition ids' move was checked in production (2026-10-17 00:48Z): every
-- one of the 27 books in its edition (its ISBN's, or its own when it has
-- none) and in that edition's work, 27 editions in all, and the copy matched
-- with no row or link lost.
select private.drop_copy('20261031000000_edition_ids');
