-- The town's newest books pass by the books no one may be shown in a set,
-- not one at a time (AUD-158). town_view's catalog read the books newest
-- first and asked the books' policy of each until catalog_limit were kept,
-- so every typed-in book kept to a reader's own library, newer than the
-- last one kept, was asked about on each opening of the town, by everyone:
-- about 0.1ms each in a made-up town, and a reader's library grows. Now
-- private.newest_book_ids takes the books newest first a slice at a time,
-- keeps of each slice only the books a row could show the reader
-- (private.search_candidates, as the search does), and asks the policy
-- (private.book_is_seen) of those alone, in order, until enough are kept.
-- The catalog is then read as before, under the reader's own row-level
-- security, so it holds the same books in the same order: nothing shown
-- that was not shown before.
--
-- newest_book_ids answers only the ids of books the reader may read, as the
-- catalog does; anon and authenticated call it because town_view runs as
-- them. No table or row changes. Nothing to copy (private.keep_copy).
--
-- Rollback: a new migration with the create function public.town_view of
-- 20261110000000_town_window.sql again (as create or replace), then
--   drop function private.newest_book_ids(integer);

create function private.newest_book_ids(wanted integer)
returns uuid[]
language plpgsql stable security definer set search_path = '' as $$
declare
  most integer := least(greatest(coalesce(wanted, 0), 0), 1000);
  size integer := 500;
  last_at timestamptz := 'infinity';
  last_id uuid := 'ffffffff-ffff-ffff-ffff-ffffffffffff';
  slice uuid[];
  kept uuid[] := '{}';
  candidate record;
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
    for candidate in
      select c.id, c.sure
      from private.search_candidates(slice) c
      join public.books b on b.id = c.id
      order by b.created_at desc, b.id desc
    loop
      continue when not candidate.sure and not private.book_is_seen(candidate.id);
      kept := kept || candidate.id;
      exit when cardinality(kept) >= most;
    end loop;
    exit when cardinality(slice) < size;
    size := least(size * 2, 8000);
  end loop;
  return kept;
end;
$$;
revoke all on function private.newest_book_ids(integer) from public, anon, authenticated;
grant execute on function private.newest_book_ids(integer) to anon, authenticated;

create or replace function public.town_view(
  post_limit integer default 500,
  catalog_limit integer default 300,
  record_notes boolean default true,
  record_window integer default null,
  others_nine boolean default true
)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  me uuid := (select auth.uid());
  posts_kept integer := least(greatest(post_limit, 0), 1000);
  records_kept integer := least(greatest(record_window, 0), 1000);
  -- The works the reader finished. A visitor has none, and may not read
  -- book_marks (no grant to anon), so it is not even asked for one.
  finished_works uuid[] := '{}';
  -- The newest books the reader may read, found before the policy is
  -- asked of each (AUD-158).
  newest_ids uuid[] := private.newest_book_ids(catalog_limit);
  town jsonb;
