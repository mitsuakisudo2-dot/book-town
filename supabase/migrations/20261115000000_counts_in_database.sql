-- The town's counts kept by the database (AUD-006 6c; docs/09「数は DB で
-- 数える」). The search counted, in the browser, how many public shelves
-- hold a book and how many 便り talk of it, from the town it had read: every
-- shop, but only the newest 500 便り, so a book talked of before them looked
-- untalked of (and was offered among 「棚の隅の本」), and 「話題の本」 and
-- 「多くの棚に並ぶ本」 chose only among the books the town had read. Counts
-- are of all time (けにーさん, 10-18: counts and lists of the town are of all
-- time, no window), so the database keeps them as rows are written, and
-- answers them when the search opens.
--
--   * private.work_counts keeps, for each work, how many public shelves of
--     open shops hold any book of it (a shelf once, whatever it holds of the
--     work), and how many 便り and replies talk of it, and how many of those
--     are not replies, by everyone, not reading alone. What the operator hid
--     or a report holds (private.is_hidden) is not counted. No person's
--     column: it says nothing of who.
--   * Triggers keep it: on 便り written, moved or taken back, on public
--     shelves changed and shops opened or closed, on a book moved to another
--     work or deleted, and on what the operator hides or a report holds.
--     Each recounts only the works it touched (private.recount_work), by the
--     indexes of the 便り's books and of public shelves.
--   * town_counts(books, top) answers, as the reader, the counts of the
--     works of the books asked (books the reader may read only, by the
--     books' policy), without what people blocked either way with the reader
--     put in, and the works most shelved and most talked of with a book of
--     each the reader may read (their own first). 読みたくなった is not
--     counted here: only a 便り's writer sees how many wanted to read from
--     it, as before.
--
-- New: the table private.work_counts (nobody reads it but the functions
-- below), its triggers and functions. No row of any other table changes,
-- and nothing is moved, so nothing to copy (private.keep_copy) before it.
--
-- Rollback: a new migration with
--   drop function public.town_counts(uuid[], integer);
--   drop function private.counts_for(uuid);
--   drop function private.top_works(text, integer);
--   drop function private.work_faces(uuid);
--   drop trigger posts_count_came on public.posts;
--   drop trigger posts_count_changed on public.posts;
--   drop trigger posts_count_gone on public.posts;
--   drop trigger shops_count_came on public.shops;
--   drop trigger shops_count_changed on public.shops;
--   drop trigger shops_count_gone on public.shops;
--   drop trigger books_count_changed on public.books;
--   drop trigger books_count_gone on public.books;
--   drop trigger moderation_hides_count on public.moderation_hides;
--   drop trigger moderation_folds_count on public.moderation_folds;
--   drop function private.count_posts(), private.count_shops(),
--     private.count_books(), private.count_moderation();
--   drop function private.recount_target(text, uuid);
--   drop function private.recount_book_texts(text[]);
--   drop function private.recount_books(uuid[]);
--   drop function private.recount_work(uuid);
--   drop function private.work_tally(uuid, uuid[]);
--   drop function private.shelf_books(jsonb);
--   drop table private.work_counts;
-- An app that finds no town_counts counts the town it read, as before.

create table private.work_counts (
  work_id uuid primary key references public.works (id) on delete cascade,
  shelves integer not null default 0 check (shelves >= 0),
  talk integer not null default 0 check (talk >= 0),
  reviews integer not null default 0 check (reviews >= 0 and reviews <= talk)
);
alter table private.work_counts enable row level security;
revoke all on table private.work_counts from public, anon, authenticated;
create index work_counts_shelves on private.work_counts (shelves desc, work_id)
  where shelves > 0;
create index work_counts_talk on private.work_counts (talk desc, work_id)
  where talk > 0;

-- Each book on a list of shelves, with how many of them hold it.
create function private.shelf_books(shelves jsonb)
returns table (book text, shelves integer)
language sql immutable set search_path = '' as $$
  select held.book, count(distinct held.place)::integer
  from (
    select item ->> 'bookId' as book, entry.place
    from jsonb_array_elements(
        case when jsonb_typeof(shelf_books.shelves) = 'array'
          then shelf_books.shelves else '[]'::jsonb end
      ) with ordinality as entry(shelf, place)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(entry.shelf -> 'items') = 'array'
        then entry.shelf -> 'items' else '[]'::jsonb end
    ) as item
    where jsonb_typeof(item) = 'object' and item ->> 'bookId' is not null
  ) held
  group by held.book
