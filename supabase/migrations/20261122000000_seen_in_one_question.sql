-- The books a row names but the reader may not read are passed by a slice
-- at a time, not asked about one by one (AUD-160). The town's newest books
-- (private.newest_book_ids) and the search (private.found_book_ids) kept of
-- each slice the books a row could show the reader (search_candidates) and
-- asked private.book_is_seen of each in turn. book_is_seen and the
-- functions it asks are planned anew at every call: about 1.5ms a book in
-- production, against about 0.2ms with the same conditions in one query.
-- And a book in a record for followers was a candidate for everyone, a
-- visitor too, who can never read it: in a made-up town with eight such
-- books to each one shown, a visitor's town took about 5 seconds.
--
-- Now:
-- 1. A record for followers names its book only to a reader who follows
--    the record's owner (book_is_shared asks that too, and more), and to
--    no visitor.
--    A book whose owner left is no longer a candidate for everyone, as a
--    見本 is: only where a row names it.
-- 2. private.seen_book_ids tells, for many books in one query, which the
--    books' policy "books are seen where they are used" lets the reader
--    read: book_is_listed, book_is_mine and book_is_shared, written out in
--    one query; may_see is asked once for each owner of a record for
--    followers, not once a book. The newest books and the search ask it in
--    the order they keep books, a chunk at a time (private.keep_seen_books),
--    so they ask about little more than they keep.
--    A 見本 not used where anyone may see it costs a row of that query, not
--    a question of its own.
-- What is kept, and in what order, is what the policy says, as before.
-- Whoever widens book_is_listed, book_is_mine or book_is_shared widens
-- seen_book_ids the same way (tests/db-newest-books.test.ts compares them).
--
-- Only functions change; no table, no row, nothing to copy.
--
-- Rollback: a new migration with
--   the create or replace function private.search_candidates of
--   20261120100000_sample_book_candidates.sql, the create function
--   private.newest_book_ids of 20261120000000_newest_books_shown.sql and the
--   create or replace function private.found_book_ids of
--   20261114000000_search_candidates.sql again (each as create or replace),
--   then
--   drop function private.keep_seen_books(uuid[], integer, uuid[], uuid[]);
--   drop function private.seen_book_ids(uuid[]);

-- As in 20261120100000_sample_book_candidates.sql, but a record for
-- followers names its book only to a reader following its owner, and of
-- the books with no owner only 見本 are candidates whatever names them.
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
    -- A 見本 may stand on any shop's shelf. A book whose owner left (its
    -- created_by set null) is not one: no one else's row may name it
    -- (own_books_only), so it is named only as any other book is.
    select o.id from others o
    where o.created_by is null and private.is_sample_book(o.id)
    union select n.book_id from other_ids i join public.profile_nine n
      on n.book_id = any(i.ids)
    union select p.book_id from other_ids i join public.posts p
      on p.book_id = any(i.ids)
      and (p.reading_mode is distinct from 'solo' or p.author_id = (select auth.uid()))
    union select e.book_id from other_ids i join public.reading_entries e
      on e.book_id = any(i.ids)
      and (e.is_public or e.user_id = (select auth.uid())
        or (e.audience = 'followers' and exists (
          select 1 from public.profile_follows f
          where f.follower_id = (select auth.uid()) and f.followee_id = e.user_id
        )))
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

