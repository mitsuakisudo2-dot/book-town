-- The books a search looks at are narrowed to the ones the reader may read
-- before anything is counted or kept (AUD-154). found_book_ids counted the
-- books holding a query's pairs, cut them at 2,000 and chose near titles
-- among all of them, and asked the books' policy question only of the ones
-- it kept; now what a search gives depends on the books the reader may read
-- alone. Many books the reader may not read cost a few index scans, not a
-- question each (AUD-048: about 4.3 seconds for 20,000 of them in a made-up
-- town).
--
-- private.search_candidates tells, for many books at once, which may be
-- seen. A book from a catalog, or the reader's own, is seen (sure). Someone
-- else's typed-in book is seen only where it is used (book_is_listed), used
-- by the reader (book_is_mine) or shared with them (book_is_shared), and
-- each of those needs a row that names it: a record, a post, 人生の9冊, a
-- poster, a reading, the reader's marks, library or encounters, or a shelf
-- or the scene of a shop (its owner's books only, private.own_books_only; a
-- 見本 has no owner and is kept to be asked). A book no row names is passed
-- by; the others are asked the policy's question itself as found_book_ids
-- comes to them, best first, so what is seen is what the policy says, and
-- only as many are asked as it takes.
--
-- Only functions change; no table, no row, nothing to copy.
--
-- Rollback: a new migration with
--   the create function private.found_book_ids of
--   20261113000000_search_in_database.sql again (as create or replace), and
--   drop function private.search_candidates(uuid[]);
--   drop function private.book_is_seen(uuid);

create function private.search_candidates(ids uuid[])
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
    union select e.book_id from other_ids i join public.reading_entries e
      on e.book_id = any(i.ids)
    union select pb.book_id from other_ids i join public.poster_books pb
      on pb.book_id = any(i.ids)
    union select r.book_id from other_ids i join public.reading_sessions r
      on r.book_id = any(i.ids)
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
revoke all on function private.search_candidates(uuid[]) from public, anon, authenticated;

-- The question of the books' policy "books are seen where they are used".
create function private.book_is_seen(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.books x
    where x.id = b
      and (
        x.source <> 'manual'
        or x.created_by = (select auth.uid())
        or private.book_is_listed(x.id)
        or private.book_is_mine(x.id)
        or private.book_is_shared(x.id)
      )
  )
$$;
revoke all on function private.book_is_seen(uuid) from public, anon, authenticated;

-- As in 20261113000000_search_in_database.sql, but only the books that may
-- be seen (search_candidates) are kept, each asked the policy's question
-- (book_is_seen) unless sure, as it comes up; near titles are looked for,
-- and come after, when fewer than asked were kept of the books holding a
-- form's pairs or found by ISBN.
create or replace function private.found_book_ids(
  forms jsonb,
  whole_isbn text,
  isbn_start text,
  wanted integer
) returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  most integer := least(greatest(coalesce(wanted, 0), 0), 200);
  asked jsonb := case when jsonb_typeof(forms) = 'array' then forms else '[]'::jsonb end;
  form jsonb;
  form_grams text[];
  all_grams text[] := '{}';
  found uuid[] := '{}';
  by_isbn boolean := false;
  slice integer;
  size integer;
  step integer;
  kept uuid[] := '{}';
  editions uuid[] := '{}';
  candidate record;
begin
  if most = 0 then
    return kept;
  end if;

  if whole_isbn is not null and whole_isbn ~ '^[0-9]{12}[0-9X]$' then
    found := array(select b.id from public.books b where b.isbn = whole_isbn);
    by_isbn := true;
  else
    if isbn_start is not null and isbn_start ~ '^[0-9]{5,12}$' then
      found := array(
        select b.id from public.books b
        where b.isbn like isbn_start || '%'
          or (char_length(isbn_start) <= 9 and b.isbn like '978' || isbn_start || '%')
      );
      by_isbn := true;
    end if;
    -- The books holding every pair of a form, form by form.
    for form in select f from jsonb_array_elements(asked) f limit 20 loop
      form_grams := array(
        select g from jsonb_array_elements_text(
          case when jsonb_typeof(form -> 'grams') = 'array' then form -> 'grams' else '[]'::jsonb end
        ) g limit 200
      );
      continue when cardinality(form_grams) = 0;
      all_grams := all_grams || form_grams;
      found := found || array(
        select g.book_id from private.book_grams g
        where g.grams @> form_grams
      );
    end loop;
  end if;

  -- The books found by their pairs alone each hold all of a form's, so they
  -- come in the order of the rest of the keys, which no other book changes:
  -- they are taken a slice at a time in that order (each slice twice the
  -- one before), until enough are kept.
  if not by_isbn then
    found := array(
      select b.id from public.books b
      where b.id = any(found)
      order by (b.created_by = me) desc nulls last, (b.source <> 'manual') desc,
        b.created_at, b.id
    );
    slice := 1;
    size := 500;
    while slice <= cardinality(found) and cardinality(kept) < most loop
      for candidate in
        select b.id, b.edition_id, c.sure
        from private.search_candidates(found[slice:slice + size - 1]) c
        join public.books b on b.id = c.id
        order by (b.created_by = me) desc nulls last, (b.source <> 'manual') desc,
          b.created_at, b.id
      loop
        continue when candidate.edition_id = any(editions);
        continue when not candidate.sure and not private.book_is_seen(candidate.id);
        kept := kept || candidate.id;
        editions := editions || candidate.edition_id;
        exit when cardinality(kept) >= most;
      end loop;
      slice := slice + size;
      size := size * 2;
    end loop;
  end if;

  -- Found by ISBN too: all of them, best first. Then, if fewer than asked
  -- were kept, the books sharing enough pairs with a form (near titles).
  for step in 1..2 loop
    continue when step = 1 and not by_isbn;
    exit when step = 2 and (cardinality(kept) >= most or cardinality(all_grams) = 0);
    for candidate in
      select b.id, b.edition_id, c.sure
      from private.search_candidates(case when step = 1 then found else array(
          select g.book_id from private.book_grams g where g.grams && all_grams
          except
          select unnest(found)
        ) end) c
      join public.books b on b.id = c.id
      left join private.book_grams g on g.book_id = b.id
      where step = 1
        or exists (
          select 1 from jsonb_array_elements(asked) f
          where cardinality(array(
            select unnest(g.grams)
            intersect
            select jsonb_array_elements_text(f -> 'grams')
          )) >= greatest(coalesce((f ->> 'need')::integer, 1), 1)
        )
      order by
        -- Most of a form's pairs held first; the reader's own, then a book
        -- from a catalog, then the oldest, among equals.
        coalesce((
          select max(
            cardinality(array(
              select unnest(g.grams)
              intersect
              select jsonb_array_elements_text(f -> 'grams')
            ))::numeric
            / greatest(jsonb_array_length(f -> 'grams'), 1)
          )
          from jsonb_array_elements(asked) f
          where jsonb_typeof(f -> 'grams') = 'array'
        ), 1) desc,
        (b.created_by = me) desc nulls last,
        (b.source <> 'manual') desc,
        b.created_at,
        b.id
    loop
      continue when candidate.edition_id = any(editions);
      continue when not candidate.sure and not private.book_is_seen(candidate.id);
      kept := kept || candidate.id;
      editions := editions || candidate.edition_id;
      exit when cardinality(kept) >= most;
    end loop;
  end loop;
  return kept;
end;
$$;
