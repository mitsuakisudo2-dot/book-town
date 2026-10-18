-- A reader's rows name only books of their own (AUD-001, its second step; the
-- first was 20261105000000_own_book_rows.sql; docs/09「自分の本の行」).
-- A row of a reader's (a library row, a shelf's book, a mark, an encounter, a
-- post, a record, a reading, 人生の9冊, a poster's books, their shop's shelves
-- and scene) names their own registration, a catalog row ('ndl') or a 見本's
-- book, and the database refuses one naming a book typed in by anyone else
-- (private.own_books_only). The app makes a reader's own copy of such a book
-- the first time they use it (copy_book) and knows which books are theirs
-- (my_books), so what someone else typed in, and later edits, reaches only
-- their own rows. Rows that came to name someone else's book since the first
-- step are moved to copies as it moved them, with the same function, and the
-- copy the first step kept is let go (private.drop_copy).
--
-- copy_book(original, copy) makes the copy under the id the app gave it: the
-- same title, author, ISBN, publisher and price, the reader's, in the same
-- edition and so the same work (a book without an ISBN, in the edition of the
-- book it was copied from), written down as taken (private.book_copies). It
-- comes in as a registration of the reader's does, judged against the master
-- from now. Only a book the reader may read, typed in by someone else, is
-- copied; any other is answered as a book that is not there. Sent again, it
-- does nothing. my_books() answers the reader's own books, each with the book
-- it was copied from, if it is a copy. An encounter on a post meets the
-- reader's book of the post's book's edition, their copy of it, as well as
-- the post's book itself (check_book_encounter).
--
-- Rollback: the copies are their readers' registrations and stay, and
-- book_copies keeps the reason 'taken'. A new migration undoes the rest with
--   drop trigger library_entries_own_books on public.library_entries;
--   drop trigger library_shelf_books_own_books on public.library_shelf_books;
--   drop trigger book_marks_own_books on public.book_marks;
--   drop trigger book_encounters_own_books on public.book_encounters;
--   drop trigger posts_own_books on public.posts;
--   drop trigger reading_entries_own_books on public.reading_entries;
--   drop trigger reading_sessions_own_books on public.reading_sessions;
--   drop trigger profile_nine_own_books on public.profile_nine;
--   drop trigger poster_books_own_books on public.poster_books;
--   drop trigger shop_private_own_books on public.shop_private;
--   drop function public.copy_book(uuid, uuid), public.my_books(),
--     private.own_books_only(), private.poster_books_own(),
--     private.shop_books_own(), private.may_name_book(uuid, uuid),
--     private.is_my_book_of(uuid, uuid);
--   drop index public.books_created_by;

-- and then makes private.check_book_encounter() again as
-- 20261025000000_library.sql has it, with create or replace. pnpm test:db
-- runs exactly that. Should the move itself need undoing (readers' rows
-- naming the books they named before), before anyone has written to these
-- tables since: restore_copy puts every row of them back as it was kept (it
-- leaves the triggers above aside while it does), and the rows keyed by a
-- copy this move made, and the copy, go. The copies it made are the ones its
-- copy of public.books does not have. (The first step's move is no longer
-- undone: its copy is let go below.)
--   select * from private.restore_copy('20261106000000_own_books_only', array[
--     'public.library_entries', 'public.library_shelf_books', 'public.book_marks',
--     'public.book_encounters', 'public.posts', 'public.reading_entries',
--     'public.reading_sessions', 'public.profile_nine', 'public.posters',
--     'public.poster_books', 'public.shop_private', 'public.shops']::regclass[]);
--   do $$
--   begin
--     execute format(
--       'create temporary table moved_here as select c.book_id from private.book_copies c
--        where c.reason = ''moved'' and not exists (select 1 from keep.%I k where k.id = c.book_id)',
--       (select c.copy_name from keep.copies c
--        where c.label = '20261106000000_own_books_only' and c.source = 'public.books'));
--   end;
--   $$;
--   delete from public.library_shelf_books s using moved_here m where s.book_id = m.book_id;
--   delete from public.library_entries l using moved_here m where l.book_id = m.book_id;
--   delete from public.book_marks b using moved_here m where b.book_id = m.book_id;
--   delete from public.books b using moved_here m where b.id = m.book_id;
--   drop table moved_here;
-- docs/09「自分の本の行」has the steps.

