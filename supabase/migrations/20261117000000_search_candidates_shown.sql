-- The candidates of a search are only the books a row could show the
-- reader (AUD-156). search_candidates kept someone else's typed-in book to
-- be asked the books' policy question whenever any row named it, so books
-- named only where the policy never looks were each asked, without end:
-- about 10 seconds for 5,000 of them in a made-up town. Now a row counts
-- only where the policy could show its book: a record that is public, for
-- followers or the reader's own; a post not read alone (solo) or the
-- reader's own; a poster published or the reader's own; a reading together
-- or the reader's own. 人生の9冊, the reader's marks, library and
-- encounters, and shops' shelves and scenes, as before. What is seen is
-- still what the policy says (book_is_seen); fewer books are asked.
--
-- Only the function changes; no table, no row, nothing to copy.
--
-- Rollback: a new migration with the create function
-- private.search_candidates of 20261114000000_search_candidates.sql again
-- (as create or replace).

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
    where a.source = 'manual' and a.created_by is distinct from (select auth.uid())
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
