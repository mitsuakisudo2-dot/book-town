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
--   * Triggers keep it by what each write adds and takes away, never by
--     counting a work again: 便り written, moved or taken back; public
--     shelves changed and shops opened or closed; a book moved to another
--     work or deleted (before it goes, what it put in leaves its work); and
--     what the operator hides or a report holds or lets go. Adding is done
--     in the order of works, so writes at once neither lose a count nor wait
--     on each other in a circle, and costs what the write touched (a 便り,
--     a shop's shelves, a book's own 便り and shelves, one person's), however
--     many readers registered the same book.
--   * Every night (03:30 in Japan) private.recount_all counts everything
--     again from the rows and sets what drifted (writes at once with hiding,
--     say). A count is never let below 0 when read, and no write is refused
--     for one.
--   * town_counts(books, top) answers, as the reader, the counts of the
--     works of the books asked (books the reader may read only, by the
--     books' policy), without what people blocked either way with the reader
--     put in (counted from those people's own 便り and shop), and the works
--     most shelved and most talked of with a book of each the reader may
--     read (their own first). 読みたくなった is not counted here: only a
--     便り's writer sees how many wanted to read from it, as before.
--
-- New: the table private.work_counts (nobody reads it but the functions
-- below), its triggers, functions and nightly job. No row of any other table
-- changes, and nothing is moved, so nothing to copy (private.keep_copy)
-- before it.
--
-- Rollback: a new migration with
--   select cron.unschedule('work-counts');
--   drop function public.town_counts(uuid[], integer);
--   drop function private.counts_of(uuid[]);
--   drop function private.top_works(text, integer);
--   drop function private.work_faces(uuid);
--   drop trigger posts_count_came on public.posts;
--   drop trigger posts_count_changed on public.posts;
--   drop trigger posts_count_gone on public.posts;
--   drop trigger shops_count_came on public.shops;
--   drop trigger shops_count_changed on public.shops;
--   drop trigger shops_count_gone on public.shops;
--   drop trigger books_count_moved on public.books;
--   drop trigger books_count_gone on public.books;
--   drop trigger moderation_hides_count on public.moderation_hides;
--   drop trigger moderation_folds_count on public.moderation_folds;
--   drop function private.count_posts(), private.count_shops(),
--     private.count_book(), private.count_moderation();
--   drop function private.recount_all();
--   drop function private.tally_all();
--   drop function private.target_part(text, uuid);
--   drop function private.book_part(uuid, uuid);
--   drop function private.add_shops(jsonb);
--   drop function private.add_posts(jsonb);
--   drop function private.add_counts(uuid[], integer[], integer[], integer[]);
--   drop function private.shop_shown(uuid, uuid, boolean);
--   drop function private.post_counted(uuid, uuid, text, uuid);
--   drop function private.shelf_works(jsonb);
--   drop table private.work_counts;
-- An app that finds no town_counts counts the town it read, as before.

-- No check that a count is not below 0: a write is never refused for a
-- count. Reading takes 0 for less, and the night's recount sets it.
create table private.work_counts (
  work_id uuid primary key references public.works (id) on delete cascade,
  shelves integer not null default 0,
  talk integer not null default 0,
  reviews integer not null default 0
);
alter table private.work_counts enable row level security;
revoke all on table private.work_counts from public, anon, authenticated;
create index work_counts_shelves on private.work_counts (shelves desc, work_id)
  where shelves > 0;
create index work_counts_talk on private.work_counts (talk desc, work_id)
  where talk > 0;

-- Each work on a list of shelves, with how many of the shelves hold a book
-- of it. Ids that are not a book's are passed by.
create function private.shelf_works(list jsonb)
returns table (work_id uuid, shelves integer)
language sql stable security definer set search_path = '' as $$
  select b.work_id, count(distinct held.place)::integer
  from (
    select case
        when item ->> 'bookId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        then (item ->> 'bookId')::uuid
      end as book,
      entry.place
    from jsonb_array_elements(
        case when jsonb_typeof(list) = 'array' then list else '[]'::jsonb end
      ) with ordinality as entry(shelf, place)
    cross join lateral jsonb_array_elements(
      case when jsonb_typeof(entry.shelf -> 'items') = 'array'
        then entry.shelf -> 'items' else '[]'::jsonb end
    ) as item
    where jsonb_typeof(item) = 'object'
  ) held
  join public.books b on b.id = held.book
  group by b.work_id
$$;

-- Whether a 便り counts: of a book, not reading alone, not hidden or held,
-- nor its writer.
create function private.post_counted(post uuid, author uuid, mode text, book uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select book is not null and mode is distinct from 'solo'
    and not private.is_hidden('post', post)
    and not private.is_hidden('profile', author)
$$;

-- Whether a shop's public shelves count: open, not hidden, nor its owner.
create function private.shop_shown(shop uuid, owner uuid, is_open boolean)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(is_open, false)
    and not private.is_hidden('shop', shop)
    and not private.is_hidden('profile', owner)
$$;

-- Adds to works' counts (less where negative), in the order of works.
create function private.add_counts(
  d_works uuid[], d_shelves integer[], d_talk integer[], d_reviews integer[]
) returns void
language sql security definer set search_path = '' as $$
  insert into private.work_counts as c (work_id, shelves, talk, reviews)
  select d.work, d.shelves, d.talk, d.reviews
  from unnest(d_works, d_shelves, d_talk, d_reviews)
    as d(work, shelves, talk, reviews)
  where d.work is not null
    and (d.shelves <> 0 or d.talk <> 0 or d.reviews <> 0)
    and exists (select 1 from public.works w where w.id = d.work)
  order by d.work
  on conflict (work_id) do update
    set shelves = c.shelves + excluded.shelves,
      talk = c.talk + excluded.talk,
      reviews = c.reviews + excluded.reviews
$$;

-- 便り come (sign 1) or gone (-1), as rows of posts in JSON.
create function private.add_posts(moved jsonb) returns void
language sql security definer set search_path = '' as $$
  select private.add_counts(
    array_agg(d.work_id order by d.work_id),
    array_agg(0 order by d.work_id),
    array_agg(d.talk order by d.work_id),
    array_agg(d.reviews order by d.work_id))
  from (
    select b.work_id, sum(m.sign)::integer as talk,
      coalesce(sum(m.sign) filter (where m.parent_id is null), 0)::integer
        as reviews
    from jsonb_to_recordset(coalesce(moved, '[]'::jsonb)) as m(
      id uuid, book_id uuid, author_id uuid, parent_id uuid,
      reading_mode text, sign integer)
    join public.books b on b.id = m.book_id
    where private.post_counted(m.id, m.author_id, m.reading_mode, m.book_id)
    group by b.work_id
  ) d
$$;

-- Shops come (sign 1) or gone (-1), as rows of shops in JSON.
create function private.add_shops(moved jsonb) returns void
language sql security definer set search_path = '' as $$
  select private.add_counts(
    array_agg(d.work_id order by d.work_id),
    array_agg(d.shelves order by d.work_id),
    array_agg(0 order by d.work_id),
    array_agg(0 order by d.work_id))
  from (
    select w.work_id, sum(m.sign * w.shelves)::integer as shelves
    from jsonb_to_recordset(coalesce(moved, '[]'::jsonb)) as m(
      id uuid, owner_id uuid, is_open boolean, public_shelves jsonb,
      sign integer)
    cross join lateral private.shelf_works(m.public_shelves) w
    where private.shop_shown(m.id, m.owner_id, m.is_open)
    group by w.work_id
  ) d
$$;

-- What one book puts in a work as things are: its 便り, and the public
-- shelves holding it that hold no other book of the work.
create function private.book_part(book uuid, work uuid)
returns table (shelves integer, talk integer, reviews integer)
language sql stable security definer set search_path = '' as $$
  select
    (select count(*)::integer
      from public.shops s
      cross join lateral jsonb_array_elements(
        case when jsonb_typeof(s.public_shelves) = 'array'
          then s.public_shelves else '[]'::jsonb end) shelf
      where s.public_shelves @> jsonb_build_array(jsonb_build_object(
          'items', jsonb_build_array(jsonb_build_object('bookId', book::text))))
        and private.shop_shown(s.id, s.owner_id, s.is_open)
        and jsonb_typeof(shelf -> 'items') = 'array'
        and exists (
          select 1 from jsonb_array_elements(shelf -> 'items') i
          where i ->> 'bookId' = book::text)
        and not exists (
          select 1 from jsonb_array_elements(shelf -> 'items') i
          join public.books o on o.id = case
            when i ->> 'bookId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then (i ->> 'bookId')::uuid end
          where o.work_id = work and o.id <> book)),
    (select count(*)::integer from public.posts p
      where p.book_id = book
        and private.post_counted(p.id, p.author_id, p.reading_mode, p.book_id)),
    (select count(*)::integer from public.posts p
      where p.book_id = book and p.parent_id is null
        and private.post_counted(p.id, p.author_id, p.reading_mode, p.book_id))
$$;

-- What hiding or holding one thing changes, as though it were not hidden:
-- a 便り's, a shop's shelves', or a person's 便り and shop's.
create function private.target_part(kind text, target uuid)
returns table (work_id uuid, shelves integer, talk integer, reviews integer)
language sql stable security definer set search_path = '' as $$
  select x.work_id, sum(x.shelves)::integer, sum(x.talk)::integer,
    sum(x.reviews)::integer
  from (
    select b.work_id, 0 as shelves, 1 as talk,
      (p.parent_id is null)::integer as reviews
    from public.posts p join public.books b on b.id = p.book_id
    where kind = 'post' and p.id = target
      and p.reading_mode is distinct from 'solo'
      and not private.is_hidden('profile', p.author_id)
    union all
    select b.work_id, 0, 1, (p.parent_id is null)::integer
    from public.posts p join public.books b on b.id = p.book_id
    where kind = 'profile' and p.author_id = target
      and p.reading_mode is distinct from 'solo'
      and not private.is_hidden('post', p.id)
    union all
    select w.work_id, w.shelves, 0, 0
    from public.shops s cross join lateral private.shelf_works(s.public_shelves) w
    where kind = 'shop' and s.id = target and s.is_open
      and not private.is_hidden('profile', s.owner_id)
    union all
    select w.work_id, w.shelves, 0, 0
    from public.shops s cross join lateral private.shelf_works(s.public_shelves) w
    where kind = 'profile' and s.owner_id = target and s.is_open
      and not private.is_hidden('shop', s.id)
  ) x
  group by x.work_id
$$;

-- 便り: what the rows written put in, less what they put in before.
create function private.count_posts() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.add_posts((
      select jsonb_agg(to_jsonb(n) || '{"sign": 1}'::jsonb) from came n));
  elsif tg_op = 'DELETE' then
    perform private.add_posts((
      select jsonb_agg(to_jsonb(o) || '{"sign": -1}'::jsonb) from gone o));
  else
    perform private.add_posts((
      select jsonb_agg(x.post)
      from gone o join came n on n.id = o.id
      cross join lateral (values
        (to_jsonb(o) || '{"sign": -1}'::jsonb),
        (to_jsonb(n) || '{"sign": 1}'::jsonb)) as x(post)
      where (o.book_id, o.reading_mode, o.parent_id, o.author_id)
        is distinct from (n.book_id, n.reading_mode, n.parent_id, n.author_id)));
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

-- Shops: what their public shelves put in, less what they put in before.
create function private.count_shops() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform private.add_shops((
      select jsonb_agg(to_jsonb(n) || '{"sign": 1}'::jsonb) from came n));
  elsif tg_op = 'DELETE' then
    perform private.add_shops((
      select jsonb_agg(to_jsonb(o) || '{"sign": -1}'::jsonb) from gone o));
  else
    perform private.add_shops((
      select jsonb_agg(x.shop)
      from gone o join came n on n.id = o.id
      cross join lateral (values
        (to_jsonb(o) || '{"sign": -1}'::jsonb),
        (to_jsonb(n) || '{"sign": 1}'::jsonb)) as x(shop)
      where (o.is_open, o.owner_id, o.public_shelves)
        is distinct from (n.is_open, n.owner_id, n.public_shelves)));
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

-- Books: before one moves to another work (editions joined or set apart, a
-- book held), what it puts in leaves its old work and goes to the new one;
-- before one is deleted, it leaves. After it is gone, 便り and shelves that
-- still name it count for no work, here and at night alike.
create function private.count_book() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  part record;
begin
  select * into part from private.book_part(old.id, old.work_id);
  perform private.add_counts(array[old.work_id],
    array[-part.shelves], array[-part.talk], array[-part.reviews]);
  if tg_op = 'UPDATE' then
    select * into part from private.book_part(old.id, new.work_id);
    perform private.add_counts(array[new.work_id],
      array[part.shelves], array[part.talk], array[part.reviews]);
    return new;
  end if;
  return old;
end;
$$;
create trigger books_count_moved before update of work_id on public.books
  for each row when (old.work_id is distinct from new.work_id)
  execute function private.count_book();
create trigger books_count_gone before delete on public.books
  for each row execute function private.count_book();

-- What the operator hides, and what a report holds or lets go: only when
-- whether the thing is hidden changes (a fold that stays folded, or a held
-- one that stays held, changes nothing).
create function private.count_moderation() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  kind text;
  target uuid;
  other boolean;
  was boolean;
  is_now boolean;
  sign integer;
begin
  for kind, target in
    select distinct t.kind, t.target from (values
      (case when tg_op <> 'INSERT' then old.target_kind end,
        case when tg_op <> 'INSERT' then old.target_id end),
      (case when tg_op <> 'DELETE' then new.target_kind end,
        case when tg_op <> 'DELETE' then new.target_id end)
    ) as t(kind, target)
    where t.kind in ('post', 'shop', 'profile')
  loop
    if tg_table_name = 'moderation_hides' then
      other := exists (
        select 1 from public.moderation_folds f
        where f.target_kind = kind and f.target_id = target and f.state = 'held');
      was := other or coalesce(tg_op <> 'INSERT'
        and old.target_kind = kind and old.target_id = target, false);
      is_now := other or coalesce(tg_op <> 'DELETE'
        and new.target_kind = kind and new.target_id = target, false);
    else
      other := exists (
        select 1 from public.moderation_hides h
        where h.target_kind = kind and h.target_id = target);
      was := other or coalesce(tg_op <> 'INSERT'
        and old.target_kind = kind and old.target_id = target
        and old.state = 'held', false);
      is_now := other or coalesce(tg_op <> 'DELETE'
        and new.target_kind = kind and new.target_id = target
        and new.state = 'held', false);
    end if;
    if was is distinct from is_now then
      sign := case when is_now then -1 else 1 end;
      perform private.add_counts(
        array_agg(p.work_id order by p.work_id),
        array_agg(sign * p.shelves order by p.work_id),
        array_agg(sign * p.talk order by p.work_id),
        array_agg(sign * p.reviews order by p.work_id))
      from private.target_part(kind, target) p;
    end if;
  end loop;
  return null;
end;
$$;
create trigger moderation_hides_count
  after insert or update or delete on public.moderation_hides
  for each row execute function private.count_moderation();
create trigger moderation_folds_count
  after insert or update or delete on public.moderation_folds
  for each row execute function private.count_moderation();

-- Every work's counts from the rows, at once.
create function private.tally_all()
returns table (work_id uuid, shelves integer, talk integer, reviews integer)
language sql stable security definer set search_path = '' as $$
  with hidden as (
    select h.target_kind as kind, h.target_id as id from public.moderation_hides h
    union
    select f.target_kind, f.target_id from public.moderation_folds f
    where f.state = 'held'
  ),
  talked as (
    select b.work_id, count(*)::integer as talk,
      (count(*) filter (where p.parent_id is null))::integer as reviews
    from public.posts p join public.books b on b.id = p.book_id
    where p.reading_mode is distinct from 'solo'
      and not exists (select 1 from hidden x where x.kind = 'post' and x.id = p.id)
      and not exists (
        select 1 from hidden x where x.kind = 'profile' and x.id = p.author_id)
    group by b.work_id
  ),
  shelved as (
    select w.work_id, sum(w.shelves)::integer as shelves
    from public.shops s cross join lateral private.shelf_works(s.public_shelves) w
    where s.is_open
      and not exists (select 1 from hidden x where x.kind = 'shop' and x.id = s.id)
      and not exists (
        select 1 from hidden x where x.kind = 'profile' and x.id = s.owner_id)
    group by w.work_id
  )
  select coalesce(t.work_id, s.work_id), coalesce(s.shelves, 0),
    coalesce(t.talk, 0), coalesce(t.reviews, 0)
  from talked t full join shelved s on s.work_id = t.work_id
$$;

-- Sets every work's counts to what the rows say. Writes that would add
-- wait until it is done (and it, for those already adding), so none is
-- lost or counted twice.
create function private.recount_all() returns void
language plpgsql security definer set search_path = '' as $$
begin
  lock table private.work_counts in share row exclusive mode;
  with fresh as materialized (select * from private.tally_all()),
  dropped as (
    delete from private.work_counts c
    where not exists (select 1 from fresh f where f.work_id = c.work_id)
  )
  insert into private.work_counts as c (work_id, shelves, talk, reviews)
  select f.work_id, f.shelves, f.talk, f.reviews from fresh f
  where exists (select 1 from public.works w where w.id = f.work_id)
  order by f.work_id
  on conflict (work_id) do update
    set shelves = excluded.shelves, talk = excluded.talk,
      reviews = excluded.reviews
    where (c.shelves, c.talk, c.reviews)
      is distinct from (excluded.shelves, excluded.talk, excluded.reviews);
end;
$$;

revoke all on function private.shelf_works(jsonb) from public, anon, authenticated;
revoke all on function private.post_counted(uuid, uuid, text, uuid) from public, anon, authenticated;
revoke all on function private.shop_shown(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function private.add_counts(uuid[], integer[], integer[], integer[]) from public, anon, authenticated;
revoke all on function private.add_posts(jsonb) from public, anon, authenticated;
revoke all on function private.add_shops(jsonb) from public, anon, authenticated;
revoke all on function private.book_part(uuid, uuid) from public, anon, authenticated;
revoke all on function private.target_part(text, uuid) from public, anon, authenticated;
revoke all on function private.count_posts() from public, anon, authenticated;
revoke all on function private.count_shops() from public, anon, authenticated;
revoke all on function private.count_book() from public, anon, authenticated;
revoke all on function private.count_moderation() from public, anon, authenticated;
revoke all on function private.tally_all() from public, anon, authenticated;
revoke all on function private.recount_all() from public, anon, authenticated;

-- Every work counted from what is already there, and again every night
-- (18:30 UTC is 03:30 in Japan).
select private.recount_all();
select cron.schedule('work-counts', '30 18 * * *', 'select private.recount_all()');

-- Reading them -----------------------------------------------------------------

-- Works' counts for whoever asks: without what anyone blocked with them,
-- either way, put in, counted from those people's own 便り and shop.
create function private.counts_of(works uuid[])
returns table (work_id uuid, shelves integer, talk integer, reviews integer)
language plpgsql stable security definer set search_path = '' as $$
#variable_conflict use_column
declare
  apart uuid[] := '{}';
begin
  if auth.uid() is not null then
    apart := array(
      select b.blocked_id from public.blocks b where b.blocker_id = auth.uid()
      union
      select b.blocker_id from public.blocks b where b.blocked_id = auth.uid());
  end if;
  if cardinality(apart) = 0 then
    return query
    select c.work_id, greatest(c.shelves, 0), greatest(c.talk, 0),
      greatest(c.reviews, 0)
    from private.work_counts c where c.work_id = any(works);
    return;
  end if;
  return query
  with kept as (
    select c.work_id, c.shelves, c.talk, c.reviews from private.work_counts c
    where c.work_id = any(works)
  ),
  theirs as (
    select x.work_id, sum(x.shelves)::integer as shelves,
      sum(x.talk)::integer as talk, sum(x.reviews)::integer as reviews
    from (
      select b.work_id, 0 as shelves, 1 as talk,
        (p.parent_id is null)::integer as reviews
      from public.posts p join public.books b on b.id = p.book_id
      where p.author_id = any(apart) and b.work_id = any(works)
        and private.post_counted(p.id, p.author_id, p.reading_mode, p.book_id)
      union all
      select w.work_id, w.shelves, 0, 0
      from public.shops s
      cross join lateral private.shelf_works(s.public_shelves) w
      where s.owner_id = any(apart) and w.work_id = any(works)
        and private.shop_shown(s.id, s.owner_id, s.is_open)
    ) x
    group by x.work_id
  )
  select k.work_id,
    greatest(k.shelves - coalesce(t.shelves, 0), 0),
    greatest(k.talk - coalesce(t.talk, 0), 0),
    greatest(k.reviews - coalesce(t.reviews, 0), 0)
  from kept k left join theirs t on t.work_id = k.work_id;
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
  with readable as (
    select b.id, b.work_id from public.books b
    where b.id = any((town_counts.books)[1:1000])
  ),
  asked as (
    select r.id, c.shelves, c.talk, c.reviews
    from readable r
    join private.counts_of(array(select distinct work_id from readable)) c
      on c.work_id = r.work_id
    where c.shelves > 0 or c.talk > 0
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
    join private.counts_of(array(select work from tops)) c
      on c.work_id = tops.work
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

revoke all on function private.counts_of(uuid[]) from public, anon, authenticated;
revoke all on function private.top_works(text, integer) from public, anon, authenticated;
revoke all on function private.work_faces(uuid) from public, anon, authenticated;
revoke all on function public.town_counts(uuid[], integer) from public;
grant execute on function private.counts_of(uuid[]) to anon, authenticated;
grant execute on function private.top_works(text, integer) to anon, authenticated;
grant execute on function private.work_faces(uuid) to anon, authenticated;
grant execute on function public.town_counts(uuid[], integer) to anon, authenticated;
