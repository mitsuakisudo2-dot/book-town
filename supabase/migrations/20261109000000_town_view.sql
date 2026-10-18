-- The town in one answer (AUD-006 6a, AUD-135, AUD-043; docs/09「街を読む
-- 関数」). The app read the rows every reader may see of the town (profiles,
-- 人生の9冊, shops, the newest 便り, reactions, reading together, records,
-- folds, posters, the newest books) table by table, a page of 1000 rows at a
-- time: at 10,000 readers about a thousand requests, each from its own
-- moment, so rows that moved between two pages had the whole town read
-- again. town_view answers all of it in one statement, from one snapshot,
-- in the order the app read it; town_books answers the books those rows
-- point to, any number in one request.
--
-- Both are security invoker: each select runs as the reader who asks, under
-- the same row-level security and column grants as the reads they replace,
-- so nothing is shown that was not shown before. auth.uid() only leaves out
-- what a visitor never read (reactions) and the reader's own reading
-- sessions (read with the rest of their own rows). A reader's own rows that
-- carry a version (profiles.nine_version, shop_private, posters.version;
-- 20261107000000_write_versions) come back as before, so saving over a
-- version still works.
--
-- Reactions are asked for as the policy allows them, the reader's own and
-- those on the reader's own 便り, through the index on each rather than
-- by testing the policy on every row of the table (AUD-042).
--
-- With record_notes => false, others' reading records come without their
-- words (body ''): a profile's page reads them when it is opened. The rest
-- of a record (its book, feelings, audience, time) stays, for what the
-- town counts and says from it.
--
-- No table or row changes. Nothing to copy (private.keep_copy) before it.
--
-- Rollback: a new migration with
--   drop function public.town_view(integer, integer, boolean);
--   drop function public.town_books(uuid[]);
-- An app that finds neither reads the tables one by one, as before.

create function public.town_view(
  post_limit integer default 500,
  catalog_limit integer default 300,
  record_notes boolean default true
)
returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
declare
  town jsonb;
begin
  town := jsonb_build_object(
    'profiles', coalesce((
      select jsonb_agg(to_jsonb(p) order by p.created_at, p.id)
      from public.profiles p
    ), '[]'::jsonb),
    'nine', coalesce((
      select jsonb_agg(to_jsonb(n) order by n.profile_id, n.position)
      from public.profile_nine n
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
        limit least(greatest(post_limit, 0), 1000)
      ) newest
    ), '[]'::jsonb),
    'together', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.id)
      from public.reading_sessions t
      where t.mode = 'together' and t.ended_at is null
        and t.user_id is distinct from (select auth.uid())
    ), '[]'::jsonb),
    'records', coalesce((
      select jsonb_agg(case
        when record_notes or e.user_id = (select auth.uid()) then to_jsonb(e)
        else to_jsonb(e) || jsonb_build_object('body', '')
      end order by e.id)
      from public.reading_entries e
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
  -- A visitor reads no reactions (nor may they: anon has no grant on the
  -- table), so the statement is not even planned for one.
  if (select auth.uid()) is null then
    return town || jsonb_build_object('post_reactions', '[]'::jsonb);
  end if;
  return town || jsonb_build_object('post_reactions', coalesce((
    select jsonb_agg(to_jsonb(r) order by r.user_id, r.post_id, r.kind)
    from (
      select * from public.post_reactions
      where user_id = (select auth.uid())
      union
      select r.* from public.post_reactions r
      join public.posts p on p.id = r.post_id
      where p.author_id = (select auth.uid())
    ) r
  ), '[]'::jsonb));
end
$$;

create function public.town_books(ids uuid[])
returns jsonb
language sql stable security invoker set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object(
    'id', b.id, 'isbn', b.isbn, 'title', b.title, 'author', b.author,
    'publisher', b.publisher, 'price', b.price, 'source', b.source,
    'work_id', b.work_id, 'created_at', b.created_at, 'updated_at', b.updated_at
  ) order by b.id), '[]'::jsonb)
  from public.books b
  where b.id = any(ids)
$$;

revoke all on function public.town_view(integer, integer, boolean) from public;
revoke all on function public.town_books(uuid[]) from public;
grant execute on function public.town_view(integer, integer, boolean) to anon, authenticated;
grant execute on function public.town_books(uuid[]) to anon, authenticated;