-- The books among ids the books' policy lets the reader read, in one query:
-- the policy's own terms, with the bodies of book_is_listed, book_is_mine
-- (as 20261025000000_library.sql left it) and book_is_shared written out,
-- each term over all the books at once. Shops are looked in only for the
-- books no other term let through, one index lookup a book, as
-- book_is_listed and book_is_mine do. Planned with sequential scans off, as
-- book_is_listed is, so every term is an index lookup however few rows a
-- table has; and in plpgsql, so its plan is kept from one call to the next
-- (a SQL function like book_is_seen is planned again at every call).
create function private.seen_book_ids(ids uuid[])
returns setof uuid
language plpgsql stable security definer set search_path = ''
set enable_seqscan = off as $$
begin
  return query
  with
  asked as (
    select x.id, x.source, x.created_by from public.books x
    where x.id = any(ids)
  ),
  -- book_is_shared: the owners of these books' records for followers whom
  -- the reader may see (may_see), each asked once. Materialized, so that
  -- the question is not pushed down to be asked of every record.
  owners as materialized (
    select distinct e.user_id from public.reading_entries e
    where (select auth.uid()) is not null
      and e.book_id = any(ids)
      and e.audience = 'followers'
  ),
  shown_owners as (
    select o.user_id from owners o
    where private.may_see(o.user_id, 'followers')
  ),
  by_rows as (
    select a.id from asked a
    where a.source <> 'manual' or a.created_by = (select auth.uid())
    -- book_is_listed, but for shops.
    union select n.book_id from public.profile_nine n
    where n.book_id = any(ids) and not private.is_hidden('profile', n.profile_id)
    union select p.book_id from public.posts p
    where p.book_id = any(ids)
      and p.reading_mode is distinct from 'solo'
      and not private.is_hidden('post', p.id)
      and not private.is_hidden('profile', p.author_id)
    union select e.book_id from public.reading_entries e
    where e.book_id = any(ids)
      and e.is_public
      and not private.is_hidden('profile', e.user_id)
    union select pb.book_id from public.poster_books pb
    join public.posters p on p.id = pb.poster_id
    where pb.book_id = any(ids)
      and p.status = 'published'
      and not private.is_hidden('poster', p.id)
      and not private.is_hidden('profile', p.author_id)
    union select r.book_id from public.reading_sessions r
    where r.book_id = any(ids)
      and r.mode = 'together'
      and not private.is_hidden('profile', r.user_id)
    -- book_is_mine, but for the reader's shop; nothing for a visitor.
    union select m.book_id from public.book_marks m
    where m.user_id = (select auth.uid()) and m.book_id = any(ids)
    union select l.book_id from public.library_entries l
    where l.user_id = (select auth.uid()) and l.book_id = any(ids)
      and l.removed_at is null
    union select c.book_id from public.book_encounters c
    where c.user_id = (select auth.uid()) and c.book_id = any(ids)
    union select p.book_id from public.posts p
    where p.author_id = (select auth.uid()) and p.book_id = any(ids)
    union select e.book_id from public.reading_entries e
    where e.user_id = (select auth.uid()) and e.book_id = any(ids)
    union select r.book_id from public.reading_sessions r
    where r.user_id = (select auth.uid()) and r.book_id = any(ids)
    union select n.book_id from public.profile_nine n
    where n.profile_id = (select auth.uid()) and n.book_id = any(ids)
    union select pb.book_id from public.poster_books pb
    join public.posters p on p.id = pb.poster_id
    where pb.book_id = any(ids) and p.author_id = (select auth.uid())
    -- book_is_shared.
    union select e.book_id from public.reading_entries e
    join shown_owners o on o.user_id = e.user_id
    where e.book_id = any(ids) and e.audience = 'followers'
  )
  select r.id from by_rows r
  where r.id = any(ids)
  union
  select a.id from asked a
  where a.id not in (select r.id from by_rows r)
    and (
      -- book_is_listed: an open shop's public shelves and scene.
      exists (
        select 1 from public.shops s
        where s.is_open
          and (
            s.public_scene_books @> jsonb_build_array(a.id::text)
            or s.public_shelves @> jsonb_build_array(jsonb_build_object(
              'items', jsonb_build_array(jsonb_build_object('bookId', a.id::text))))
          )
          and not private.is_hidden('shop', s.id)
          and not private.is_hidden('profile', s.owner_id)
      )
      -- book_is_mine: every shelf and scene of the reader's own shop.
      or ((select auth.uid()) is not null and exists (
        select 1 from public.shop_private sp
        where sp.shop_id = any (array(
            select s.id from public.shops s where s.owner_id = (select auth.uid())
          ))
          and (
            sp.scene_books @> jsonb_build_array(a.id::text)
            or sp.shelves @> jsonb_build_array(jsonb_build_object(
              'items', jsonb_build_array(jsonb_build_object('bookId', a.id::text))))
          )
      ))
    );
end;
$$;
revoke all on function private.seen_book_ids(uuid[]) from public, anon, authenticated;