begin
  if me is not null and record_window is not null then
    select coalesce(array_agg(distinct f.work_id), '{}') into finished_works
    from public.books f
    where f.work_id is not null and f.id in (
      select k.book_id from public.book_marks k
      where k.user_id = me and k.kind = 'finished'
      union
      select o.book_id from public.reading_entries o
      where o.user_id = me and o.kind = 'finished'
    );
  end if;

  town := jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
      from public.profiles p
    ), '[]'::jsonb),
    'nine', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.profile_id, n.position)
      from public.profile_nine n
      where others_nine or n.profile_id = me
    ), '[]'::jsonb),
    'shops', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', s.id, 'owner_id', s.owner_id, 'name', s.name,
        'description', s.description, 'tagline', s.tagline, 'theme', s.theme,
        'is_open', s.is_open, 'public_shelves', s.public_shelves,
        'public_scene_books', s.public_scene_books, 'created_at', s.created_at
      ) order by s.created_at, s.id)
      from public.shops s
    ), '[]'::jsonb),
    'posts', coalesce((
      select jsonb_agg(to_jsonb(newest) order by newest.created_at desc, newest.id desc)
      from (
        select * from public.posts
        order by created_at desc, id desc
        limit posts_kept
      ) newest
    ), '[]'::jsonb),
    'together', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.id)
      from public.reading_sessions t
      where t.mode = 'together' and t.ended_at is null
        and t.user_id is distinct from me
    ), '[]'::jsonb),
    'folds', coalesce((
      select jsonb_agg(jsonb_build_object(
        'target_kind', f.target_kind, 'target_id', f.target_id,
        'state', f.state, 'since', f.since
      ) order by f.target_kind, f.target_id)
      from public.moderation_folds f
    ), '[]'::jsonb),
    'posters', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.id)
      from public.posters x
    ), '[]'::jsonb),
    'catalog', coalesce((
      select jsonb_agg(to_jsonb(c) order by c.created_at desc, c.id desc)
      from (
        select b.id, b.isbn, b.title, b.author, b.publisher, b.price,
          b.source, b.work_id, b.created_at, b.updated_at
        from public.books b
        where b.id = any(newest_ids)
        order by b.created_at desc, b.id desc
        limit least(greatest(catalog_limit, 0), 1000)
      ) c
    ), '[]'::jsonb)
  );

  if record_window is null then
    town := town || jsonb_build_object('records', coalesce((
      select jsonb_agg(case
        when record_notes or e.user_id = me then to_jsonb(e)
        else to_jsonb(e) || jsonb_build_object('body', '')
      end order by e.id)
      from public.reading_entries e
    ), '[]'::jsonb));
  else
    town := town || jsonb_build_object('records', coalesce((
      select jsonb_agg(case
        when record_notes or e.user_id = me then to_jsonb(e)
        else to_jsonb(e) || jsonb_build_object('body', '')
      end order by e.id)
      from (
        -- Each once, however many of the reasons below bring it.
        select distinct on (kept.id) kept.* from (
          -- The reader's own, every one.
          select own.* from public.reading_entries own
          where own.user_id = me
          union all
          -- Others' newest.
          (
            select n.* from public.reading_entries n
            where n.kind = 'finished' and n.user_id is distinct from me
            order by n.created_at desc, n.id desc
            limit records_kept
          )
          union all
          -- What the 便り answered stand on: the writer's newest record of
          -- the book (letterFeelings), one 便り at a time.
          select r.* from (
            select p.author_id, p.book_id from public.posts p
            where p.book_id is not null
            order by p.created_at desc, p.id desc
            limit posts_kept
          ) p
          cross join lateral (
            select w.* from public.reading_entries w
            where w.user_id = p.author_id and w.book_id = p.book_id
              and w.kind = 'finished' and w.user_id is distinct from me
            order by w.created_at desc, w.id desc
            limit 1
          ) r
          union all
          -- Others' of the works the reader finished.
          (
            select m.* from public.books b
            join public.reading_entries m on m.book_id = b.id
            where cardinality(finished_works) > 0
              and b.work_id = any(finished_works)
              and m.kind = 'finished' and m.user_id <> me
            order by m.created_at desc, m.id desc
            limit records_kept
          )
        ) kept
        order by kept.id
      ) e
    ), '[]'::jsonb));
  end if;

  -- A visitor reads no reactions (nor may they: anon has no grant on the
  -- table), so the statement is not even planned for one.
  if me is null then
    return town || jsonb_build_object('post_reactions', '[]'::jsonb);
  end if;
  return town || jsonb_build_object('post_reactions', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.user_id, r.post_id, r.kind)
    from (
      select * from public.post_reactions
      where user_id = me
      union
      select r.* from public.post_reactions r
      join public.posts p on p.id = r.post_id
      where p.author_id = me
    ) r
  ), '[]'::jsonb));
end
$$;
