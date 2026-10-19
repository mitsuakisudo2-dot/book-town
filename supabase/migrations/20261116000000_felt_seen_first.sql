-- A feeling's records, looked for only where the reader may look (AUD-006 6c;
-- docs/09「本の検索」). private.felt_page (20261113000000_search_in_database.sql)
-- gave every finished record felt with a feeling, newest first, and
-- felt_in_town and feeling_records read each page as the reader until one
-- was seen. Where most of a feeling's records are ones the reader may not
-- see, they walked them all: in a made-up town with 25,000 records of one
-- feeling kept by their reader alone, about 3.0 and 2.4 seconds for a
-- visitor (PGlite, not production; production's limit for visitors is 3
-- seconds).
--
-- Now felt_page gives only the records the policy might show the asker:
-- those shown to everyone (by a new index on their feelings), those shown to
-- followers of the readers the asker follows (from the asker's follows), and
-- the asker's own. Those the policy shows are among them, so felt_in_town and
-- feeling_records, which still read each page as the reader, answer as
-- before. Records of readers blocked either way or hidden by the operator are
-- still among those given, and passed by a page at a time; a visitor never
-- gets a follower's or a private record's id.
--
-- New: the index reading_entries_felt_everyone. felt_page is replaced with
-- the same arguments and answer; no row changes, and nothing is moved, so
-- nothing to copy (private.keep_copy) before it.
--
-- Rollback: a new migration with the create function private.felt_page of
-- 20261113000000_search_in_database.sql again (as create or replace), and
--   drop index public.reading_entries_felt_everyone;

create index reading_entries_felt_everyone on public.reading_entries
  using gin (feelings) where kind = 'finished' and audience = 'everyone';

create or replace function private.felt_page(
  feeling text,
  before_at timestamptz,
  before_id uuid,
  size integer
)
returns table (id uuid, created_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select seen.id, seen.created_at from (
    (
      select e.id, e.created_at from public.reading_entries e
      where e.kind = 'finished' and e.audience = 'everyone'
        and e.feelings @> array[feeling]
        and (before_at is null or (e.created_at, e.id) < (before_at, before_id))
      order by e.created_at desc, e.id desc
      limit least(greatest(size, 1), 500)
    )
    union all
    (
      select e.id, e.created_at
      from public.profile_follows f
      join public.reading_entries e on e.user_id = f.followee_id
      where f.follower_id = (select auth.uid())
        and e.kind = 'finished' and e.audience = 'followers'
        and e.feelings @> array[feeling]
        and (before_at is null or (e.created_at, e.id) < (before_at, before_id))
      order by e.created_at desc, e.id desc
      limit least(greatest(size, 1), 500)
    )
    union all
    (
      select e.id, e.created_at from public.reading_entries e
      where e.user_id = (select auth.uid())
        and e.kind = 'finished' and e.audience <> 'everyone'
        and e.feelings @> array[feeling]
        and (before_at is null or (e.created_at, e.id) < (before_at, before_id))
      order by e.created_at desc, e.id desc
      limit least(greatest(size, 1), 500)
    )
  ) seen
  order by seen.created_at desc, seen.id desc
  limit least(greatest(size, 1), 500)
$$;