-- Nobody writes a book or a reader's row naming one until this file is done;
-- reading goes on. In the order of 20261105000000_own_book_rows.sql, for the
-- reason it gives there.
select set_config('lock_timeout', '10s', true);
select private.keep_copy('20261106000000_own_books_only', array[
  'public.book_marks', 'public.library_shelf_books', 'public.library_entries',
  'public.book_encounters', 'public.posts', 'public.reading_entries',
  'public.reading_sessions', 'public.profile_nine', 'public.posters',
  'public.poster_books', 'public.shop_private', 'public.shops', 'public.books'
]::regclass[]);
do $$
begin
  lock table public.works in share row exclusive mode;
  lock table public.editions in share row exclusive mode;
  lock table private.edition_sources in share row exclusive mode;
  lock table private.book_checks in share row exclusive mode;
  lock table private.work_changes in share row exclusive mode;
end;
$$;

-- The first step's move was checked on production (2026-10-18, no rows to
-- move): its copy goes.
select private.drop_copy('20261105000000_own_book_rows');

-- The move ----------------------------------------------------------------------

-- Every reader whose rows name a book typed in by someone else, or by nobody
-- now, is given their copy of it, as the first step did.
create temporary table own_copies_made as
select distinct b.id as original, u.id as reader, null::uuid as own
from public.books b
cross join lateral private.book_users(b.id) u (id)
where b.source = 'manual' and not private.is_sample_book(b.id)
  and u.id is distinct from b.created_by;
update own_copies_made m set own = private.give_own_copy(m.original, m.reader, 'moved');

-- Besides check_copy's rows and links: no reader's row names a book typed in
-- by anyone else; every copy is its book but its id and whose it is, in its
-- book's edition and that edition's work; every other book is as it was; and
-- every row of the tables copied is as it was, the copies read as the books
-- they were made from. Counts only in the messages: they land in public
-- Actions logs.
create function pg_temp.copies_undone(r jsonb) returns jsonb
language plpgsql as $$
declare
  m record;
  t text := r::text;
begin
  for m in select own, original from own_copies_made loop
    t := replace(t, m.own::text, m.original::text);
  end loop;
  return t::jsonb;
end;
$$;
do $$
declare
  copied record;
  changed bigint;
begin
  select count(*) into changed
  from public.books b
  cross join lateral private.book_users(b.id) u (id)
  where b.source = 'manual' and not private.is_sample_book(b.id)
    and u.id is distinct from b.created_by;
  if changed > 0 then
    raise exception '% readers still name a book typed in by someone else', changed;
  end if;
  select count(*) into changed
  from own_copies_made m
  join public.books c on c.id = m.own
  join public.books o on o.id = m.original
  join public.editions e on e.id = c.edition_id
  where to_jsonb(c) - array['id', 'created_by', 'work_id']
      is distinct from to_jsonb(o) - array['id', 'created_by', 'work_id']
    or c.created_by is distinct from m.reader
    or c.work_id is distinct from e.work_id
    or not exists (
      select 1 from private.book_copies k
      where k.book_id = m.own and k.copied_from = m.original and k.reason = 'moved');
  if changed > 0 then
    raise exception '% copies are not their books', changed;
  end if;
  for copied in
    select c.source, c.copy_name from keep.copies c
    where c.label = '20261106000000_own_books_only'
  loop
    if copied.source = 'public.books' then
      execute format(
        'select count(*) from (
           (select to_jsonb(b) from public.books b
            where not exists (select 1 from own_copies_made m where m.own = b.id)
            except all
            select to_jsonb(k) - ''keep_owners'' from keep.%1$I k)
           union all
           (select to_jsonb(k) - ''keep_owners'' from keep.%1$I k
            except all
            select to_jsonb(b) from public.books b
            where not exists (select 1 from own_copies_made m where m.own = b.id))
         ) d',
        copied.copy_name) into changed;
    else
      execute format(
        'select count(*) from (
           (select pg_temp.copies_undone(to_jsonb(t)) from %1$s t
            except all
            select to_jsonb(k) - ''keep_owners'' from keep.%2$I k)
           union all
           (select to_jsonb(k) - ''keep_owners'' from keep.%2$I k
            except all
            select pg_temp.copies_undone(to_jsonb(t)) from %1$s t)
         ) d',
        copied.source, copied.copy_name) into changed;
    end if;
    if changed > 0 then
      raise exception 'the move changed % rows of %', changed, copied.source;
    end if;
  end loop;
end;
$$;
drop function pg_temp.copies_undone(jsonb);
drop table own_copies_made;

-- Rows keyed by their book are written again under the copy: measured above.
select private.check_copy('20261106000000_own_books_only',
  rows_may_go => array[
    'public.library_entries', 'public.library_shelf_books', 'public.book_marks',
    'public.poster_books'
  ]::regclass[]);

-- Whose rows may name what ---------------------------------------------------------