-- Books in the order they are kept, asked about a chunk at a time
-- (seen_book_ids), the first chunk 100 books and each next one twice the
-- one before (at most 2,000): only about as many are asked about as it
-- takes, and nothing at all when there are none. kept goes on from the ones
-- given, while fewer than most are kept. Given editions, only one book of
-- each edition is kept, and editions goes on too; given null, any.
create function private.keep_seen_books(
  ordered uuid[],
  most integer,
  inout kept uuid[],
  inout editions uuid[]
)
language plpgsql stable security definer set search_path = '' as $$
declare
  first integer := 1;
  size integer := 100;
  candidate record;
begin
  while first <= coalesce(cardinality(ordered), 0) and cardinality(kept) < most loop
    for candidate in
      select u.id, b.edition_id
      from unnest(ordered[first:first + size - 1]) with ordinality u(id, n)
      join public.books b on b.id = u.id
      where u.id in (
        select s.id from private.seen_book_ids(ordered[first:first + size - 1]) s(id)
      )
      order by u.n
    loop
      if editions is not null then
        continue when candidate.edition_id = any(editions);
        editions := editions || candidate.edition_id;
      end if;
      kept := kept || candidate.id;
      exit when cardinality(kept) >= most;
    end loop;
    first := first + size;
    size := least(size * 2, 2000);
  end loop;
end;
$$;
revoke all on function private.keep_seen_books(uuid[], integer, uuid[], uuid[])
  from public, anon, authenticated;

-- As in 20261120000000_newest_books_shown.sql, but the books of a slice a
-- row names are asked about a chunk at a time (keep_seen_books).
create or replace function private.newest_book_ids(wanted integer)
returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  most integer := least(greatest(coalesce(wanted, 0), 0), 1000);
  size integer := 500;
  last_at timestamptz := 'infinity';
  last_id uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  slice uuid[];
  ordered uuid[];
  kept uuid[] := '{}';
begin
  while cardinality(kept) < most loop
    -- The next books, newest first, after the last slice's oldest.
    slice := array(
      select b.id from public.books b
      where b.created_at <= last_at
        and (b.created_at < last_at or b.id < last_id)
      order by b.created_at desc, b.id desc
      limit size
    );
    exit when cardinality(slice) = 0;
    select b.created_at, b.id into last_at, last_id
    from public.books b where b.id = slice[cardinality(slice)];
    ordered := array(
      select c.id from private.search_candidates(slice) c
      join public.books b on b.id = c.id
      order by b.created_at desc, b.id desc
    );
    select k.kept into kept
    from private.keep_seen_books(ordered, most, kept, null) k;
    exit when cardinality(slice) < size;
    size := least(size * 2, 8000);
  end loop;
  return kept;
end;
$$;
revoke all on function private.newest_book_ids(integer) from public, anon, authenticated;
grant execute on function private.newest_book_ids(integer) to anon, authenticated;

-- As in 20261114000000_search_candidates.sql, but the books a row names are
-- asked about a chunk at a time (keep_seen_books), not one by one.
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
  ordered uuid[];
  kept uuid[] := '{}';
  editions uuid[] := '{}';
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
      ordered := array(
        select b.id
        from private.search_candidates(found[slice:slice + size - 1]) c
        join public.books b on b.id = c.id
        order by (b.created_by = me) desc nulls last, (b.source <> 'manual') desc,
          b.created_at, b.id
      );
      select k.kept, k.editions into kept, editions
      from private.keep_seen_books(ordered, most, kept, editions) k;
      slice := slice + size;
      size := size * 2;
    end loop;
  end if;

  -- Found by ISBN too: all of them, best first. Then, if fewer than asked
  -- were kept, the books sharing enough pairs with a form (near titles).
  for step in 1..2 loop
    continue when step = 1 and not by_isbn;
    exit when step = 2 and (cardinality(kept) >= most or cardinality(all_grams) = 0);
    ordered := array(
      select b.id
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
    );
    select k.kept, k.editions into kept, editions
    from private.keep_seen_books(ordered, most, kept, editions) k;
  end loop;
  return kept;
end;
$$;
