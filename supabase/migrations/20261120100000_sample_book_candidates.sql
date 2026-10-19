-- A sample book (one with no owner) is a candidate for a visitor too
-- (AUD-158's check in production). search_candidates kept as others' books
-- those whose owner "is distinct from" the reader; a visitor has no id, and
-- null is not distinct from null, so to a visitor a sample book was neither
-- the reader's own nor another's, and was never asked about: the town's
-- newest books and the search left out sample books a visitor may read
-- (used in a public post, a published poster, a reading together). Now a
-- book with no owner is always asked the books' policy question, as by_rows
-- already meant. Readers who are signed in saw them before and see the same.
--
-- Only the function changes; no table, no row, nothing to copy.
--
-- Rollback: a new migration with the create or replace function
-- private.search_candidates of 20261117000000_search_candidates_shown.sql
-- again.

create or replace function private.search_candidates(ids uuid[])
returns table (id uuid, sure boolean)
language sql stable security definer set search_path = '' as $$
  with asked as (
    select b.id, b.source, b.created_by
    from public.books b
    where b.id = any(ids)
  ),
  others as (
    select a.id, a.created_by from asked a
    where a.source = 'manual'
      and (a.created_by is null or a.created_by is distinct from (select auth.uid()))
  ),
  other_ids as (
    select coalesce(array_agg(o.id), '{}') as ids from others o
  ),
  by_rows as (
    select o.id from others o where o.created_by is null
    union select n.book_id from other_ids i join public.profile_nine n
      on n.book_id = any(i.ids)
    union select p.book_id from other_ids i join public.posts p
      on p.book_id = any(i.ids)
      and (p.reading_mode is distinct from 'solo' or p.author_id = (select auth.uid()))
    union select e.book_id from other_ids i join public.reading_entries e
      on e.book_id = any(i.ids)
      and (e.is_public or e.audience = 'followers' or e.user_id = (select auth.uid()))
    union select pb.book_id from other_ids i join public.poster_books pb
      on pb.book_id = any(i.ids)
      join public.posters ps on ps.id = pb.poster_id
      and (ps.status = 'published' or ps.author_id = (select auth.uid()))
    union select r.book_id from other_ids i join public.reading_sessions r
      on r.book_id = any(i.ids)
      and (r.mode = 'together' or r.user_id = (select auth.uid()))
    union select m.book_id from other_ids i join public.book_marks m
      on m.user_id = (select auth.uid()) and m.book_id = any(i.ids)
    union select l.book_id from other_ids i join public.library_entries l
      on l.user_id = (select auth.uid()) and l.book_id = any(i.ids)
    union select c.book_id from other_ids i join public.book_encounters c
      on c.user_id = (select auth.uid()) and c.book_id = any(i.ids)
  ),
  owners as (
    select coalesce(array_agg(distinct o.created_by), '{}') as ids
    from others o
    where o.created_by is not null and o.id not in (select r.id from by_rows r)
  ),
  -- The shops a book no row names could stand in: its owner's, and the
  -- reader's own.
  shelved as (
    select item ->> 'bookId' as id
    from owners w
      join public.shops s on s.is_open and s.owner_id = any(w.ids),
      jsonb_array_elements(case when jsonb_typeof(s.public_shelves) = 'array'
                                then s.public_shelves else '[]' end) shelf,
      jsonb_array_elements(case when jsonb_typeof(shelf -> 'items') = 'array'
                                then shelf -> 'items' else '[]' end) item
    union
    select jsonb_array_elements_text(case when jsonb_typeof(s.public_scene_books) = 'array'
                                          then s.public_scene_books else '[]' end)
    from owners w
      join public.shops s on s.is_open and s.owner_id = any(w.ids)
    union
    select item ->> 'bookId'
    from public.shop_private sp
    join public.shops s on s.id = sp.shop_id and s.owner_id = (select auth.uid()),
      jsonb_array_elements(case when jsonb_typeof(sp.shelves) = 'array'
                                then sp.shelves else '[]' end) shelf,
      jsonb_array_elements(case when jsonb_typeof(shelf -> 'items') = 'array'
                                then shelf -> 'items' else '[]' end) item
    union
    select jsonb_array_elements_text(case when jsonb_typeof(sp.scene_books) = 'array'
                                          then sp.scene_books else '[]' end)
    from public.shop_private sp
    join public.shops s on s.id = sp.shop_id and s.owner_id = (select auth.uid())
  ),
  named as (
    select r.id from by_rows r
    union select o.id from others o join shelved s on s.id = o.id::text
  )
  select a.id, true from asked a
  where a.source <> 'manual' or a.created_by = (select auth.uid())
  union all
  select n.id, false from named n
$$;
