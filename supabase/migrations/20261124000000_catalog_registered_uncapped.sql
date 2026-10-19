-- AUD-162: the books readers registered are not counted against the catalog's
-- cap (private.catalog_settings), so they come into the catalog and its
-- search whatever the library's records took of it (the owner's cards of
-- 10-19 11:55Z, "出す", and 15:25Z, "すぐ"). With 9,999 of the 10,000 taken by
-- the trial, the registered books had stopped at one.
--
-- private.catalog_promote no longer counts or is stopped by the cap;
-- private.catalog_drop and private.catalog_gone count only the library's
-- batches when they write how many are taken; and the count is written once
-- here the same way. No row of a reader's, and no catalog row, changes.
--
-- Rollback: a new migration that runs
--   update private.catalog_settings s
--     set taken = (select count(*) from private.catalog_imports);
-- and then makes private.catalog_promote(), private.catalog_drop() and
-- private.catalog_gone() again as 20261123000000_library_catalog.sql has them.

-- As before (library_catalog), but not counted against the cap: a catalog row
-- made from a reader's registered book is not a record taken from the
-- library, and there are never more of them than the books readers
-- registered. The settings row is still locked first, so that a promotion
-- and a take wait for each other.
create or replace function private.catalog_promote(most integer default 2000, lately interval default null)
returns integer
language plpgsql security definer set search_path = '' as $$
declare
  recent uuid[];
  e record;
  m record;
  w record;
  book uuid;
  made integer := 0;
begin
  perform 1 from private.catalog_settings s for update;
  perform set_config('private.importing', 'on', true);
  if lately is not null then
    recent := array(
      select distinct b.edition_id from private.book_checks c
      join public.books b on b.id = c.book_id
      where c.judged_at > now() - lately);
  end if;
  for e in
    select d.id, d.isbn from public.editions d
    where (recent is null or d.id = any(recent))
      and d.isbn is not null
      and not exists (select 1 from public.books c where c.isbn = d.isbn and c.source = 'ndl')
      and exists (
        select 1 from private.edition_sources s
        where s.edition_id = d.id and s.state = 'found' and s.fields ? 'title')
      and exists (select 1 from public.books b where b.edition_id = d.id)
      and not exists (
        select 1 from public.books b
        left join private.book_checks c on c.book_id = b.id
        where b.edition_id = d.id and c.verdict is null)
    order by d.id
    limit least(greatest(coalesce(catalog_promote.most, 0), 0), 20000)
  loop
    select * into m from private.edition_bibliography(e.id);
    continue when m.title is null;
    select * into w from private.catalog_words(jsonb_strip_nulls(jsonb_build_object(
      'title', m.title, 'volume', m.volume, 'creators', m.creators, 'publisher', m.publisher)));
    insert into public.books (isbn, title, author, publisher, source, created_by)
    values (e.isbn, w.title, w.author, w.publisher, 'ndl', null)
    returning id into book;
    insert into private.catalog_imports (book_id, batch, issued)
    values (book, 'registered', left(m.issued, 7));
    -- It shows the bibliography the edition has, as its own words.
    update private.book_checks c set placed_at = '-infinity', checked_at = now(),
      verdict = 'same', judged_at = now()
    where c.book_id = book;
    made := made + 1;
  end loop;
  perform set_config('private.importing', '', true);
  return made;
end;
$$;

-- The library's batches only.
create or replace function private.catalog_drop(batch text) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b uuid;
  gone integer := 0;
begin
  for b in
    select i.book_id from private.catalog_imports i where i.batch = catalog_drop.batch
  loop
    continue when private.catalog_used(b);
    delete from public.books x where x.id = b and x.source = 'ndl';
    gone := gone + 1;
  end loop;
  update private.catalog_settings s set taken = (
    select count(*) from private.catalog_imports i where i.batch <> 'registered');
  return gone;
end;
$$;

create or replace function private.catalog_gone(records text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  b uuid;
  gone integer := 0;
begin
  for b in
    select i.book_id from private.catalog_imports i where i.record = any (records)
  loop
    continue when private.catalog_used(b);
    delete from public.books x where x.id = b and x.source = 'ndl';
    gone := gone + 1;
  end loop;
  update private.catalog_settings s set taken = (
    select count(*) from private.catalog_imports i where i.batch <> 'registered');
  return gone;
end;
$$;

update private.catalog_settings s set taken = (
  select count(*) from private.catalog_imports i where i.batch <> 'registered');
