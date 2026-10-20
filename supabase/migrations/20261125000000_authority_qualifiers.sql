-- AUD-163: a person's name in the bibliographic master leaves out what the
-- library's name authority writes after the name. private.bib_person took
-- off the years of a life ("1946-2026", "1950-") only, so a heading with a
-- death year alone ("-2026"), the years of the work ("pub. 2021"), a trade
-- or a field ("弁護士", "東洋史") or anything else after the given name was
-- the name as written ("藤原, 緋沙子, -2026"), and one with a single name and
-- such words had them put in front of it, as a romaji given name
-- ("pub. 2026 こーだ"). Now, as src/lib/book-name.ts authorWords reads the
-- catalogue's headings, with the same examples (tests/fixtures/authority-names.ts):
--
--   * a heading's third part and the ones after it are left out, but for a
--     romaji name's Jr., Sr., II, III or IV, which comes after the name
--     ("John Doe Jr.");
--   * a second part that is years ("-2026", "pub. 2021", "1962-L") leaves
--     the name alone ("こーだ").
--
-- The names already kept are made again the same way: those of the sources'
-- answers (private.edition_sources), where the name has a comma and is the
-- one the heading gave, and readings with a comma; then the author of the
-- catalog rows (books of 'ndl') whose editions' names changed, and the
-- readers' books of those editions are judged again (book_rechecks; a
-- verdict that stays the same changes nothing). 52 names of 49 editions in
-- production on 10-19. Nothing else changes, and no row is taken out.
--
-- Before that, the sources, the books, their checks and the books' search
-- words are copied (private.keep_copy), and compared after
-- (private.check_copy).
--
-- Rollback: a new migration that makes private.bib_person() again as
-- 20261101000000_bibliography.sql has it; the names made again stay as
-- they are (they are what the heading says), or come back from the copy
-- keep."20261125000000_authority_qualifiers" (private.restore_copy).

select private.keep_copy('20261125000000_authority_qualifiers',
  array['private.edition_sources', 'public.books', 'private.book_checks',
    'private.book_grams']::regclass[]);

-- The names to make again, read with the function as it was: a name the
-- heading gave (not the book's own statement of it) that has a comma.
create temporary table authority_fixed on commit drop as
  select s.edition_id, s.source, x.n
  from private.edition_sources s
  cross join lateral jsonb_array_elements(case when jsonb_typeof(s.fields -> 'creators') = 'array'
    then s.fields -> 'creators' else '[]' end) with ordinality x (c, n)
  where x.c ? 'heading' and x.c ->> 'name' ~ ','
    and x.c ->> 'name' = private.bib_person(x.c ->> 'heading');

create or replace function private.bib_person(raw text, apart text default '') returns text
language sql immutable set search_path = '' as $$
  select case
    when cardinality(p) < 2 or p[1] = '' then n
    when p[2] ~ '^(pub\.\s*)?-?[0-9]{2,4}[0-9.?]*(\s*-\s*[0-9]{0,4}\??)?[A-Z]?$' then p[1]
    when p[2] = '' then n
    when (p[1] || p[2]) ~ '[A-Za-z]' then concat_ws(' ', p[2], p[1],
      (select x from unnest(p[3:]) x where x ~ '^(Jr\.?|Sr\.?|II|III|IV)$' limit 1))
    else p[1] || apart || p[2]
  end
  from (select private.bib_text(regexp_replace(raw,
    '\s*,?\s*[0-9]{3,4}\??\s*-\s*([0-9]{3,4}\??)?\s*$', '')) as n) a
  cross join lateral (
    select array(select btrim(x) from regexp_split_to_table(n, ',') x) as p) b
$$;

update private.edition_sources s set fields = jsonb_set(s.fields, '{creators}', (
    select jsonb_agg(x.c
      || case when exists (
          select 1 from authority_fixed f
          where f.edition_id = s.edition_id and f.source = s.source and f.n = x.n)
        then jsonb_build_object('name', private.bib_person(x.c ->> 'heading')) else '{}' end
      || case when x.c ->> 'reading' ~ ','
        then jsonb_build_object('reading', private.bib_person(x.c ->> 'reading', ' ')) else '{}' end
      order by x.n)
    from jsonb_array_elements(s.fields -> 'creators') with ordinality x (c, n)))
where jsonb_typeof(s.fields -> 'creators') = 'array'
  and (exists (select 1 from authority_fixed f where f.edition_id = s.edition_id and f.source = s.source)
    or exists (select 1 from jsonb_array_elements(s.fields -> 'creators') c where c ->> 'reading' ~ ','));

-- The catalog rows of those editions, named by the master's people as
-- catalog_take and catalog_promote name them, and judged the same as when
-- they came (the update has them judged again, book_retitled).
create temporary table authority_rows on commit drop as
  select b.id, w.author
  from public.books b
  cross join lateral private.edition_bibliography(b.edition_id) m
  cross join lateral private.catalog_words(jsonb_build_object('title', 'x', 'creators', m.creators)) w
  where b.source = 'ndl'
    and b.edition_id in (select f.edition_id from authority_fixed f)
    and b.author is distinct from w.author;
update public.books b set author = r.author from authority_rows r where b.id = r.id;
update private.book_checks c set checked_at = now(), confirmed_at = null
from authority_rows r where c.book_id = r.id;

insert into private.book_rechecks (book_id)
  select b.id from public.books b
  where b.source = 'manual' and b.edition_id in (select f.edition_id from authority_fixed f)
on conflict do nothing;

select private.check_copy('20261125000000_authority_qualifiers');
