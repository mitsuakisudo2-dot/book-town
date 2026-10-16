-- Works and editions (item 4 of the 2026-10-16 plan). A row of books has
-- always been one edition: one ISBN, or one book typed in by hand. A work
-- gathers the editions of one text: a 文庫 and its 単行本, an old and a new
-- translation, an original and its translation, and the same ISBN typed in
-- by two readers, who each keep their own row (hide_registered_titles).
-- Reviews, posts, POPs and posters meet at the work; a reader's own records,
-- marks and shelves stay on the edition they hold. A work is one volume:
-- series and their volumes (item 6) come above works later, so 上 and 下 are
-- two works.
--
-- How books come together (the owner's rules, 2026-10-16 12:10Z): better
-- left apart as a candidate than joined by mistake. The same ISBN joins a
-- book to the work of the books already there; ISBN-10s are stored as their
-- ISBN-13 (the app turns them, and isbn13_valid refuses anything else), so
-- equal means equal. Unless their titles or authors clearly disagree
-- (same_edition_text): then the book gets a work of its own, and the
-- operator looks at the pair. Different ISBNs, or none, with the same title
-- and author make a candidate for the operator, never joined by itself.
--
-- The operator joins works (join_works), parts books out again
-- (part_books), and marks two works as different (keep_apart). A joined
-- work keeps its books for good, so a book registered later with the ISBN
-- of any of them joins that work too. Every book that joined a work with
-- others in it, and every join and part, is written down
-- (private.work_changes), so each can be undone. Later rules (a catalog's
-- work ids, say) go into isbn_work and the catalog import, which may name a
-- work itself.
--
-- What moves: no row loses or changes anything. Every book gets a work, by
-- the same rules as a new one, oldest first; whatever points at a book
-- (posts, marks, the library, encounters, records, reading, the nine,
-- posters, shops' shelves and scenes) reaches its work through it.
--
-- Who reads what: a book's work_id is read with the book. A work holds
-- nothing of its own yet, and nobody reads works through the API. A work id
-- tells nothing about the other editions in it: each is read only where its
-- own book may be read (hide_registered_titles), and a work is a fresh random
-- id, never a book's. Readers never name a work: books' column grants leave
-- work_id out, and the database fills it in.
--
-- The copy (moving_copies): books, and every table that points at a book,
-- so the check finds every row and link as it was. Nothing writes to them
-- until this file is done. docs/09「作品と版」has the steps and the undoing.
--
-- Rollback: until an app that reads work_id is live, a new migration undoes
-- this one with
--   drop trigger books_work on public.books;
--   drop trigger books_work_placed on public.books;
--   drop function private.book_work(), private.book_work_placed(),
--     private.isbn_work(text, text, text), private.join_works(uuid, uuid),
--     private.part_books(uuid[]), private.keep_apart(uuid, uuid),
--     private.work_candidates();
--   drop table private.works_apart, private.work_changes;
--   alter table public.books drop column work_id;
--   drop table public.works;
--   drop function private.same_edition_text(text, text, text, text),
--     private.same_author_text(text, text), private.fold_book_text(text);
--   revoke insert, update on public.books from authenticated;
--   grant insert, update on public.books to authenticated;

-- pnpm test:db runs exactly that, then drops the copy and runs this file
-- again. Once an app reads work_id, production has to go back to an app from
-- before it first: a town that asks for a column the database lacks does not
-- load. This file changes no book's own columns, and the check below makes
-- sure. Should they need putting back as the copy kept them, after the
-- rollback (the copy has no work_id, and a book needs one until then):
--   select * from private.restore_copy('20261027000000_works', array['public.books']::regclass[]);

-- Nobody reads or writes a book until this file is done, and the copy, the
-- works and the check all see the same books. Taken before the copy's own
-- lock, so this file never waits to raise a lock it holds.
select set_config('lock_timeout', '10s', true);
lock table public.books in access exclusive mode;

select private.keep_copy('20261027000000_works', array[
  'public.books',
  'public.book_encounters',
  'public.book_marks',
  'public.library_entries',
  'public.library_shelf_books',
  'public.poster_books',
  'public.posts',
  'public.profile_nine',
  'public.reading_entries',
  'public.reading_sessions'
]::regclass[]);

-- Telling books apart ------------------------------------------------------------------

-- A title or an author as it is compared: full and half width, case,
-- spaces and punctuation set aside (「新装版」 and 新装版, ＡＢＣ and abc).
create function private.fold_book_text(t text) returns text
language sql immutable set search_path = '' as $$
  select lower(translate(
    regexp_replace(normalize(coalesce(t, ''), nfkc), '\s', '', 'g'),
    '!"#$%&''()*+,-./:;<=>?@[\]^_`{|}~「」『』〔〕【】〈〉《》〘〙・、。〜',
    ''
  ))
$$;
revoke all on function private.fold_book_text(text) from public, anon, authenticated;

-- Whether two authors, as typed, may be the same people: either is blank,
-- one holds the other, or a name of two characters or more in one is in the
-- other (ブラッドベリ, レイ and レイ・ブラッドベリ 著). Words for a role (編集,
-- 監修, 翻訳…) are no one's name.
create function private.same_author_text(author_a text, author_b text) returns boolean
language sql immutable set search_path = '' as $$
  with f as (
    select private.fold_book_text(author_a) as aa, private.fold_book_text(author_b) as ab
  ),
  names as (
    select private.fold_book_text(x.name) as name, 'a' as side
    from regexp_split_to_table(normalize(coalesce(author_a, ''), nfkc), '[\s,、，・/&;]+') x (name)
    union all
    select private.fold_book_text(x.name), 'b'
    from regexp_split_to_table(normalize(coalesce(author_b, ''), nfkc), '[\s,、，・/&;]+') x (name)
  )
  select f.aa = '' or f.ab = '' or strpos(f.aa, f.ab) > 0 or strpos(f.ab, f.aa) > 0
    or exists (
      select 1 from names n
      where char_length(n.name) >= 2
        and n.name not in ('編集', '監修', '著者', '原作', '翻訳', '共著', '編著',
          '監訳', '作画', '原著', '写真', 'イラスト', 'ほか', 'その他')
        and strpos(case n.side when 'a' then f.ab else f.aa end, n.name) > 0
    )
  from f
$$;
revoke all on function private.same_author_text(text, text) from public, anon, authenticated;

-- Whether two books of one ISBN read as one book. A title agrees when either
-- is blank, both are the same, or one of two characters or more is in the
-- other, folded (華氏451度 and 華氏451度 新訳版; ノルウェイの森 and
-- ノルウェイの森 上, which one ISBN names once); the authors agree as
-- same_author_text says. Anything else is a clear disagreement, and the
-- operator looks at it.
create function private.same_edition_text(
  title_a text, author_a text, title_b text, author_b text
) returns boolean
language sql immutable set search_path = '' as $$
  with f as (
    select private.fold_book_text(title_a) as ta, private.fold_book_text(title_b) as tb
  )
  select
    (f.ta = '' or f.tb = '' or f.ta = f.tb
      or (least(char_length(f.ta), char_length(f.tb)) >= 2
        and (strpos(f.ta, f.tb) > 0 or strpos(f.tb, f.ta) > 0)))
    and private.same_author_text(author_a, author_b)
  from f
$$;
revoke all on function private.same_edition_text(text, text, text, text)
  from public, anon, authenticated;

-- Works ---------------------------------------------------------------------------

create table public.works (
  id uuid primary key default gen_random_uuid(),
  -- Set when the operator joined this work into another: its editions went
  -- there, and it stays, empty, so an id that named it still leads somewhere.
  merged_into uuid references public.works (id),
  created_at timestamptz not null default now(),
  constraint works_not_into_itself check (merged_into is distinct from id)
);
alter table public.works enable row level security;
revoke all on public.works from public, anon, authenticated;

alter table public.books add column work_id uuid;

-- How each book came to share its work, so any of it can be undone. isbn: it
-- joined a work with a book of its ISBN in it, at registration (or named);
-- named: a catalog import or the operator named a work with no book of its
-- ISBN; join and part: the operator's. A book given a work of its own at
-- registration has no row.
create table private.work_changes (
  id uuid primary key default gen_random_uuid(),
  book_id uuid not null references public.books (id) on delete cascade,
  from_work uuid references public.works (id),
  to_work uuid not null references public.works (id),
  kind text not null check (kind in ('isbn', 'named', 'join', 'part')),
  changed_at timestamptz not null default now(),
  check ((kind in ('isbn', 'named')) = (from_work is null))
);
create index work_changes_book on private.work_changes (book_id);
alter table private.work_changes enable row level security;
revoke all on private.work_changes from public, anon, authenticated;

-- Two works the operator found to be different, so the candidates leave
-- them out. One row a pair, the smaller id first.
create table private.works_apart (
  work_a uuid not null references public.works (id),
  work_b uuid not null references public.works (id),
  decided_at timestamptz not null default now(),
  primary key (work_a, work_b),
  check (work_a < work_b)
);
alter table private.works_apart enable row level security;
revoke all on private.works_apart from public, anon, authenticated;

-- The work a book of this ISBN belongs to, if any: that of a book of the
-- same ISBN that reads as the same book, a catalog row's first, then the
-- oldest's. Books not yet given a work (while this file gives them theirs)
-- are passed over.
create function private.isbn_work(isbn text, title text, author text) returns uuid
language sql stable security definer set search_path = '' as $$
  select b.work_id
  from public.books b
  where b.isbn = isbn_work.isbn
    and b.work_id is not null
    and private.same_edition_text(b.title, b.author, isbn_work.title, isbn_work.author)
  order by b.source = 'ndl' desc, b.created_at, b.id
  limit 1
$$;
revoke all on function private.isbn_work(text, text, text) from public, anon, authenticated;

-- The books there are now, by the same rules, catalog rows and then the
-- oldest first. They keep their updated_at: their own data is as it was.
alter table public.books disable trigger books_touch;
do $$
declare
  b record;
  found_work uuid;
begin
  for b in
    select id, isbn, title, author, created_at from public.books
    order by source = 'ndl' desc, created_at, id
  loop
    found_work := case when b.isbn is not null
      then private.isbn_work(b.isbn, b.title, b.author) end;
    if found_work is null then
      insert into public.works (created_at) values (b.created_at)
      returning id into found_work;
    else
      insert into private.work_changes (book_id, to_work, kind, changed_at)
      values (b.id, found_work, 'isbn', b.created_at);
    end if;
    update public.books set work_id = found_work where id = b.id;
  end loop;
end;
$$;
alter table public.books enable trigger books_touch;

-- A book is never without a work, and a work with editions is never deleted
-- (the operator's joins leave it, merged_into set).
alter table public.books
  alter column work_id set not null,
  add constraint books_work_id_fkey foreign key (work_id)
    references public.works (id) on delete restrict;
create index books_work on public.books (work_id);

-- A new book's work ------------------------------------------------------------------

-- Before a book is inserted, it is given its work: isbn_work's, or a new one.
-- A book sent again (the app's upsert ignores duplicates) meets its own row
-- and is given that row's work, so no work is made for nothing. A work named
-- in the insert stays, or the one it was joined into: only the operator and
-- a catalog import can name one, as readers have no grant on the column.
-- Security definer, to find a book of the same ISBN that the reader cannot
-- read and to make a work, which readers cannot. It only ever writes into the
-- row being inserted, and what it writes is a work id, which shows nothing.
-- Two books of one ISBN inserted at once wait for each other, so they meet.
create function private.book_work() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  found_work uuid;
begin
  if new.work_id is not null then
    select coalesce(w.merged_into, w.id) into found_work
    from public.works w where w.id = new.work_id;
    new.work_id := coalesce(found_work, new.work_id);
    return new;
  end if;
  select b.work_id into found_work from public.books b where b.id = new.id;
  if found then
    new.work_id := found_work;
    return new;
  end if;
  if new.isbn is not null then
    perform pg_advisory_xact_lock(hashtext('book-town.works'), hashtext(new.isbn));
    found_work := private.isbn_work(new.isbn, new.title, new.author);
  end if;
  if found_work is null then
    insert into public.works default values returning id into found_work;
  end if;
  new.work_id := found_work;
  return new;
end;
$$;
revoke all on function private.book_work() from public, anon, authenticated;
create trigger books_work before insert on public.books
  for each row execute function private.book_work();

-- Once books are in, each that joined a work with others in it is written
-- down: those of a work that had books already, and all but the first of
-- the books of one work sent together. Only rows really inserted get here,
-- not a duplicate the upsert passed over.
create function private.book_work_placed() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into private.work_changes (book_id, to_work, kind)
  select a.id, a.work_id,
    case when exists (
      select 1 from public.books b
      where b.work_id = a.work_id and b.id <> a.id and b.isbn = a.isbn
    ) then 'isbn' else 'named' end
  from added a
  where exists (
    select 1 from public.books b
    where b.work_id = a.work_id and b.id <> a.id
      and (b.id < a.id or not exists (select 1 from added x where x.id = b.id))
  );
  return null;
end;
$$;
revoke all on function private.book_work_placed() from public, anon, authenticated;
create trigger books_work_placed after insert on public.books
  referencing new table as added
  for each statement execute function private.book_work_placed();

-- Readers write every column of a book they typed in as before, except its
-- work. A reader who sends a work_id is refused; the app never does.
revoke insert, update on public.books from authenticated;
grant insert (id, isbn, title, author, publisher, price, source, created_by,
  created_at, updated_at),
  update (id, isbn, title, author, publisher, price, source, created_by,
  created_at, updated_at)
  on public.books to authenticated;
grant select (work_id) on public.books to anon, authenticated;

-- The operator's tools ------------------------------------------------------------------
-- Run in the Supabase dashboard as the operator. They take books' ids, as
-- the operator finds books (select id, title, work_id from books where …).
-- Book ids never go in the public repository: a typed-in book's id is what
-- keeps it private (hide_registered_titles).

-- Joins the work of goes_with into the work of stays_with: every edition of
-- the one moves to the other, with all that points at them. Returns how many
-- books moved. Undo: part_books with the books that moved (work_changes,
-- kind 'join', at that time).
--   select private.join_works('<a book of the work that stays>', '<a book of the work that goes>');
create function private.join_works(stays_with uuid, goes_with uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  kept uuid;
  gone uuid;
  moved integer;
begin
  select b.work_id into kept from public.books b where b.id = stays_with;
  select b.work_id into gone from public.books b where b.id = goes_with;
  if kept is null or gone is null then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if kept = gone then
    raise exception 'the two books are one work already';
  end if;
  insert into private.work_changes (book_id, from_work, to_work, kind)
  select b.id, gone, kept, 'join' from public.books b where b.work_id = gone;
  update public.books set work_id = kept where work_id = gone;
  get diagnostics moved = row_count;
  -- Works joined into the one that goes now lead to the one that stays.
  update public.works set merged_into = kept where id = gone or merged_into = gone;
  -- What was decided about the work that went is about the one that stays.
  insert into private.works_apart (work_a, work_b, decided_at)
  select least(kept, o.other), greatest(kept, o.other), a.decided_at
  from private.works_apart a
  cross join lateral (
    select case when a.work_a = gone then a.work_b else a.work_a end as other
  ) o
  where gone in (a.work_a, a.work_b) and o.other <> kept
  on conflict do nothing;
  delete from private.works_apart a where gone in (a.work_a, a.work_b);
  return moved;
end;
$$;
revoke all on function private.join_works(uuid, uuid) from public, anon, authenticated;

-- Takes the books out of their works into one new work of their own, with
-- all that points at them: an edition joined by mistake, or a join undone.
-- The new work is kept apart from each work they left, so the pair does not
-- come back as a candidate. Returns the new work. A work left without
-- editions stays, empty. Undo: join_works again.
--   select private.part_books(array['<book>', '<book>']::uuid[]);
create function private.part_books(book_ids uuid[]) returns uuid
language plpgsql security definer set search_path = '' as $$
declare
  fresh uuid;
begin
  if coalesce(cardinality(book_ids), 0) = 0 then
    raise exception 'name the books to part';
  end if;
  if exists (
    select 1 from unnest(book_ids) given (id)
    where not exists (select 1 from public.books b where b.id = given.id)
  ) then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  insert into public.works default values returning id into fresh;
  insert into private.work_changes (book_id, from_work, to_work, kind)
  select b.id, b.work_id, fresh, 'part' from public.books b where b.id = any (book_ids);
  insert into private.works_apart (work_a, work_b)
  select distinct least(fresh, b.work_id), greatest(fresh, b.work_id)
  from public.books b where b.id = any (book_ids)
  on conflict do nothing;
  update public.books set work_id = fresh where id = any (book_ids);
  return fresh;
end;
$$;
revoke all on function private.part_books(uuid[]) from public, anon, authenticated;

-- Marks the works of two books as different works, so work_candidates
-- leaves the pair out. Undo: delete the row from private.works_apart.
--   select private.keep_apart('<book>', '<book>');
create function private.keep_apart(book_a uuid, book_b uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  a uuid;
  b uuid;
begin
  select x.work_id into a from public.books x where x.id = book_a;
  select x.work_id into b from public.books x where x.id = book_b;
  if a is null or b is null then
    raise exception 'no book has that id' using errcode = 'P0002';
  end if;
  if a = b then
    raise exception 'the two books are one work; part one out first';
  end if;
  insert into private.works_apart (work_a, work_b)
  values (least(a, b), greatest(a, b))
  on conflict do nothing;
end;
$$;
revoke all on function private.keep_apart(uuid, uuid) from public, anon, authenticated;

-- What the operator may look at: books in different works that may be one.
-- isbn: the same ISBN, whose titles or authors disagree. title: titles the
-- same, or one the start of the other but for a number (華氏451度 and
-- 華氏451度 新訳版, never ONE PIECE 1 and ONE PIECE 10), folded, with any
-- ISBN or none, by authors that agree (same_author_text), neither blank:
-- a title alone is too little to go on. One pair for each two works, not
-- kept apart. Those that touch the most come first: the readers with either
-- in their library, the public reviews of either, and the open shops showing
-- either on a public shelf or in their scene. Nothing is joined by it.
--   select * from private.work_candidates();
create function private.work_candidates()
returns table (
  reason text,
  book_a uuid,
  book_b uuid,
  title_a text,
  title_b text,
  author_a text,
  author_b text,
  isbn_a text,
  isbn_b text,
  readers bigint,
  reviews bigint,
  shops bigint
)
language sql stable security definer set search_path = '' as $$
  with folded as (
    select b.id, b.work_id, b.title, b.author, b.isbn,
      private.fold_book_text(b.title) as title_key,
      private.fold_book_text(b.author) as author_key
    from public.books b
  ),
  pairs as (
    select 'isbn' as reason, a.id as a_id, b.id as b_id, a.work_id as a_work, b.work_id as b_work
    from folded a join folded b on b.isbn = a.isbn and b.work_id > a.work_id
    union all
    select 'title', a.id, b.id, a.work_id, b.work_id
    from folded a
    join folded b on left(b.title_key, 2) = left(a.title_key, 2)
      and b.work_id > a.work_id
    cross join lateral (
      select case when char_length(a.title_key) <= char_length(b.title_key)
        then substr(b.title_key, char_length(a.title_key) + 1)
        else substr(a.title_key, char_length(b.title_key) + 1) end as rest
    ) r
    where a.title_key <> '' and a.author_key <> '' and b.author_key <> ''
      and (starts_with(a.title_key, b.title_key) or starts_with(b.title_key, a.title_key))
      and r.rest !~ '^[0-9]'
      and private.same_author_text(a.author, b.author)
  ),
  chosen as (
    select distinct on (p.a_work, p.b_work) p.*
    from pairs p
    where not exists (
      select 1 from private.works_apart x
      where x.work_a = least(p.a_work, p.b_work) and x.work_b = greatest(p.a_work, p.b_work)
    )
    order by p.a_work, p.b_work, p.reason, p.a_id, p.b_id
  ),
  scored as (
    select c.reason, c.a_id, c.b_id,
      (select count(distinct l.user_id) from public.library_entries l
       join public.books e on e.id = l.book_id
       where e.work_id in (c.a_work, c.b_work) and l.removed_at is null) as readers,
      (select count(*) from public.posts p
       join public.books e on e.id = p.book_id
       where e.work_id in (c.a_work, c.b_work)
         and p.parent_id is null and p.reading_mode is distinct from 'solo') as reviews,
      (select count(*) from public.shops s
       where s.is_open and exists (
         select 1 from public.books e
         where e.work_id in (c.a_work, c.b_work)
           and (s.public_scene_books @> jsonb_build_array(e.id::text)
             or s.public_shelves @> jsonb_build_array(jsonb_build_object(
               'items', jsonb_build_array(jsonb_build_object('bookId', e.id::text)))))
       )) as shops
    from chosen c
  )
  select s.reason, a.id, b.id, a.title, b.title, a.author, b.author, a.isbn, b.isbn,
    s.readers, s.reviews, s.shops
  from scored s
  join folded a on a.id = s.a_id
  join folded b on b.id = s.b_id
  order by s.readers + s.reviews + s.shops desc, s.reason, a.id, b.id
$$;
revoke all on function private.work_candidates() from public, anon, authenticated;

-- The check ---------------------------------------------------------------------------

-- Besides check_copy's rows and links: every book kept its own columns,
-- books share a work only when they share an ISBN, and every work has a
-- book. Counts only in the messages: they land in public Actions logs.
do $$
declare
  copy_table text;
  changed bigint;
begin
  select c.copy_name into copy_table from keep.copies c
  where c.label = '20261027000000_works' and c.source = 'public.books';
  execute format(
    'select count(*) from keep.%I c join public.books b on b.id = c.id
     where (b.isbn, b.title, b.author, b.publisher, b.price, b.source, b.created_by,
            b.created_at, b.updated_at)
       is distinct from (c.isbn, c.title, c.author, c.publisher, c.price, c.source,
            c.created_by, c.created_at, c.updated_at)',
    copy_table) into changed;
  if changed > 0 then
    raise exception 'the move changed % books', changed;
  end if;
  select count(*) into changed from public.books b join public.books o
    on o.work_id = b.work_id and o.id <> b.id
    and (o.isbn is null or b.isbn is null or o.isbn <> b.isbn);
  if changed > 0 then
    raise exception '% books share a work without sharing an ISBN', changed;
  end if;
  select count(*) into changed from public.works w
  where not exists (select 1 from public.books b where b.work_id = w.id);
  if changed > 0 then
    raise exception '% works have no book', changed;
  end if;
end;
$$;

select private.check_copy('20261027000000_works');
