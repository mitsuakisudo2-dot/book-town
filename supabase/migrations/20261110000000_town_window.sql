-- The town without every reader's records and 人生の9冊 (AUD-006 6a, the
-- third part; docs/09「街を読む関数」). town_view answered every record and
-- every reader's nine, so each reader who joined made every town larger and
-- slower to read, for everyone. Others' records and nines are now read when
-- a screen shows them: a reader's on their profile's page, a book's on its
-- page (work_records). The town itself keeps what it shows of them:
--
--   * the newest records of others (record_window of them), for the books
--     finished lately;
--   * the record each 便り it answers stands on (the writer's own record of
--     the book), for the feelings shown on the 便り;
--   * others' records of the works the reader finished (record_window of
--     them), for the notice that someone else finished one too.
--
-- Which feelings anyone in the town has kept is asked when the search opens
-- (felt_in_town), over all time, not a window (けにーさん, 10-18: counts and
-- lists of the town are of all time).
--
-- Others' nines are left out with others_nine => false; the reader's own
-- stays. With record_window null (the default) and others_nine true, the
-- answer is the one before, so an app from before this file reads the same
-- town.
--
-- Records of others that only say a book was opened or bought (kind other
-- than finished) are never read by the app, and are left out of the window.
--
-- Both are security invoker, as before: each select runs as the reader who
-- asks, under the same row-level security, so nothing is shown that was not
-- shown before. A record is tested against its policy only once it is found
-- by an index (the newest, by created_at; a work's, by book_id; a 便り's
-- writer's, by user_id), so the town costs no more as records are added. An
-- index on feelings would not help: the policy is tested before a filter
-- that is not leakproof, as @> is not.
--
-- The feelings are the ones reading_entries' check allows (FEELINGS in
-- src/lib/types.ts); a file that adds one adds it here too
-- (tests/db-town-window.test.ts compares the two).
--
-- No table or row changes. Nothing to copy (private.keep_copy) before it.
--
-- Rollback: a new migration with
--   drop function public.felt_in_town();
--   drop function public.work_records(uuid, integer);
--   drop function public.town_view(integer, integer, boolean, integer, boolean);
--   drop index public.reading_entries_newest;
--   drop index public.reading_entries_book;
-- and the create function public.town_view(integer, integer, boolean) of
-- 20261109000000_town_view.sql again, with its revoke and grant. An app that
-- finds no town_view with these arguments asks it as before, and reads the
-- whole town.

create index reading_entries_newest
  on public.reading_entries (created_at desc, id desc);
create index reading_entries_book on public.reading_entries (book_id);

drop function public.town_view(integer, integer, boolean);

create function public.town_view(
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

-- A book's page: the records of its work, newest first, at most
-- record_limit of them (up to 1000), others' without their words, as the
-- town reads them. Of every book of the work the reader may read.
create function public.work_records(book uuid, record_limit integer default 200)
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(case
    when e.user_id = (select auth.uid()) then to_jsonb(e)
    else to_jsonb(e) || jsonb_build_object('body', '')
  end order by e.created_at desc, e.id desc), '[]'::jsonb)
  from (
    select r.* from public.reading_entries r
    join public.books b on b.id = r.book_id
    where r.kind = 'finished'
      and b.work_id = (select w.work_id from public.books w where w.id = book)
    order by r.created_at desc, r.id desc
    limit least(greatest(record_limit, 0), 1000)
  ) e
$$;

-- The search: which feelings anyone kept, in records the reader may see,
-- of all time. It stops once every feeling is found, so a town where each is
-- kept somewhere is answered from its first records; one where a feeling is
-- kept nowhere reads every record once, as the whole town did before.
create function public.felt_in_town()
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  every text[] := array[
    'cried', 'quiet', 'sleepless', 'warm', 'laughed', 'scared',
    'shaken', 'again', 'recommend', 'talk', 'lingering', 'not_now'
  ];
  found text[] := '{}';
  kept text[];
begin
  for kept in
    select e.feelings from public.reading_entries e
    where e.kind = 'finished' and e.feelings <> '{}'
  loop
    found := array(select distinct unnest(found || kept));
    exit when cardinality(found) = cardinality(every);
  end loop;
  return coalesce((
    select jsonb_agg(feeling order by place)
    from unnest(every) with ordinality as felt(feeling, place)
    where feeling = any(found)
  ), '[]'::jsonb);
end
$$;

revoke all on function public.town_view(integer, integer, boolean, integer, boolean) from public;
revoke all on function public.felt_in_town() from public;
revoke all on function public.work_records(uuid, integer) from public;
grant execute on function public.town_view(integer, integer, boolean, integer, boolean) to anon, authenticated;
grant execute on function public.work_records(uuid, integer) to anon, authenticated;
grant execute on function public.felt_in_town() to anon, authenticated;