$$;

-- A work's counts as everyone may see them: 便り and replies of any book of
-- it, not reading alone; public shelves of open shops holding any book of
-- it, a shelf once. Nothing hidden by the operator or held by a report.
-- With `people`, the part of it those people put in.
create function private.work_tally(work uuid, people uuid[] default null)
returns table (shelves integer, talk integer, reviews integer)
language sql stable security definer set search_path = '' as $$
  with copies as (
    select b.id from public.books b where b.work_id = work_tally.work
  ),
  said as (
    select p.parent_id from public.posts p
    where p.book_id in (select id from copies)
      and p.reading_mode is distinct from 'solo'
      and (work_tally.people is null or p.author_id = any(work_tally.people))
      and not private.is_hidden('post', p.id)
      and not private.is_hidden('profile', p.author_id)
  ),
  shops as (
    -- By the index of public shelves, a book at a time.
    select distinct s.id, s.public_shelves from copies c
    join public.shops s on s.public_shelves @> jsonb_build_array(
      jsonb_build_object('items', jsonb_build_array(
        jsonb_build_object('bookId', c.id::text))))
    where s.is_open
      and (work_tally.people is null or s.owner_id = any(work_tally.people))
      and not private.is_hidden('shop', s.id)
      and not private.is_hidden('profile', s.owner_id)
  )
  select
    (select count(*)::integer from shops s
      cross join lateral jsonb_array_elements(s.public_shelves) shelf
      where jsonb_typeof(shelf -> 'items') = 'array'
        and exists (
          select 1 from jsonb_array_elements(shelf -> 'items') item
          where item ->> 'bookId' in (select id::text from copies))),
    (select count(*)::integer from said),
    (select count(*)::integer from said where parent_id is null)
$$;