-- Whether a row of `reader`'s may name book `b`: their own registration, a
-- catalog row or a 見本's book. A book that is not there is left to the row's
-- foreign key, which says so as it always did.
create function private.may_name_book(b uuid, reader uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((
    select x.source <> 'manual' or private.is_sample_book(x.id)
      or coalesce(x.created_by = reader, false)
    from public.books x where x.id = b), true)
$$;
revoke all on function private.may_name_book(uuid, uuid) from public, anon, authenticated;

-- After a row is written, its book, if it names a new one, is one its reader
-- may name: tg_argv[0] is the column naming whose the row is. Security
-- definer, as who typed a book in is not readable; the refusal is the same
-- whatever the book, so it tells nothing about it.
create function private.own_books_only() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  now_named uuid := (to_jsonb(new) ->> 'book_id')::uuid;
begin
  if now_named is null or (tg_op = 'UPDATE'
      and now_named is not distinct from (to_jsonb(old) ->> 'book_id')::uuid) then
    return null;
  end if;
  if not private.may_name_book(now_named, (to_jsonb(new) ->> tg_argv[0])::uuid) then
    raise exception 'a reader''s rows name their own books'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.own_books_only() from public, anon, authenticated;
create trigger library_entries_own_books after insert or update of book_id
  on public.library_entries
  for each row execute function private.own_books_only('user_id');
create trigger library_shelf_books_own_books after insert or update of book_id
  on public.library_shelf_books
  for each row execute function private.own_books_only('user_id');
create trigger book_marks_own_books after insert or update of book_id
  on public.book_marks
  for each row execute function private.own_books_only('user_id');
create trigger book_encounters_own_books after insert or update of book_id
  on public.book_encounters
  for each row execute function private.own_books_only('user_id');
create trigger posts_own_books after insert or update of book_id
  on public.posts
  for each row execute function private.own_books_only('author_id');
create trigger reading_entries_own_books after insert or update of book_id
  on public.reading_entries
  for each row execute function private.own_books_only('user_id');
create trigger reading_sessions_own_books after insert or update of book_id
  on public.reading_sessions
  for each row execute function private.own_books_only('user_id');
create trigger profile_nine_own_books after insert or update of book_id
  on public.profile_nine
  for each row execute function private.own_books_only('profile_id');

-- A poster's books are its author's (poster_books follows the pages).
create function private.poster_books_own() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and new.book_id = old.book_id and new.poster_id = old.poster_id then
    return null;
  end if;
  if not private.may_name_book(new.book_id,
      (select p.author_id from public.posters p where p.id = new.poster_id)) then
    raise exception 'a reader''s rows name their own books'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.poster_books_own() from public, anon, authenticated;
create trigger poster_books_own_books after insert or update
  on public.poster_books
  for each row execute function private.poster_books_own();

-- A shop's shelves and scene are its owner's. Only the books new to them are
-- asked about; ids that are no book here (a 見本's by the app's name, a
-- broken one) are passed over, as everywhere the shelves are read.
create function private.shop_books_own() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  owner uuid := (select s.owner_id from public.shops s where s.id = new.shop_id);
  refused boolean;
begin
  with named (id, was) as (
    select jsonb_array_elements_text(new.scene_books), false
    union all
    select item ->> 'bookId', false
    from jsonb_array_elements(case when jsonb_typeof(new.shelves) = 'array'
                                   then new.shelves else '[]' end) shelf,
      jsonb_array_elements(case when jsonb_typeof(shelf -> 'items') = 'array'
                                then shelf -> 'items' else '[]' end) item
    union all
    select jsonb_array_elements_text(old.scene_books), true where tg_op = 'UPDATE'
    union all
    select item ->> 'bookId', true
    from jsonb_array_elements(case when tg_op = 'UPDATE' and jsonb_typeof(old.shelves) = 'array'
                                   then old.shelves else '[]' end) shelf,
      jsonb_array_elements(case when jsonb_typeof(shelf -> 'items') = 'array'
                                then shelf -> 'items' else '[]' end) item
  )
  select bool_or(not private.may_name_book(b.id, owner)) into refused
  from public.books b
  where b.id::text in (select n.id from named n where not n.was
                       except select n.id from named n where n.was);
  if refused then
    raise exception 'a reader''s rows name their own books'
      using errcode = '23514';
  end if;
  return null;
end;
$$;
revoke all on function private.shop_books_own() from public, anon, authenticated;
create trigger shop_private_own_books after insert or update of shelves, scene
  on public.shop_private
  for each row execute function private.shop_books_own();

-- An encounter on a post ------------------------------------------------------------

-- Whether `mine` is the asker's own book of the edition `b` is in: their copy
-- of it, or their own registration of its ISBN. Their own book only, so it
-- tells nothing of anyone else's.
create function private.is_my_book_of(b uuid, mine uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.books m join public.books o on o.edition_id = m.edition_id
    where m.id = mine and o.id = b and m.created_by = (select auth.uid()))
$$;
revoke all on function private.is_my_book_of(uuid, uuid) from public, anon;
grant execute on function private.is_my_book_of(uuid, uuid) to authenticated;

-- As 20261025000000_library.sql has it, and a post's encounter meets the
-- post's own book or the reader's copy of it: a reader's rows name their own
-- books (own_books_only above).
create or replace function private.check_book_encounter() returns trigger
language plpgsql set search_path = '' as $$
declare
  owner uuid;
  met uuid;
begin
  perform 1 from public.book_encounters c
  where c.id = new.id and c.user_id = new.user_id
  for key share;
  if found then
    return new;
  end if;
  if new.via = 'post' then
    if new.post_id is null or new.shop_id is not null
      or new.placement_key is not null then
      raise exception 'an encounter on a post names the post alone'
        using errcode = '23514';
    end if;
    select p.author_id, p.book_id into owner, met
    from public.posts p where p.id = new.post_id;
    if not found then
      raise exception 'the post met is not found' using errcode = '23503';
    end if;
  elsif new.via = 'pop' then
    if new.shop_id is null or new.placement_key is null
      or new.post_id is not null then
      raise exception 'an encounter on a POP names its shop and place'
        using errcode = '23514';
    end if;
    select s.owner_id into owner from public.shops s where s.id = new.shop_id;
    if not found then
      raise exception 'the shop met is not found' using errcode = '23503';
    end if;
  elsif new.post_id is not null or new.shop_id is not null
    or new.placement_key is not null then
    raise exception 'an encounter on a book''s page names no post or shop'
      using errcode = '23514';
  end if;
  if owner = new.user_id then
    raise exception 'a reader''s own post or shop is no encounter'
      using errcode = '23514';
  end if;
  if new.via = 'post' and met is distinct from new.book_id
    and not private.is_my_book_of(met, new.book_id) then
    raise exception 'an encounter on a post meets the post''s own book'
      using errcode = '23514';
  end if;
  new.other_reader_id := owner;
  return new;
end;
$$;

-- The app's copies and the reader's own books --------------------------------------------

alter table private.book_copies drop constraint book_copies_reason_check;
alter table private.book_copies add constraint book_copies_reason_check
  check (reason in ('moved', 'taken'));

-- A reader's own books, asked for by my_books (and an account's going).
create index books_created_by on public.books (created_by) where created_by is not null;

