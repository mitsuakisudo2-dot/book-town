-- A book a reader typed in or scanned stays theirs until they use it where
-- others can see (R2 of the 2026-10-13 review). Until now every row of books
-- was readable by anyone, so the titles a reader registered, and when, could
-- be listed through the API without ever being shown anywhere.
--
-- Who reads a book now:
-- * a catalog row ('ndl'): everyone, as before;
-- * a row typed in by hand ('manual'): the reader who typed it in, any reader
--   whose own rows use it (book_is_mine), and everyone once it is used where
--   anyone may look (book_is_listed).
--
-- Nothing is rewritten; only the read policy changes. Rollback: a new
-- migration that puts back "books are public" (using (true)).
--
-- A table or column that comes to refer to a book must be taught to these two
-- functions (create or replace), or the book goes missing from the screens
-- that show it. The policy itself stays as it is.
--
-- What this does not hide, and why that is enough:
-- * A foreign key is checked without row level security, so a reader who
--   knows a book's id can mark it, post about it or shelve it, and then read
--   it as their own. The id is the key: a typed-in book's id is random, and
--   the only rows others can read that carry it are rows that list it.
--   Writing a book under a taken id is refused (or, as the app's upsert does,
--   changes nothing), which tells that the id exists, never what it is.
-- * No function or view hands out a book's fields. The definer functions that
--   touch book ids (copy_public_shelves, copy_public_scene, list_poster_books)
--   only copy or list ids, and the two below answer yes or no.
-- * A cover removal request (a report about a book) is not a use: filing one
--   on an id must not unlock its title, and no screen needs it.

-- Used where anyone may look: the rows anon can read, by the same rules as
-- each table's own policy. A use hidden by the operator or held by a serious
-- report does not count; a folded one does, as it is still read with a tap.
-- Blocks are left out: whoever is blocked can read the same rows signed out.
-- 見本's book rows are listed like any other; the app shows the 見本's books
-- from its own copy (townFromRows), whether or not their rows can be read.
create function private.book_is_listed(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select
    -- 人生の9冊.
    exists (
      select 1 from public.profile_nine n
      where n.book_id = b and not private.is_hidden('profile', n.profile_id)
    )
    -- Posts, reviews, replies and 一緒に読む memos; never a private note.
    or exists (
      select 1 from public.posts p
      where p.book_id = b
        and p.reading_mode is distinct from 'solo'
        and not private.is_hidden('post', p.id)
        and not private.is_hidden('profile', p.author_id)
    )
    or exists (
      select 1 from public.reading_entries e
      where e.book_id = b
        and e.is_public
        and not private.is_hidden('profile', e.user_id)
    )
    or exists (
      select 1 from public.poster_books pb
      join public.posters p on p.id = pb.poster_id
      where pb.book_id = b
        and p.status = 'published'
        and not private.is_hidden('poster', p.id)
        and not private.is_hidden('profile', p.author_id)
    )
    -- Reading together, ended or not: the row stays readable after it ends.
    or exists (
      select 1 from public.reading_sessions r
      where r.book_id = b
        and r.mode = 'together'
        and not private.is_hidden('profile', r.user_id)
    )
    -- An open shop's public shelves and the public part of its store scene.
    or exists (
      select 1 from public.shops s
      where s.is_open
        and (
          s.public_scene_books @> jsonb_build_array(b::text)
          or s.public_shelves @> jsonb_build_array(jsonb_build_object(
            'items', jsonb_build_array(jsonb_build_object('bookId', b::text))))
        )
        and not private.is_hidden('shop', s.id)
        and not private.is_hidden('profile', s.owner_id)
    )
$$;

-- Used by the asking reader, private uses included: their marks, posts and
-- private notes (held or hidden too), records, reading, nine, posters and
-- drafts, and every shelf and scene of their own shop. Their own shop is
-- saved whole, so a book on a private shelf that could not be read would
-- drop out of the next save. It only ever answers about the asker.
create function private.book_is_mine(b uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (
      select 1 from public.book_marks m
      where m.user_id = (select auth.uid()) and m.book_id = b
    )
    or exists (
      select 1 from public.posts p
      where p.author_id = (select auth.uid()) and p.book_id = b
    )
    or exists (
      select 1 from public.reading_entries e
      where e.user_id = (select auth.uid()) and e.book_id = b
    )
    or exists (
      select 1 from public.reading_sessions r
      where r.user_id = (select auth.uid()) and r.book_id = b
    )
    or exists (
      select 1 from public.profile_nine n
      where n.profile_id = (select auth.uid()) and n.book_id = b
    )
    or exists (
      select 1 from public.poster_books pb
      join public.posters p on p.id = pb.poster_id
      where pb.book_id = b and p.author_id = (select auth.uid())
    )
    or exists (
      select 1 from public.shops s
      join public.shop_private sp on sp.shop_id = s.id
      where s.owner_id = (select auth.uid())
        and (
          sp.scene_books @> jsonb_build_array(b::text)
          or sp.shelves @> jsonb_build_array(jsonb_build_object(
            'items', jsonb_build_array(jsonb_build_object('bookId', b::text))))
        )
    )
  )
$$;

-- Asked by the policy below for every book read, signed in or not. The
-- private schema is not served by the API, so nobody calls them directly.
revoke execute on function private.book_is_listed(uuid), private.book_is_mine(uuid)
  from public;
grant execute on function private.book_is_listed(uuid), private.book_is_mine(uuid)
  to anon, authenticated;

-- The policy asks book_is_listed about every typed-in book that is not the
-- reader's own, so each of its questions should be an index lookup. Without
-- these, each one read every shop's shelves, every nine and every reading:
-- listing the newest books of a town of 200 shops and 7000 typed-in books
-- took five times as long.
create index profile_nine_book on public.profile_nine (book_id);
create index reading_sessions_book on public.reading_sessions (book_id)
  where book_id is not null;
create index shops_public_shelves on public.shops
  using gin (public_shelves jsonb_path_ops);
create index shops_public_scene_books on public.shops
  using gin (public_scene_books jsonb_path_ops);

drop policy "books are public" on public.books;
create policy "books are seen where they are used" on public.books
  for select to anon, authenticated
  using (
    source <> 'manual'
    or created_by = (select auth.uid())
    or private.book_is_listed(id)
    or private.book_is_mine(id)
  );