create function private.recount_work(work uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  t record;
begin
  if work is null then
    return;
  end if;
  if not exists (select 1 from public.works w where w.id = work) then
    delete from private.work_counts where work_id = work;
    return;
  end if;
  select * into t from private.work_tally(work);
  if t.shelves = 0 and t.talk = 0 then
    delete from private.work_counts where work_id = work;
  else
    insert into private.work_counts (work_id, shelves, talk, reviews)
    values (work, t.shelves, t.talk, t.reviews)
    on conflict (work_id) do update
      set shelves = excluded.shelves, talk = excluded.talk,
        reviews = excluded.reviews;
  end if;
end;
$$;

-- The works of books, each once.
create function private.recount_books(ids uuid[]) returns void
language sql security definer set search_path = '' as $$
  select private.recount_work(w.work_id) from (
    select distinct b.work_id from public.books b where b.id = any(ids)
  ) w
$$;

-- The same, for book ids as shelves keep them (text, maybe not an id).
create function private.recount_book_texts(ids text[]) returns void
language sql security definer set search_path = '' as $$
  select private.recount_books(array(
    select distinct id::uuid from unnest(ids) id
    where id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  ))
$$;

-- What hiding or holding something changes: a 便り's work, a shop's
-- shelved works, or all of a person's.
create function private.recount_target(kind text, target uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if kind = 'post' then
    perform private.recount_books(array(
      select p.book_id from public.posts p
      where p.id = target and p.book_id is not null));
  elsif kind = 'shop' then
    perform private.recount_book_texts(array(
      select b.book from public.shops s, private.shelf_books(s.public_shelves) b
      where s.id = target));
  elsif kind = 'profile' then
    perform private.recount_books(array(
      select distinct p.book_id from public.posts p
      where p.author_id = target and p.book_id is not null));
    perform private.recount_book_texts(array(
      select b.book from public.shops s, private.shelf_books(s.public_shelves) b
      where s.owner_id = target));
  end if;
end;
$$;

-- 便り: the works of the books written of, before and after.
create function private.count_posts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.recount_books(array(
      select distinct book_id from came where book_id is not null));
  elsif tg_op = 'DELETE' then
    perform private.recount_books(array(
      select distinct book_id from gone where book_id is not null));
  else
    perform private.recount_books(array(
      select distinct x.book_id from gone o join came n on n.id = o.id
      cross join lateral (values (o.book_id), (n.book_id)) as x(book_id)
      where x.book_id is not null
        and (o.book_id is distinct from n.book_id
          or o.reading_mode is distinct from n.reading_mode
          or o.parent_id is distinct from n.parent_id
          or o.author_id is distinct from n.author_id)));
  end if;
  return null;
end;
$$;
create trigger posts_count_came after insert on public.posts
  referencing new table as came
  for each statement execute function private.count_posts();
create trigger posts_count_changed after update on public.posts
  referencing old table as gone new table as came
  for each statement execute function private.count_posts();
create trigger posts_count_gone after delete on public.posts
  referencing old table as gone
  for each statement execute function private.count_posts();

-- Shops: the books whose shelves changed in number, or every book of a
-- shop opened, closed, made or closed for good.
create function private.count_shops() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.recount_book_texts(array(
      select b.book from came s, private.shelf_books(s.public_shelves) b
      where s.is_open));
  elsif tg_op = 'DELETE' then
    perform private.recount_book_texts(array(
      select b.book from gone s, private.shelf_books(s.public_shelves) b
      where s.is_open));
  else
    perform private.recount_book_texts(array(
      select x.book
      from gone o join came n on n.id = o.id
      cross join lateral (
        select coalesce(a.book, b.book) as book, a.shelves as was,
          b.shelves as now
        from private.shelf_books(o.public_shelves) a
        full join private.shelf_books(n.public_shelves) b on b.book = a.book
      ) x
      where o.is_open is distinct from n.is_open
        or o.owner_id is distinct from n.owner_id
        or x.was is distinct from x.now));
  end if;
  return null;
end;
$$;
create trigger shops_count_came after insert on public.shops
  referencing new table as came
  for each statement execute function private.count_shops();
create trigger shops_count_changed after update on public.shops
  referencing old table as gone new table as came
  for each statement execute function private.count_shops();
create trigger shops_count_gone after delete on public.shops
  referencing old table as gone
  for each statement execute function private.count_shops();

-- Books: one moved to another work (editions joined or set apart, a book
-- held) counts in its new work, and leaves its old one; one deleted leaves.
create function private.count_books() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    perform private.recount_work(w.work_id)
    from (select distinct work_id from gone) w;
  else
    perform private.recount_work(w.work_id) from (
      select o.work_id from gone o join came n on n.id = o.id
      where o.work_id is distinct from n.work_id
      union
      select n.work_id from gone o join came n on n.id = o.id
      where o.work_id is distinct from n.work_id
    ) w;
  end if;
  return null;
end;
$$;
create trigger books_count_changed after update on public.books
  referencing old table as gone new table as came
  for each statement execute function private.count_books();
create trigger books_count_gone after delete on public.books
  referencing old table as gone
  for each statement execute function private.count_books();

-- What the operator hides, and what a report holds or lets go.
create function private.count_moderation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform private.recount_target(old.target_kind, old.target_id);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    perform private.recount_target(new.target_kind, new.target_id);
  end if;
  return null;
end;
$$;
create trigger moderation_hides_count
  after insert or update or delete on public.moderation_hides
  for each row execute function private.count_moderation();
create trigger moderation_folds_count
  after insert or update or delete on public.moderation_folds
  for each row execute function private.count_moderation();

revoke all on function private.shelf_books(jsonb) from public, anon, authenticated;
revoke all on function private.work_tally(uuid, uuid[]) from public, anon, authenticated;
revoke all on function private.recount_work(uuid) from public, anon, authenticated;
revoke all on function private.recount_books(uuid[]) from public, anon, authenticated;
revoke all on function private.recount_book_texts(text[]) from public, anon, authenticated;
revoke all on function private.recount_target(text, uuid) from public, anon, authenticated;
revoke all on function private.count_posts() from public, anon, authenticated;
revoke all on function private.count_shops() from public, anon, authenticated;
revoke all on function private.count_books() from public, anon, authenticated;
revoke all on function private.count_moderation() from public, anon, authenticated;

-- Every work counted from what is already there.
select private.recount_work(w.work_id) from (
  select b.work_id from public.posts p join public.books b on b.id = p.book_id
  union
  select b.work_id from public.shops s
  cross join lateral private.shelf_books(s.public_shelves) held
  join public.books b on b.id::text = held.book
  where s.is_open
) w;

-- Reading them -----------------------------------------------------------------

-- A work's counts for whoever asks: without what anyone blocked with them,
-- either way, put in.
create function private.counts_for(work uuid)
returns table (shelves integer, talk integer, reviews integer)
language plpgsql stable security definer set search_path = '' as $$
declare
  kept record;
  apart uuid[];
  theirs record;
begin
  select c.shelves, c.talk, c.reviews into kept
  from private.work_counts c where c.work_id = work;
  if not found then
    return query select 0, 0, 0;
    return;
  end if;
  if auth.uid() is not null then
    apart := array(
      select b.blocked_id from public.blocks b where b.blocker_id = auth.uid()
      union
      select b.blocker_id from public.blocks b where b.blocked_id = auth.uid());
  end if;
  if coalesce(cardinality(apart), 0) = 0 then
    return query select kept.shelves, kept.talk, kept.reviews;
    return;
  end if;
  select * into theirs from private.work_tally(work, apart);
  return query select
    greatest(kept.shelves - theirs.shelves, 0),
    greatest(kept.talk - theirs.talk, 0),
    greatest(kept.reviews - theirs.reviews, 0);
end;
$$;

-- The works most shelved (counted = 'shelves') or most talked of ('talk'), by
-- what everyone may see: a few more than are shown, as blocks may lower
-- some for whoever asks.
create function private.top_works(counted text, size integer)
returns table (work uuid)
language sql stable security definer set search_path = '' as $$
  (select c.work_id from private.work_counts c
    where top_works.counted = 'shelves' and c.shelves > 0
    order by c.shelves desc, c.work_id
    limit least(greatest(size, 0), 50))
  union all
  (select c.work_id from private.work_counts c
    where top_works.counted = 'talk' and c.talk > 0
    order by c.talk desc, c.work_id
    limit least(greatest(size, 0), 50))
$$;

-- A few books that may stand for a work, the best first: the asker's own,
-- one from a catalog, the book of its newest 便り, one on a public shelf.
-- Ids only, and only of books the asker has or anyone may see used (never
-- one another reader keeps unused, which would tell it is there); the
-- asker reads them under the books' policy.
create function private.work_faces(work uuid)
returns uuid[]
language sql stable security definer set search_path = '' as $$
  select array_remove(array[
    (select b.id from public.books b
      where b.work_id = work and auth.uid() is not null
        and b.created_by = auth.uid()
      order by b.created_at limit 1),
    (select b.id from public.books b
      where b.work_id = work and b.source <> 'manual'
      order by b.created_at limit 1),
    (select p.book_id from public.posts p
      join public.books b on b.id = p.book_id
      where b.work_id = work and p.reading_mode is distinct from 'solo'
        and not private.is_hidden('post', p.id)
        and not private.is_hidden('profile', p.author_id)
      order by p.created_at desc limit 1),
    (select b.id from public.books b
      where b.work_id = work and exists (
        select 1 from public.shops s
        where s.is_open and not private.is_hidden('shop', s.id)
          and not private.is_hidden('profile', s.owner_id)
          and s.public_shelves @> jsonb_build_array(
          jsonb_build_object('items', jsonb_build_array(
            jsonb_build_object('bookId', b.id::text)))))
      order by b.created_at limit 1)
  ], null)
$$;

-- The counts the search shows, of all time: those of the works of `books`
-- (at most 1000; the ones the reader may read), and the `top` works most
-- shelved and most talked of (at most 20 each), each with a book of it the
-- reader may read. Security invoker: books are read as the reader.
create function public.town_counts(books uuid[], top integer default 6)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  with asked as (
    select b.id, c.shelves, c.talk, c.reviews
    from public.books b
    cross join lateral private.counts_for(b.work_id) c
    where b.id = any((town_counts.books)[1:1000])
      and (c.shelves > 0 or c.talk > 0)
  ),
  tops as (
    select kind.counted, t.work, t.place
    from (values ('shelves'), ('talk')) as kind(counted)
    cross join lateral private.top_works(kind.counted,
      least(greatest(town_counts.top, 0), 20) + 10)
      with ordinality as t(work, place)
  ),
  faced as (
    select tops.counted, tops.place, c.shelves, c.talk, c.reviews, face.book
    from tops
    cross join lateral private.counts_for(tops.work) c
    cross join lateral (
      select jsonb_build_object(
        'id', b.id, 'isbn', b.isbn, 'title', b.title, 'author', b.author,
        'publisher', b.publisher, 'price', b.price, 'source', b.source,
        'work_id', b.work_id, 'created_at', b.created_at,
        'updated_at', b.updated_at) as book
      from unnest(private.work_faces(tops.work)) with ordinality as f(id, rank)
      join public.books b on b.id = f.id
      order by f.rank limit 1
    ) face
  ),
  ranked as (
    select faced.*, row_number() over (
      partition by faced.counted
      order by case when faced.counted = 'shelves' then faced.shelves
        else faced.talk end desc, faced.place) as nth
    from faced
    where case when faced.counted = 'shelves' then faced.shelves
      else faced.talk end > 0
  )
  select jsonb_build_object(
    'counts', coalesce((select jsonb_agg(jsonb_build_object(
      'book', a.id, 'shelves', a.shelves, 'talk', a.talk,
      'reviews', a.reviews)) from asked a), '[]'::jsonb),
    'shelved', coalesce((select jsonb_agg(jsonb_build_object(
      'book', r.book, 'shelves', r.shelves, 'talk', r.talk,
      'reviews', r.reviews) order by r.nth) from ranked r
      where r.counted = 'shelves' and r.nth <= least(greatest(town_counts.top, 0), 20)),
      '[]'::jsonb),
    'talked', coalesce((select jsonb_agg(jsonb_build_object(
      'book', r.book, 'shelves', r.shelves, 'talk', r.talk,
      'reviews', r.reviews) order by r.nth) from ranked r
      where r.counted = 'talk' and r.nth <= least(greatest(town_counts.top, 0), 20)),
      '[]'::jsonb)
  )
$$;

revoke all on function private.counts_for(uuid) from public, anon, authenticated;
revoke all on function private.top_works(text, integer) from public, anon, authenticated;
revoke all on function private.work_faces(uuid) from public, anon, authenticated;
revoke all on function public.town_counts(uuid[], integer) from public;
grant execute on function private.counts_for(uuid) to anon, authenticated;
grant execute on function private.top_works(text, integer) to anon, authenticated;
grant execute on function private.work_faces(uuid) to anon, authenticated;
grant execute on function public.town_counts(uuid[], integer) to anon, authenticated;