-- The reader's copy of a book typed in by someone else, under the id their
-- app gave it, made the first time they use the book (src/lib/own-books.ts).
-- The book is one they may read now, as the books' policy reads it (asked
-- of here, as who typed it in is not readable); asked for any other, the
-- answer is that of a book that is not there.
create function public.copy_book(original uuid, copy uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  reader uuid := (select auth.uid());
  x public.books%rowtype;
  made record;
begin
  if reader is null then
    raise exception 'only a reader keeps books' using errcode = '42501';
  end if;
  -- Sent again, its answer lost: made already.
  if exists (
    select 1 from private.book_copies c join public.books b on b.id = c.book_id
    where c.book_id = copy and c.copied_from = original and b.created_by = reader
  ) then
    return;
  end if;
  select * into x from public.books b
  where b.id = original and b.source = 'manual' and not private.is_sample_book(b.id)
    and b.created_by is distinct from reader
    and (private.book_is_listed(b.id) or private.book_is_mine(b.id)
      or private.book_is_shared(b.id));
  if not found then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  insert into public.books (id, isbn, title, author, publisher, price, source, created_by)
  values (copy, x.isbn, x.title, x.author, x.publisher, x.price, 'manual', reader)
  returning edition_id, work_id into made;
  if x.isbn is null then
    update public.books b set edition_id = x.edition_id, work_id = x.work_id
    where b.id = copy;
    delete from public.editions e where e.id = made.edition_id;
    delete from public.works w where w.id = made.work_id;
  end if;
  insert into private.book_copies (book_id, copied_from, reason)
  values (copy, original, 'taken');
end;
$$;
revoke all on function public.copy_book(uuid, uuid) from public, anon, authenticated;
grant execute on function public.copy_book(uuid, uuid) to authenticated;

-- The reader's own books, each copy with the book it was made from (a book
-- since gone, none). Their own only, as who typed a book in is not readable.
create function public.my_books() returns table (id uuid, copied_from uuid)
language sql stable security definer set search_path = '' as $$
  select b.id, c.copied_from from public.books b
  left join private.book_copies c on c.book_id = b.id
  where b.created_by = (select auth.uid())
$$;
revoke all on function public.my_books() from public, anon, authenticated;
grant execute on function public.my_books() to authenticated;
